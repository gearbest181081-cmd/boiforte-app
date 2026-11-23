import { useLiveQuery } from 'dexie-react-hooks';
import { db, pontosDoLote, type Lote, type Pesagem } from './db';
import { projetar, resumo, type Projecao, type Resumo } from './calc';
import { alertasDoLote, type Alerta } from './alertas';
import { hojeISO } from './calc';

export interface LoteInfo {
  lote: Lote;
  pesagens: Pesagem[];
  resumo: Resumo;
  projecao: Projecao | null;
  alertas: Alerta[];
}

export function montarInfo(lote: Lote, pesagens: Pesagem[], hoje = hojeISO()): LoteInfo {
  const pontos = pontosDoLote(pesagens);
  return {
    lote,
    pesagens,
    resumo: resumo(pontos),
    projecao: lote.pesoAlvo ? projetar(pontos, lote.pesoAlvo, lote.gmdMeta) : null,
    alertas: alertasDoLote(lote, pontos, hoje),
  };
}

/** Todos os lotes com seus indicadores calculados, atualizando sozinho. */
export function useLotesInfo(incluirEncerrados = false): LoteInfo[] | undefined {
  return useLiveQuery(async () => {
    const lotes = await db.lotes.toArray();
    const pes = await db.pesagens.toArray();
    return lotes
      .filter((l) => incluirEncerrados || !l.encerrado)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
      .map((l) => montarInfo(l, pes.filter((p) => p.loteId === l.id)));
  }, [incluirEncerrados]);
}

// ---------- Escala de fornecimento ----------
import { pesoEstimado } from './calc';
import { calcularFormula, kgCabDia, type ResultadoFormula } from './nutricao';
import { situacao, type SituacaoEstoque } from './estoque';
import type { Formula, Fornecimento, Ingrediente } from './db';

export interface LinhaEscala {
  lote: Lote;
  formula: Formula | null;
  resultado: ResultadoFormula | null;
  pesoRef: number | null;
  consumoPctPV: number;
  kgCab: number;
  kgTotal: number;
  custoPrevisto: number;
  fornecimento: Fornecimento | null;
}

/** Monta a escala de um dia: quanto cada lote deve receber, já ajustado pelo peso estimado. */
export function montarEscala(lotes: Lote[], pesagens: Pesagem[], formulas: Formula[], ingredientes: Ingrediente[], fornecimentos: Fornecimento[], data: string): LinhaEscala[] {
  const fmap = new Map(formulas.map((f) => [f.id!, f]));
  return lotes
    .filter((l) => !l.encerrado && l.dataEntrada <= data)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
    .map((lote) => {
      const formula = lote.formulaId ? fmap.get(lote.formulaId) ?? null : null;
      const resultado = formula ? calcularFormula(formula.itens, ingredientes) : null;
      const pesoRef = pesoEstimado(pontosDoLote(pesagens.filter((p) => p.loteId === lote.id)), data, lote.gmdMeta);
      const consumoPctPV = lote.consumoPctPV || formula?.consumoPctPV || 0;
      const kgCab = pesoRef ? kgCabDia(pesoRef, consumoPctPV) : 0;
      const kgTotal = kgCab * lote.qtdCabecas;
      const custoKg = formula?.modo === 'batida' ? formula.custoEstoque ?? resultado?.custoKg ?? 0 : resultado?.custoKg ?? 0;
      return {
        lote, formula, resultado, pesoRef, consumoPctPV, kgCab, kgTotal, custoPrevisto: kgTotal * custoKg,
        fornecimento: fornecimentos.find((f) => f.loteId === lote.id && f.data === data) ?? null,
      };
    });
}

export function useEscala(data: string): LinhaEscala[] | undefined {
  return useLiveQuery(async () => {
    const [lotes, pesagens, formulas, ingredientes, fornecimentos] = await Promise.all([
      db.lotes.toArray(), db.pesagens.toArray(), db.formulas.toArray(), db.ingredientes.toArray(), db.fornecimentos.where('data').equals(data).toArray(),
    ]);
    return montarEscala(lotes, pesagens, formulas, ingredientes, fornecimentos, data);
  }, [data]);
}

export interface ItemEstoque { tipo: 'insumo' | 'mistura'; id: number; nome: string; precoKg: number; situacao: SituacaoEstoque; consumoPlanejado: number }

/** Situação de todos os estoques, usando a escala de hoje como consumo previsto. */
export function useEstoque(hoje = hojeISO()): ItemEstoque[] | undefined {
  return useLiveQuery(async () => {
    const [lotes, pesagens, formulas, ingredientes, movs] = await Promise.all([
      db.lotes.toArray(), db.pesagens.toArray(), db.formulas.toArray(), db.ingredientes.toArray(), db.movimentos.toArray(),
    ]);
    const escala = montarEscala(lotes, pesagens, formulas, ingredientes, [], hoje);
    const planIng = new Map<number, number>();
    const planMist = new Map<number, number>();
    for (const l of escala) {
      if (!l.formula || !l.resultado) continue;
      if (l.formula.modo === 'batida') planMist.set(l.formula.id!, (planMist.get(l.formula.id!) ?? 0) + l.kgTotal);
      else for (const i of l.resultado.inclusao) planIng.set(i.ingredienteId, (planIng.get(i.ingredienteId) ?? 0) + (l.kgTotal * i.pct) / 100);
    }
    const out: ItemEstoque[] = [];
    for (const f of formulas.filter((x) => x.modo === 'batida')) {
      const m = movs.filter((x) => x.formulaId === f.id);
      const plan = planMist.get(f.id!) ?? 0;
      out.push({ tipo: 'mistura', id: f.id!, nome: f.nome, precoKg: f.custoEstoque ?? calcularFormula(f.itens, ingredientes).custoKg, consumoPlanejado: plan, situacao: situacao(m, hoje, f.diasAlerta ?? 7, plan) });
    }
    for (const g of ingredientes) {
      const m = movs.filter((x) => x.ingredienteId === g.id);
      const plan = planIng.get(g.id!) ?? 0;
      if (!m.length && !plan) continue; // insumo sem uso nem estoque não aparece
      out.push({ tipo: 'insumo', id: g.id!, nome: g.nome, precoKg: g.preco, consumoPlanejado: plan, situacao: situacao(m, hoje, g.diasAlerta ?? 7, plan) });
    }
    const ordem = { ruim: 0, atencao: 1, bom: 2, parado: 3 } as const;
    return out.sort((a, b) => ordem[a.situacao.nivel] - ordem[b.situacao.nivel] || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [hoje]);
}

// ---------- Financeiro e análise dos lotes ----------
import { dreLote, folhaComoFixos, ratear, variacao, type DreLote } from './financeiro';
import { emCarencia, pendenciasSanidade, liberacaoAbate } from './sanidade';
import { lerConfigFin, lerConfig as lerConfigMercado } from './db';
import type { Lancamento, CustoFixo, Venda, EventoSanitario, Lembrete, Animal, Funcionario } from './db';

export interface Tudo {
  lotes: Lote[]; pesagens: Pesagem[]; formulas: Formula[]; ingredientes: Ingrediente[]; fornecimentos: Fornecimento[];
  lancamentos: Lancamento[]; custosFixos: CustoFixo[]; vendas: Venda[]; sanidade: EventoSanitario[]; lembretes: Lembrete[];
  movimentos: { data: string; valor?: number; tipo: string; origem: string }[]; animais: Animal[]; funcionarios: Funcionario[];
  precoArroba: number; rendimento: number; oportunidadeMes: number; comissaoVenda: number;
}

export async function carregarTudo(): Promise<Tudo> {
  const [lotes, pesagens, formulas, ingredientes, fornecimentos, lancamentos, custosFixos, vendas, sanidade, lembretes, movimentos, animais, funcionarios, m, f] = await Promise.all([
    db.lotes.toArray(), db.pesagens.toArray(), db.formulas.toArray(), db.ingredientes.toArray(), db.fornecimentos.toArray(),
    db.lancamentos.toArray(), db.custosFixos.toArray(), db.vendas.toArray(), db.sanidade.toArray(), db.lembretes.toArray(), db.movimentos.toArray(), db.animais.toArray(),
    db.funcionarios.toArray(), lerConfigMercado(), lerConfigFin(),
  ]);
  return { lotes, pesagens, formulas, ingredientes, fornecimentos, lancamentos, custosFixos, vendas, sanidade, lembretes, movimentos, animais, funcionarios, ...m, ...f };
}

export function useTudo(): Tudo | undefined {
  return useLiveQuery(carregarTudo);
}

export interface AnaliseLote { info: LoteInfo; dre: DreLote; liberacao: { data: string; produto: string } | null }

/** DRE de todos os lotes até uma data (rateio dos indiretos incluído). */
export function analisarLotes(t: Tudo, ate = hojeISO()): AnaliseLote[] {
  const loteFin = t.lotes.map((l) => ({ id: l.id!, nome: l.nome, dataEntrada: l.dataEntrada, qtdCabecas: l.qtdCabecas, encerrado: l.encerrado, dataSaida: l.dataSaida }));
  const rateio = ratear(loteFin, t.vendas, t.lancamentos, t.custosFixos, ate);
  const rateioFolha = ratear(loteFin, t.vendas, [], folhaComoFixos(t.funcionarios), ate);
  return t.lotes.map((l, i) => {
    const pes = t.pesagens.filter((p) => p.loteId === l.id);
    const dre = dreLote({
      lote: loteFin[i], pontos: pontosDoLote(pes), gmdMeta: l.gmdMeta, saidas: t.vendas, lancamentos: t.lancamentos,
      fornecimentos: t.fornecimentos, rateio: rateio.get(l.id!) ?? 0, rateioFolha: rateioFolha.get(l.id!) ?? 0, precoArroba: t.precoArroba, rendimento: t.rendimento,
      taxaOportunidadeMes: t.oportunidadeMes, ate,
    });
    return { info: montarInfo(l, pes, ate), dre, liberacao: liberacaoAbate(t.sanidade, l.id!) };
  });
}

/** Alertas que cruzam financeiro, sanidade e desempenho. */
export function alertasInteligentes(t: Tudo, hoje = hojeISO()): Alerta[] {
  const out: Alerta[] = [];
  const atual = analisarLotes(t, hoje);
  const fimMesPassado = somaDiasLocal(hoje.slice(0, 8) + '01', -1);
  const passado = analisarLotes(t, fimMesPassado);
  for (const a of atual) {
    const l = a.info.lote;
    if (l.encerrado) continue;
    const antes = passado.find((p) => p.info.lote.id === l.id);
    const v = variacao(antes?.dre.custoArrobaProduzida ?? null, a.dre.custoArrobaProduzida);
    // só compara depois de 45 dias de lote: no começo a @ produzida é pequena e qualquer gasto muda muito o custo
    if (v != null && v >= 0.05 && antes && antes.dre.dias >= 45) {
      out.push({ nivel: 'atencao', titulo: `${l.nome}: custo da @ subiu ${Math.round(v * 100)}% este mês`, texto: `Passou de ${moeda(antes!.dre.custoArrobaProduzida)} para ${moeda(a.dre.custoArrobaProduzida)} por @ produzida. Confira o consumo do trato e o GMD.` });
    }
    if (a.dre.custoArrobaProduzida != null && a.dre.custoArrobaProduzida > t.precoArroba) {
      out.push({ nivel: 'ruim', titulo: `${l.nome}: a @ produzida custa mais que a @ vendida`, texto: `Custo de ${moeda(a.dre.custoArrobaProduzida)} por @ contra ${moeda(t.precoArroba)} do mercado. Cada @ a mais dá prejuízo.` });
    }
    const car = emCarencia(t.sanidade, l.id!, hoje);
    if (car) {
      const prev = a.info.projecao?.dataPrevista;
      if (prev && prev < car.data) out.push({ nivel: 'ruim', titulo: `${l.nome}: carência atrapalha a venda`, texto: `A previsão de saída (${prev.split('-').reverse().join('/')}) é antes do fim da carência de ${car.produto} (${car.data.split('-').reverse().join('/')}). Não mande para o abate antes.` });
      else if (diasEntre(hoje, car.data) <= 30 || (a.info.projecao && diasEntre(hoje, a.info.projecao.dataPrevista) <= 45)) out.push({ nivel: 'atencao', titulo: `${l.nome} em carência até ${car.data.split('-').reverse().join('/')}`, texto: `Por causa de ${car.produto}. Só libere para abate depois dessa data.` });
    }
  }
  const nomes = new Map(t.lotes.map((l) => [l.id!, l.nome]));
  for (const p of pendenciasSanidade(t.sanidade.filter((e) => !t.lotes.find((l) => l.id === e.loteId)?.encerrado).map((e) => ({ ...e, nomeLote: nomes.get(e.loteId) })), t.lembretes, hoje)) {
    out.push({ nivel: p.nivel, titulo: p.titulo, texto: p.texto });
  }
  return out;
}

import { diasEntre, somaDias as somaDiasLocal } from './calc';
const moeda = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
