-- BoiForte: Anotações e tarefas da ronda (o que precisa ser corrigido na fazenda, com foto, módulo e piquete).
--
-- O que esta migração faz:
--   1. A tabela "anotacoes" do app passa a sincronizar como as outras (registros + regras em bf_esquemas,
--      que vêm no bloco GERADO abaixo). O vaqueiro vê e grava anotações (é ele quem faz a ronda).
--   2. Um gatilho em registros (só para anotacoes) carimba no servidor QUEM anotou e QUEM resolveu,
--      com o nome da pessoa na equipe. O que o celular mandar nesses campos é ignorado.
--      O vaqueiro só apaga anotação que ele mesmo fez; dono e gerente apagam qualquer uma.
--   3. Fotos no Storage do Supabase, balde PRIVADO "anotacoes", uma pasta por fazenda: "<fazenda>/<foto>.jpg".
--      Regras (RLS em storage.objects), conferidas no servidor:
--        * ver: quem é da fazenda (qualquer papel, menos quem está pausado pelo plano);
--        * enviar: dono, gerente e vaqueiro; só JPEG, até 1 MB (limite do balde); nome no formato certo;
--          até 300 fotos por pessoa por dia e 5.000 fotos por fazenda;
--        * trocar uma foto já enviada: ninguém (sem regra de UPDATE: foto enviada não muda);
--        * apagar: dono e gerente; o vaqueiro só as fotos que ele mesmo enviou.
--      As funções usadas pelas regras ficam no schema bf_privado. Motivo: toda migração faz
--      "revoke execute on all functions in schema public" e regrava a lista; aqui elas não são derrubadas
--      por isso, e também não ficam expostas na API (o Supabase só publica o schema public).
--
-- Depende de 20261123160000_funcionarios.sql (e das anteriores).
-- Ao apagar a fazenda ou a conta pelo app, ele apaga antes as fotos da fazenda pelo Storage
-- (o banco não consegue apagar arquivos do Storage).

-- ---------------------------------------------------------------- 1. vaqueiro vê e grava anotações
create or replace function public.bf_vaqueiro_le() returns text[] language sql immutable as $$
  select array['propriedades','modulos','piquetes','lotes','animais','pesagens','ingredientes','formulas','movimentos','batidas','fornecimentos','sanidade','lembretes','config','anotacoes']
$$;
create or replace function public.bf_vaqueiro_grava() returns text[] language sql immutable as $$
  select array['animais','pesagens','fornecimentos','movimentos','sanidade','lotes','lancamentos','anotacoes']
$$;

-- Regras de validação de todas as tabelas (agora com "anotacoes"); repete as de antes, sem mudança nelas.
-- GERADO por src/nuvem/gerarSql.ts a partir de src/validar.ts e src/nuvem/esquema.ts.
-- Não edite à mão: rode `npm run gerar-sql` depois de mudar as regras.
insert into public.bf_esquemas (tabela, rotulo, regras, refs) values
  ('animais', 'Animal', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"brinco":{"t":"texto","max":30,"obrigatorio":true},"sexo":{"t":"enum","valores":["macho","femea","misto"],"obrigatorio":false},"raca":{"t":"texto","max":40,"obrigatorio":false},"ativo":{"t":"bool"},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb),
  ('anotacoes', 'Anotação', '{"id":{"t":"id","obrigatorio":false},"texto":{"t":"texto","max":1000,"obrigatorio":true},"categoria":{"t":"enum","valores":["cerca","agua","cocho","pasto","animal","estrutura","outro"],"obrigatorio":false},"moduloId":{"t":"id","obrigatorio":false},"piqueteId":{"t":"id","obrigatorio":false},"urgente":{"t":"bool"},"feita":{"t":"bool"},"data":{"t":"data","obrigatorio":true},"feitaEm":{"t":"data","obrigatorio":false},"fotos":{"t":"lista","max":4,"item":{"foto":{"t":"texto","max":36,"obrigatorio":true}}},"autor":{"t":"texto","max":80,"obrigatorio":false},"autorId":{"t":"texto","max":36,"obrigatorio":false},"feitaPor":{"t":"texto","max":80,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"moduloId":"modulos","piqueteId":"piquetes","__listas":{}}'::jsonb),
  ('batidas', 'Batida', '{"id":{"t":"id","obrigatorio":false},"formulaId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"kg":{"t":"num","min":0.001,"max":10000000,"obrigatorio":true,"inteiro":false},"custoTotal":{"t":"num","min":0,"max":100000000,"obrigatorio":true,"inteiro":false},"itens":{"t":"lista","max":60,"item":{"ingredienteId":{"t":"id","obrigatorio":true},"kg":{"t":"num","min":0,"max":10000000,"obrigatorio":true,"inteiro":false},"custo":{"t":"num","min":0,"max":100000000,"obrigatorio":true,"inteiro":false}}},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"formulaId":"formulas","__listas":{"itens":{"ingredienteId":"ingredientes"}}}'::jsonb),
  ('config', 'Configuração', '{"chave":{"t":"texto","max":40,"obrigatorio":true},"valor":{"t":"num","min":-1000000000000,"max":1000000000000,"obrigatorio":true,"inteiro":false}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('custosFixos', 'Custo fixo', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"valorMensal":{"t":"num","min":0,"max":100000000,"obrigatorio":true,"inteiro":false},"desde":{"t":"data","obrigatorio":true},"ate":{"t":"data","obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('formulas', 'Fórmula', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"tipo":{"t":"enum","valores":["sal_mineral","proteinado","proteico_energetico","rip","tip","creep","confinamento","outro"],"obrigatorio":true},"unidade":{"t":"enum","valores":["pct","kg"],"obrigatorio":true},"modo":{"t":"enum","valores":["direto","batida"],"obrigatorio":true},"consumoPctPV":{"t":"num","min":0,"max":0.05,"obrigatorio":true,"inteiro":false},"itens":{"t":"lista","max":60,"item":{"ingredienteId":{"t":"id","obrigatorio":true},"qtd":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":false}}},"custoEstoque":{"t":"num","min":0,"max":100000,"obrigatorio":false,"inteiro":false},"diasAlerta":{"t":"num","min":0,"max":365,"obrigatorio":false,"inteiro":true},"obs":{"t":"texto","max":1000,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{"itens":{"ingredienteId":"ingredientes"}}}'::jsonb),
  ('fornecimentos', 'Fornecimento', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"formulaId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"cabecas":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"pesoRef":{"t":"num","min":0,"max":2000,"obrigatorio":true,"inteiro":false},"kgPrevisto":{"t":"num","min":0,"max":10000000,"obrigatorio":true,"inteiro":false},"kgFornecido":{"t":"num","min":0,"max":10000000,"obrigatorio":true,"inteiro":false},"custo":{"t":"num","min":0,"max":100000000,"obrigatorio":true,"inteiro":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","formulaId":"formulas","__listas":{}}'::jsonb),
  ('funcionarios', 'Funcionário', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"funcao":{"t":"texto","max":60,"obrigatorio":true},"salario":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":false},"encargos":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":false},"admissao":{"t":"data","obrigatorio":true},"saida":{"t":"data","obrigatorio":false},"telefone":{"t":"texto","max":20,"obrigatorio":false},"usuarioId":{"t":"texto","max":36,"obrigatorio":false},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('ingredientes', 'Ingrediente', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"ms":{"t":"num","min":1,"max":100,"obrigatorio":true,"inteiro":false},"pb":{"t":"num","min":0,"max":300,"obrigatorio":true,"inteiro":false},"ndt":{"t":"num","min":0,"max":100,"obrigatorio":true,"inteiro":false},"ca":{"t":"num","min":0,"max":40,"obrigatorio":true,"inteiro":false},"p":{"t":"num","min":0,"max":25,"obrigatorio":true,"inteiro":false},"preco":{"t":"num","min":0,"max":100000,"obrigatorio":true,"inteiro":false},"ureia":{"t":"bool"},"ureiaTeor":{"t":"num","min":0,"max":100,"obrigatorio":false,"inteiro":false},"fb":{"t":"num","min":0,"max":100,"obrigatorio":false,"inteiro":false},"cobre":{"t":"num","min":0,"max":50000,"obrigatorio":false,"inteiro":false},"manganes":{"t":"num","min":0,"max":50000,"obrigatorio":false,"inteiro":false},"categoria":{"t":"enum","valores":["ingrediente","nucleo","sal_mineral","sal_adensado","proteinado","proteico_energetico","racao"],"obrigatorio":false},"consumo":{"t":"texto","max":80,"obrigatorio":false},"diasAlerta":{"t":"num","min":0,"max":365,"obrigatorio":false,"inteiro":true},"ativo":{"t":"bool"},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('lancamentos', 'Lançamento', '{"id":{"t":"id","obrigatorio":false},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["despesa","receita"],"obrigatorio":true},"categoria":{"t":"enum","valores":["compra_animais","pasto","sanidade","mao_obra","frete","impostos","manutencao","combustivel","outros","venda_animais","outras_receitas"],"obrigatorio":true},"descricao":{"t":"texto","max":120,"obrigatorio":false},"valor":{"t":"num","min":0,"max":1000000000,"obrigatorio":true,"inteiro":false},"loteId":{"t":"id","obrigatorio":false},"origem":{"t":"enum","valores":["manual","compra_lote","sanidade"],"obrigatorio":false},"refId":{"t":"id","obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"compraQtd":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":true},"compraPreco":{"t":"num","min":0,"max":10000000,"obrigatorio":false,"inteiro":false},"compraComissao":{"t":"num","min":0,"max":1,"obrigatorio":false,"inteiro":false},"compraFrete":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"compraNf":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","refId":{"porCampo":"origem","mapa":{"compra_lote":"lotes","sanidade":"sanidade"}},"__listas":{}}'::jsonb),
  ('lembretes', 'Lembrete', '{"id":{"t":"id","obrigatorio":false},"titulo":{"t":"texto","max":100,"obrigatorio":true},"mes":{"t":"num","min":1,"max":12,"obrigatorio":true,"inteiro":true},"dia":{"t":"num","min":1,"max":31,"obrigatorio":true,"inteiro":true},"antecedenciaDias":{"t":"num","min":0,"max":365,"obrigatorio":true,"inteiro":true},"obs":{"t":"texto","max":200,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('lotes', 'Lote', '{"id":{"t":"id","obrigatorio":false},"propriedadeId":{"t":"id","obrigatorio":true},"piqueteId":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"fase":{"t":"enum","valores":["cria","recria","engorda_pasto","tip","confinamento"],"obrigatorio":true},"sexo":{"t":"enum","valores":["macho","femea","misto"],"obrigatorio":true},"controle":{"t":"enum","valores":["lote","individual"],"obrigatorio":true},"qtdCabecas":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"dataEntrada":{"t":"data","obrigatorio":true},"pesoAlvo":{"t":"num","min":0,"max":2000,"obrigatorio":false,"inteiro":false},"gmdMeta":{"t":"num","min":0,"max":5,"obrigatorio":false,"inteiro":false},"formulaId":{"t":"id","obrigatorio":false},"consumoPctPV":{"t":"num","min":0,"max":0.05,"obrigatorio":false,"inteiro":false},"encerrado":{"t":"bool"},"dataSaida":{"t":"data","obrigatorio":false},"obs":{"t":"texto","max":1000,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"propriedadeId":"propriedades","piqueteId":"piquetes","formulaId":"formulas","__listas":{}}'::jsonb),
  ('modulos', 'Módulo', '{"id":{"t":"id","obrigatorio":false},"propriedadeId":{"t":"id","obrigatorio":true},"nome":{"t":"texto","max":80,"obrigatorio":true},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"propriedadeId":"propriedades","__listas":{}}'::jsonb),
  ('movimentos', 'Estoque', '{"id":{"t":"id","obrigatorio":false},"ingredienteId":{"t":"id","obrigatorio":false},"formulaId":{"t":"id","obrigatorio":false},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["entrada","saida","ajuste"],"obrigatorio":true},"kg":{"t":"num","min":-10000000,"max":10000000,"obrigatorio":true,"inteiro":false},"valor":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"origem":{"t":"enum","valores":["compra","batida","fornecimento","ajuste"],"obrigatorio":true},"refId":{"t":"id","obrigatorio":false},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"ingredienteId":"ingredientes","formulaId":"formulas","refId":{"porCampo":"origem","mapa":{"batida":"batidas","fornecimento":"fornecimentos"}},"__listas":{}}'::jsonb),
  ('pesagens', 'Pesagem', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["media","individual"],"obrigatorio":true},"pesoMedio":{"t":"num","min":1,"max":2000,"obrigatorio":true,"inteiro":false},"qtdPesada":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"pesos":{"t":"lista","max":100000,"item":{"animalId":{"t":"id","obrigatorio":true},"peso":{"t":"num","min":1,"max":2000,"obrigatorio":true,"inteiro":false}}},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{"pesos":{"animalId":"animais"}}}'::jsonb),
  ('piquetes', 'Piquete', '{"id":{"t":"id","obrigatorio":false},"moduloId":{"t":"id","obrigatorio":true},"nome":{"t":"texto","max":80,"obrigatorio":true},"areaHa":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":false},"capim":{"t":"texto","max":60,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"moduloId":"modulos","__listas":{}}'::jsonb),
  ('propriedades', 'Fazenda', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":120,"obrigatorio":true},"municipio":{"t":"texto","max":80,"obrigatorio":false},"uf":{"t":"texto","max":2,"obrigatorio":false},"areaHa":{"t":"num","min":0,"max":10000000,"obrigatorio":false,"inteiro":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('sanidade', 'Sanidade', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"feito":{"t":"bool"},"tipo":{"t":"enum","valores":["vacina","vermifugo","carrapaticida","antibiotico","vitamina","exame","outro"],"obrigatorio":true},"produto":{"t":"texto","max":80,"obrigatorio":true},"dose":{"t":"texto","max":40,"obrigatorio":false},"qtdAnimais":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":true},"custo":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"carenciaDias":{"t":"num","min":0,"max":730,"obrigatorio":false,"inteiro":true},"repetirDias":{"t":"num","min":0,"max":730,"obrigatorio":false,"inteiro":true},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb),
  ('vendas', 'Venda', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["venda","morte"],"obrigatorio":true},"cabecas":{"t":"num","min":1,"max":1000000,"obrigatorio":true,"inteiro":true},"pesoMedio":{"t":"num","min":0,"max":2000,"obrigatorio":false,"inteiro":false},"modo":{"t":"enum","valores":["arroba","cabeca"],"obrigatorio":false},"preco":{"t":"num","min":0,"max":10000000,"obrigatorio":false,"inteiro":false},"rendimento":{"t":"num","min":0,"max":1,"obrigatorio":false,"inteiro":false},"comissaoPct":{"t":"num","min":0,"max":1,"obrigatorio":false,"inteiro":false},"frete":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"outros":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"valorBruto":{"t":"num","min":0,"max":1000000000,"obrigatorio":true,"inteiro":false},"valorLiquido":{"t":"num","min":-100000000,"max":1000000000,"obrigatorio":true,"inteiro":false},"comprador":{"t":"texto","max":80,"obrigatorio":false},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb)
on conflict (tabela) do update set rotulo = excluded.rotulo, regras = excluded.regras, refs = excluded.refs;

-- ---------------------------------------------------------------- 2. carimbo de autor (no servidor)
create function public.bf_anotacoes_antes_gravar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  velho jsonb := case when tg_op = 'UPDATE' and not old.excluido then old.dados end;
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
    if papel_quem = 'vaqueiro' and velho is not null and (velho->>'autorId') is distinct from quem::text then
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

create trigger registros_anotacoes before insert or update on public.registros
  for each row when (new.tabela = 'anotacoes') execute function public.bf_anotacoes_antes_gravar();

-- ---------------------------------------------------------------- 3. fotos no Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anotacoes', 'anotacoes', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create schema if not exists bf_privado;
revoke all on schema bf_privado from public, anon;
grant usage on schema bf_privado to authenticated;

-- Fazenda dona do arquivo "<fazenda>/<foto>.jpg" (nulo se o nome não estiver nesse formato).
create function bf_privado.fazenda_da_foto(nome text) returns uuid language sql immutable as $$
  select case when nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
              then split_part(nome, '/', 1)::uuid end
$$;

create function bf_privado.pode_ver_foto(nome text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.bf_papel(bf_privado.fazenda_da_foto(nome)) is not null
$$;

-- Enviar: papel que grava + limite por pessoa por dia (conta no banco).
create function bf_privado.pode_enviar_foto(nome text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare p public.papel := public.bf_papel(bf_privado.fazenda_da_foto(nome));
begin
  if p is null or p = 'consultor' then return false; end if;
  perform public.bf_limite('foto_anotacao', 300, 86400);
  return true;
end $$;

-- Teto de fotos por fazenda. Roda como a própria pessoa (sem security definer): ela enxerga todas as fotos
-- da fazenda pela regra de leitura, então a contagem é a da fazenda inteira.
create function bf_privado.cabe_foto(nome text) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
declare f uuid := bf_privado.fazenda_da_foto(nome); n integer;
begin
  if f is null then return false; end if;
  select count(*) into n from storage.objects o where o.bucket_id = 'anotacoes' and o.name like f::text || '/%';
  if n >= 5000 then -- (sem bf_erro: a pessoa não tem permissão de chamar funções do schema public)
    raise exception using errcode = 'P0001', message = 'A fazenda chegou ao limite de 5.000 fotos de anotações. Apague anotações antigas com foto.';
  end if;
  return true;
end $$;

-- Apagar: dono e gerente apagam qualquer foto da fazenda; o vaqueiro, só as que ele enviou.
create function bf_privado.pode_apagar_foto(nome text, enviada_por text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.bf_papel(bf_privado.fazenda_da_foto(nome))
    when 'dono' then true
    when 'gerente' then true
    when 'vaqueiro' then enviada_por is not null and enviada_por = auth.uid()::text
    else false end
$$;

revoke execute on all functions in schema bf_privado from public, anon;
grant execute on all functions in schema bf_privado to authenticated;

create policy bf_anotacoes_ver on storage.objects for select to authenticated
  using (bucket_id = 'anotacoes' and bf_privado.pode_ver_foto(name));

create policy bf_anotacoes_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'anotacoes' and bf_privado.pode_enviar_foto(name) and bf_privado.cabe_foto(name));

create policy bf_anotacoes_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'anotacoes' and bf_privado.pode_apagar_foto(name, owner_id));
-- Sem regra de UPDATE: ninguém troca uma foto já enviada (o app manda sempre com upsert desligado).

-- ---------------------------------------------------------------- permissões (mesma lista de antes)
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(uuid),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text), public.plano_da_fazenda(uuid) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb), public.definir_plano(uuid, text, integer),
  public.definir_cota_foto(uuid, integer) to service_role;
