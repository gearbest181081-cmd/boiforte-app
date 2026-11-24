-- BoiForte: Pasto. O módulo é o conjunto de piquetes; o piquete é a variável de decisão (quem entra, quando entra, quando sai).
--
-- O que esta migração faz:
--   1. Tabelas novas do app que sincronizam como as outras (registros + regras em bf_esquemas, no bloco GERADO abaixo):
--        * "ocupacoes": entrada e saída de um lote (ou de um grupo de manejo da cria) num piquete, com cabeças, peso,
--          altura do capim, nota e fotos/áudios na entrada e na saída;
--        * "ndvi": o NDVI do satélite (Sentinel-2) por piquete e data. Só o servidor grava (função gravar_ndvi).
--      Módulo ganha sistema (rotacionado/contínuo), dias de ocupação e de descanso e capacidade de suporte (UA/ha);
--      piquete ganha alturas de entrada/saída, kg de MS por cm e o contorno (pontos lat/lon, até 500).
--   2. UM OCUPANTE POR PIQUETE, conferido no servidor (gatilhos em registros):
--        * lotes e grupos ativos (não encerrados) não podem ter o mesmo piqueteId;
--        * duas ocupações do mesmo piquete não podem se cruzar no tempo (sair e outro entrar no mesmo dia pode);
--        * o mesmo lote/grupo não pode estar em duas ocupações ao mesmo tempo.
--      A mensagem começa com "Piquete ocupado" (o app tenta de novo depois que a troca de piquete inteira subiu).
--   3. O vaqueiro vê e grava ocupações (é ele quem leva o gado e tira a foto do capim) e pode mudar o piquete do lote
--      (antes só mudava a quantidade de cabeças). Só dono e gerente apagam uma ocupação.
--   4. Fotos e áudios do pasto vão para o mesmo balde privado "anotacoes" (mesmas regras de quem vê, envia e apaga),
--      que passa a aceitar áudio (webm, ogg, m4a) além de JPEG, com o mesmo limite de 1 MB.
--   5. NDVI: piquetes_para_ndvi e gravar_ndvi são só da função "ndvi" (service_role). pedir_ndvi deixa o dono/gerente
--      pedir uma atualização (no máximo 2 por hora por pessoa). Ao apagar um piquete, o NDVI dele some também.
--
-- Depende de 20261124130000_fase_rip_tip.sql (e das anteriores).

-- ---------------------------------------------------------------- 1. vaqueiro
create or replace function public.bf_vaqueiro_le() returns text[] language sql immutable as $$
  select array['propriedades','modulos','piquetes','lotes','animais','pesagens','ingredientes','formulas','movimentos','batidas','fornecimentos','sanidade','lembretes','config','anotacoes','ocupacoes','ndvi']
$$;
create or replace function public.bf_vaqueiro_grava() returns text[] language sql immutable as $$
  select array['animais','pesagens','fornecimentos','movimentos','sanidade','lotes','lancamentos','anotacoes','ocupacoes']
$$;

-- Regras de validação de todas as tabelas (agora com "ocupacoes" e "ndvi"); repete as de antes.
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
  ('lotes', 'Lote', '{"id":{"t":"id","obrigatorio":false},"propriedadeId":{"t":"id","obrigatorio":true},"piqueteId":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":80,"obrigatorio":true},"fase":{"t":"enum","valores":["cria","recria","rip","engorda_pasto","tip","confinamento"],"obrigatorio":true},"sexo":{"t":"enum","valores":["macho","femea","misto"],"obrigatorio":true},"controle":{"t":"enum","valores":["lote","individual"],"obrigatorio":true},"qtdCabecas":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"dataEntrada":{"t":"data","obrigatorio":true},"pesoAlvo":{"t":"num","min":0,"max":2000,"obrigatorio":false,"inteiro":false},"gmdMeta":{"t":"num","min":0,"max":5,"obrigatorio":false,"inteiro":false},"formulaId":{"t":"id","obrigatorio":false},"consumoPctPV":{"t":"num","min":0,"max":0.05,"obrigatorio":false,"inteiro":false},"encerrado":{"t":"bool"},"dataSaida":{"t":"data","obrigatorio":false},"obs":{"t":"texto","max":1000,"obrigatorio":false},"fases":{"t":"lista","max":30,"item":{"data":{"t":"data","obrigatorio":true},"de":{"t":"enum","valores":["cria","recria","rip","engorda_pasto","tip","confinamento"],"obrigatorio":true},"para":{"t":"enum","valores":["cria","recria","rip","engorda_pasto","tip","confinamento"],"obrigatorio":true},"pesoMedio":{"t":"num","min":1,"max":2000,"obrigatorio":false,"inteiro":false},"dieta":{"t":"texto","max":80,"obrigatorio":false}}},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"propriedadeId":"propriedades","piqueteId":"piquetes","formulaId":"formulas","__listas":{}}'::jsonb),
  ('modulos', 'Módulo', '{"id":{"t":"id","obrigatorio":false},"propriedadeId":{"t":"id","obrigatorio":true},"nome":{"t":"texto","max":80,"obrigatorio":true},"sistema":{"t":"enum","valores":["rotacionado","continuo"],"obrigatorio":false},"diasOcupacao":{"t":"num","min":1,"max":365,"obrigatorio":false,"inteiro":true},"diasDescanso":{"t":"num","min":0,"max":365,"obrigatorio":false,"inteiro":true},"capacidadeUA":{"t":"num","min":0,"max":50,"obrigatorio":false,"inteiro":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"propriedadeId":"propriedades","__listas":{}}'::jsonb),
  ('movimentos', 'Estoque', '{"id":{"t":"id","obrigatorio":false},"ingredienteId":{"t":"id","obrigatorio":false},"formulaId":{"t":"id","obrigatorio":false},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["entrada","saida","ajuste"],"obrigatorio":true},"kg":{"t":"num","min":-10000000,"max":10000000,"obrigatorio":true,"inteiro":false},"valor":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"origem":{"t":"enum","valores":["compra","batida","fornecimento","ajuste"],"obrigatorio":true},"refId":{"t":"id","obrigatorio":false},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"ingredienteId":"ingredientes","formulaId":"formulas","refId":{"porCampo":"origem","mapa":{"batida":"batidas","fornecimento":"fornecimentos"}},"__listas":{}}'::jsonb),
  ('ndvi', 'NDVI', '{"id":{"t":"id","obrigatorio":false},"piqueteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"ndvi":{"t":"num","min":-1,"max":1,"obrigatorio":true,"inteiro":false},"min":{"t":"num","min":-1,"max":1,"obrigatorio":false,"inteiro":false},"max":{"t":"num","min":-1,"max":1,"obrigatorio":false,"inteiro":false},"nuvemPct":{"t":"num","min":0,"max":100,"obrigatorio":false,"inteiro":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"piqueteId":"piquetes","__listas":{}}'::jsonb),
  ('ocupacoes', 'Ocupação do piquete', '{"id":{"t":"id","obrigatorio":false},"piqueteId":{"t":"id","obrigatorio":true},"tipo":{"t":"enum","valores":["lote","grupo"],"obrigatorio":true},"ocupanteId":{"t":"id","obrigatorio":true},"entrada":{"t":"data","obrigatorio":true},"saida":{"t":"data","obrigatorio":false},"cabecas":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"pesoMedio":{"t":"num","min":1,"max":2000,"obrigatorio":false,"inteiro":false},"alturaEntrada":{"t":"num","min":0,"max":300,"obrigatorio":false,"inteiro":false},"alturaSaida":{"t":"num","min":0,"max":300,"obrigatorio":false,"inteiro":false},"massaEntrada":{"t":"num","min":0,"max":50000,"obrigatorio":false,"inteiro":false},"notaEntrada":{"t":"texto","max":1000,"obrigatorio":false},"notaSaida":{"t":"texto","max":1000,"obrigatorio":false},"midiasEntrada":{"t":"lista","max":4,"item":{"arq":{"t":"texto","max":36,"obrigatorio":true},"ext":{"t":"enum","valores":["jpg","webm","ogg","m4a"],"obrigatorio":true}}},"midiasSaida":{"t":"lista","max":4,"item":{"arq":{"t":"texto","max":36,"obrigatorio":true},"ext":{"t":"enum","valores":["jpg","webm","ogg","m4a"],"obrigatorio":true}}},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"piqueteId":"piquetes","ocupanteId":{"porCampo":"tipo","mapa":{"lote":"lotes","grupo":"grupos"}},"__listas":{}}'::jsonb),
  ('pesagens', 'Pesagem', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["media","individual"],"obrigatorio":true},"pesoMedio":{"t":"num","min":1,"max":2000,"obrigatorio":true,"inteiro":false},"qtdPesada":{"t":"num","min":0,"max":1000000,"obrigatorio":true,"inteiro":true},"pesos":{"t":"lista","max":100000,"item":{"animalId":{"t":"id","obrigatorio":true},"peso":{"t":"num","min":1,"max":2000,"obrigatorio":true,"inteiro":false}}},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{"pesos":{"animalId":"animais"}}}'::jsonb),
  ('piquetes', 'Piquete', '{"id":{"t":"id","obrigatorio":false},"moduloId":{"t":"id","obrigatorio":true},"nome":{"t":"texto","max":80,"obrigatorio":true},"areaHa":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":false},"capim":{"t":"texto","max":60,"obrigatorio":false},"alturaEntrada":{"t":"num","min":1,"max":300,"obrigatorio":false,"inteiro":false},"alturaSaida":{"t":"num","min":1,"max":300,"obrigatorio":false,"inteiro":false},"kgMsCm":{"t":"num","min":1,"max":1000,"obrigatorio":false,"inteiro":false},"contorno":{"t":"lista","max":500,"item":{"lat":{"t":"num","min":-90,"max":90,"obrigatorio":true,"inteiro":false},"lon":{"t":"num","min":-180,"max":180,"obrigatorio":true,"inteiro":false}}},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"moduloId":"modulos","__listas":{}}'::jsonb),
  ('propriedades', 'Fazenda', '{"id":{"t":"id","obrigatorio":false},"nome":{"t":"texto","max":120,"obrigatorio":true},"municipio":{"t":"texto","max":80,"obrigatorio":false},"uf":{"t":"texto","max":2,"obrigatorio":false},"areaHa":{"t":"num","min":0,"max":10000000,"obrigatorio":false,"inteiro":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"__listas":{}}'::jsonb),
  ('sanidade', 'Sanidade', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"feito":{"t":"bool"},"tipo":{"t":"enum","valores":["vacina","vermifugo","carrapaticida","antibiotico","vitamina","exame","outro"],"obrigatorio":true},"produto":{"t":"texto","max":80,"obrigatorio":true},"dose":{"t":"texto","max":40,"obrigatorio":false},"qtdAnimais":{"t":"num","min":0,"max":1000000,"obrigatorio":false,"inteiro":true},"custo":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"carenciaDias":{"t":"num","min":0,"max":730,"obrigatorio":false,"inteiro":true},"repetirDias":{"t":"num","min":0,"max":730,"obrigatorio":false,"inteiro":true},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb),
  ('vendas', 'Venda', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"data":{"t":"data","obrigatorio":true},"tipo":{"t":"enum","valores":["venda","morte"],"obrigatorio":true},"cabecas":{"t":"num","min":1,"max":1000000,"obrigatorio":true,"inteiro":true},"pesoMedio":{"t":"num","min":0,"max":2000,"obrigatorio":false,"inteiro":false},"modo":{"t":"enum","valores":["arroba","cabeca"],"obrigatorio":false},"preco":{"t":"num","min":0,"max":10000000,"obrigatorio":false,"inteiro":false},"rendimento":{"t":"num","min":0,"max":1,"obrigatorio":false,"inteiro":false},"comissaoPct":{"t":"num","min":0,"max":1,"obrigatorio":false,"inteiro":false},"frete":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"outros":{"t":"num","min":0,"max":100000000,"obrigatorio":false,"inteiro":false},"valorBruto":{"t":"num","min":0,"max":1000000000,"obrigatorio":true,"inteiro":false},"valorLiquido":{"t":"num","min":-100000000,"max":1000000000,"obrigatorio":true,"inteiro":false},"comprador":{"t":"texto","max":80,"obrigatorio":false},"obs":{"t":"texto","max":300,"obrigatorio":false},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb)
on conflict (tabela) do update set rotulo = excluded.rotulo, regras = excluded.regras, refs = excluded.refs;

-- ---------------------------------------------------------------- 3. enviar_alteracoes: o vaqueiro também muda o piquete do lote
-- Mesmo corpo de 20261123130000_correcoes_seguranca.sql; só muda a regra marcada com "PASTO".
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

-- ---------------------------------------------------------------- 2. um ocupante por piquete
-- Nome do piquete para a mensagem.
create function public.bf_nome_piquete(f uuid, g text) returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce((select r.dados->>'nome' from public.registros r where r.fazenda_id = f and r.tabela = 'piquetes' and r.gid = g), 'O piquete')
$$;

-- Lote ou grupo de manejo (cria) ativo com piquete: ninguém mais ativo pode estar no mesmo piquete.
create function public.bf_pasto_ocupante() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pq text := new.dados->>'piqueteId';
  outro public.registros;
begin
  if new.excluido or new.dados is null or pq is null or coalesce((new.dados->>'encerrado')::boolean, false) then return new; end if;
  -- tranca o piquete até o fim da transação (dois celulares mandando ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtextextended(new.fazenda_id::text || '/piquete/' || pq, 0));
  select * into outro from public.registros r
    where r.fazenda_id = new.fazenda_id and r.tabela in ('lotes', 'grupos') and not r.excluido
      and r.dados->>'piqueteId' = pq and not coalesce((r.dados->>'encerrado')::boolean, false)
      and not (r.tabela = new.tabela and r.gid = new.gid)
    limit 1;
  if outro.gid is not null then
    perform public.bf_erro(format('Piquete ocupado: %s já tem %s %s. Um piquete recebe um lote ou grupo por vez.',
      public.bf_nome_piquete(new.fazenda_id, pq), case outro.tabela when 'lotes' then 'o lote' else 'o grupo' end, coalesce(outro.dados->>'nome', '')));
  end if;
  return new;
end $$;

create trigger registros_pasto_ocupante before insert or update on public.registros
  for each row when (new.tabela in ('lotes', 'grupos')) execute function public.bf_pasto_ocupante();

-- Ocupação: datas, mídias e nenhum cruzamento no tempo (no mesmo piquete, nem do mesmo lote/grupo).
-- Períodos [entrada, saída): sair num dia e outro entrar no mesmo dia pode. Sem saída = ainda está lá.
create function public.bf_pasto_ocupacao() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d jsonb := new.dados;
  ini date; fim date;
  outro public.registros;
  m jsonb;
  papel_quem public.papel;
begin
  if new.excluido or d is null then
    if new.atualizado_por is not null then
      select mb.papel into papel_quem from public.membros mb where mb.fazenda_id = new.fazenda_id and mb.usuario_id = new.atualizado_por;
      if papel_quem = 'vaqueiro' then perform public.bf_erro('Só o dono ou o gerente apagam uma entrada/saída de piquete.'); end if;
    end if;
    return new;
  end if;
  ini := (d->>'entrada')::date;
  fim := coalesce((d->>'saida')::date, 'infinity'::date);
  if fim < ini then perform public.bf_erro('Ocupação do piquete: a saída é antes da entrada.'); end if;
  for m in select value from jsonb_array_elements(coalesce(d->'midiasEntrada', '[]'::jsonb) || coalesce(d->'midiasSaida', '[]'::jsonb)) loop
    if coalesce(m->>'arq', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform public.bf_erro('Ocupação do piquete: foto ou áudio inválido.');
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(new.fazenda_id::text || '/piquete/' || (d->>'piqueteId'), 0));
  select * into outro from public.registros r
    where r.fazenda_id = new.fazenda_id and r.tabela = 'ocupacoes' and not r.excluido and r.gid <> new.gid
      and r.dados->>'piqueteId' = d->>'piqueteId'
      and (r.dados->>'entrada')::date < fim and coalesce((r.dados->>'saida')::date, 'infinity'::date) > ini
    limit 1;
  if outro.gid is not null then
    perform public.bf_erro(format('Piquete ocupado: %s já tinha outro lote ou grupo de %s a %s.', public.bf_nome_piquete(new.fazenda_id, d->>'piqueteId'),
      to_char((outro.dados->>'entrada')::date, 'DD/MM/YYYY'), coalesce(to_char((outro.dados->>'saida')::date, 'DD/MM/YYYY'), 'hoje')));
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.fazenda_id::text || '/ocupante/' || (d->>'tipo') || '/' || (d->>'ocupanteId'), 0));
  select * into outro from public.registros r
    where r.fazenda_id = new.fazenda_id and r.tabela = 'ocupacoes' and not r.excluido and r.gid <> new.gid
      and r.dados->>'tipo' = d->>'tipo' and r.dados->>'ocupanteId' = d->>'ocupanteId'
      and (r.dados->>'entrada')::date < fim and coalesce((r.dados->>'saida')::date, 'infinity'::date) > ini
    limit 1;
  if outro.gid is not null then
    perform public.bf_erro(format('Piquete ocupado: estes animais estavam em %s nesse período.', public.bf_nome_piquete(new.fazenda_id, outro.dados->>'piqueteId')));
  end if;
  return new;
end $$;

create trigger registros_pasto_ocupacao before insert or update on public.registros
  for each row when (new.tabela = 'ocupacoes') execute function public.bf_pasto_ocupacao();

-- ---------------------------------------------------------------- 5. NDVI (só o servidor grava)
-- Quem grava pelo app (enviar_alteracoes) sempre tem atualizado_por; a função do satélite grava sem.
create function public.bf_ndvi_so_servidor() returns trigger language plpgsql as $$
begin
  if new.atualizado_por is not null then perform public.bf_erro('O NDVI vem do satélite; não dá para gravar pelo app.'); end if;
  return new;
end $$;
create trigger registros_ndvi_so_servidor before insert or update on public.registros
  for each row when (new.tabela = 'ndvi') execute function public.bf_ndvi_so_servidor();

-- Apagou o piquete: o NDVI dele some (e desce como apagado para os celulares).
create function public.bf_ndvi_do_piquete_apagado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.registros r set excluido = true, dados = null, versao = nextval('public.registros_versao'), atualizado_em = now(), atualizado_por = null
    where r.fazenda_id = new.fazenda_id and r.tabela = 'ndvi' and not r.excluido and r.dados->>'piqueteId' = new.gid;
  return null;
end $$;
create trigger registros_ndvi_piquete_apagado after update on public.registros
  for each row when (new.tabela = 'piquetes' and new.excluido and not old.excluido) execute function public.bf_ndvi_do_piquete_apagado();

-- Piquetes com contorno para buscar o NDVI (só a função do satélite). "ultima": data do NDVI mais novo do piquete.
create function public.piquetes_para_ndvi(p_fazenda uuid default null, p_limite integer default 2000)
returns table (fazenda_id uuid, gid text, contorno jsonb, ultima date)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.fazenda_id, p.gid, p.dados->'contorno',
    (select max((n.dados->>'data')::date) from public.registros n
       where n.fazenda_id = p.fazenda_id and n.tabela = 'ndvi' and not n.excluido and n.dados->>'piqueteId' = p.gid)
  from public.registros p
  where p.tabela = 'piquetes' and not p.excluido and jsonb_typeof(p.dados->'contorno') = 'array'
    and jsonb_array_length(p.dados->'contorno') >= 3
    and (p_fazenda is null or p.fazenda_id = p_fazenda)
  order by 4 nulls first, p.fazenda_id, p.gid
  limit least(greatest(coalesce(p_limite, 2000), 1), 10000)
$$;

-- Grava as leituras de um piquete: [{data, ndvi, min, max, nuvemPct}]. Mesma data = atualiza (gid fixo por piquete e data).
create function public.gravar_ndvi(p_fazenda uuid, p_piquete text, p_linhas jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l jsonb; dt date; v numeric; dados jsonb; g text; n integer := 0; existe boolean;
begin
  if not exists (select 1 from public.registros r where r.fazenda_id = p_fazenda and r.tabela = 'piquetes' and r.gid = p_piquete and not r.excluido) then
    return 0;
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 400 then perform public.bf_erro('Leituras inválidas.'); end if;
  for l in select value from jsonb_array_elements(p_linhas) loop
    begin
      dt := (l->>'data')::date;
      v := (l->>'ndvi')::numeric;
    exception when others then continue;
    end;
    if dt is null or v is null or v < -1 or v > 1 or dt < date '2015-01-01' or dt > current_date + 1 then continue; end if;
    dados := jsonb_strip_nulls(jsonb_build_object(
      'piqueteId', p_piquete, 'data', to_char(dt, 'YYYY-MM-DD'), 'ndvi', round(v, 3),
      'min', case when (l->>'min')::numeric between -1 and 1 then round((l->>'min')::numeric, 3) end,
      'max', case when (l->>'max')::numeric between -1 and 1 then round((l->>'max')::numeric, 3) end,
      'nuvemPct', case when (l->>'nuvemPct')::numeric between 0 and 100 then round((l->>'nuvemPct')::numeric, 1) end,
      'criadoEm', (extract(epoch from now()) * 1000)::bigint));
    g := (substr(md5(p_fazenda::text || p_piquete || dt::text), 1, 8) || '-' || substr(md5(p_fazenda::text || p_piquete || dt::text), 9, 4) || '-4'
      || substr(md5(p_fazenda::text || p_piquete || dt::text), 14, 3) || '-8' || substr(md5(p_fazenda::text || p_piquete || dt::text), 18, 3) || '-'
      || substr(md5(p_fazenda::text || p_piquete || dt::text), 21, 12));
    select true into existe from public.registros r where r.fazenda_id = p_fazenda and r.tabela = 'ndvi' and r.gid = g;
    if existe is null then
      update public.fazendas set total_registros = total_registros + 1 where id = p_fazenda and total_registros < 2000000;
      if not found then return n; end if;
    end if;
    insert into public.registros as r (fazenda_id, tabela, gid, dados, excluido, versao, atualizado_por)
      values (p_fazenda, 'ndvi', g, dados, false, nextval('public.registros_versao'), null)
      on conflict (fazenda_id, tabela, gid) do update set dados = excluded.dados, excluido = false, versao = excluded.versao, atualizado_em = now(), atualizado_por = null
      where r.dados is distinct from excluded.dados;
    n := n + 1;
    existe := null;
  end loop;
  return n;
end $$;

-- Dono ou gerente pede para atualizar o NDVI da fazenda agora (a função confere isto antes de chamar o satélite).
create function public.pedir_ndvi(f uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.papel := public.bf_papel(f);
begin
  if p is null or p not in ('dono', 'gerente') then perform public.bf_erro('Só o dono ou o gerente atualizam o satélite.'); end if;
  perform public.bf_limite('ndvi', 2, 3600);
  return true;
end $$;

-- ---------------------------------------------------------------- 4. fotos e áudios do pasto no Storage
update storage.buckets set allowed_mime_types = array['image/jpeg', 'audio/webm', 'audio/ogg', 'audio/mp4'] where id = 'anotacoes';

create or replace function bf_privado.fazenda_da_foto(nome text) returns uuid language sql immutable as $$
  select case when nome ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webm|ogg|m4a)$'
              then split_part(nome, '/', 1)::uuid end
$$;

-- ---------------------------------------------------------------- permissões (lista de antes + as novas)
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(uuid),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text), public.plano_da_fazenda(uuid),
  public.tenho_senha(), public.pedir_ndvi(uuid) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb), public.definir_plano(uuid, text, integer),
  public.definir_cota_foto(uuid, integer), public.piquetes_para_ndvi(uuid, integer), public.gravar_ndvi(uuid, text, jsonb) to service_role;
