// Alertas inteligentes do rebanho (Etapa 1: desempenho e pesagens).
import { desvioMeta, diasEntre, fmtGmd, fmtPct, projetar, resumo, fmtData, type PontoPeso } from './calc';

export type Nivel = 'ruim' | 'atencao' | 'bom';
export interface Alerta { nivel: Nivel; titulo: string; texto: string }

export interface LoteParaAlerta {
  nome: string;
  pesoAlvo?: number | null;
  gmdMeta?: number | null;
  encerrado?: boolean;
}

/** Dias sem pesar a partir dos quais o app pede uma nova pesagem. */
export const DIAS_SEM_PESAR = 35;

export function alertasDoLote(lote: LoteParaAlerta, pontos: PontoPeso[], hoje: string): Alerta[] {
  if (lote.encerrado) return [];
  const out: Alerta[] = [];
  const r = resumo(pontos);
  if (r.pesoAtual == null) {
    out.push({ nivel: 'atencao', titulo: `${lote.nome}: sem pesagem`, texto: 'Faça a primeira pesagem para o app calcular o GMD e a projeção.' });
    return out;
  }
  const gmdRef = r.gmdUltimo ?? r.gmdTotal;
  if (gmdRef != null && gmdRef < 0) {
    out.push({ nivel: 'ruim', titulo: `${lote.nome} perdeu peso`, texto: `O lote perdeu peso na última pesagem (${fmtGmd(gmdRef)}). Confira pasto, água, cocho e sanidade.` });
  } else {
    const d = desvioMeta(gmdRef, lote.gmdMeta);
    if (d != null && d <= -0.1) {
      out.push({
        nivel: 'ruim',
        titulo: `${lote.nome} está ${fmtPct(-d).replace('+', '')} abaixo do GMD projetado`,
        texto: `Ganho atual de ${fmtGmd(gmdRef)} contra meta de ${fmtGmd(lote.gmdMeta)}. Verifique se o pasto está bem manejado, a água limpa e o suplemento sendo consumido.`,
      });
    } else if (d != null && d >= 0.1) {
      out.push({ nivel: 'bom', titulo: `${lote.nome} acima da meta`, texto: `Ganho de ${fmtGmd(gmdRef)}, ${fmtPct(d)} acima da meta. Bom trabalho!` });
    }
  }
  const semPesar = diasEntre(r.dataUltima!, hoje);
  if (semPesar >= DIAS_SEM_PESAR) {
    out.push({ nivel: 'atencao', titulo: `${lote.nome}: ${semPesar} dias sem pesar`, texto: `Última pesagem em ${fmtData(r.dataUltima)}. Pese de novo para acompanhar o ganho.` });
  }
  if (lote.pesoAlvo) {
    const p = projetar(pontos, lote.pesoAlvo, lote.gmdMeta);
    if (p?.jaAtingiu) {
      out.push({ nivel: 'bom', titulo: `${lote.nome} atingiu o peso alvo`, texto: `Peso médio de ${Math.round(r.pesoAtual)} kg. Hora de planejar a venda ou a próxima fase.` });
    } else if (p && diasEntre(hoje, p.dataPrevista) <= 30) {
      out.push({ nivel: 'atencao', titulo: `${lote.nome} perto do peso alvo`, texto: `Previsão de chegar a ${lote.pesoAlvo} kg em ${fmtData(p.dataPrevista)}. Comece a negociar a saída.` });
    }
  }
  return out;
}

const ORDEM: Record<Nivel, number> = { ruim: 0, atencao: 1, bom: 2 };
export function ordenarAlertas(a: Alerta[]): Alerta[] {
  return [...a].sort((x, y) => ORDEM[x.nivel] - ORDEM[y.nivel]);
}
