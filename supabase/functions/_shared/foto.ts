// Regras da leitura por foto. Sem dependências (roda no Deno da função e nos testes do app).
// Nunca confiamos na resposta do modelo: cada número passa por limites antes de voltar para o app,
// e o app mostra tudo para a pessoa conferir antes de salvar.

export type TipoFoto = 'rotulo' | 'balanca';
export const CATEGORIAS = ['ingrediente', 'nucleo', 'sal_mineral', 'sal_adensado', 'proteinado', 'proteico_energetico', 'racao'] as const;
export type Categoria = (typeof CATEGORIAS)[number];
/** Equivalente proteico da ureia: 1% de ureia dá ~2,81% de PB. */
export const PB_POR_UREIA = 2.81;
export const MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_BASE64 = 6_000_000; // ~4,5 MB de imagem

export interface PedidoFoto { tipo: TipoFoto; imagem: string; mime: (typeof MIMES)[number]; fazenda: string }

export function validarPedido(corpo: unknown): PedidoFoto {
  const c = corpo as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') throw new Error('Pedido inválido.');
  if (c.tipo !== 'rotulo' && c.tipo !== 'balanca') throw new Error('Tipo de foto inválido.');
  if (typeof c.mime !== 'string' || !(MIMES as readonly string[]).includes(c.mime)) throw new Error('A foto precisa ser JPG, PNG ou WebP.');
  if (typeof c.imagem !== 'string' || c.imagem.length < 100) throw new Error('Foto vazia.');
  if (c.imagem.length > MAX_BASE64) throw new Error('Foto grande demais.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(c.imagem)) throw new Error('Foto inválida.');
  // A fazenda decide o plano e a cota; o banco confere se a pessoa é mesmo dela.
  if (typeof c.fazenda !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.fazenda)) throw new Error('Ligue o celular a uma fazenda na nuvem.');
  return { tipo: c.tipo, imagem: c.imagem, mime: c.mime as PedidoFoto['mime'], fazenda: c.fazenda };
}

const num = { type: ['number', 'null'] } as const;

export const ESQUEMA: Record<TipoFoto, Record<string, unknown>> = {
  rotulo: {
    type: 'object', additionalProperties: false,
    required: ['legivel', 'categoria', 'nome', 'umidade', 'pb', 'ndt', 'ca', 'p', 'nnp_pb', 'consumo_texto', 'consumo_pct_pv', 'observacao'],
    properties: {
      legivel: { type: 'boolean' }, categoria: { type: ['string', 'null'], enum: [...CATEGORIAS, null] },
      nome: { type: ['string', 'null'] }, umidade: num, pb: num, ndt: num, ca: num, p: num, nnp_pb: num,
      consumo_texto: { type: ['string', 'null'] }, consumo_pct_pv: num,
      observacao: { type: ['string', 'null'] },
    },
  },
  balanca: {
    type: 'object', additionalProperties: false, required: ['legivel', 'peso', 'brinco'],
    properties: { legivel: { type: 'boolean' }, peso: num, brinco: { type: ['string', 'null'] } },
  },
};

export const PROMPT: Record<TipoFoto, string> = {
  rotulo: [
    'A imagem é o rótulo (níveis de garantia / tabela nutricional) de um produto para bovinos, no Brasil.',
    'categoria: "nucleo" se for núcleo/premix para misturar com milho e farelo na fazenda;',
    '"sal_mineral" (mineral puro), "sal_adensado" (mineral com ureia/proteína, "adensado"), "proteinado" (proteico ou proteico-mineral pronto),',
    '"proteico_energetico" (proteico-energético pronto), "racao" (ração pronta: RIP, TIP, creep, engorda) ou "ingrediente" (grão, farelo, ureia...).',
    'Para produto pronto para uso, use o modo de uso / consumo indicado no rótulo.',
    'Leia os valores impressos e devolva TODOS em porcentagem (%) na matéria natural, como está no rótulo:',
    '- converta g/kg dividindo por 10 (ex.: 400 g/kg = 40%); mg/kg dividindo por 10000.',
    '- umidade: o valor de "Umidade (máx.)". pb: "Proteína bruta (mín.)". ndt: "NDT" se houver.',
    '- ca: "Cálcio" (se vier mínimo e máximo, use a média). p: "Fósforo (mín.)".',
    '- nnp_pb: "Equivalente proteico de NNP" (proteína vinda de ureia), se houver.',
    '- consumo_texto: o consumo indicado, curto, como está no rótulo (ex.: "1 g por kg de peso vivo" ou "100 a 200 g/cab/dia").',
    '- consumo_pct_pv: o mesmo consumo em % do peso vivo só se o rótulo der assim (1 g/kg PV = 0,1; 0,3% PV = 0,3); senão null.',
    'Use null para o que não estiver na foto. Não invente nem estime valores. nome: nome comercial do produto.',
    'legivel = false se a foto não for um rótulo ou não der para ler. observacao: algo importante em uma frase curta (ou null).',
  ].join('\n'),
  balanca: [
    'A imagem é o visor de uma balança de gado. Leia o peso mostrado em kg.',
    'Se houver um número de brinco/identificação na tela, devolva em brinco; senão null.',
    'legivel = false se não der para ler o peso com segurança. Não estime.',
  ].join('\n'),
};

const faixa = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 1000) / 1000 : null;
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, max);
  return s || null;
};

export interface LeituraRotulo {
  legivel: boolean; categoria: Categoria | null; nome: string | null;
  ms: number | null; pb: number | null; ndt: number | null; ca: number | null; p: number | null;
  /** true só quando o produto é a própria ureia. */
  ureia: boolean;
  /** % de ureia contida no produto, pelo equivalente proteico de NNP do rótulo. */
  ureiaTeor: number | null;
  consumo: string | null; consumoPctPV: number | null; observacao: string | null;
}
export interface LeituraBalanca { legivel: boolean; peso: number | null; brinco: string | null }

/** Limpa o que o modelo respondeu: só números plausíveis passam. */
export function limparLeitura(tipo: TipoFoto, bruto: unknown): LeituraRotulo | LeituraBalanca {
  const r = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  if (tipo === 'balanca') {
    const peso = faixa(r.peso, 1, 2000);
    return { legivel: r.legivel === true && peso != null, peso, brinco: texto(r.brinco, 30) };
  }
  const umidade = faixa(r.umidade, 0, 99);
  const pb = faixa(r.pb, 0, 300);
  const nnp = faixa(r.nnp_pb, 0, 300);
  const pura = pb != null && pb >= 200;
  const pct = faixa(r.consumo_pct_pv, 0.005, 5);
  return {
    legivel: r.legivel === true,
    categoria: (CATEGORIAS as readonly unknown[]).includes(r.categoria) ? (r.categoria as Categoria) : null,
    nome: texto(r.nome, 80),
    ms: umidade == null ? null : Math.round((100 - umidade) * 1000) / 1000,
    pb, ndt: faixa(r.ndt, 0, 100), ca: faixa(r.ca, 0, 40), p: faixa(r.p, 0, 25),
    ureia: pura,
    ureiaTeor: pura || !nnp ? null : Math.min(100, Math.round((nnp / PB_POR_UREIA) * 100) / 100),
    consumo: texto(r.consumo_texto, 80),
    consumoPctPV: pct == null ? null : pct / 100,
    observacao: texto(r.observacao, 200),
  };
}

/** Comparação de segredo em tempo constante (para a chamada agendada das cotações). */
export function segredoConfere(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
