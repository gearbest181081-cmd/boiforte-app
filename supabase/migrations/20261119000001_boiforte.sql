-- BoiForte: banco na nuvem (Supabase / Postgres).
-- Regra do projeto: o servidor nunca confia no aplicativo.
--   * Ninguém grava direto nas tabelas: toda gravação passa pelas funções abaixo, que conferem
--     login, papel na fazenda, formato de cada campo, referências e refazem as contas de dinheiro.
--   * Leitura protegida por RLS: cada pessoa só enxerga as fazendas de que faz parte.
--   * O id do usuário vem sempre do token da sessão (auth.uid()), nunca de um parâmetro.

-- ---------------------------------------------------------------- tabelas

create type public.papel as enum ('dono', 'gerente', 'vaqueiro', 'consultor');

create table public.fazendas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 120),
  criado_por uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  total_registros integer not null default 0
);

create table public.membros (
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  papel public.papel not null,
  nome text not null default '' check (char_length(nome) <= 80),
  entrou_em timestamptz not null default now(),
  primary key (fazenda_id, usuario_id)
);
create index membros_usuario on public.membros (usuario_id);

create table public.convites (
  codigo text primary key check (codigo ~ '^[A-Z2-9]{10}$'),
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  papel public.papel not null check (papel <> 'dono'),
  criado_por uuid not null references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_por uuid references auth.users (id) on delete set null,
  usado_em timestamptz
);

create sequence public.registros_versao;

-- Um registro do app (lote, pesagem, venda...). "dados" já validado e recalculado pelo servidor.
create table public.registros (
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  tabela text not null,
  gid text not null check (char_length(gid) <= 40),
  dados jsonb,
  excluido boolean not null default false,
  versao bigint not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  primary key (fazenda_id, tabela, gid)
);
create index registros_versao_idx on public.registros (fazenda_id, versao);

create table public.auditoria (
  id bigserial primary key,
  fazenda_id uuid not null references public.fazendas (id) on delete cascade,
  usuario_id uuid,
  acao text not null,
  tabela text,
  gid text,
  em timestamptz not null default now(),
  antes jsonb,
  depois jsonb
);
create index auditoria_fazenda on public.auditoria (fazenda_id, em desc);

-- Contagem de uso por pessoa (limite de requisições feito no banco, não no app).
create table public.limites (
  usuario_id uuid not null,
  tipo text not null,
  janela timestamptz not null,
  contagem integer not null default 0,
  primary key (usuario_id, tipo, janela)
);

-- Cotações: gravadas só pelo servidor (função agendada), lidas por quem tem login.
create table public.cotacoes (
  produto text not null check (produto in ('boi_gordo', 'vaca_gorda', 'novilha', 'bezerro', 'milho', 'soja', 'farelo_soja')),
  praca text not null check (char_length(praca) between 1 and 60),
  data date not null,
  valor numeric(14, 4) not null check (valor > 0 and valor < 100000),
  unidade text not null check (unidade in ('R$/@', 'R$/cab', 'R$/sc60', 'R$/t')),
  fonte text not null check (char_length(fonte) <= 120),
  atualizado_em timestamptz not null default now(),
  primary key (produto, praca, data)
);

-- Regras de cada tabela do app, geradas a partir de src/validar.ts (ver 20261119000002_esquemas.sql).
create table public.bf_esquemas (
  tabela text primary key,
  rotulo text not null,
  regras jsonb not null,
  refs jsonb not null
);

-- ---------------------------------------------------------------- permissões básicas

alter table public.fazendas enable row level security;
alter table public.membros enable row level security;
alter table public.convites enable row level security;
alter table public.registros enable row level security;
alter table public.auditoria enable row level security;
alter table public.limites enable row level security;
alter table public.cotacoes enable row level security;
alter table public.bf_esquemas enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Papel da pessoa logada na fazenda (nulo = não faz parte).
create function public.bf_papel(f uuid) returns public.papel
language sql stable security definer set search_path = public, pg_temp as $$
  select papel from public.membros where fazenda_id = f and usuario_id = auth.uid()
$$;

-- O que o vaqueiro pode ver e gravar (o dinheiro fica de fora). Igual a src/nuvem/esquema.ts.
create function public.bf_vaqueiro_le() returns text[] language sql immutable as $$
  select array['propriedades','modulos','piquetes','lotes','animais','pesagens','ingredientes','formulas','movimentos','batidas','fornecimentos','sanidade','lembretes','config']
$$;
create function public.bf_vaqueiro_grava() returns text[] language sql immutable as $$
  select array['animais','pesagens','fornecimentos','movimentos','sanidade','lotes','lancamentos']
$$;

-- As políticas usam bf_papel (security definer) para não cair em recursão na tabela membros.
create policy fazendas_ler on public.fazendas for select to authenticated using (public.bf_papel(fazendas.id) is not null);
create policy membros_ler on public.membros for select to authenticated using (public.bf_papel(membros.fazenda_id) is not null);
create policy registros_ler on public.registros for select to authenticated
  using (public.bf_papel(registros.fazenda_id) is not null
         and (public.bf_papel(registros.fazenda_id) <> 'vaqueiro' or registros.tabela = any (public.bf_vaqueiro_le())));
create policy auditoria_ler on public.auditoria for select to authenticated using (public.bf_papel(auditoria.fazenda_id) = 'dono');
create policy convites_ler on public.convites for select to authenticated using (public.bf_papel(convites.fazenda_id) = 'dono');
create policy cotacoes_ler on public.cotacoes for select to authenticated using (true);
-- limites e bf_esquemas: sem política = ninguém lê pela API.

grant select on public.fazendas, public.membros, public.registros, public.auditoria, public.convites, public.cotacoes to authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;

-- ---------------------------------------------------------------- utilitários

create function public.bf_erro(msg text) returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = msg;
end $$;

create function public.bf_exigir_login() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then perform public.bf_erro('Faça login para continuar.'); end if;
  return u;
end $$;

-- Limite de uso: no máximo "maximo" chamadas por janela de "segundos". Conta no banco.
create function public.bf_limite(p_tipo text, p_maximo integer, p_segundos integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.bf_exigir_login();
  j timestamptz := to_timestamp(floor(extract(epoch from now()) / p_segundos) * p_segundos);
  c integer;
begin
  insert into public.limites as l (usuario_id, tipo, janela, contagem) values (u, p_tipo, j, 1)
  on conflict on constraint limites_pkey do update set contagem = l.contagem + 1
  returning l.contagem into c;
  if c = 1 then delete from public.limites l where l.usuario_id = u and l.tipo = p_tipo and l.janela < j; end if;
  if c > p_maximo then perform public.bf_erro('Muitas tentativas. Espere um pouco e tente de novo.'); end if;
end $$;

-- Código de convite: 10 letras/números sem os que confundem (0, O, 1, I).
create function public.bf_codigo() returns text language plpgsql volatile as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
  pos constant int[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11]; -- pula os bytes fixos de versão/variante do uuid
  s text := '';
begin
  for i in 1..10 loop s := s || substr(alfabeto, (get_byte(b, pos[i]) % 32) + 1, 1); end loop;
  return s;
end $$;

-- ---------------------------------------------------------------- validação (espelha src/validar.ts)

create function public.bf_validar_campos(regras jsonb, refs jsonb, d jsonb, f uuid, rotulo text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  campo text; regra jsonb; v jsonb; t text; out jsonb := '{}'::jsonb;
  s text; n numeric; alvo text; lista jsonb; item jsonb; itens jsonb;
begin
  if d is null or jsonb_typeof(d) <> 'object' then perform public.bf_erro(rotulo || ': registro inválido.'); end if;
  for campo, regra in select key, value from jsonb_each(regras) loop
    if campo in ('id', 'gid') then continue; end if; -- id local do celular e gid ficam fora dos dados
    t := regra->>'t';
    v := d->campo;
    if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and v #>> '{}' = '') then
      if coalesce((regra->>'obrigatorio')::boolean, false) then perform public.bf_erro(format('%s: o campo "%s" é obrigatório.', rotulo, campo)); end if;
      continue;
    end if;
    if t = 'texto' then
      if jsonb_typeof(v) <> 'string' then perform public.bf_erro(format('%s: "%s" deve ser texto.', rotulo, campo)); end if;
      s := btrim(regexp_replace(v #>> '{}', '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
      if char_length(s) > (regra->>'max')::int then perform public.bf_erro(format('%s: "%s" passou de %s letras.', rotulo, campo, regra->>'max')); end if;
      if s = '' then
        if coalesce((regra->>'obrigatorio')::boolean, false) then perform public.bf_erro(format('%s: o campo "%s" é obrigatório.', rotulo, campo)); end if;
        continue;
      end if;
      out := out || jsonb_build_object(campo, s);
    elsif t = 'num' then
      if jsonb_typeof(v) <> 'number' then perform public.bf_erro(format('%s: "%s" deve ser um número.', rotulo, campo)); end if;
      n := (v #>> '{}')::numeric;
      if n < (regra->>'min')::numeric or n > (regra->>'max')::numeric then perform public.bf_erro(format('%s: "%s" fora do limite (%s a %s).', rotulo, campo, regra->>'min', regra->>'max')); end if;
      if coalesce((regra->>'inteiro')::boolean, false) and n <> trunc(n) then perform public.bf_erro(format('%s: "%s" deve ser inteiro.', rotulo, campo)); end if;
      out := out || jsonb_build_object(campo, v);
    elsif t = 'data' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then perform public.bf_erro(format('%s: data "%s" inválida.', rotulo, campo)); end if;
      s := v #>> '{}';
      begin
        if to_char(s::date, 'YYYY-MM-DD') <> s or substr(s, 1, 4)::int not between 1990 and 2100 then perform public.bf_erro(format('%s: data "%s" inválida.', rotulo, campo)); end if;
      exception when datetime_field_overflow or invalid_datetime_format then
        perform public.bf_erro(format('%s: data "%s" inválida.', rotulo, campo));
      end;
      out := out || jsonb_build_object(campo, s);
    elsif t = 'enum' then
      if jsonb_typeof(v) <> 'string' or not (regra->'valores' ? (v #>> '{}')) then perform public.bf_erro(format('%s: valor de "%s" não permitido.', rotulo, campo)); end if;
      out := out || jsonb_build_object(campo, v);
    elsif t = 'bool' then
      if jsonb_typeof(v) <> 'boolean' then perform public.bf_erro(format('%s: "%s" deve ser sim/não.', rotulo, campo)); end if;
      out := out || jsonb_build_object(campo, v);
    elsif t = 'id' then
      -- No servidor, referência = gid de outro registro DA MESMA fazenda.
      alvo := case jsonb_typeof(refs->campo) when 'string' then refs->>campo
                when 'object' then refs->campo->'mapa'->>(d->>(refs->campo->>'porCampo')) end;
      if alvo is null then continue; end if; -- referência sem tabela conhecida (ex.: ajuste de estoque): descartada
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform public.bf_erro(format('%s: referência "%s" inválida.', rotulo, campo));
      end if;
      if not exists (select 1 from public.registros r where r.fazenda_id = f and r.tabela = alvo and r.gid = v #>> '{}' and not r.excluido) then
        perform public.bf_erro(format('%s: "%s" aponta para um registro que não existe nesta fazenda.', rotulo, campo));
      end if;
      out := out || jsonb_build_object(campo, v);
    elsif t = 'lista' then
      if jsonb_typeof(v) <> 'array' then perform public.bf_erro(format('%s: "%s" deve ser uma lista.', rotulo, campo)); end if;
      if jsonb_array_length(v) > (regra->>'max')::int then perform public.bf_erro(format('%s: "%s" tem itens demais.', rotulo, campo)); end if;
      itens := '[]'::jsonb;
      for item in select value from jsonb_array_elements(v) loop
        itens := itens || jsonb_build_array(public.bf_validar_campos(regra->'item', coalesce(refs->'__listas'->campo, '{}'::jsonb), item, f, rotulo || ' (' || campo || ')'));
      end loop;
      out := out || jsonb_build_object(campo, itens);
    end if;
  end loop;
  return out; -- campos desconhecidos ficam de fora
end $$;

create function public.bf_validar(tabela text, d jsonb, f uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e public.bf_esquemas;
begin
  select * into e from public.bf_esquemas where bf_esquemas.tabela = bf_validar.tabela;
  if not found then perform public.bf_erro('Tabela desconhecida.'); end if;
  return public.bf_validar_campos(e.regras, e.refs, d, f, e.rotulo);
end $$;

-- ---------------------------------------------------------------- contas refeitas no servidor

create function public.bf_recalcular(tabela text, d jsonb) returns jsonb language plpgsql immutable as $$
declare
  cab numeric; peso numeric; rend numeric; preco numeric; com numeric; frete numeric; outros numeric;
  bruto numeric; liquido numeric;
begin
  if tabela = 'vendas' then
    if d->>'tipo' = 'morte' then
      return d || jsonb_build_object('valorBruto', 0, 'valorLiquido', 0);
    end if;
    cab := (d->>'cabecas')::numeric;
    peso := coalesce((d->>'pesoMedio')::numeric, 0);
    rend := coalesce((d->>'rendimento')::numeric, 0.5);
    preco := coalesce((d->>'preco')::numeric, 0);
    com := coalesce((d->>'comissaoPct')::numeric, 0);
    frete := coalesce((d->>'frete')::numeric, 0);
    outros := coalesce((d->>'outros')::numeric, 0);
    bruto := case when coalesce(d->>'modo', 'arroba') = 'arroba' then peso * rend / 15 * preco else preco end * cab;
    liquido := bruto - bruto * com - frete - outros;
    return d || jsonb_build_object('valorBruto', round(bruto, 2), 'valorLiquido', round(liquido, 2));
  elsif tabela = 'lancamentos' and d->>'origem' = 'compra_lote' and d ? 'compraPreco' and d ? 'compraQtd' then
    return d || jsonb_build_object('valor', round(
      (d->>'compraQtd')::numeric * (d->>'compraPreco')::numeric * (1 + coalesce((d->>'compraComissao')::numeric, 0))
      + coalesce((d->>'compraFrete')::numeric, 0) + coalesce((d->>'compraNf')::numeric, 0), 2));
  elsif tabela = 'batidas' then
    return d || jsonb_build_object('custoTotal', coalesce((select sum((i->>'custo')::numeric) from jsonb_array_elements(d->'itens') i), 0));
  end if;
  return d;
end $$;

-- ---------------------------------------------------------------- sincronização

-- Recebe as alterações do celular. Cada uma é conferida e gravada à parte: se uma falhar,
-- as outras seguem, e a resposta diz qual falhou e por quê.
create function public.enviar_alteracoes(f uuid, ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.bf_exigir_login();
  meu public.papel := public.bf_papel(f);
  op jsonb; tab text; g text; acao text;
  antigo public.registros; limpo jsonb; v bigint;
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
      if meu = 'vaqueiro' and tab = 'lancamentos' and (limpo->>'origem' is distinct from 'sanidade' or (antigo.gid is not null and antigo.dados->>'origem' is distinct from 'sanidade')) then
        perform public.bf_erro('Seu papel não permite lançar dinheiro.');
      end if;

      if antigo.gid is not null and not antigo.excluido and antigo.dados = limpo then
        resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', antigo.versao, 'dados', limpo));
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
      if tab in ('lancamentos', 'vendas', 'custosFixos', 'config') then
        insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes, depois) values (f, u, 'gravar', tab, g, antigo.dados, limpo);
      end if;
      resposta := resposta || jsonb_build_array(jsonb_build_object('tabela', tab, 'gid', g, 'ok', true, 'versao', v, 'dados', limpo));
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

-- Devolve o que mudou depois da versão "desde" (o vaqueiro não recebe o financeiro).
create function public.baixar_alteracoes(f uuid, desde bigint, limite integer default 1000)
returns table (tabela text, gid text, dados jsonb, excluido boolean, versao bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare meu public.papel := public.bf_papel(f);
begin
  perform public.bf_exigir_login();
  if meu is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  return query
    select r.tabela, r.gid, r.dados, r.excluido, r.versao from public.registros r
    where r.fazenda_id = f and r.versao > coalesce(desde, 0)
      and (meu <> 'vaqueiro' or r.tabela = any (public.bf_vaqueiro_le()))
    order by r.versao
    limit least(greatest(coalesce(limite, 1000), 1), 2000);
end $$;

-- ---------------------------------------------------------------- fazendas e equipe

create function public.criar_fazenda(p_nome text, meu_nome text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); f uuid; n text := btrim(coalesce(p_nome, ''));
begin
  perform public.bf_limite('criar_fazenda', 5, 86400);
  if char_length(n) not between 1 and 120 then perform public.bf_erro('Dê um nome para a fazenda.'); end if;
  if (select count(*) from public.membros m where m.usuario_id = u and m.papel = 'dono') >= 10 then
    perform public.bf_erro('Limite de fazendas por pessoa atingido.');
  end if;
  insert into public.fazendas (nome, criado_por) values (n, u) returning id into f;
  insert into public.membros (fazenda_id, usuario_id, papel, nome) values (f, u, 'dono', left(btrim(coalesce(meu_nome, '')), 80));
  insert into public.auditoria (fazenda_id, usuario_id, acao) values (f, u, 'criar_fazenda');
  return f;
end $$;

create function public.minhas_fazendas() returns table (fazenda_id uuid, nome text, papel public.papel)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, f.nome, m.papel from public.membros m join public.fazendas f on f.id = m.fazenda_id
  where m.usuario_id = auth.uid() order by f.nome
$$;

create function public.criar_convite(f uuid, p_papel public.papel) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); c text;
begin
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode chamar pessoas para a equipe.'); end if;
  if p_papel = 'dono' then perform public.bf_erro('Convide como gerente e depois mude o papel.'); end if;
  perform public.bf_limite('convite_criar', 30, 86400);
  loop
    c := public.bf_codigo();
    exit when not exists (select 1 from public.convites where codigo = c);
  end loop;
  insert into public.convites (codigo, fazenda_id, papel, criado_por, expira_em) values (c, f, p_papel, u, now() + interval '7 days');
  insert into public.auditoria (fazenda_id, usuario_id, acao, depois) values (f, u, 'criar_convite', jsonb_build_object('papel', p_papel));
  return c;
end $$;

create function public.aceitar_convite(p_codigo text, meu_nome text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); c public.convites; k text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.bf_limite('convite_usar', 10, 3600); -- evita adivinhar código
  select * into c from public.convites v where v.codigo = k for update;
  -- Código errado devolve nulo em vez de erro: um erro desfaria a contagem de tentativas acima.
  if not found or c.usado_por is not null or c.expira_em < now() then return null; end if;
  if exists (select 1 from public.membros m where m.fazenda_id = c.fazenda_id and m.usuario_id = u) then
    perform public.bf_erro('Você já faz parte desta fazenda.');
  end if;
  insert into public.membros (fazenda_id, usuario_id, papel, nome) values (c.fazenda_id, u, c.papel, left(btrim(coalesce(meu_nome, '')), 80));
  update public.convites set usado_por = u, usado_em = now() where convites.codigo = k;
  insert into public.auditoria (fazenda_id, usuario_id, acao, depois) values (c.fazenda_id, u, 'entrar', jsonb_build_object('papel', c.papel));
  return c.fazenda_id;
end $$;

create function public.equipe(f uuid) returns table (usuario_id uuid, nome text, papel public.papel, entrou_em timestamptz, eu boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.bf_exigir_login();
  if public.bf_papel(f) is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  return query select m.usuario_id, m.nome, m.papel, m.entrou_em, m.usuario_id = auth.uid()
    from public.membros m where m.fazenda_id = f order by m.papel, m.nome;
end $$;

create function public.mudar_papel(f uuid, usuario uuid, p_papel public.papel) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); antes public.papel;
begin
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode mudar papéis.'); end if;
  select m.papel into antes from public.membros m where m.fazenda_id = f and m.usuario_id = usuario for update;
  if not found then perform public.bf_erro('Pessoa não encontrada na equipe.'); end if;
  if antes = 'dono' and p_papel <> 'dono' and (select count(*) from public.membros m where m.fazenda_id = f and m.papel = 'dono') <= 1 then
    perform public.bf_erro('A fazenda precisa ter pelo menos um dono.');
  end if;
  update public.membros m set papel = p_papel where m.fazenda_id = f and m.usuario_id = usuario;
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes, depois)
    values (f, u, 'mudar_papel', jsonb_build_object('usuario', usuario, 'papel', antes), jsonb_build_object('usuario', usuario, 'papel', p_papel));
end $$;

create function public.remover_membro(f uuid, usuario uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); p public.papel;
begin
  if usuario <> u and public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode tirar pessoas da equipe.'); end if;
  select m.papel into p from public.membros m where m.fazenda_id = f and m.usuario_id = usuario for update;
  if not found then perform public.bf_erro('Pessoa não encontrada na equipe.'); end if;
  if p = 'dono' and (select count(*) from public.membros m where m.fazenda_id = f and m.papel = 'dono') <= 1 then
    perform public.bf_erro('A fazenda precisa ter pelo menos um dono. Passe para outra pessoa antes de sair.');
  end if;
  delete from public.membros where fazenda_id = f and usuario_id = usuario;
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes) values (f, u, 'remover_membro', jsonb_build_object('usuario', usuario, 'papel', p));
end $$;

-- Apaga a fazenda e tudo dela da nuvem (pedido do dono; LGPD).
create function public.apagar_fazenda(f uuid, confirmar_nome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.bf_exigir_login();
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode apagar a fazenda.'); end if;
  if (select nome from public.fazendas where id = f) is distinct from btrim(confirmar_nome) then perform public.bf_erro('Digite o nome da fazenda igualzinho para confirmar.'); end if;
  delete from public.fazendas where id = f;
end $$;

-- Garante que nenhuma função auxiliar ficou executável pela API (permissões padrão do Supabase).
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;

grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text) to authenticated;
