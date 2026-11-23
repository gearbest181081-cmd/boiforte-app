-- BoiForte: cadastro de funcionários com salário (23/11/2026).
--   * Os funcionários são uma tabela nova do app ("funcionarios"), sincronizada como as outras pelo
--     enviar_alteracoes / baixar_alteracoes. As regras de cada campo estão no bloco gerado abaixo.
--   * Quem vê os salários: dono, gerente e consultor (que já veem todo o dinheiro). O VAQUEIRO NÃO RECEBE
--     esta tabela: baixar_alteracoes só manda a ele o que está em bf_vaqueiro_le(), e "funcionarios" não está lá.
--     Ele também não grava (não está em bf_vaqueiro_grava()). Leitura direta da tabela registros já é proibida.
--   * Quem grava: dono e gerente. Só o DONO liga um funcionário a uma conta do app, e só a quem já é da
--     equipe da fazenda. Ninguém que não seja dono mexe no próprio cadastro (não aumenta o próprio salário).
--   * Toda gravação de funcionário fica na auditoria (só o dono lê), como o resto do dinheiro.
-- Depende das migrações anteriores (bf_uid, bf_papel com "bloqueado").
-- Não muda nenhuma tabela existente: só acrescenta regras e duas travas (gatilhos) na tabela registros.

-- GERADO por src/nuvem/gerarSql.ts a partir de src/validar.ts e src/nuvem/esquema.ts.
-- Não edite à mão: rode `npm run gerar-sql` depois de mudar as regras.
insert into public.bf_esquemas (tabela, rotulo, regras, refs) values
  ('animais', 'Animal', '{"id":{"t":"id","obrigatorio":false},"loteId":{"t":"id","obrigatorio":true},"brinco":{"t":"texto","max":30,"obrigatorio":true},"sexo":{"t":"enum","valores":["macho","femea","misto"],"obrigatorio":false},"raca":{"t":"texto","max":40,"obrigatorio":false},"ativo":{"t":"bool"},"criadoEm":{"t":"num","min":0,"max":4102444800000,"obrigatorio":false,"inteiro":true},"gid":{"t":"gid"}}'::jsonb, '{"loteId":"lotes","__listas":{}}'::jsonb),
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

-- ---------------------------------------------------------------- trava: quem pode gravar funcionário
create function public.bf_funcionarios_conferir() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := public.bf_uid();
  meu public.papel;
  antigo jsonb;
  ant_u text; nov_u text;
begin
  if auth.uid() is null then return new; end if; -- manutenção pelo painel do Supabase (sem pessoa logada)
  if u is null then perform public.bf_erro('Faça login para continuar.'); end if;
  meu := public.bf_papel(new.fazenda_id);
  if meu is null or meu not in ('dono', 'gerente') then
    perform public.bf_erro('Só o dono ou o gerente cadastram funcionários.');
  end if;

  if tg_op = 'UPDATE' then
    antigo := case when old.excluido then null else old.dados end;
  else -- insert que pode virar update (on conflict): olha o que já existe
    select case when r.excluido then null else r.dados end into antigo from public.registros r
      where r.fazenda_id = new.fazenda_id and r.tabela = new.tabela and r.gid = new.gid;
  end if;
  ant_u := nullif(antigo->>'usuarioId', '');
  nov_u := case when new.excluido then null else nullif(new.dados->>'usuarioId', '') end;

  if meu <> 'dono' then
    if ant_u = u::text or nov_u = u::text then
      perform public.bf_erro('Ninguém muda o próprio cadastro de funcionário (nem o salário). Peça ao dono.');
    end if;
    if new.excluido and ant_u is not null then
      perform public.bf_erro('Só o dono apaga o cadastro de quem usa o app.');
    end if;
    if nov_u is distinct from ant_u then
      perform public.bf_erro('Só o dono liga o funcionário a uma conta do app.');
    end if;
  end if;

  if nov_u is not null and nov_u is distinct from ant_u then
    if nov_u !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.membros m where m.fazenda_id = new.fazenda_id and m.usuario_id = nov_u::uuid) then
      perform public.bf_erro('Esta conta não faz parte da equipe da fazenda.');
    end if;
    if exists (select 1 from public.registros r where r.fazenda_id = new.fazenda_id and r.tabela = 'funcionarios'
               and r.gid <> new.gid and not r.excluido and r.dados->>'usuarioId' = nov_u) then
      perform public.bf_erro('Esta conta já está ligada a outro funcionário.');
    end if;
  end if;
  return new;
end $$;

create trigger registros_funcionarios_conferir before insert or update on public.registros
  for each row when (new.tabela = 'funcionarios') execute function public.bf_funcionarios_conferir();

-- ---------------------------------------------------------------- auditoria dos salários
-- enviar_alteracoes já anota quando apaga; aqui anota quando cria ou muda (antes e depois, com o salário).
create function public.bf_funcionarios_auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes, depois)
    values (new.fazenda_id, new.atualizado_por, 'gravar', new.tabela, new.gid,
            case when tg_op = 'UPDATE' and not old.excluido then old.dados end, new.dados);
  return null;
end $$;

create trigger registros_funcionarios_auditar after insert or update on public.registros
  for each row when (new.tabela = 'funcionarios' and not new.excluido) execute function public.bf_funcionarios_auditar();

-- ---------------------------------------------------------------- permissões
-- As travas não são chamadas pela API. Mesmo bloco das migrações anteriores, sem nada novo liberado.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;
grant execute on function public.enviar_alteracoes(uuid, jsonb), public.baixar_alteracoes(uuid, bigint, integer),
  public.criar_fazenda(text, text), public.minhas_fazendas(), public.criar_convite(uuid, public.papel),
  public.aceitar_convite(text, text), public.equipe(uuid), public.mudar_papel(uuid, uuid, public.papel),
  public.remover_membro(uuid, uuid), public.apagar_fazenda(uuid, text), public.pode_usar_foto(uuid),
  public.apagar_minha_conta(text), public.cancelar_convite(uuid, text), public.plano_da_fazenda(uuid) to authenticated;
grant execute on function public.gravar_cotacoes(jsonb), public.definir_plano(uuid, text, integer),
  public.definir_cota_foto(uuid, integer) to service_role;
