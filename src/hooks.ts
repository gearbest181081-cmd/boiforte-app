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
