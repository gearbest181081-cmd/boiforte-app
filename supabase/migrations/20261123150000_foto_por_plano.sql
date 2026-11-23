-- BoiForte: leitura por foto conforme o plano da fazenda.
--   * Básico: sem leitura por foto.
--   * Pro: 150 leituras por mês por fazenda (mês do calendário, horário de Brasília). O servidor pode
--     aumentar a cota de uma fazenda (pacote extra) com definir_cota_foto.
--   * Continuam valendo: 30 por pessoa por dia e o teto geral do sistema (300 por dia).
-- A função "ler-foto" agora manda a fazenda; o banco confere se a pessoa é dela (e não está pausada).
-- Uma recusa desfaz todas as contagens da chamada: foto recusada não gasta cota.
-- Depende de 20261123140000_planos_usuarios.sql.

alter table public.fazendas
  add column cota_foto_mes integer not null default 150 check (cota_foto_mes between 0 and 100000);

-- Janela do mês corrente no horário de Brasília (para o contador mensal).
create function public.bf_inicio_mes() returns timestamptz language sql stable as $$
  select date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
$$;

-- Quantas leituras a fazenda já usou neste mês.
create function public.bf_fotos_no_mes(f uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select l.contagem from public.limites l
    where l.usuario_id = f and l.tipo = 'foto_mes' and l.janela = public.bf_inicio_mes()), 0)
$$;

-- Troca a versão sem fazenda: sem ela não dá para saber o plano.
drop function public.pode_usar_foto();

create function public.pode_usar_foto(f uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); fz public.fazendas; j timestamptz := public.bf_inicio_mes(); c integer;
begin
  if public.bf_papel(f) is null then
    perform public.bf_erro('Ligue o celular a uma fazenda na nuvem para usar a leitura por foto.');
  end if;
  select * into fz from public.fazendas where id = f;
  if fz.plano is distinct from 'pro' then
    perform public.bf_erro('A leitura por foto é do plano Pro. Digite os valores ou peça ao dono para mudar de plano.');
  end if;
  perform public.bf_limite('foto', 30, 86400);
  perform public.bf_limite_chave('00000000-0000-0000-0000-000000000000', 'foto_total', 300, 86400);
  -- Contador do mês por fazenda: um UPDATE atômico por linha (dois pedidos juntos não passam da cota).
  insert into public.limites as l (usuario_id, tipo, janela, contagem) values (f, 'foto_mes', j, 1)
  on conflict on constraint limites_pkey do update set contagem = l.contagem + 1
  returning l.contagem into c;
  if c = 1 then delete from public.limites l where l.usuario_id = f and l.tipo = 'foto_mes' and l.janela < j; end if;
  if c > fz.cota_foto_mes then
    perform public.bf_erro(format('A fazenda já usou as %s leituras por foto deste mês. Digite os valores; a cota volta no dia 1º.', fz.cota_foto_mes));
  end if;
  return fz.cota_foto_mes - c; -- quantas ainda restam no mês
end $$;

-- Cota mensal de fotos de uma fazenda (pacote extra). Só o servidor.
create function public.definir_cota_foto(f uuid, p_cota integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare antes integer;
begin
  if p_cota is null or p_cota not between 0 and 100000 then perform public.bf_erro('Cota inválida.'); end if;
  select cota_foto_mes into antes from public.fazendas where id = f for no key update;
  if not found then perform public.bf_erro('Fazenda não encontrada.'); end if;
  update public.fazendas set cota_foto_mes = p_cota where id = f;
  insert into public.auditoria (fazenda_id, usuario_id, acao, antes, depois)
    values (f, null, 'definir_cota_foto', jsonb_build_object('cota', antes), jsonb_build_object('cota', p_cota));
end $$;

-- O app mostra também as fotos do mês (0 de limite no Básico).
drop function public.plano_da_fazenda(uuid);
create function public.plano_da_fazenda(f uuid)
returns table (plano text, usuarios_extras integer, limite integer, pessoas integer, convites_abertos integer, eu_pausado boolean,
               fotos_usadas integer, fotos_limite integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare eu public.membros;
begin
  perform public.bf_exigir_login();
  select * into eu from public.membros m where m.fazenda_id = f and m.usuario_id = public.bf_uid();
  if not found then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  return query select fz.plano, fz.usuarios_extras, public.bf_limite_usuarios(fz.plano, fz.usuarios_extras),
      (select count(*)::integer from public.membros m where m.fazenda_id = f),
      (select count(*)::integer from public.convites v where v.fazenda_id = f and v.usado_por is null and v.expira_em > now()),
      eu.bloqueado,
      public.bf_fotos_no_mes(f),
      case when fz.plano = 'pro' then fz.cota_foto_mes else 0 end
    from public.fazendas fz where fz.id = f;
end $$;

-- ---------------------------------------------------------------- permissões
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(uuid),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text), public.plano_da_fazenda(uuid) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb), public.definir_plano(uuid, text, integer),
  public.definir_cota_foto(uuid, integer) to service_role;
