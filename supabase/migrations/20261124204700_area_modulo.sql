-- BoiForte: área do módulo (pedido do Luiz em 24/11/2026).
--
-- O que esta migração faz:
--   1. O módulo ganha o campo "areaHa" (a área do módulo inteiro, em hectares). Só acrescenta essa regra ao
--      módulo em bf_esquemas: não regrava as regras das outras tabelas, então pode rodar antes ou depois das
--      migrações da Cria e da rastreabilidade sem desfazer nada delas.
--   2. A SOMA DAS ÁREAS DOS PIQUETES NÃO PASSA DA ÁREA DO MÓDULO, conferido no servidor (gatilho em registros):
--        * piquete novo, piquete que cresceu, que mudou de módulo ou que voltou da lixeira: a soma com os outros
--          piquetes do módulo tem que caber na área do módulo;
--        * módulo: a área não pode ficar menor que a soma dos piquetes dele, nem voltar a ficar em branco
--          depois de gravada;
--        * diminuir um piquete, mudar só o nome, o capim ou o contorno sempre pode; aumentar a área do módulo
--          ou mudar só o manejo dele também;
--        * módulo antigo, ainda sem área: sem limite (como antes), até o dono ou o gerente informar a área.
--      Folga de 0,001 ha (10 m²) para o arredondamento, a mesma do app. Tranca a conferência de área da fazenda
--      até o fim da gravação: dois celulares mandando piquetes ao mesmo tempo não passam juntos da área.
--      A mensagem começa com "Área do módulo": o app tenta de novo depois que o resto subiu, porque às vezes o
--      módulo diminuído chega antes do piquete diminuído.
--
-- Depende de 20261124150000_pasto.sql. Não cria tabela nem função que o app chame; não muda nenhum dado gravado.
-- Pode rodar mais de uma vez.

-- ---------------------------------------------------------------- 1. regra do campo novo (a mesma de src/validar.ts)
update public.bf_esquemas
   set regras = regras || '{"areaHa":{"t":"num","min":0.01,"max":1000000,"obrigatorio":false,"inteiro":false}}'::jsonb
 where tabela = 'modulos';

-- ---------------------------------------------------------------- 2. soma dos piquetes ≤ área do módulo
-- Hectares com vírgula para a mensagem (24.50 → "24,5").
create or replace function public.bf_ha(v numeric) returns text language sql immutable as $$
  select replace(trim_scale(round(v, 2))::text, '.', ',')
$$;

create or replace function public.bf_area_modulo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  folga constant numeric := 0.001;
  antigo jsonb; area numeric; area_antes numeric; mod_gid text; mod_area numeric; mod_nome text; soma numeric;
begin
  if new.excluido or new.dados is null then return new; end if; -- apagar sempre pode

  -- O que já está gravado (apagado conta como nada). O app grava com "insert ... on conflict do update":
  -- no insert que vai virar update, olha a linha que já existe, para a mudança pequena não ser barrada.
  if tg_op = 'UPDATE' then
    antigo := case when old.excluido then null else old.dados end;
  else
    select case when r.excluido then null else r.dados end into antigo from public.registros r
      where r.fazenda_id = new.fazenda_id and r.tabela = new.tabela and r.gid = new.gid;
  end if;

  if new.tabela = 'modulos' then
    area := (new.dados->>'areaHa')::numeric;
    area_antes := (antigo->>'areaHa')::numeric;
    if area_antes is not null and area is null then
      perform public.bf_erro('Área do módulo: a área não pode ficar em branco depois de gravada. Se o app estiver desatualizado, feche e abra de novo.');
    end if;
    if area is null then return new; end if;              -- módulo sem área: sem limite
    if area >= area_antes then return new; end if;        -- a área só cresceu (ou ficou igual)
    perform pg_advisory_xact_lock(hashtextextended(new.fazenda_id::text || '/area_modulo', 0));
    select coalesce(sum((r.dados->>'areaHa')::numeric), 0) into soma from public.registros r
      where r.fazenda_id = new.fazenda_id and r.tabela = 'piquetes' and not r.excluido and r.dados->>'moduloId' = new.gid;
    if soma > area + folga then
      perform public.bf_erro(format('Área do módulo: os piquetes do módulo %s já somam %s ha. A área do módulo não pode ser menor que isso.',
        coalesce(new.dados->>'nome', ''), public.bf_ha(soma)));
    end if;
    return new;
  end if;

  -- piquete
  mod_gid := new.dados->>'moduloId';
  area := coalesce((new.dados->>'areaHa')::numeric, 0);
  if mod_gid is null or area <= 0 then return new; end if; -- piquete sem área não pesa na soma
  if antigo->>'moduloId' = mod_gid and area <= coalesce((antigo->>'areaHa')::numeric, 0) then
    return new; -- não cresceu nem mudou de módulo
  end if;
  -- Uma trava só por fazenda (e não por módulo): o envio com piquetes de vários módulos não fica esperando outro
  -- celular que trancou os mesmos módulos na ordem contrária.
  perform pg_advisory_xact_lock(hashtextextended(new.fazenda_id::text || '/area_modulo', 0));
  select (r.dados->>'areaHa')::numeric, r.dados->>'nome' into mod_area, mod_nome from public.registros r
    where r.fazenda_id = new.fazenda_id and r.tabela = 'modulos' and r.gid = mod_gid and not r.excluido;
  if mod_area is null then return new; end if; -- módulo antigo, sem área: sem limite
  select coalesce(sum((r.dados->>'areaHa')::numeric), 0) into soma from public.registros r
    where r.fazenda_id = new.fazenda_id and r.tabela = 'piquetes' and not r.excluido and r.gid <> new.gid and r.dados->>'moduloId' = mod_gid;
  if soma + area > mod_area + folga then
    perform public.bf_erro(format('Área do módulo: o módulo %s tem %s ha%s. O piquete %s pode ter no máximo %s ha.',
      coalesce(mod_nome, ''), public.bf_ha(mod_area),
      case when soma > 0 then format(' e os outros piquetes já usam %s ha', public.bf_ha(soma)) else '' end,
      coalesce(new.dados->>'nome', ''), public.bf_ha(greatest(mod_area - soma, 0))));
  end if;
  return new;
end $$;

drop trigger if exists registros_area_modulo on public.registros;
create trigger registros_area_modulo before insert or update on public.registros
  for each row when (new.tabela in ('modulos', 'piquetes')) execute function public.bf_area_modulo();

-- Nada aqui é chamado pelo app (o gatilho roda sozinho quando o servidor grava).
revoke execute on function public.bf_area_modulo(), public.bf_ha(numeric) from public, anon, authenticated;
