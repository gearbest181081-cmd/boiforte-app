-- BoiForte: Lixeira. Nada do que se apaga no app some do banco: o registro fica guardado e pode voltar.
--
-- O que esta migração faz:
--   1. "registros" ganha a coluna "lixeira": o pacote do que foi apagado junto num toque (ex.: o lote com as pesagens
--      e as vacinas dele). Só tem valor enquanto o registro está apagado.
--   2. enviar_alteracoes, ao apagar: marca como apagado (excluido) e GUARDA os dados (antes, os dados saíam do registro
--      e ficavam só na auditoria). O pacote vem do app; se não vier (app antigo), o servidor cria um por envio.
--      Quando é o próprio app trocando um registro por outro (lixeira = false), os dados ficam, mas fora da lixeira.
--      Restaurar = gravar de novo o mesmo registro (mesmo gid), com as mesmas regras de sempre: quem pode gravar aquela
--      tabela, referências que existem e não estão apagadas, contas refeitas no servidor e os gatilhos (um lote por piquete,
--      área do módulo, cadastro de funcionário...). Fica na auditoria como "restaurar".
--      O vaqueiro que restaura um trato ou um movimento de estoque fica com o custo/valor que o servidor já tinha
--      (ele não vê preço). O vaqueiro continua sem poder apagar nem restaurar lote.
--   3. baixar_alteracoes manda também o que está na lixeira (com os dados, quando foi apagado e o nome de quem apagou),
--      para todos os celulares da equipe verem a mesma lixeira. O vaqueiro continua recebendo sem os valores em dinheiro
--      e sem as tabelas de dinheiro, como antes.
--   4. NDVI: ao apagar um piquete, o NDVI dele fica guardado; se o piquete voltar, o NDVI volta junto.
--   5. Anotação restaurada continua com quem anotou (não passa a ser de quem restaurou).
--   6. O que foi apagado ANTES desta migração volta para a lixeira, com os dados guardados na auditoria
--      (o que foi apagado no mesmo envio vira um item só). Fica de fora a despesa ou o movimento de estoque que o app
--      refez sozinho (a compra, a vacina, a batida ou o trato a que ele pertence continua lá), para não lançar duas vezes.
--
-- Não muda: apagar a conta (apagar_minha_conta, LGPD) e apagar a fazenda da nuvem (apagar_fazenda) continuam apagando
-- de verdade: a lei manda e a pessoa confirma digitando. Ninguém lê "registros" direto (só pelas funções), como antes.
--
-- Depende de 20261124150000_pasto.sql. Pode rodar antes ou depois das migrações da Cria, da rastreabilidade e da área
-- do módulo (elas não mexem nestas funções). Pode rodar de novo sem estragar nada.

-- ---------------------------------------------------------------- 1. coluna
alter table public.registros add column if not exists lixeira uuid;
comment on column public.registros.lixeira is 'Pacote da lixeira (o que foi apagado junto). Só enquanto excluido = true.';

-- ---------------------------------------------------------------- 2. enviar_alteracoes
-- Mesmo corpo de 20261124150000_pasto.sql; as mudanças estão marcadas com "LIXEIRA".
create or replace function public.enviar_alteracoes(f uuid, ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.bf_exigir_login();
  meu public.papel := public.bf_papel(f);
  op jsonb; tab text; g text; acao text;
  antigo public.registros; limpo jsonb; v bigint; san jsonb;
  resposta jsonb := '[]'::jsonb; msg text;
  lx uuid; lx_envio uuid := gen_random_uuid(); -- LIXEIRA: pacote para o que vier sem (app antigo): um por envio
begin
  if meu is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  if meu = 'consultor' then perform public.bf_erro('Consultor só pode ver os dados.'); end if;
  if ops is null or jsonb_typeof(ops) <> 'array' then perform public.bf_erro('Envio inválido.'); end if;
  if jsonb_array_length(ops) > 500 then perform public.bf_erro('Envio grande demais (máximo de 500 registros por vez).'); end if;
  if octet_length(ops::text) > 4000000 then perform public.bf_erro('Envio grande demais.'); end if;
  perform public.bf_limite('enviar', 120, 60);

  for op in select value from jsonb_array_elements(ops) loop
    tab := op->>'tabela'; g := op->>'gid'; acao := op->>'op';
    begin
      if tab is null or not exists (select 1 from public.bf_esquemas e where e.tabela = tab) then perform public.bf_erro('Tabela desconhecida.'); end if;
      if g is null or (tab = 'config' and g !~ '^[A-Za-z][A-Za-z0-9_]{0,39}$')
         or (tab <> 'config' and g !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        perform public.bf_erro('Identificador inválido.');
      end if;
      if acao not in ('put', 'del') then perform public.bf_erro('Operação inválida.'); end if;
      if meu = 'vaqueiro' and not (tab = any (public.bf_vaqueiro_grava())) then perform public.bf_erro('Seu papel não permite mudar isto.'); end if;

      select * into antigo from public.registros r where r.fazenda_id = f and r.tabela = tab and r.gid = g for update;

      if acao = 'del' then
        if meu = 'vaqueiro' and (tab = 'lotes' or (tab = 'lancamentos' and coalesce(antigo.dados->>'origem', '') <> 'sanidade')) then
          perform public.bf_erro('Seu papel não permite apagar isto.');
        end if;
        if antigo.gid is null or antigo.excluido then
          resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', coalesce(antigo.versao, 0)));
          continue;
        end if;
        -- LIXEIRA: os dados ficam no registro (só marca como apagado), com o pacote do que foi apagado junto.
        -- "lixeira": false = o próprio app trocou o registro por outro (ex.: a despesa da vacina refeita): os dados
        -- ficam, mas não aparece na lixeira.
        lx := case when op->'lixeira' = 'false'::jsonb then null
                   when coalesce(op->>'lixeira', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (op->>'lixeira')::uuid
                   else lx_envio end;
        v := nextval('public.registros_versao');
        update public.registros set excluido = true, lixeira = lx, versao = v, atualizado_em = now(), atualizado_por = u
          where fazenda_id = f and tabela = tab and gid = g;
        insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes) values (f, u, 'apagar', tab, g, antigo.dados);
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', v));
        continue;
      end if;

      limpo := public.bf_recalcular(tab, public.bf_validar(tab, op->'dados', f));
      if tab = 'config' and limpo->>'chave' <> g then perform public.bf_erro('Configuração inválida.'); end if;

      if meu = 'vaqueiro' and tab = 'lotes' then
        -- PASTO: além da quantidade de cabeças, o piquete (o vaqueiro leva o gado de um piquete para outro).
        if antigo.gid is null or antigo.excluido or (antigo.dados - 'qtdCabecas' - 'piqueteId') <> (limpo - 'qtdCabecas' - 'piqueteId') then
          perform public.bf_erro('O vaqueiro só pode atualizar a quantidade de cabeças e o piquete do lote.');
        end if;
      end if;
      if meu = 'vaqueiro' and tab = 'lancamentos' then
        if limpo->>'origem' is distinct from 'sanidade' or (antigo.gid is not null and antigo.dados->>'origem' is distinct from 'sanidade') then
          perform public.bf_erro('Seu papel não permite lançar dinheiro.');
        end if;
        -- A4: só a despesa da vacina, com o valor e a data da aplicação gravada no servidor.
        select r.dados into san from public.registros r
          where r.fazenda_id = f and r.tabela = 'sanidade' and r.gid = limpo->>'refId' and not r.excluido;
        if san is null or coalesce((san->>'custo')::numeric, 0) <= 0 then
          perform public.bf_erro('O lançamento da vacina precisa apontar para uma aplicação com custo.');
        end if;
        if limpo->>'tipo' <> 'despesa' or limpo->>'categoria' <> 'sanidade' then
          perform public.bf_erro('Seu papel não permite lançar dinheiro.');
        end if;
        limpo := limpo || jsonb_build_object('valor', round((san->>'custo')::numeric, 2), 'data', san->'data');
      end if;
      if meu = 'vaqueiro' and tab = 'fornecimentos' then
        -- A4: o custo do trato vem do servidor (o celular do vaqueiro não tem os preços).
        -- LIXEIRA: restaurando, fica o custo guardado (antes, só valia o do registro não apagado).
        limpo := limpo || jsonb_build_object('custo',
          case when antigo.gid is not null and antigo.dados ? 'custo' then antigo.dados->'custo'
               else to_jsonb(public.bf_custo_fornecimento(f, limpo)) end);
      end if;
      if meu = 'vaqueiro' and tab = 'movimentos' then
        -- A4: o vaqueiro não define valor em dinheiro do estoque; o que já existia fica (LIXEIRA: também o guardado).
        limpo := (limpo - 'valor') || case when antigo.gid is not null and antigo.dados ? 'valor'
                                          then jsonb_build_object('valor', antigo.dados->'valor') else '{}'::jsonb end;
      end if;

      if antigo.gid is not null and not antigo.excluido and antigo.dados = limpo then
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', antigo.versao,
          'dados', case when meu = 'vaqueiro' then public.bf_sem_dinheiro(tab, limpo) else limpo end));
        continue;
      end if;

      if antigo.gid is null then
        update public.fazendas set total_registros = total_registros + 1 where id = f and total_registros < 2000000;
        if not found then perform public.bf_erro('A fazenda chegou ao limite de registros.'); end if;
      end if;

      v := nextval('public.registros_versao');
      insert into public.registros as r (fazenda_id, tabela, gid, dados, excluido, versao, atualizado_por)
        values (f, tab, g, limpo, false, v, u)
        on conflict (fazenda_id, tabela, gid) do update set dados = excluded.dados, excluido = false, versao = excluded.versao,
          atualizado_em = now(), atualizado_por = excluded.atualizado_por, lixeira = null; -- LIXEIRA: saiu da lixeira
      if antigo.gid is not null and antigo.excluido then
        -- LIXEIRA: voltou da lixeira (antes = o que estava guardado; vazio se foi apagado antes desta migração)
        insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes, depois) values (f, u, 'restaurar', tab, g, antigo.dados, limpo);
      elsif tab in ('lancamentos', 'vendas', 'custosFixos', 'config', 'fornecimentos', 'movimentos') then
        insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes, depois) values (f, u, 'gravar', tab, g, antigo.dados, limpo);
      end if;
      resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', v,
        'dados', case when meu = 'vaqueiro' then public.bf_sem_dinheiro(tab, limpo) else limpo end));
    exception
      when sqlstate 'P0001' then
        get stacked diagnostics msg = message_text;
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', false, 'erro', msg));
      when others then
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', false, 'erro', 'Não foi possível gravar este registro.'));
    end;
  end loop;
  return resposta;
end $$;

-- ---------------------------------------------------------------- 3. baixar_alteracoes (com a lixeira)
-- Mesmas regras de 20261123130000_correcoes_seguranca.sql (o vaqueiro não recebe o dinheiro) e 3 colunas a mais:
-- lixeira, apagado_em e apagado_por (nome de quem apagou, como está na equipe). Mudou o que a função devolve,
-- então ela é recriada (o app antigo ignora as colunas novas).
drop function if exists public.baixar_alteracoes(uuid, bigint, integer);
create function public.baixar_alteracoes(f uuid, desde bigint, limite integer default 1000)
returns table (tabela text, gid text, dados jsonb, excluido boolean, versao bigint, lixeira uuid, apagado_em timestamptz, apagado_por text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare meu public.papel := public.bf_papel(f);
begin
  perform public.bf_exigir_login();
  if meu is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  if meu <> 'vaqueiro' then
    return query
      select r.tabela, r.gid, r.dados, r.excluido, r.versao,
             case when r.excluido then r.lixeira end,
             case when r.excluido and r.lixeira is not null then r.atualizado_em end,
             case when r.excluido and r.lixeira is not null then coalesce(nullif(btrim(m.nome), ''), 'Alguém da equipe') end
      from public.registros r
      left join public.membros m on m.fazenda_id = r.fazenda_id and m.usuario_id = r.atualizado_por
      where r.fazenda_id = f and r.versao > coalesce(desde, 0)
      order by r.versao
      limit least(greatest(coalesce(limite, 1000), 1), 2000);
  else
    return query
      select r.tabela, r.gid,
             case when r.tabela = 'config' and r.gid = any (public.bf_config_dinheiro()) then null
                  else public.bf_sem_dinheiro(r.tabela, r.dados) end,
             r.excluido or (r.tabela = 'config' and r.gid = any (public.bf_config_dinheiro())),
             r.versao,
             case when r.excluido and r.tabela <> 'config' then r.lixeira end,
             case when r.excluido and r.tabela <> 'config' and r.lixeira is not null then r.atualizado_em end,
             case when r.excluido and r.tabela <> 'config' and r.lixeira is not null then coalesce(nullif(btrim(m.nome), ''), 'Alguém da equipe') end
      from public.registros r
      left join public.membros m on m.fazenda_id = r.fazenda_id and m.usuario_id = r.atualizado_por
      where r.fazenda_id = f and r.versao > coalesce(desde, 0) and r.tabela = any (public.bf_vaqueiro_le())
      order by r.versao
      limit least(greatest(coalesce(limite, 1000), 1), 2000);
  end if;
end $$;

-- ---------------------------------------------------------------- 4. NDVI vai e volta com o piquete
create or replace function public.bf_ndvi_do_piquete_apagado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- LIXEIRA: o NDVI fica guardado (mesmo pacote do piquete) em vez de perder os dados.
  update public.registros r set excluido = true, lixeira = new.lixeira, versao = nextval('public.registros_versao'), atualizado_em = now(), atualizado_por = null
    where r.fazenda_id = new.fazenda_id and r.tabela = 'ndvi' and not r.excluido and r.dados->>'piqueteId' = new.gid;
  return null;
end $$;

-- O piquete voltou da lixeira: o NDVI guardado dele volta junto (e desce para os celulares).
create or replace function public.bf_ndvi_do_piquete_restaurado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.registros r set excluido = false, lixeira = null, versao = nextval('public.registros_versao'), atualizado_em = now(), atualizado_por = null
    where r.fazenda_id = new.fazenda_id and r.tabela = 'ndvi' and r.excluido and r.dados is not null and r.dados->>'piqueteId' = new.gid;
  return null;
end $$;
drop trigger if exists registros_ndvi_piquete_restaurado on public.registros;
create trigger registros_ndvi_piquete_restaurado after update on public.registros
  for each row when (new.tabela = 'piquetes' and old.excluido and not new.excluido) execute function public.bf_ndvi_do_piquete_restaurado();

-- ---------------------------------------------------------------- 5. anotação restaurada continua de quem anotou
-- Mesmo corpo de 20261123170000_anotacoes.sql; só muda "velho" (marcado com LIXEIRA).
create or replace function public.bf_anotacoes_antes_gravar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- LIXEIRA: o registro apagado agora guarda os dados; ao restaurar, autor e "feita por" vêm de lá.
  velho jsonb := case when tg_op = 'UPDATE' then old.dados end;
  quem uuid := new.atualizado_por;
  nome_quem text;
  papel_quem public.papel;
  foto jsonb;
begin
  select coalesce(nullif(btrim(m.nome), ''), 'Alguém da equipe'), m.papel into nome_quem, papel_quem
    from public.membros m where m.fazenda_id = new.fazenda_id and m.usuario_id = quem;
  nome_quem := coalesce(nome_quem, 'Alguém da equipe');

  if new.excluido or new.dados is null then
    -- Apagar: o vaqueiro só apaga o que ele mesmo anotou.
    if papel_quem = 'vaqueiro' and velho is not null and not old.excluido and (velho->>'autorId') is distinct from quem::text then
      perform public.bf_erro('Anotação: só quem anotou, o gerente ou o dono podem apagar.');
    end if;
    return new;
  end if;

  -- Fotos: só ids no formato certo (o caminho no Storage é montado com eles).
  for foto in select value from jsonb_array_elements(coalesce(new.dados->'fotos', '[]'::jsonb)) loop
    if coalesce(foto->>'foto', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public.bf_erro('Anotação: foto inválida.');
    end if;
  end loop;

  -- Quem anotou: na primeira gravação é quem enviou; depois não muda mais.
  if velho is null then
    new.dados := new.dados || jsonb_build_object('autor', nome_quem, 'autorId', quem::text);
  else
    new.dados := (new.dados - 'autor' - 'autorId')
      || jsonb_strip_nulls(jsonb_build_object('autor', velho->'autor', 'autorId', velho->'autorId'));
  end if;

  -- Quem resolveu: quem marcou como feita. Voltou para "a fazer": some.
  if coalesce((new.dados->>'feita')::boolean, false) then
    if velho is not null and coalesce((velho->>'feita')::boolean, false) then
      new.dados := (new.dados - 'feitaPor') || jsonb_strip_nulls(jsonb_build_object('feitaPor', velho->'feitaPor'));
    else
      new.dados := new.dados || jsonb_build_object('feitaPor', nome_quem);
    end if;
  else
    new.dados := new.dados - 'feitaPor' - 'feitaEm';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 6. o que já tinha sido apagado volta para a lixeira
-- Os dados vêm da auditoria (a última vez que cada registro foi apagado). O que foi apagado no mesmo envio
-- (mesma pessoa, mesmo momento) vira um pacote só. Um registro com problema não impede os outros.
-- Não muda quem apagou nem quando (atualizado_por/atualizado_em já são da hora em que foi apagado).
do $$
declare a record;
begin
  for a in
    select distinct on (au.fazenda_id, au.tabela, au.gid) au.fazenda_id, au.tabela, au.gid, au.antes, au.usuario_id, au.em
    from public.auditoria au
    join public.registros r on r.fazenda_id = au.fazenda_id and r.tabela = au.tabela and r.gid = au.gid and r.excluido and r.dados is null
    where au.acao = 'apagar' and au.antes is not null and jsonb_typeof(au.antes) = 'object' and au.tabela not in ('config', 'ndvi')
      -- a despesa/movimento que o app refez sozinho: o registro de origem continua lá
      and not exists (
        select 1 from public.registros o
        where o.fazenda_id = au.fazenda_id and not o.excluido and o.gid = au.antes->>'refId'
          and o.tabela = case
            when au.tabela = 'lancamentos' and au.antes->>'origem' = 'compra_lote' then 'lotes'
            when au.tabela = 'lancamentos' and au.antes->>'origem' = 'sanidade' then 'sanidade'
            when au.tabela = 'movimentos' and au.antes->>'origem' = 'batida' then 'batidas'
            when au.tabela = 'movimentos' and au.antes->>'origem' = 'fornecimento' then 'fornecimentos'
          end)
    order by au.fazenda_id, au.tabela, au.gid, au.em desc, au.id desc
  loop
    begin
      update public.registros r
        set dados = a.antes,
            lixeira = md5(a.fazenda_id::text || '/' || coalesce(a.usuario_id::text, '') || '/' || a.em::text)::uuid,
            versao = nextval('public.registros_versao')
        where r.fazenda_id = a.fazenda_id and r.tabela = a.tabela and r.gid = a.gid and r.excluido and r.dados is null;
    exception when others then
      raise notice 'Lixeira: % % ficou sem voltar (%).', a.tabela, a.gid, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- permissões
-- baixar_alteracoes foi recriada: liberar de novo para quem tem login. Gatilhos não são chamados pela API.
revoke execute on function public.baixar_alteracoes(uuid, bigint, integer) from public, anon;
grant execute on function public.baixar_alteracoes(uuid, bigint, integer) to authenticated;
revoke execute on function public.bf_ndvi_do_piquete_restaurado() from public, anon, authenticated;

notify pgrst, 'reload schema';
