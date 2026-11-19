-- BoiForte: leitura por foto (cota por pessoa) e gravação das cotações (só pelo servidor).

-- A função "ler-foto" chama esta antes de gastar com a leitura. Exige login, ser de alguma fazenda
-- e respeita a cota: 30 fotos por dia por pessoa.
create function public.pode_usar_foto() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login();
begin
  if not exists (select 1 from public.membros m where m.usuario_id = u) then
    perform public.bf_erro('Ligue o celular a uma fazenda na nuvem para usar a leitura por foto.');
  end if;
  perform public.bf_limite('foto', 30, 86400);
  return true;
end $$;

-- Faixas plausíveis por produto: um número fora disso é erro de leitura da fonte e não entra.
create function public.bf_cotacao_plausivel(p_produto text, p_unidade text, p_valor numeric) returns boolean
language sql immutable as $$
  select case
    when p_produto in ('boi_gordo', 'vaca_gorda', 'novilha') then p_unidade = 'R$/@' and p_valor between 80 and 1500
    when p_produto = 'bezerro' then (p_unidade = 'R$/cab' and p_valor between 500 and 15000) or (p_unidade = 'R$/@' and p_valor between 80 and 2000)
    when p_produto in ('milho', 'soja') then p_unidade = 'R$/sc60' and p_valor between 10 and 600
    when p_produto = 'farelo_soja' then p_unidade = 'R$/t' and p_valor between 500 and 10000
    else false end
$$;

-- Grava as cotações coletadas. Só a função agendada (chave de serviço) pode chamar.
create function public.gravar_cotacoes(lista jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare c jsonb; n integer := 0;
begin
  if jsonb_typeof(lista) <> 'array' or jsonb_array_length(lista) > 200 then perform public.bf_erro('Lista inválida.'); end if;
  for c in select * from jsonb_array_elements(lista) loop
    begin
      if not public.bf_cotacao_plausivel(c->>'produto', c->>'unidade', (c->>'valor')::numeric) then continue; end if;
      if (c->>'data')::date > current_date + 1 or (c->>'data')::date < current_date - 60 then continue; end if;
      insert into public.cotacoes (produto, praca, data, valor, unidade, fonte)
      values (c->>'produto', left(c->>'praca', 60), (c->>'data')::date, round((c->>'valor')::numeric, 4), c->>'unidade', left(c->>'fonte', 120))
      on conflict (produto, praca, data) do update set valor = excluded.valor, unidade = excluded.unidade, fonte = excluded.fonte, atualizado_em = now();
      n := n + 1;
    exception when others then null; -- linha estranha não derruba as outras
    end;
  end loop;
  delete from public.cotacoes where data < current_date - 400; -- guarda pouco mais de um ano
  return n;
end $$;

-- LGPD / exigência da Play Store: a pessoa apaga a própria conta. As fazendas em que ela é a única
-- pessoa são apagadas junto. Se for a única dona de uma fazenda com equipe, precisa passar a dona antes.
create function public.apagar_minha_conta(confirmar text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := public.bf_exigir_login(); f record;
begin
  if confirmar is distinct from 'APAGAR' then perform public.bf_erro('Escreva APAGAR para confirmar.'); end if;
  for f in select m.fazenda_id from public.membros m where m.usuario_id = u and m.papel = 'dono' loop
    if not exists (select 1 from public.membros o where o.fazenda_id = f.fazenda_id and o.usuario_id <> u) then
      delete from public.fazendas where id = f.fazenda_id;
    elsif not exists (select 1 from public.membros o where o.fazenda_id = f.fazenda_id and o.usuario_id <> u and o.papel = 'dono') then
      perform public.bf_erro('Você é a única dona de uma fazenda com equipe. Passe alguém para dono antes de apagar a conta.');
    end if;
  end loop;
  delete from public.membros where usuario_id = u;
  delete from public.limites where usuario_id = u;
  delete from auth.users where id = u;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(),
  public.apagar_minha_conta(text) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb) to service_role;
