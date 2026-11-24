// Fases do lote e a mudança de fase (ex.: o lote termina a RIP e passa para a TIP).
// O lote continua o mesmo: pesagens, trato, custos e vendas seguem juntos. O que muda é a fase,
// a dieta, o peso alvo e o GMD esperado. A mudança fica guardada no histórico do lote (lote.fases),
// para ver depois quanto o lote ganhou em cada fase.
import { db, FASES, pontosDoLote, type Fase, type Lote, type MudancaFase, type Pesagem } from './db';
import { diasEntre, hojeISO, ordenar, pesoEstimado, type PontoPeso } from './calc';
import type { TipoFormula } from './nutricao';

/** GMD de referência por fase (tabela de referência da planilha, ajustável). */
export const GMD_SUGERIDO: Record<Fase, number> = { cria: 0.7, recria: 0.6, rip: 0.8, engorda_pasto: 0.75, tip: 0.95, confinamento: 1.35 };

/**
 * A Cria não tem peso alvo de saída: o gado de cria é vendido por outros critérios (pedido do Luiz).
 * As outras fases têm, com a sugestão abaixo.
 */
export type FaseComPesoAlvo = Exclude<Fase, 'cria'>;
export const usaPesoAlvo = (fase: Fase): fase is FaseComPesoAlvo => fase !== 'cria';
export const PESO_ALVO_SUGERIDO: Record<FaseComPesoAlvo, number> = { recria: 360, rip: 390, engorda_pasto: 510, tip: 540, confinamento: 540 };
/** Peso alvo que vale para o lote. Na Cria é sempre nenhum, mesmo que um lote antigo tenha um guardado. */
export function pesoAlvoDoLote(lote: { fase: Fase; pesoAlvo?: number | null }): number | null {
  return usaPesoAlvo(lote.fase) && lote.pesoAlvo ? lote.pesoAlvo : null;
}

/** Para onde o lote costuma ir depois de cada fase (é só a sugestão; a pessoa escolhe). */
export const PROXIMA_FASE: Record<Fase, Fase> = { cria: 'recria', recria: 'tip', rip: 'tip', engorda_pasto: 'tip', tip: 'confinamento', confinamento: 'tip' };

/** Tipo de fórmula que combina com a fase (para sugerir a dieta nova). */
export const DIETA_DA_FASE: Partial<Record<Fase, TipoFormula>> = { cria: 'creep', rip: 'rip', tip: 'tip', confinamento: 'confinamento' };

export const nomeCurtoFase = (f: Fase) => (FASES[f] ?? f).split(' (')[0];

export interface DadosMudanca {
  data: string;
  para: Fase;
  formulaId: number | null;
  pesoAlvo: number | null;
  gmdMeta: number | null;
  /** Peso médio pesado no dia da mudança (lote controlado pelo lote). Vira uma pesagem. */
  pesoMedio?: number | null;
}

/** Passa o lote para outra fase, guardando o histórico. Tudo junto: ou grava tudo, ou nada. */
export async function mudarFase(loteId: number, d: DadosMudanca): Promise<void> {
  await db.transaction('rw', db.lotes, db.pesagens, db.formulas, async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) throw new Error('Lote não encontrado.');
    if (lote.encerrado) throw new Error('Este lote está encerrado. Reabra o lote antes de mudar a fase.');
    if (d.para === lote.fase) throw new Error(`O lote já está em ${nomeCurtoFase(d.para)}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data)) throw new Error('Informe a data da mudança.');
    if (d.data < lote.dataEntrada) throw new Error('A data da mudança não pode ser antes da entrada do lote.');
    if (d.data > hojeISO()) throw new Error('A data da mudança não pode ser no futuro.');
    const ultima = lote.fases?.[lote.fases.length - 1];
    if (ultima && d.data < ultima.data) throw new Error(`A última mudança de fase foi em ${ultima.data.split('-').reverse().join('/')}. Use uma data igual ou depois dela.`);
    if (d.formulaId && !(await db.formulas.get(d.formulaId))) throw new Error('Dieta não encontrada.');

    const peso = d.pesoMedio && d.pesoMedio > 0 ? d.pesoMedio : null;
    if (peso && lote.controle === 'lote') {
      await db.pesagens.add({ loteId, data: d.data, tipo: 'media', pesoMedio: peso, qtdPesada: lote.qtdCabecas, obs: `Entrada na ${nomeCurtoFase(d.para)}`, criadoEm: Date.now() });
    }
    const pesagens = await db.pesagens.where('loteId').equals(loteId).toArray();
    const pesoNaData = peso ?? pesoEstimado(pontosAte(pesagens, d.data), d.data, lote.gmdMeta);
    const dietaAntes = lote.formulaId ? (await db.formulas.get(lote.formulaId))?.nome : undefined;

    const mudanca: MudancaFase = { data: d.data, de: lote.fase, para: d.para };
    if (pesoNaData != null && pesoNaData > 0) mudanca.pesoMedio = Math.round(pesoNaData * 10) / 10;
    if (dietaAntes) mudanca.dieta = dietaAntes.slice(0, 80);

    await db.lotes.update(loteId, {
      fase: d.para,
      formulaId: d.formulaId || null,
      consumoPctPV: null, // a dieta nova usa o consumo dela (dá para ajustar depois em Editar lote)
      pesoAlvo: usaPesoAlvo(d.para) ? d.pesoAlvo : null,
      gmdMeta: d.gmdMeta,
      fases: [...(lote.fases ?? []), mudanca],
    });
  });
}

function pontosAte(pesagens: Pesagem[], data: string): PontoPeso[] {
  return pontosDoLote(pesagens).filter((p) => p.data <= data);
}

export interface TrechoFase {
  fase: Fase;
  inicio: string;
  fim: string | null; // null = fase atual
  dias: number;
  pesoInicio: number | null;
  pesoFim: number | null;
  ganho: number | null;
  gmd: number | null;
  dieta?: string;
}

/**
 * Divide a vida do lote em fases (ex.: RIP de 28/09 a 15/12, TIP de 15/12 até hoje),
 * com o peso no começo e no fim de cada uma e o GMD de cada fase.
 */
export function trechosDeFase(lote: Lote, pontos: PontoPeso[], hoje = hojeISO()): TrechoFase[] {
  const mud = [...(lote.fases ?? [])].sort((a, b) => a.data.localeCompare(b.data));
  const ps = ordenar(pontos);
  const pesoEm = (data: string, conhecido?: number) => {
    if (conhecido) return conhecido;
    const exato = [...ps].reverse().find((p) => p.data === data);
    if (exato) return exato.peso;
    return pesoEstimado(ps.filter((p) => p.data <= data), data, null);
  };
  const out: TrechoFase[] = [];
  let inicio = lote.dataEntrada;
  let fase: Fase = mud[0]?.de ?? lote.fase;
  let pesoIni: number | null = ps.find((p) => p.data >= lote.dataEntrada)?.peso ?? null;
  for (const m of mud) {
    const pesoFim = pesoEm(m.data, m.pesoMedio);
    out.push(trecho(fase, inicio, m.data, pesoIni, pesoFim, m.dieta));
    inicio = m.data; fase = m.para; pesoIni = pesoFim;
  }
  const ultimo = ps.length ? ps[ps.length - 1] : null;
  const pesoAtual = ultimo && ultimo.data > inicio ? ultimo.peso : null;
  const fimAtual = lote.encerrado && lote.dataSaida ? lote.dataSaida : hoje;
  const t = trecho(fase, inicio, null, pesoIni, pesoAtual, undefined);
  t.dias = Math.max(0, diasEntre(inicio, fimAtual));
  t.gmd = pesoAtual != null && pesoIni != null && ultimo && diasEntre(inicio, ultimo.data) > 0 ? (pesoAtual - pesoIni) / diasEntre(inicio, ultimo.data) : null;
  out.push(t);
  return out;
}

function trecho(fase: Fase, inicio: string, fim: string | null, pesoInicio: number | null, pesoFim: number | null, dieta?: string): TrechoFase {
  const dias = fim ? Math.max(0, diasEntre(inicio, fim)) : 0;
  const ganho = pesoInicio != null && pesoFim != null ? pesoFim - pesoInicio : null;
  return { fase, inicio, fim, dias, pesoInicio, pesoFim, ganho, gmd: ganho != null && dias > 0 ? ganho / dias : null, dieta };
}
