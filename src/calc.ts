// Cálculos zootécnicos do BoiForte. Funções puras, testadas em calc.test.ts.

export const DIA_MS = 86_400_000;
/** Rendimento de carcaça padrão (planilha do Luiz usa 50%). */
export const RENDIMENTO_PADRAO = 0.5;

export interface PontoPeso {
  data: string; // AAAA-MM-DD
  peso: number; // kg (médio ou individual)
}

/** Converte AAAA-MM-DD em número de dias (UTC, sem fuso). */
export function diaNum(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
}

export function diasEntre(inicio: string, fim: string): number {
  return diaNum(fim) - diaNum(inicio);
}

export function somaDias(data: string, dias: number): string {
  const d = new Date((diaNum(data) + Math.round(dias)) * DIA_MS);
  return d.toISOString().slice(0, 10);
}

export function hojeISO(agora: Date = new Date()): string {
  const off = agora.getTimezoneOffset() * 60_000;
  return new Date(agora.getTime() - off).toISOString().slice(0, 10);
}

/** GMD (kg/dia) entre dois pontos. Retorna null se as datas não andam para frente. */
export function gmd(a: PontoPeso, b: PontoPeso): number | null {
  const dias = diasEntre(a.data, b.data);
  if (dias <= 0) return null;
  return (b.peso - a.peso) / dias;
}

export function ordenar(pontos: PontoPeso[]): PontoPeso[] {
  return [...pontos].sort((x, y) => diaNum(x.data) - diaNum(y.data));
}

export interface Periodo {
  de: PontoPeso;
  ate: PontoPeso;
  dias: number;
  ganho: number;
  gmd: number | null;
}

/** GMD de cada intervalo entre pesagens consecutivas. */
export function periodos(pontos: PontoPeso[]): Periodo[] {
  const p = ordenar(pontos);
  const out: Periodo[] = [];
  for (let i = 1; i < p.length; i++) {
    out.push({
      de: p[i - 1],
      ate: p[i],
      dias: diasEntre(p[i - 1].data, p[i].data),
      ganho: p[i].peso - p[i - 1].peso,
      gmd: gmd(p[i - 1], p[i]),
    });
  }
  return out;
}

export interface Resumo {
  pesoInicial: number | null;
  pesoAtual: number | null;
  dataUltima: string | null;
  gmdTotal: number | null; // da primeira à última pesagem
  gmdUltimo: number | null; // último intervalo
  ganhoTotal: number | null;
  diasAcompanhados: number;
}

export function resumo(pontos: PontoPeso[]): Resumo {
  const p = ordenar(pontos);
  if (p.length === 0) {
    return { pesoInicial: null, pesoAtual: null, dataUltima: null, gmdTotal: null, gmdUltimo: null, ganhoTotal: null, diasAcompanhados: 0 };
  }
  const prim = p[0];
  const ult = p[p.length - 1];
  const per = periodos(p);
  return {
    pesoInicial: prim.peso,
    pesoAtual: ult.peso,
    dataUltima: ult.data,
    gmdTotal: p.length > 1 ? gmd(prim, ult) : null,
    gmdUltimo: per.length ? per[per.length - 1].gmd : null,
    ganhoTotal: ult.peso - prim.peso,
    diasAcompanhados: diasEntre(prim.data, ult.data),
  };
}

export interface Projecao {
  gmdUsado: number;
  origemGmd: 'ultimo' | 'total' | 'meta';
  diasFaltando: number;
  dataPrevista: string;
  jaAtingiu: boolean;
}

/**
 * Projeta quando o peso alvo será atingido.
 * Usa o GMD do último período; se não houver, o GMD total; se não houver, a meta.
 */
export function projetar(pontos: PontoPeso[], pesoAlvo: number, gmdMeta?: number | null): Projecao | null {
  const r = resumo(pontos);
  if (r.pesoAtual == null || r.dataUltima == null || !(pesoAlvo > 0)) return null;
  let gmdUsado: number | null = null;
  let origemGmd: Projecao['origemGmd'] = 'meta';
  if (r.gmdUltimo != null && r.gmdUltimo > 0) { gmdUsado = r.gmdUltimo; origemGmd = 'ultimo'; }
  else if (r.gmdTotal != null && r.gmdTotal > 0) { gmdUsado = r.gmdTotal; origemGmd = 'total'; }
  else if (gmdMeta != null && gmdMeta > 0) { gmdUsado = gmdMeta; origemGmd = 'meta'; }
  if (gmdUsado == null) return null;
  if (r.pesoAtual >= pesoAlvo) {
    return { gmdUsado, origemGmd, diasFaltando: 0, dataPrevista: r.dataUltima, jaAtingiu: true };
  }
  const diasFaltando = Math.ceil((pesoAlvo - r.pesoAtual) / gmdUsado);
  return { gmdUsado, origemGmd, diasFaltando, dataPrevista: somaDias(r.dataUltima, diasFaltando), jaAtingiu: false };
}

/** Arrobas de carcaça: peso vivo × rendimento ÷ 15 (mesma fórmula da planilha). */
export function arrobas(pesoVivo: number, rendimento: number = RENDIMENTO_PADRAO): number {
  return (pesoVivo * rendimento) / 15;
}

/** Diferença percentual do GMD real frente à meta (ex.: -0.11 = 11% abaixo). */
export function desvioMeta(gmdReal: number | null, gmdMeta: number | null | undefined): number | null {
  if (gmdReal == null || gmdMeta == null || gmdMeta <= 0) return null;
  return (gmdReal - gmdMeta) / gmdMeta;
}

export function media(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

/** Peso esperado numa data, partindo do primeiro ponto com o GMD meta. */
export function pesoEsperado(inicio: PontoPeso, gmdMeta: number, data: string): number {
  return inicio.peso + gmdMeta * diasEntre(inicio.data, data);
}

// ---------- Formatação pt-BR ----------
const nf = (min: number, max: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
export const fmtKg = (v: number | null | undefined, casas = 1) => (v == null || !Number.isFinite(v) ? '—' : `${nf(0, casas).format(v)} kg`);
export const fmtGmd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${nf(3, 3).format(v)} kg/dia`);
export const fmtNum = (v: number | null | undefined, casas = 1) => (v == null || !Number.isFinite(v) ? '—' : nf(0, casas).format(v));
export const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${nf(0, 0).format(v * 100)}%`);
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Peso estimado numa data: última pesagem + GMD (último período, senão médio, senão meta) × dias.
 * Usado para ajustar o trato automaticamente entre uma pesagem e outra.
 */
export function pesoEstimado(pontos: PontoPeso[], data: string, gmdMeta?: number | null): number | null {
  const r = resumo(pontos);
  if (r.pesoAtual == null || r.dataUltima == null) return null;
  const dias = diasEntre(r.dataUltima, data);
  if (dias <= 0) return r.pesoAtual;
  const g = r.gmdUltimo != null && r.gmdUltimo > 0 ? r.gmdUltimo : r.gmdTotal != null && r.gmdTotal > 0 ? r.gmdTotal : gmdMeta && gmdMeta > 0 ? gmdMeta : 0;
  return r.pesoAtual + g * dias;
}
