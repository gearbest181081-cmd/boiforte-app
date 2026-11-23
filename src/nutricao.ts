// Formulação de dietas e suplementos. Funções puras, testadas em nutricao.test.ts.
import { avaliarNutrientes, fmtValor, textoFaixa } from './faixas';
// Valores dos ingredientes são "na matéria natural" (como vêm no rótulo do saco), em %.

export interface Nutrientes { ms: number; pb: number; ndt: number; ca: number; p: number }
export type CategoriaIngrediente = 'ingrediente' | 'nucleo' | 'sal_mineral' | 'sal_adensado' | 'proteinado' | 'proteico_energetico' | 'racao';
/** ureia: é a própria ureia. ureiaTeor: % de ureia contida (núcleo, sal adensado, proteinado...). */
/** Nutrientes que nem todo rótulo traz: fibra bruta (%), cobre e manganês (mg/kg). Vazio = não informado. */
export interface NutrientesExtras { fb?: number; cobre?: number; manganes?: number }
export type ChaveExtra = keyof NutrientesExtras;
export const EXTRAS: ChaveExtra[] = ['fb', 'cobre', 'manganes'];
export interface IngredienteNut extends Nutrientes, NutrientesExtras { id?: number; nome: string; preco: number; ureia?: boolean; ureiaTeor?: number; categoria?: CategoriaIngrediente; consumo?: string }
export interface ItemFormula { ingredienteId: number; qtd: number }

export type TipoFormula = 'sal_mineral' | 'proteinado' | 'proteico_energetico' | 'rip' | 'tip' | 'creep' | 'confinamento' | 'outro';

export interface Faixa { min?: number; max?: number }
export interface PerfilTipo {
  nome: string;
  descricao: string;
  consumoPctPV: number; // consumo sugerido, fração do peso vivo (0,001 = 0,1%)
  base: 'mn' | 'ms'; // faixas na matéria natural (suplementos) ou na matéria seca (dieta total)
  pb?: Faixa; ndt?: Faixa; caP?: Faixa; ureiaMax?: number;
}

/**
 * Faixas usuais de referência. São ponto de partida e podem ser ajustadas;
 * a decisão final é do nutricionista da fazenda.
 */
export const TIPOS: Record<TipoFormula, PerfilTipo> = {
  sal_mineral: { nome: 'Sal mineral', descricao: 'Mistura mineral, consumo ~0,05% PV', consumoPctPV: 0.0005, base: 'mn', caP: { min: 1, max: 3 } },
  proteinado: { nome: 'Proteinado', descricao: 'Proteico-mineral, consumo ~0,1% PV', consumoPctPV: 0.001, base: 'mn', pb: { min: 30, max: 50 }, ndt: { min: 35, max: 65 }, caP: { min: 1.2, max: 4 }, ureiaMax: 15 },
  proteico_energetico: { nome: 'Proteico energético', descricao: 'Consumo ~0,3% a 0,5% PV', consumoPctPV: 0.003, base: 'mn', pb: { min: 18, max: 32 }, ndt: { min: 55, max: 75 }, caP: { min: 1.2, max: 4 }, ureiaMax: 8 },
  rip: { nome: 'RIP (recria intensiva a pasto)', descricao: 'Ração de recria, consumo ~0,5% a 1% PV', consumoPctPV: 0.007, base: 'mn', pb: { min: 16, max: 24 }, ndt: { min: 65, max: 80 }, caP: { min: 1.2, max: 3 }, ureiaMax: 3 },
  tip: { nome: 'TIP (terminação intensiva a pasto)', descricao: 'Consumo ~1,5% a 2% PV', consumoPctPV: 0.015, base: 'mn', pb: { min: 13, max: 18 }, ndt: { min: 70, max: 82 }, caP: { min: 1.2, max: 3 }, ureiaMax: 1.5 },
  creep: { nome: 'Creep feeding', descricao: 'Bezerro ao pé da vaca, consumo ~0,5% a 1% PV', consumoPctPV: 0.007, base: 'mn', pb: { min: 18, max: 24 }, ndt: { min: 70, max: 82 }, caP: { min: 1.2, max: 3 }, ureiaMax: 0 },
  confinamento: { nome: 'Confinamento (dieta total)', descricao: 'Volumoso + concentrado, consumo ~2,2% a 2,5% PV na MS', consumoPctPV: 0.023, base: 'ms', pb: { min: 12, max: 15 }, ndt: { min: 68, max: 80 }, caP: { min: 1.5, max: 3 }, ureiaMax: 1.2 },
  outro: { nome: 'Outro', descricao: 'Sem faixa de referência', consumoPctPV: 0.003, base: 'mn' },
};

export interface ResultadoFormula {
  totalKg: number; // soma das quantidades (kg) ou 100 (%)
  inclusao: { ingredienteId: number; pct: number; kgPorTon: number; custo: number }[];
  mn: Nutrientes; // composição na matéria natural (%)
  ms: Omit<Nutrientes, 'ms'>; // composição na matéria seca (%)
  caP: number | null;
  custoKg: number; // R$/kg da mistura pronta
  ureiaPct: number; // % de ureia na mistura
  ingredientesFaltando: number[];
  /** Fibra bruta (%), cobre e manganês (mg/kg). semDado = quantos ingredientes da mistura não informam o valor. */
  extras: Record<ChaveExtra, { mn: number; ms: number; informado: boolean; semDado: number }>;
}

const PADRAO_POR_NOME = () => new Map(INGREDIENTES_PADRAO.map((i) => [i.nome, i]));
let padraoPorNome: ReturnType<typeof PADRAO_POR_NOME> | null = null;
/**
 * Valor de fibra, cobre ou manganês do ingrediente. Quem instalou o app antes desses campos tem os
 * ingredientes de partida sem eles: nesse caso usamos o valor de tabela do mesmo ingrediente de partida.
 */
export function valorExtra(ing: IngredienteNut, k: ChaveExtra): number | undefined {
  const v = ing[k];
  if (v != null && Number.isFinite(v)) return v;
  padraoPorNome ??= PADRAO_POR_NOME();
  return padraoPorNome.get(ing.nome)?.[k];
}

export function calcularFormula(itens: ItemFormula[], ingredientes: IngredienteNut[]): ResultadoFormula {
  const mapa = new Map(ingredientes.map((i) => [i.id, i]));
  const validos = itens.filter((i) => i.qtd > 0);
  const total = validos.reduce((s, i) => s + i.qtd, 0);
  const mn: Nutrientes = { ms: 0, pb: 0, ndt: 0, ca: 0, p: 0 };
  let custoKg = 0, ureiaPct = 0;
  const faltando: number[] = [];
  const ex = Object.fromEntries(EXTRAS.map((k) => [k, { mn: 0, ms: 0, informado: false, semDado: 0 }])) as ResultadoFormula['extras'];
  const inclusao = validos.map((it) => {
    const ing = mapa.get(it.ingredienteId);
    const frac = total > 0 ? it.qtd / total : 0;
    if (!ing) { faltando.push(it.ingredienteId); return { ingredienteId: it.ingredienteId, pct: frac * 100, kgPorTon: frac * 1000, custo: 0 }; }
    mn.ms += frac * ing.ms; mn.pb += frac * ing.pb; mn.ndt += frac * ing.ndt; mn.ca += frac * ing.ca; mn.p += frac * ing.p;
    custoKg += frac * ing.preco;
    ureiaPct += frac * (ing.ureia ? 100 : ing.ureiaTeor ?? 0);
    for (const k of EXTRAS) {
      const v = valorExtra(ing, k);
      if (v == null) ex[k].semDado++;
      else { ex[k].mn += frac * v; ex[k].informado = true; }
    }
    return { ingredienteId: it.ingredienteId, pct: frac * 100, kgPorTon: frac * 1000, custo: frac * ing.preco };
  });
  const f = mn.ms > 0 ? 100 / mn.ms : 0;
  for (const k of EXTRAS) ex[k].ms = ex[k].mn * f;
  return {
    totalKg: total,
    inclusao,
    mn,
    ms: { pb: mn.pb * f, ndt: mn.ndt * f, ca: mn.ca * f, p: mn.p * f },
    caP: mn.p > 0 ? mn.ca / mn.p : null,
    custoKg,
    ureiaPct,
    ingredientesFaltando: faltando,
    extras: ex,
  };
}

export type NivelAlerta = 'ruim' | 'atencao' | 'bom';
export interface AlertaFormula { nivel: NivelAlerta; texto: string; risco?: string }

const f1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function avaliarFormula(tipo: TipoFormula, r: ResultadoFormula, consumoPctPV = TIPOS[tipo].consumoPctPV): AlertaFormula[] {
  const perfil = TIPOS[tipo];
  const out: AlertaFormula[] = [];
  if (r.totalKg <= 0) return [{ nivel: 'atencao', texto: 'Adicione os ingredientes e as quantidades.' }];
  if (r.ingredientesFaltando.length) out.push({ nivel: 'ruim', texto: 'Algum ingrediente desta fórmula foi apagado da biblioteca.', risco: 'Os números abaixo estão incompletos.' });
  const base = perfil.base === 'ms' ? r.ms : r.mn;
  const sufixo = perfil.base === 'ms' ? ' na matéria seca' : '';

  const checar = (nome: string, valor: number, faixa: Faixa | undefined, riscoBaixo: string, riscoAlto: string) => {
    if (!faixa) return;
    if (faixa.min != null && valor < faixa.min) {
      const muito = valor < faixa.min * 0.85;
      out.push({ nivel: muito ? 'ruim' : 'atencao', texto: `${nome} ${muito ? 'muito ' : ''}baixo: ${f1(valor)}%${sufixo} (referência ${f1(faixa.min)}% a ${f1(faixa.max ?? faixa.min)}%).`, risco: riscoBaixo });
    } else if (faixa.max != null && valor > faixa.max) {
      const muito = valor > faixa.max * 1.15;
      out.push({ nivel: muito ? 'ruim' : 'atencao', texto: `${nome} ${muito ? 'muito ' : ''}alto: ${f1(valor)}%${sufixo} (referência ${f1(faixa.min ?? 0)}% a ${f1(faixa.max)}%).`, risco: riscoAlto });
    }
  };

  checar('PB (proteína)', base.pb, perfil.pb,
    'Pouca proteína: o capim é mal aproveitado e o GMD cai.',
    'Proteína acima do necessário: encarece a dieta e o excesso de nitrogênio é perdido na urina.');
  checar('NDT (energia)', base.ndt, perfil.ndt,
    'Pouca energia: o animal não converte a proteína em ganho de peso.',
    'Energia alta demais para o tipo: risco de acidose, timpanismo e queda no consumo de pasto.');

  if (perfil.caP) {
    if (r.caP == null) {
      if (tipo === 'sal_mineral' || r.mn.ca > 0) out.push({ nivel: 'atencao', texto: 'Fósforo (P) não informado, não dá para calcular a relação Ca:P.', risco: 'Confira o rótulo do núcleo ou do sal.' });
    } else if (r.caP < 1) {
      out.push({ nivel: 'ruim', texto: `Relação Ca:P muito baixa: ${f1(r.caP)}:1 (ideal ${f1(perfil.caP.min!)} a ${f1(perfil.caP.max!)}:1).`, risco: 'Risco de cálculo urinário (pedra nos rins), principalmente em machos, e problemas de ossos.' });
    } else if (r.caP < perfil.caP.min!) {
      out.push({ nivel: 'atencao', texto: `Relação Ca:P baixa: ${f1(r.caP)}:1 (ideal ${f1(perfil.caP.min!)} a ${f1(perfil.caP.max!)}:1).`, risco: 'Dietas com muito grão precisam de calcário para evitar cálculo urinário.' });
    } else if (r.caP > perfil.caP.max! * 1.5) {
      out.push({ nivel: 'ruim', texto: `Relação Ca:P muito alta: ${f1(r.caP)}:1 (ideal ${f1(perfil.caP.min!)} a ${f1(perfil.caP.max!)}:1).`, risco: 'Excesso de cálcio atrapalha a absorção de fósforo, zinco e manganês.' });
    } else if (r.caP > perfil.caP.max!) {
      out.push({ nivel: 'atencao', texto: `Relação Ca:P alta: ${f1(r.caP)}:1 (ideal ${f1(perfil.caP.min!)} a ${f1(perfil.caP.max!)}:1).`, risco: 'Pode reduzir a absorção de fósforo.' });
    }
  }

  if (perfil.ureiaMax != null && r.ureiaPct > perfil.ureiaMax) {
    out.push({
      nivel: 'ruim',
      texto: perfil.ureiaMax === 0 ? `Ureia na mistura (${f1(r.ureiaPct)}%): não use ureia neste tipo.` : `Ureia acima do limite: ${f1(r.ureiaPct)}% (máximo ${f1(perfil.ureiaMax)}%).`,
      risco: 'Risco de intoxicação por ureia, que pode matar. Faça adaptação gradual e garanta cocho coberto e água.',
    });
  }
  // Cálcio, fósforo, cobre, manganês e fibra: só viram alerta quando o desvio é crítico.
  // (O que está só um pouco fora aparece marcado no próprio resultado.)
  for (const a of avaliarNutrientes(tipo, r, consumoPctPV)) {
    if (!a.critico || !['ca', 'p', 'cobre', 'manganes', 'fb'].includes(a.chave)) continue;
    const muito = a.status === 'muito_abaixo' ? 'muito baixo' : 'muito alto';
    out.push({ nivel: 'ruim', texto: `${a.rotulo} ${muito}: ${fmtValor(a.valor!, a.unidade)}${a.base === 'ms' ? ' na matéria seca' : ''} (faixa ${textoFaixa(a.faixa!)}).`, risco: a.risco });
  }
  if (!out.length && tipo !== 'outro') out.push({ nivel: 'bom', texto: 'Fórmula dentro das faixas de referência.' });
  return out;
}

/** kg por cabeça por dia a partir do peso e do consumo em % do peso vivo. */
export function kgCabDia(pesoKg: number, consumoPctPV: number): number {
  return pesoKg * consumoPctPV;
}

/**
 * Custo da arroba produzida só pela nutrição.
 * @ ganhas por dia = GMD × rendimento ÷ 15 (mesma base da planilha).
 */
export function custoArrobaNutricao(diariaRS: number, gmd: number | null, rendimento = 0.5): number | null {
  if (gmd == null || gmd <= 0) return null;
  return diariaRS / ((gmd * rendimento) / 15);
}

/** Converte a fórmula para uma batida de X kg (quanto de cada ingrediente). */
export function batida(r: ResultadoFormula, kgBatida: number): { ingredienteId: number; kg: number }[] {
  return r.inclusao.map((i) => ({ ingredienteId: i.ingredienteId, kg: (i.pct / 100) * kgBatida }));
}

/**
 * Ingredientes de partida (valores médios de tabela, na matéria natural). O produtor ajusta preço e composição.
 * Fibra bruta, cobre e manganês: médias aproximadas das tabelas de composição de alimentos (CQBAL/UFV e NASEM 2016).
 * Núcleo e sal mineral ficam sem esses valores de propósito: variam muito e devem ser copiados do rótulo.
 */
export const INGREDIENTES_PADRAO: Omit<IngredienteNut, 'id'>[] = [
  { nome: 'Milho grão moído', ms: 88, pb: 8, ndt: 78, ca: 0.03, p: 0.25, preco: 1.2, fb: 2.2, cobre: 3, manganes: 7 },
  { nome: 'Farelo de soja', ms: 89, pb: 45, ndt: 73, ca: 0.3, p: 0.58, preco: 2.67, fb: 6, cobre: 15, manganes: 35 },
  { nome: 'Sorgo grão moído', ms: 88, pb: 9, ndt: 72, ca: 0.03, p: 0.29, preco: 1.0, fb: 2.5, cobre: 5, manganes: 15 },
  { nome: 'Farelo de algodão 38%', ms: 90, pb: 38, ndt: 62, ca: 0.2, p: 1.0, preco: 1.9, fb: 12, cobre: 17, manganes: 20 },
  { nome: 'Caroço de algodão', ms: 91, pb: 21, ndt: 76, ca: 0.14, p: 0.55, preco: 1.3, fb: 22, cobre: 8, manganes: 13 },
  { nome: 'DDG de milho', ms: 90, pb: 30, ndt: 77, ca: 0.05, p: 0.8, preco: 1.6, fb: 7.5, cobre: 6, manganes: 18 },
  { nome: 'Polpa cítrica', ms: 88, pb: 6, ndt: 70, ca: 1.6, p: 0.1, preco: 1.1, fb: 12, cobre: 6, manganes: 7 },
  { nome: 'Silagem de milho', ms: 32, pb: 2.4, ndt: 21, ca: 0.08, p: 0.07, preco: 0.25, fb: 7, cobre: 1.5, manganes: 9 },
  { nome: 'Ureia pecuária', ms: 98, pb: 281, ndt: 0, ca: 0, p: 0, preco: 4.5, ureia: true, fb: 0, cobre: 0, manganes: 0 },
  { nome: 'Calcário calcítico', ms: 100, pb: 0, ndt: 0, ca: 37, p: 0, preco: 0.4, fb: 0, cobre: 0, manganes: 0 },
  { nome: 'Sal comum (cloreto de sódio)', ms: 100, pb: 0, ndt: 0, ca: 0, p: 0, preco: 1.0, fb: 0, cobre: 0, manganes: 0 },
  { nome: 'Núcleo TIP (preencha pelo rótulo)', ms: 95, pb: 30, ndt: 20, ca: 8, p: 2.5, preco: 3.0 },
  { nome: 'Sal mineral 80 (preencha pelo rótulo)', ms: 99, pb: 0, ndt: 0, ca: 15, p: 8, preco: 3.2 },
];
