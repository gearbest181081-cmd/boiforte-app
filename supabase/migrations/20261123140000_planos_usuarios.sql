-- BoiForte: limite de pessoas na equipe por plano da fazenda.
--   Básico e Pro: quem assina + 1 pessoa (2 no total). Cada pessoa a mais é paga (usuarios_extras).
-- Regras (todas no banco; o app só mostra):
--   * O plano fica na tabela fazendas e só o servidor muda (definir_plano, chave de serviço). O app não tem
--     permissão de UPDATE em fazendas, então ninguém se dá plano Pro pelo celular.
--   * Uma trava (gatilho) em "membros" recusa a entrada de mais gente do que o plano deixa, venha de onde vier
--     (convite, função futura ou erro de programação). Ela tranca a linha da fazenda antes de contar, então dois
--     convites aceitos ao mesmo tempo não passam juntos do limite.
--   * Se o plano diminuir (ex.: Pro vencido vira Básico), ninguém é apagado: quem passa do limite fica "pausado"
--     (não baixa, não envia, não usa foto) até o dono tirar alguém ou aumentar o plano. Os donos ficam na frente;
--     depois, quem entrou primeiro. Todo plano tem pelo menos 2 vagas, então sempre sobra um dono ativo.
-- Depende de 20261123130000_correcoes_seguranca.sql (bf_uid, cancelar_convite, pode_usar_foto com teto geral).

-- ---------------------------------------------------------------- colunas novas
alter table public.fazendas
  add column plano text not null default 'basico' check (plano in ('basico', 'pro')),
  add column usuarios_extras integer not null default 0 check (usuarios_extras between 0 and 48);

alter table public.membros add column bloqueado boolean not null default false;

-- Fazendas que já existem hoje (antes de haver cobrança) passam para Pro com vagas para todos que já estão
-- nelas, para ninguém perder acesso ao rodar esta migração. Ajuste depois com definir_plano.
update public.fazendas fz set plano = 'pro',
  usuarios_extras = least(48, greatest(0, (select count(*) from public.membros m where m.fazenda_id = fz.id) - 2));

-- ---------------------------------------------------------------- contas do plano
create function public.bf_limite_usuarios(p_plano text, p_extras integer) returns integer language sql immutable as $$
  select case when p_plano in ('basico', 'pro') then 2 + coalesce(p_extras, 0) else 0 end
$$;

create function public.bf_nome_plano(p_plano text) returns text language sql immutable as $$
  select case p_plano when 'basico' then 'Básico' when 'pro' then 'Pro' else p_plano end
$$;

-- Recalcula quem fica pausado. Chamar sempre com a linha da fazenda já trancada (ou deixa que ela tranca).
create function public.bf_reaplicar_limite(f uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare lim integer;
begin
  select public.bf_limite_usuarios(fz.plano, fz.usuarios_extras) into lim from public.fazendas fz where fz.id = f for no key update;
  if not found then return; end if; -- fazenda sendo apagada
  update public.membros m set bloqueado = o.pos > lim
    from (select m2.usuario_id, row_number() over (order by (m2.papel = 'dono') desc, m2.entrou_em, m2.usuario_id) pos
          from public.membros m2 where m2.fazenda_id = f) o
    where m.fazenda_id = f and m.usuario_id = o.usuario_id and m.bloqueado is distinct from (o.pos > lim);
end $$;

-- ---------------------------------------------------------------- a trava
create function public.bf_membros_antes_inserir() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare fz public.fazendas; n integer; lim integer;
begin
  -- Tranca a fazenda: quem chegar junto espera e conta de novo depois (sem corrida).
  select * into fz from public.fazendas where id = new.fazenda_id for no key update;
  if not found then return new; end if; -- a chave estrangeira recusa logo em seguida
  select count(*) into n from public.membros m where m.fazenda_id = new.fazenda_id;
  lim := public.bf_limite_usuarios(fz.plano, fz.usuarios_extras);
  if n >= lim then
    perform public.bf_erro(format('A equipe desta fazenda está completa (plano %s: %s pessoas). Peça ao dono para liberar uma vaga ou aumentar o plano.',
      public.bf_nome_plano(fz.plano), lim));
  end if;
  new.bloqueado := false;
  return new;
end $$;

create trigger membros_limite_plano before insert on public.membros
  for each row execute function public.bf_membros_antes_inserir();

-- Saiu alguém ou mudou papel: quem estava pausado pode voltar (ou outro pausar, se um pausado virou dono).
create function public.bf_membros_depois_mudar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.bf_reaplicar_limite(coalesce(old.fazenda_id, new.fazenda_id));
  return null;
end $$;

create trigger membros_reaplicar_limite after delete or update of papel on public.membros
  for each row execute function public.bf_membros_depois_mudar();

-- ---------------------------------------------------------------- quem está pausado não acessa
-- bf_papel é a porta de tudo (RLS de fazendas/membros, enviar, baixar, equipe, convites).
create or replace function public.bf_papel(f uuid) returns public.papel
language sql stable security definer set search_path = public, pg_temp as $$
  select papel from public.membros where fazenda_id = f and usuario_id = public.bf_uid() and not bloqueado
$$;

-- A lista de fazendas mostra também as pausadas, para o app explicar o motivo.
drop function public.minhas_fazendas();
create function public.minhas_fazendas() returns table (fazenda_id uuid, nome text, papel public.papel, bloqueado boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, f.nome, m.papel, m.bloqueado from public.membros m join public.fazendas f on f.id = m.fazenda_id
  where m.usuario_id = public.bf_uid() order by f.nome
$$;

drop function public.equipe(uuid);
create function public.equipe(f uuid) returns table (usuario_id uuid, nome text, papel public.papel, entrou_em timestamptz, eu boolean, bloqueado boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.bf_exigir_login();
  if public.bf_papel(f) is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  return query select m.usuario_id, m.nome, m.papel, m.entrou_em, m.usuario_id = auth.uid(), m.bloqueado
    from public.membros m where m.fazenda_id = f order by m.bloqueado, m.papel, m.nome;
end $$;

-- Foto: só quem não está pausado (mesmo corpo da migração anterior, com "not m.bloqueado").
create or replace function public.pode_usar_foto() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login();
begin
  if not exists (select 1 from public.membros m where m.usuario_id = u and not m.bloqueado) then
    perform public.bf_erro('Ligue o celular a uma fazenda na nuvem para usar a leitura por foto.');
  end if;
  perform public.bf_limite('foto', 30, 86400);
  perform public.bf_limite_chave('00000000-0000-0000-0000-000000000000', 'foto_total', 300, 86400);
  return true;
end $$;

-- ---------------------------------------------------------------- convites respeitam o plano
-- Não deixa gerar mais códigos do que vagas livres (pessoas + convites em aberto). A trava em membros
-- continua sendo a garantia final; isto só avisa o dono antes.
create or replace function public.criar_convite(f uuid, p_papel public.papel) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); c text; fz public.fazendas; ocupadas integer; lim integer;
begin
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode chamar pessoas para a equipe.'); end if;
  if p_papel = 'dono' then perform public.bf_erro('Convide como gerente e depois mude o papel.'); end if;
  perform public.bf_limite('convite_criar', 30, 86400);
  select * into fz from public.fazendas where id = f for no key update;
  lim := public.bf_limite_usuarios(fz.plano, fz.usuarios_extras);
  select (select count(*) from public.membros m where m.fazenda_id = f)
       + (select count(*) from public.convites v where v.fazenda_id = f and v.usado_por is null and v.expira_em > now())
    into ocupadas;
  if ocupadas >= lim then
    perform public.bf_erro(format('Sem vaga na equipe (plano %s: %s pessoas, contando os convites ainda não usados). Cancele um convite, tire alguém da equipe ou aumente o plano.',
      public.bf_nome_plano(fz.plano), lim));
  end if;
  loop
    c := public.bf_codigo();
    exit when not exists (select 1 from public.convites where codigo = c);
  end loop;
  insert into public.convites (codigo, fazenda_id, papel, criado_por, expira_em) values (c, f, p_papel, u, now() + interval '7 days');
  insert into public.auditoria (fazenda_id, usuario_id, acao, depois) values (f, u, 'criar_convite', jsonb_build_object('papel', p_papel));
  return c;
end $$;

-- Mesmo corpo de antes, mas tranca a fazenda ANTES do convite (mesma ordem de trava de criar_convite,
-- apagar_fazenda e da trava de membros), para dois pedidos ao mesmo tempo não travarem um ao outro.
create or replace function public.aceitar_convite(p_codigo text, meu_nome text default '') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); c public.convites; f uuid; k text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.bf_limite('convite_usar', 10, 3600); -- evita adivinhar código
  select v.fazenda_id into f from public.convites v where v.codigo = k;
  -- Código errado devolve nulo em vez de erro: um erro desfaria a contagem de tentativas acima.
  if not found then return null; end if;
  perform 1 from public.fazendas where id = f for no key update;
  select * into c from public.convites v where v.codigo = k for update;
  if not found or c.usado_por is not null or c.expira_em < now() then return null; end if;
  if exists (select 1 from public.membros m where m.fazenda_id = c.fazenda_id and m.usuario_id = u) then
    perform public.bf_erro('Você já faz parte desta fazenda.');
  end if;
  insert into public.membros (fazenda_id, usuario_id, papel, nome) values (c.fazenda_id, u, c.papel, left(btrim(coalesce(meu_nome, '')), 80));
  update public.convites set usado_por = u, usado_em = now() where convites.codigo = k;
  insert into public.auditoria (fazenda_id, usuario_id, acao, depois) values (c.fazenda_id, u, 'entrar', jsonb_build_object('papel', c.papel));
  return c.fazenda_id;
end $$;

-- mudar_papel e remover_membro: mesmo corpo de antes, trancando a fazenda primeiro (mesma ordem de trava).
-- Sempre sobra um dono ativo: os donos ficam na frente da fila, e todo plano tem pelo menos 2 vagas.
create or replace function public.mudar_papel(f uuid, usuario uuid, p_papel public.papel) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); antes public.papel;
begin
  if public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode mudar papéis.'); end if;
  perform 1 from public.fazendas where id = f for no key update;
  select m.papel into antes from public.membros m where m.fazenda_id = f and m.usuario_id = usuario for update;
  if not found then perform public.bf_erro('Pessoa não encontrada na equipe.'); end if;
  if antes = 'dono' and p_papel <> 'dono' and (select count(*) from public.membros m where m.fazenda_id = f and m.papel = 'dono') <= 1 then
    perform public.bf_erro('A fazenda precisa ter pelo menos um dono.');
  end if;
  update public.membros m set papel = p_papel where m.fazenda_id = f and m.usuario_id = usuario;
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes, depois)
    values (f, u, 'mudar_papel', jsonb_build_object('usuario', usuario, 'papel', antes), jsonb_build_object('usuario', usuario, 'papel', p_papel));
end $$;

create or replace function public.remover_membro(f uuid, usuario uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); p public.papel;
begin
  if usuario <> u and public.bf_papel(f) is distinct from 'dono' then perform public.bf_erro('Só o dono pode tirar pessoas da equipe.'); end if;
  perform 1 from public.fazendas where id = f for no key update;
  select m.papel into p from public.membros m where m.fazenda_id = f and m.usuario_id = usuario for update;
  if not found then perform public.bf_erro('Pessoa não encontrada na equipe.'); end if;
  if p = 'dono' and (select count(*) from public.membros m where m.fazenda_id = f and m.papel = 'dono') <= 1 then
    perform public.bf_erro('A fazenda precisa ter pelo menos um dono. Passe para outra pessoa antes de sair.');
  end if;
  delete from public.membros where fazenda_id = f and usuario_id = usuario;
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes) values (f, u, 'remover_membro', jsonb_build_object('usuario', usuario, 'papel', p));
end $$;

-- ---------------------------------------------------------------- consultar e mudar o plano
-- Qualquer pessoa da fazenda (mesmo pausada) vê o plano e as vagas, para o app explicar.
create function public.plano_da_fazenda(f uuid)
returns table (plano text, usuarios_extras integer, limite integer, pessoas integer, convites_abertos integer, eu_pausado boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare eu public.membros;
begin
  perform public.bf_exigir_login();
  select * into eu from public.membros m where m.fazenda_id = f and m.usuario_id = public.bf_uid();
  if not found then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  return query select fz.plano, fz.usuarios_extras, public.bf_limite_usuarios(fz.plano, fz.usuarios_extras),
      (select count(*)::integer from public.membros m where m.fazenda_id = f),
      (select count(*)::integer from public.convites v where v.fazenda_id = f and v.usado_por is null and v.expira_em > now()),
      eu.bloqueado
    from public.fazendas fz where fz.id = f;
end $$;

-- Muda o plano. Só o servidor (chave de serviço: futura função de pagamento) ou o painel SQL do Supabase.
-- Diminuir o plano não apaga ninguém: quem passar do limite fica pausado.
create function public.definir_plano(f uuid, p_plano text, p_extras integer default 0) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare antes public.fazendas;
begin
  if p_plano not in ('basico', 'pro') then perform public.bf_erro('Plano desconhecido.'); end if;
  if coalesce(p_extras, 0) not between 0 and 48 then perform public.bf_erro('Pessoas extras: de 0 a 48.'); end if;
  select * into antes from public.fazendas where id = f for no key update;
  if not found then perform public.bf_erro('Fazenda não encontrada.'); end if;
  update public.fazendas set plano = p_plano, usuarios_extras = coalesce(p_extras, 0) where id = f;
  perform public.bf_reaplicar_limite(f);
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes, depois) values (f, null, 'definir_plano',
    jsonb_build_object('plano', antes.plano, 'extras', antes.usuarios_extras), jsonb_build_object('plano', p_plano, 'extras', coalesce(p_extras, 0)));
end $$;

-- Fazendas que já passam do limite (não deve haver, pelo update lá em cima) ficam acertadas.
do $$ declare r record; begin
  for r in select id from public.fazendas loop perform public.bf_reaplicar_limite(r.id); end loop;
end $$;

-- ---------------------------------------------------------------- permissões
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text), public.plano_da_fazenda(uuid) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb), public.definir_plano(uuid, text, integer) to service_role;
