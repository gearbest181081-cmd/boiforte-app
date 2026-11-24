-- Foto do satélite do piquete (cores reais e mapa do verde), na função "ndvi".
-- Quem é da fazenda (qualquer papel) pode ver. O banco confere a pessoa e o piquete e devolve o contorno guardado
-- na nuvem: a função nunca usa um contorno vindo do celular. Limite: 40 fotos por hora por pessoa
-- (cada foto gasta 1 pedido da cota gratuita do Copernicus; o app guarda a foto no celular e não pede de novo).
--
-- Depende de 20261124150000_pasto.sql. Só cria uma função nova; não mexe em tabela nem em dado.
-- ATENÇÃO: migrações que fazem "revoke execute on all functions" depois desta precisam repetir o grant do fim.

create or replace function public.pedir_foto_satelite(f uuid, p text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  meu public.papel := public.bf_papel(f);
  c jsonb;
begin
  if meu is null then perform public.bf_erro('Você não faz parte desta fazenda.'); end if;
  perform public.bf_limite('ndvi_foto', 40, 3600);
  select r.dados->'contorno' into c from public.registros r
    where r.fazenda_id = f and r.tabela = 'piquetes' and r.gid = p and not r.excluido;
  if c is null or jsonb_typeof(c) <> 'array' or jsonb_array_length(c) < 3 then
    perform public.bf_erro('Este piquete ainda não tem contorno na nuvem.');
  end if;
  return c;
end $$;

revoke execute on function public.pedir_foto_satelite(uuid, text) from public, anon;
grant execute on function public.pedir_foto_satelite(uuid, text) to authenticated;
