// Regras da leitura por foto. Sem dependências (roda no Deno da função e nos testes do app).
// Nunca confiamos na resposta do modelo: cada número passa por limites antes de voltar para o app,
// e o app mostra tudo para a pessoa conferir antes de salvar.

export type TipoFoto = 'rotulo' | 'balanca';
export const MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_BASE64 = 6_000_000; // ~4,5 MB de imagem

export interface PedidoFoto { tipo: TipoFoto; imagem: string; mime: (typeof MIMES)[number] }

export function validarPedido(corpo: unknown): PedidoFoto {
  const c = corpo as Record<string, unknown> | null;
  if (!c || typeof c !== 'object') throw new Error('Pedido inválido.');
  if (c.tipo !== 'rotulo' && c.tipo !== 'balanca') throw new Error('Tipo de foto inválido.');
  if (typeof c.mime !== 'string' || !(MIMES as readonly string[]).includes(c.mime)) throw new Error('A foto precisa ser JPG, PNG ou WebP.');
  if (typeof c.imagem !== 'string' || c.imagem.length < 100) throw new Error('Foto vazia.');
  if (c.imagem.length > MAX_BASE64) throw new Error('Foto grande demais.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(c.imagem)) throw new Error('Foto inválida.');
  return { tipo: c.tipo, imagem: c.imagem, mime: c.mime as PedidoFoto['mime'] };
}

const num = { type: ['number', 'null'] } as const;

export const ESQUEMA: Record<TipoFoto, Record<string, unknown>> = {
  rotulo: {
    type: 'object', additionalProperties: false,
    required: ['legivel', 'nome', 'umidade', 'pb', 'ndt', 'ca', 'p', 'nnp_pb', 'observacao'],
    properties: {
      legivel: { type: 'boolean' }, nome: { type: ['string', 'null'] }, umidade: num, pb: num, ndt: num, ca: num, p: num, nnp_pb: num,
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
    'A imagem é o rótulo (níveis de garantia) de um suplemento, núcleo, sal mineral ou ração para bovinos, no Brasil.',
    'Leia os valores impressos e devolva TODOS em porcentagem (%) na matéria natural, como está no rótulo:',
    '- converta g/kg dividindo por 10 (ex.: 400 g/kg = 40%); mg/kg dividindo por 10000.',
    '- umidade: o valor de "Umidade (máx.)". pb: "Proteína bruta (mín.)". ndt: "NDT" se houver.',
    '- ca: "Cálcio" (se vier mínimo e máximo, use a média). p: "Fósforo (mín.)".',
    '- nnp_pb: "Equivalente proteico de NNP" (proteína vinda de ureia), se houver.',
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

export interface LeituraRotulo { legivel: boolean; nome: string | null; ms: number | null; pb: number | null; ndt: number | null; ca: number | null; p: number | null; ureia: boolean; observacao: string | null }
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
  return {
    legivel: r.legivel === true,
    nome: texto(r.nome, 80),
    ms: umidade == null ? null : Math.round((100 - umidade) * 1000) / 1000,
    pb, ndt: faixa(r.ndt, 0, 100), ca: faixa(r.ca, 0, 40), p: faixa(r.p, 0, 25),
    ureia: (faixa(r.nnp_pb, 0, 300) ?? 0) > 0,
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
