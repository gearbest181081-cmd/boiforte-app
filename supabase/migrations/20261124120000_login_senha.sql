-- BoiForte: entrada com e-mail e senha (24/11/2026).
-- Primeiro acesso: a pessoa recebe um link no e-mail, entra por ele e cadastra a senha.
-- Depois: entra com e-mail e senha. Esqueceu: recebe outro link e cadastra uma senha nova.
--
-- Até aqui o app só entrava por link/código no e-mail, e uma conta com senha era bloqueada (achado A1 da auditoria:
-- alguém podia criar pela API uma conta com senha usando o e-mail de outra pessoa). Agora a senha é permitida,
-- com esta regra no servidor:
--   1. Só usa o app quem confirmou o e-mail (clicou no link ou digitou o código).
--   2. Senha posta ANTES de o e-mail ser confirmado é apagada no momento da confirmação. Assim, a senha que vale é
--      sempre a que o dono do e-mail cadastrou depois de provar que é dono dele. Quem tentar "reservar" a conta de outro
--      com uma senha perde a senha quando o verdadeiro dono confirmar.
--   3. Senhas que já existiam (o app nunca cadastrou senha até hoje) são apagadas uma vez.
-- "Confirm email" continua obrigatório no painel do Supabase.

-- ---------------------------------------------------------------- 1. quem pode usar: e-mail confirmado
create or replace function public.bf_uid() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.bf_exigir_login() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then perform public.bf_erro('Faça login para continuar.'); end if;
  if public.bf_uid() is null then
    perform public.bf_erro('Confirme seu e-mail para continuar: abra o link que mandamos.');
  end if;
  return u;
end $$;

-- ---------------------------------------------------------------- 2. senha de antes da confirmação não vale
create function public.bf_senha_so_depois_de_confirmar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    new.encrypted_password := '';
  end if;
  return new;
end $$;

create trigger bf_senha_so_depois_de_confirmar
  before update on auth.users
  for each row execute function public.bf_senha_so_depois_de_confirmar();

-- ---------------------------------------------------------------- 3. senhas antigas (de antes desta regra) saem
update auth.users set encrypted_password = '' where coalesce(encrypted_password, '') <> '';

-- ---------------------------------------------------------------- a pessoa já cadastrou a senha?
-- Só responde sobre a própria conta. Serve para o app pedir "crie sua senha" a quem ainda não tem.
create function public.tenho_senha() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select coalesce(u.encrypted_password, '') <> '' from auth.users u where u.id = public.bf_uid()), false)
$$;

revoke execute on function public.bf_senha_so_depois_de_confirmar(), public.tenho_senha() from public, anon, authenticated;
grant execute on function public.tenho_senha() to authenticated;
