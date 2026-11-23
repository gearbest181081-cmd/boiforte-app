// Escalas dos gráficos de peso e de GMD. Usadas na tela (SVG) e no PDF, para os dois saírem iguais.
import { diaNum, type PontoPeso, type Projecao } from './calc';

export interface EscalaCurva {
  x0: number; xFim: number; yMin: number; yMax: number; passo: number;
  /** Valores das linhas de grade do eixo do peso. */
  ys: number[];
  /** Projeção que cabe no gráfico (até 2 anos); senão null. */
  proj: Projecao | null;
  /** Linha da meta de GMD, cortada no topo do gráfico. Em dias (x) e kg (y). */
  meta: { x1: number; y1: number; x2: number; y2: number } | null;
}

const PASSOS = [5, 10, 20, 25, 50, 100, 200];

/** Escolhe um passo "redondo" que divide a faixa em até 4 partes. */
export function passoRedondo(faixa: number, partes = 4): number {
  return PASSOS.find((p) => p * partes >= faixa) ?? Math.ceil(faixa / partes / 250) * 250;
}

export function escalaCurva(pontos: PontoPeso[], opc: { gmdMeta?: number | null; pesoAlvo?: number | null; projecao?: Projecao | null }): EscalaCurva | null {
  if (!pontos.length) return null;
  const x0 = diaNum(pontos[0].data);
  const ult = pontos[pontos.length - 1];
  let xFim = diaNum(ult.data);
  const p = opc.projecao;
  const proj = p && !p.jaAtingiu && p.diasFaltando <= 730 && opc.pesoAlvo ? p : null;
  if (proj) xFim = Math.max(xFim, diaNum(proj.dataPrevista));
  if (xFim === x0) xFim = x0 + 30;

  const pesos = pontos.map((q) => q.peso);
  if (opc.pesoAlvo) pesos.push(opc.pesoAlvo);
  const min = Math.min(...pesos), max = Math.max(...pesos);
  const folga = Math.max(10, (max - min) * 0.1);
  const passo = passoRedondo(max - min + 2 * folga);
  const yMin = Math.max(0, Math.floor((min - folga) / passo) * passo);
  const yMax = yMin + Math.ceil((max + folga - yMin) / passo) * passo;
  const ys: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += passo) ys.push(v);

  const g = opc.gmdMeta;
  let meta = g && g > 0 ? { x1: x0, y1: pontos[0].peso, x2: xFim, y2: pontos[0].peso + g * (xFim - x0) } : null;
  if (meta && meta.y2 > yMax) meta = { ...meta, x2: x0 + (yMax - meta.y1) / g!, y2: yMax };
  return { x0, xFim, yMin, yMax, passo, ys, proj, meta };
}

/** Faixa do gráfico de barras de GMD: sempre inclui o zero e a meta. */
export function escalaGmd(valores: number[], meta?: number | null): { min: number; max: number; ys: number[] } {
  const todos = [...valores, 0, ...(meta && meta > 0 ? [meta] : [])];
  const bruto = { min: Math.min(...todos), max: Math.max(...todos) };
  const faixa = Math.max(0.2, bruto.max - bruto.min);
  const passo = [0.1, 0.2, 0.25, 0.5, 1].find((p) => p * 5 >= faixa * 1.1) ?? 2;
  const min = Math.floor(bruto.min / passo) * passo;
  let max = Math.ceil((bruto.max * 1.08) / passo) * passo;
  if (max <= min) max = min + passo;
  const ys: number[] = [];
  for (let v = min; v <= max + 1e-9; v += passo) ys.push(Math.round(v * 1000) / 1000);
  return { min, max, ys };
}
