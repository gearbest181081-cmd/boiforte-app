-- BoiForte: correções da auditoria de segurança de 23/11/2026 (achados A1 a A6).
-- Antes de rodar no Supabase, rode esta consulta. Ela tem de voltar VAZIA ou só com contas
-- que você não conhece (contas com senha ficam bloqueadas por esta migração):
--   select id, email, created_at from auth.users where coalesce(encrypted_password, '') <> '';

-- ---------------------------------------------------------------- A1: conta criada com senha não entra
-- O app só entra por código no e-mail. Uma conta com senha foi criada pela API, sem passar pelo app,
-- e pode ser de alguém que se cadastrou com o e-mail de outra pessoa. O banco ignora essa conta.
-- (A correção principal é ligar "Confirm email" no painel; isto é a segunda tranca.)
create function public.bf_uid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from auth.users u where u.id = auth.uid() and coalesce(u.encrypted_password, '') = ''
$$;

create or replace function public.bf_exigir_login() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then perform public.bf_erro('Faça login para continuar.'); end if;
  if public.bf_uid() is null then
    perform public.bf_erro('Esta conta foi criada fora do app (com senha) e está bloqueada. Fale com o suporte do BoiForte.');
  end if;
  return u;
end $$;

create or replace function public.bf_papel(f uuid) returns public.papel
language sql stable security definer set search_path = public, pg_temp as $$
  select papel from public.membros where fazenda_id = f and usuario_id = public.bf_uid()
$$;

create or replace function public.minhas_fazendas() returns table (fazenda_id uuid, nome text, papel public.papel)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, f.nome, m.papel from public.membros m join public.fazendas f on f.id = m.fazenda_id
  where m.usuario_id = public.bf_uid() order by f.nome
$$;

-- ---------------------------------------------------------------- A5: a fazenda não depende da conta de quem criou
-- Antes, apagar a conta de quem criou a fazenda apagava a fazenda de todos (on delete cascade).
-- A posse fica só em "membros"; criado_por vira só um registro histórico.
alter table public.fazendas alter column criado_por drop not null;
alter table public.fazendas drop constraint fazendas_criado_por_fkey;
alter table public.fazendas add constraint fazendas_criado_por_fkey
  foreign key (criado_por) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------- A3: o vaqueiro não recebe dinheiro
-- Configurações de dinheiro que o vaqueiro não recebe (chegam a ele como apagadas).
create function public.bf_config_dinheiro() returns text[] language sql immutable as $$
  select array['precoArroba', 'comissaoVenda', 'oportunidadeMes']
$$;

-- Zera ou tira os campos de dinheiro (zero, e não ausente, porque o app exige o número).
-- sanidade.custo continua: é o próprio vaqueiro que lança o custo da vacina.
create function public.bf_sem_dinheiro(tabela text, d jsonb) returns jsonb language sql immutable as $$
  select case
    when d is null then null
    when tabela = 'ingredientes' then d || '{"preco": 0}'::jsonb
    when tabela = 'formulas' then d - 'custoEstoque'
    when tabela = 'movimentos' then d - 'valor'
    when tabela = 'fornecimentos' then d || '{"custo": 0}'::jsonb
    when tabela = 'batidas' then d || jsonb_build_object('custoTotal', 0, 'itens',
      coalesce((select jsonb_agg(i || '{"custo": 0}'::jsonb) from jsonb_array_elements(d->'itens') i), '[]'::jsonb))
    else d end
$$;

-- Custo do trato calculado no servidor (igual a registrarFornecimento em src/db.ts):
-- mistura batida usa o custo do estoque; senão, a soma das partes pelo preço de cada ingrediente.
create function public.bf_custo_fornecimento(f uuid, d jsonb) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare fo jsonb; kg numeric := coalesce((d->>'kgFornecido')::numeric, 0); total numeric; custo_kg numeric;
begin
  select r.dados into fo from public.registros r
    where r.fazenda_id = f and r.tabela = 'formulas' and r.gid = d->>'formulaId' and not r.excluido;
  if fo is null then return 0; end if;
  if fo->>'modo' = 'batida' and fo ? 'custoEstoque' then
    return round(kg * (fo->>'custoEstoque')::numeric, 2);
  end if;
  select sum((i->>'qtd')::numeric) into total from jsonb_array_elements(fo->'itens') i where (i->>'qtd')::numeric > 0;
  if coalesce(total, 0) = 0 then return 0; end if;
  select coalesce(sum((i->>'qtd')::numeric / total * coalesce((r.dados->>'preco')::numeric, 0)), 0) into custo_kg
    from jsonb_array_elements(fo->'itens') i
    left join public.registros r on r.fazenda_id = f and r.tabela = 'ingredientes' and r.gid = i->>'ingredienteId' and not r.excluido
    where (i->>'qtd')::numeric > 0;
  return round(kg * custo_kg, 2);
end $$;

-- Leitura direta da tabela não passa pelo filtro de dinheiro: o app usa só baixar_alteracoes.
revoke select on public.registros from authenticated;

create or replace function public.baixar_alteracoes(f uuid, desde bigint, limite integer default 1000)
returns table (tabela text, gid text, dados jsonb, excluido boolean, versao bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare meu public.papel := public.bf_papel(f);
begin
  perform public.bf_exigir_login();
  if meu is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  if meu <> 'vaqueiro' then
    return query
      select r.tabela, r.gid, r.dados, r.excluido, r.versao from public.registros r
      where r.fazenda_id = f and r.versao > coalesce(desde, 0)
      order by r.versao
      limit least(greatest(coalesce(limite, 1000), 1), 2000);
  else
    return query
      select r.tabela, r.gid,
             case when r.tabela = 'config' and r.gid = any (public.bf_config_dinheiro()) then null
                  else public.bf_sem_dinheiro(r.tabela, r.dados) end,
             r.excluido or (r.tabela = 'config' and r.gid = any (public.bf_config_dinheiro())),
             r.versao
      from public.registros r
      where r.fazenda_id = f and r.versao > coalesce(desde, 0) and r.tabela = any (public.bf_vaqueiro_le())
      order by r.versao
      limit least(greatest(coalesce(limite, 1000), 1), 2000);
  end if;
end $$;

-- ---------------------------------------------------------------- A3 + A4: o que o vaqueiro grava
-- Mesmo corpo de antes, com as regras novas do vaqueiro marcadas com "A3/A4".
create or replace function public.enviar_alteracoes(f uuid, ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.bf_exigir_login();
  meu public.papel := public.bf_papel(f);
  op jsonb; tab text; g text; acao text;
  antigo public.registros; limpo jsonb; v bigint; san jsonb;
  resposta jsonb := '[]'::jsonb; msg text;
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
        v := nextval('public.registros_versao');
        update public.registros set excluido = true, dados = null, versao = v, atualizado_em = now(), atualizado_por = u
          where fazenda_id = f and tabela = tab and gid = g;
        insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes) values (f, u, 'apagar', tab, g, antigo.dados);
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', v));
        continue;
      end if;

      limpo := public.bf_recalcular(tab, public.bf_validar(tab, op->'dados', f));
      if tab = 'config' and limpo->>'chave' <> g then perform public.bf_erro('Configuração inválida.'); end if;

      if meu = 'vaqueiro' and tab = 'lotes' then
        if antigo.gid is null or antigo.excluido or (antigo.dados - 'qtdCabecas') <> (limpo - 'qtdCabecas') then
          perform public.bf_erro('O vaqueiro só pode atualizar a quantidade de cabeças do lote.');
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
        limpo := limpo || jsonb_build_object('custo',
          case when antigo.gid is not null and not antigo.excluido and antigo.dados ? 'custo' then antigo.dados->'custo'
               else to_jsonb(public.bf_custo_fornecimento(f, limpo)) end);
      end if;
      if meu = 'vaqueiro' and tab = 'movimentos' then
        -- A4: o vaqueiro não define valor em dinheiro do estoque; o que já existia fica.
        limpo := (limpo - 'valor') || case when antigo.gid is not null and not antigo.excluido and antigo.dados ? 'valor'
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
          atualizado_em = now(), atualizado_por = excluded.atualizado_por;
      if tab in ('lancamentos', 'vendas', 'custosFixos', 'config', 'fornecimentos', 'movimentos') then
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

-- Celulares de vaqueiro que já baixaram preços: estas linhas descem de novo, agora sem dinheiro.
-- Para dono, gerente e consultor elas chegam iguais (só repetem).
update public.registros set versao = nextval('public.registros_versao')
  where tabela in ('ingredientes', 'formulas', 'movimentos', 'batidas', 'fornecimentos')
     or (tabela = 'config' and gid = any (public.bf_config_dinheiro()));

-- ---------------------------------------------------------------- A2: teto geral da leitura por foto
-- Contador com chave escolhida (bf_limite conta por pessoa). A chave zero é o total do sistema.
create function public.bf_limite_chave(p_chave uuid, p_tipo text, p_maximo integer, p_segundos integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j timestamptz := to_timestamp(floor(extract(epoch from now()) / p_segundos) * p_segundos);
  c integer;
begin
  insert into public.limites as l (usuario_id, tipo, janela, contagem) values (p_chave, p_tipo, j, 1)
  on conflict on constraint limites_pkey do update set contagem = l.contagem + 1
  returning l.contagem into c;
  if c = 1 then delete from public.limites l where l.usuario_id = p_chave and l.tipo = p_tipo and l.janela < j; end if;
  if c > p_maximo then perform public.bf_erro('A leitura por foto chegou ao limite de hoje. Digite os valores ou tente amanhã.'); end if;
end $$;

-- 30 fotos por pessoa por dia (como antes) e no máximo 300 por dia no sistema todo.
-- Para mudar o teto geral, troque o 300 numa migração nova. Os planos (com e sem IA) vão entrar aqui.
create or replace function public.pode_usar_foto() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login();
begin
  if not exists (select 1 from public.membros m where m.usuario_id = u) then
    perform public.bf_erro('Ligue o celular a uma fazenda na nuvem para usar a leitura por foto.');
  end if;
  perform public.bf_limite('foto', 30, 86400);
  perform public.bf_limite_chave('00000000-0000-0000-0000-000000000000', 'foto_total', 300, 86400);
  return true;
end $$;

-- ---------------------------------------------------------------- A6: cancelar convite
create function public.cancelar_convite(f uuid, p_codigo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); k text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode cancelar convites.'); end if;
  update public.convites set expira_em = now() where codigo = k and fazenda_id = f and usado_por is null and expira_em > now();
  if not found then perform public.bf_erro('Convite não encontrado ou já usado.'); end if;
  insert into public.auditoria (fazenda_id, usuario_id, acao, depois) values (f, u, 'cancelar_convite', jsonb_build_object('codigo', k));
end $$;

-- ---------------------------------------------------------------- permissões
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb) to service_role;
