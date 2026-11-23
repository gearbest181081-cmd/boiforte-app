// Faixa adequada de cada nutriente, conforme o tipo da fórmula (RIP, TIP, proteinado...).
// Funções puras, testadas em faixas.test.ts. Referências no fim do arquivo e no README.
import { TIPOS, type ResultadoFormula, type TipoFormula } from './nutricao';

export type ChaveNut = 'pb' | 'ndt' | 'ca' | 'p' | 'caP' | 'fb' | 'cobre' | 'manganes';
export type Unidade = '%' | 'mg/kg' | ':1';

export interface FaixaNut {
  min?: number; max?: number; // faixa adequada
  critMin?: number; critMax?: number; // abaixo/acima disso é crítico (vira alerta vermelho)
  unidade: Unidade;
}

/** incompleto: algum ingrediente não informa o valor e a conta deu abaixo; não dá para afirmar que falta. */
export type Status = 'dentro' | 'abaixo' | 'acima' | 'muito_abaixo' | 'muito_acima' | 'sem_dado' | 'sem_faixa' | 'incompleto';
export interface AvaliacaoNut {
  chave: ChaveNut; rotulo: string; curto: string; valor: number | null; unidade: Unidade; base: 'mn' | 'ms';
  faixa?: FaixaNut; status: Status; critico: boolean; risco?: string;
  semDado?: number; // ingredientes da mistura sem esse valor (conta parcial)
}

/** Consumo de matéria seca total de um bovino a pasto, em fração do peso vivo (2,3% PV). */
export const IMS_PASTO = 0.023;

/**
 * Minerais na dieta total (mg/kg ou % da matéria seca). NASEM 2016, tabela de exigências e
 * máximos toleráveis para bovinos de corte: Ca 0,4–1,0%; P 0,2–0,4%; Cu 10 mg/kg (máx. tolerável 40);
 * Mn 20–40 mg/kg (máx. tolerável 1.000). Para o cobre usamos até 20 mg/kg como faixa boa (o dobro da
 * exigência, ainda bem abaixo do limite tóxico).
 */
export const DIETA = {
  ca: { min: 0.4, max: 1.0 },
  p: { min: 0.2, max: 0.4 },
  cobre: { min: 10, max: 20, toleravel: 40 },
  manganes: { min: 20, max: 40, toleravel: 1000 },
} as const;

/**
 * Quanto o pasto já entrega (na matéria seca). Estimativa conservadora para pastagens tropicais:
 * fósforo e cobre costumam faltar (Embrapa: 82% das amostras de capim do Centro-Oeste com menos de
 * 4 mg/kg de cobre); manganês costuma sobrar no capim, por isso pouco manganês não é crítico.
 */
export const PASTO = { ca: 0.3, p: 0.12, cobre: 4, manganes: 10 } as const;

/**
 * Fibra bruta (% na matéria natural, como no rótulo). Não há exigência oficial de FB; estes são os
 * máximos comuns nos níveis de garantia de produtos do mercado para cada tipo. No confinamento
 * (dieta total, na MS) a fibra mínima protege contra acidose.
 */
const FIBRA: Partial<Record<TipoFormula, FaixaNut>> = {
  proteinado: { max: 15, unidade: '%' },
  proteico_energetico: { max: 12, unidade: '%' },
  rip: { max: 10, unidade: '%' },
  tip: { max: 8, unidade: '%' },
  creep: { max: 8, unidade: '%' },
  confinamento: { min: 10, max: 20, critMin: 7, unidade: '%' },
};

const SUPLEMENTO_A_PASTO: TipoFormula[] = ['sal_mineral', 'proteinado', 'proteico_energetico', 'rip', 'tip', 'creep'];

/** Arredonda para um número fácil de ler (2 algarismos significativos). */
function redondo(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const casas = 1 - Math.floor(Math.log10(v));
  if (casas <= 0) { const m = 10 ** -casas; return Math.round(v / m) * m; }
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

/**
 * Faixa de um mineral no produto a partir da exigência na dieta toda:
 * concentração = (alvo na dieta − o que o pasto dá) × consumo de MS ÷ consumo do produto.
 * Por isso a faixa muda com o tipo (RIP come ~0,7% do PV, TIP ~1,5%, sal mineral ~0,05%).
 */
function faixaMineral(alvoMin: number, alvoMax: number, pasto: number, consumoPctPV: number, toleravel?: number, critMinFrac?: number): FaixaNut | undefined {
  if (!(consumoPctPV > 0)) return undefined;
  const k = IMS_PASTO / consumoPctPV;
  const min = redondo((alvoMin - pasto) * k);
  const max = redondo((alvoMax - pasto) * k);
  return {
    min, max, unidade: alvoMin < 5 ? '%' : 'mg/kg',
    critMax: toleravel != null ? redondo((toleravel - pasto) * k) : undefined,
    critMin: critMinFrac != null ? redondo(min * critMinFrac) : undefined,
  };
}

/** Faixas adequadas de cada nutriente para o tipo e o consumo (% do PV) da fórmula. */
export function faixasDoTipo(tipo: TipoFormula, consumoPctPV: number): Partial<Record<ChaveNut, FaixaNut>> {
  const t = TIPOS[tipo];
  const out: Partial<Record<ChaveNut, FaixaNut>> = {};
  if (tipo === 'outro') return out;
  // PB e NDT: mesmas faixas de antes; "muito" = 15% além da faixa.
  if (t.pb) out.pb = { ...t.pb, critMin: t.pb.min != null ? t.pb.min * 0.85 : undefined, critMax: t.pb.max != null ? t.pb.max * 1.15 : undefined, unidade: '%' };
  if (t.ndt) out.ndt = { ...t.ndt, critMin: t.ndt.min != null ? t.ndt.min * 0.85 : undefined, critMax: t.ndt.max != null ? t.ndt.max * 1.15 : undefined, unidade: '%' };
  if (t.caP) out.caP = { ...t.caP, critMin: 1, critMax: t.caP.max != null ? t.caP.max * 1.5 : undefined, unidade: ':1' };
  if (t.base === 'ms') {
    // Dieta total: a exigência vale direto na matéria seca.
    out.ca = { ...DIETA.ca, unidade: '%' };
    out.p = { ...DIETA.p, critMin: DIETA.p.min * 0.5, unidade: '%' };
    out.cobre = { min: DIETA.cobre.min, max: DIETA.cobre.max, critMin: DIETA.cobre.min * 0.5, critMax: DIETA.cobre.toleravel, unidade: 'mg/kg' };
    out.manganes = { min: DIETA.manganes.min, max: DIETA.manganes.max, critMax: DIETA.manganes.toleravel, unidade: 'mg/kg' };
  } else if (SUPLEMENTO_A_PASTO.includes(tipo)) {
    out.ca = faixaMineral(DIETA.ca.min, DIETA.ca.max, PASTO.ca, consumoPctPV);
    out.p = faixaMineral(DIETA.p.min, DIETA.p.max, PASTO.p, consumoPctPV, undefined, 0.5);
    out.cobre = faixaMineral(DIETA.cobre.min, DIETA.cobre.max, PASTO.cobre, consumoPctPV, DIETA.cobre.toleravel, 0.5);
    out.manganes = faixaMineral(DIETA.manganes.min, DIETA.manganes.max, PASTO.manganes, consumoPctPV, DIETA.manganes.toleravel);
  }
  if (FIBRA[tipo]) out.fb = FIBRA[tipo];
  return out;
}

const NOMES: Record<ChaveNut, [string, string]> = {
  pb: ['PB (proteína)', 'PB'], ndt: ['NDT (energia)', 'NDT'], ca: ['Cálcio (Ca)', 'Ca'], p: ['Fósforo (P)', 'P'], caP: ['Relação Ca:P', 'Ca:P'],
  fb: ['Fibra bruta (FB)', 'Fibra'], cobre: ['Cobre (Cu)', 'Cobre'], manganes: ['Manganês (Mn)', 'Manganês'],
};

const RISCOS: Record<ChaveNut, { baixo: string; alto: string }> = {
  pb: { baixo: 'Pouca proteína: o capim é mal aproveitado e o GMD cai.', alto: 'Proteína acima do necessário: encarece e o excesso é perdido na urina.' },
  ndt: { baixo: 'Pouca energia: o animal não converte a proteína em ganho de peso.', alto: 'Energia alta demais para o tipo: risco de acidose, timpanismo e queda no consumo de pasto.' },
  ca: { baixo: 'Pouco cálcio: dieta com muito grão precisa de calcário.', alto: 'Cálcio sobrando atrapalha a absorção de fósforo, zinco e manganês.' },
  p: { baixo: 'Falta de fósforo é a mais comum no pasto: o gado come terra e osso, cai o ganho e a fertilidade.', alto: 'Fósforo além do necessário só encarece o produto.' },
  caP: { baixo: 'Risco de cálculo urinário (pedra nos rins), principalmente em machos.', alto: 'Excesso de cálcio atrapalha a absorção de fósforo.' },
  fb: { baixo: 'Pouca fibra na dieta de cocho: risco de acidose e timpanismo.', alto: 'Fibra alta tira energia: o produto rende menos ganho por kg.' },
  cobre: { baixo: 'Falta de cobre é comum no capim do Brasil: pelo arrepiado e desbotado, diarreia, baixa imunidade e ganho menor.', alto: 'Cobre acima do limite tolerável pode intoxicar (acúmulo no fígado).' },
  manganes: { baixo: 'Pouco manganês no produto. O capim costuma ter bastante, mas confira o rótulo.', alto: 'Manganês acima do limite tolerável: queda de consumo e de ganho.' },
};

function status(v: number, f: FaixaNut): { status: Status; critico: boolean } {
  if (f.critMin != null && v < f.critMin) return { status: 'muito_abaixo', critico: true };
  if (f.critMax != null && v > f.critMax) return { status: 'muito_acima', critico: true };
  if (f.min != null && v < f.min) return { status: 'abaixo', critico: false };
  if (f.max != null && v > f.max) return { status: 'acima', critico: false };
  return { status: 'dentro', critico: false };
}

/** Avalia cada nutriente do resultado contra a faixa do tipo. Mesma ordem da tela. */
export function avaliarNutrientes(tipo: TipoFormula, r: ResultadoFormula, consumoPctPV: number): AvaliacaoNut[] {
  const base = TIPOS[tipo].base;
  const faixas = faixasDoTipo(tipo, consumoPctPV);
  const comp = base === 'ms' ? r.ms : r.mn;
  const valores: [ChaveNut, number | null, number?][] = [
    ['pb', comp.pb], ['ndt', comp.ndt], ['ca', comp.ca], ['p', comp.p], ['caP', r.caP],
    ...(['fb', 'cobre', 'manganes'] as const).map((k): [ChaveNut, number | null, number] => {
      const e = r.extras[k];
      return [k, e.informado ? (base === 'ms' ? e.ms : e.mn) : null, e.semDado];
    }),
  ];
  return valores.map(([chave, valor, semDado]) => {
    const faixa = faixas[chave];
    const unidade: Unidade = chave === 'caP' ? ':1' : chave === 'cobre' || chave === 'manganes' ? 'mg/kg' : '%';
    const a: AvaliacaoNut = { chave, rotulo: NOMES[chave][0], curto: NOMES[chave][1], valor, unidade, base, faixa, status: 'sem_faixa', critico: false };
    if (semDado) a.semDado = semDado;
    if (valor == null || r.totalKg <= 0) { a.status = 'sem_dado'; return a; }
    if (!faixa) return a;
    const s = status(valor, faixa);
    if (semDado && (s.status === 'abaixo' || s.status === 'muito_abaixo')) { a.status = 'incompleto'; return a; }
    a.status = s.status; a.critico = s.critico;
    if (s.status !== 'dentro') a.risco = s.status.endsWith('abaixo') ? RISCOS[chave].baixo : RISCOS[chave].alto;
    return a;
  });
}

const casas = (v: number, u: Unidade) => (u === 'mg/kg' ? (v >= 100 ? 0 : 1) : u === ':1' ? 1 : v < 1 ? 2 : 1);
const n = (v: number, u: Unidade) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas(v, u) });
export function fmtValor(v: number, u: Unidade): string {
  return u === ':1' ? `${n(v, u)}:1` : u === '%' ? `${n(v, u)}%` : `${n(v, u)} mg/kg`;
}
/** "16 a 24%", "até 10%", "a partir de 30%". */
export function textoFaixa(f: FaixaNut): string {
  const suf = f.unidade === ':1' ? ':1' : f.unidade === '%' ? '%' : ' mg/kg';
  if (f.min != null && f.max != null) return `${n(f.min, f.unidade)} a ${n(f.max, f.unidade)}${suf}`;
  if (f.max != null) return `até ${n(f.max, f.unidade)}${suf}`;
  if (f.min != null) return `a partir de ${n(f.min, f.unidade)}${suf}`;
  return '';
}

export const ROTULO_STATUS: Record<Status, string> = {
  dentro: 'Dentro', abaixo: 'Abaixo', acima: 'Acima', muito_abaixo: 'Muito abaixo', muito_acima: 'Muito acima', sem_dado: 'Sem dado', sem_faixa: '', incompleto: 'Incompleto',
};
export const nivelStatus = (s: Status, critico: boolean): 'bom' | 'atencao' | 'ruim' | '' =>
  critico ? 'ruim' : s === 'dentro' ? 'bom' : s === 'abaixo' || s === 'acima' || s === 'incompleto' ? 'atencao' : '';

/*
Referências
- NASEM (National Academies of Sciences, Engineering, and Medicine). Nutrient Requirements of Beef Cattle, 8ª ed., 2016.
  Exigências e máximos toleráveis de minerais (reproduzidos no Merck/MSD Veterinary Manual, "Dietary Mineral Requirements and
  Maximum Tolerable Amounts for Most Classes of Beef Cattle").
- Rosa, I. V. Suplementação mineral de bovinos sob pastejo. Embrapa Gado de Corte (CNPGC). Teores de cobre e manganês em
  pastagens do Centro-Oeste.
- Valadares Filho, S. C. et al. BR-CORTE: Exigências nutricionais de zebuínos puros e cruzados, 3ª ed., UFV, 2016 (consumo de MS a pasto).
- PB, NDT e Ca:P: faixas de mercado já usadas no app (TIPOS em nutricao.ts). Fibra bruta: máximos comuns em rótulos comerciais.
*/
