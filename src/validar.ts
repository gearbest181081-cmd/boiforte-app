// Validação de tudo que é gravado no banco, independente da tela que gravou.
// Roda dentro do banco (ganchos do Dexie), então também protege a importação de cópias
// e qualquer gravação feita por código. Quando houver servidor (Etapa 4), as mesmas regras
// serão repetidas lá; o servidor nunca vai confiar no que vier do celular.

export class ErroValidacao extends Error {
  constructor(msg: string) { super(msg); this.name = 'ErroValidacao'; }
}

type Regra =
  | { t: 'texto'; max: number; obrigatorio?: boolean }
  | { t: 'num'; min: number; max: number; obrigatorio?: boolean; inteiro?: boolean }
  | { t: 'data'; obrigatorio?: boolean }
  | { t: 'enum'; valores: readonly string[]; obrigatorio?: boolean }
  | { t: 'bool' }
  | { t: 'id'; obrigatorio?: boolean }
  | { t: 'gid' }
  | { t: 'lista'; max: number; item: Record<string, Regra> };

const TXT = (max = 120, obrigatorio = false): Regra => ({ t: 'texto', max, obrigatorio });
const NUM = (min: number, max: number, obrigatorio = false, inteiro = false): Regra => ({ t: 'num', min, max, obrigatorio, inteiro });
const ID = (obrigatorio = true): Regra => ({ t: 'id', obrigatorio });
const DATA = (obrigatorio = true): Regra => ({ t: 'data', obrigatorio });
const ENUM = (valores: readonly string[], obrigatorio = true): Regra => ({ t: 'enum', valores, obrigatorio });
const BOOL: Regra = { t: 'bool' };
/** Identificador global do registro (usado na sincronização com a nuvem). */
const GID: Regra = { t: 'gid' };
export const RE_GID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CRIADO = NUM(0, 4102444800000, false, true);

export const FASES_V = ['cria', 'recria', 'rip', 'engorda_pasto', 'tip', 'confinamento'] as const;
export const CATEGORIAS_ANOTACAO_V = ['cerca', 'agua', 'cocho', 'pasto', 'animal', 'estrutura', 'outro'] as const;
export const MAX_FOTOS_ANOTACAO = 4;
export const MAX_MIDIAS = 4;
export const EXTS_MIDIA_V = ['jpg', 'webm', 'ogg', 'm4a'] as const;
const MIDIA: Record<string, Regra> = { arq: { t: 'texto', max: 36, obrigatorio: true }, ext: { t: 'enum', valores: EXTS_MIDIA_V, obrigatorio: true } };
const MAX_PONTOS = 500; // o mesmo de src/pastoGeo.ts
export const TIPOS_FORMULA_V = ['sal_mineral', 'proteinado', 'proteico_energetico', 'rip', 'tip', 'creep', 'confinamento', 'outro'] as const;

const ESQUEMAS_BASE: Record<string, Record<string, Regra>> = {
  propriedades: { id: ID(false), nome: TXT(120, true), municipio: TXT(80), uf: TXT(2), areaHa: NUM(0, 10_000_000), criadoEm: CRIADO },
  // areaHa do módulo: a soma das áreas dos piquetes não pode passar dela (gatilho em 20261124204700_area_modulo.sql).
  modulos: {
    id: ID(false), propriedadeId: ID(), nome: TXT(80, true), areaHa: NUM(0.01, 1_000_000), sistema: ENUM(['rotacionado', 'continuo'], false),
    diasOcupacao: NUM(1, 365, false, true), diasDescanso: NUM(0, 365, false, true), capacidadeUA: NUM(0, 50), criadoEm: CRIADO,
  },
  piquetes: {
    id: ID(false), moduloId: ID(), nome: TXT(80, true), areaHa: NUM(0, 1_000_000), capim: TXT(60),
    alturaEntrada: NUM(1, 300), alturaSaida: NUM(1, 300), kgMsCm: NUM(1, 1000),
    contorno: { t: 'lista', max: MAX_PONTOS, item: { lat: NUM(-90, 90, true), lon: NUM(-180, 180, true) } }, criadoEm: CRIADO,
  },
  lotes: {
    id: ID(false), propriedadeId: ID(), piqueteId: ID(false), nome: TXT(80, true), fase: ENUM(FASES_V), sexo: ENUM(['macho', 'femea', 'misto']),
    controle: ENUM(['lote', 'individual']), qtdCabecas: NUM(0, 1_000_000, true, true), dataEntrada: DATA(), pesoAlvo: NUM(0, 2000), gmdMeta: NUM(0, 5),
    formulaId: ID(false), consumoPctPV: NUM(0, 0.05), encerrado: BOOL, dataSaida: DATA(false), obs: TXT(1000),
    // histórico de fases (ex.: RIP → TIP). A dieta vai pelo nome (texto) para o histórico não quebrar se a fórmula for apagada.
    fases: { t: 'lista', max: 30, item: { data: DATA(), de: ENUM(FASES_V), para: ENUM(FASES_V), pesoMedio: NUM(1, 2000), dieta: TXT(80) } },
    criadoEm: CRIADO,
  },
  animais: { id: ID(false), loteId: ID(), brinco: TXT(30, true), sexo: ENUM(['macho', 'femea', 'misto'], false), raca: TXT(40), ativo: BOOL, criadoEm: CRIADO },
  pesagens: {
    id: ID(false), loteId: ID(), data: DATA(), tipo: ENUM(['media', 'individual']), pesoMedio: NUM(1, 2000, true), qtdPesada: NUM(0, 1_000_000, true, true),
    pesos: { t: 'lista', max: 100_000, item: { animalId: ID(), peso: NUM(1, 2000, true) } }, obs: TXT(300), criadoEm: CRIADO,
  },
  ingredientes: {
    id: ID(false), nome: TXT(80, true), ms: NUM(1, 100, true), pb: NUM(0, 300, true), ndt: NUM(0, 100, true), ca: NUM(0, 40, true), p: NUM(0, 25, true),
    preco: NUM(0, 100_000, true), ureia: BOOL, ureiaTeor: NUM(0, 100),
    fb: NUM(0, 100), cobre: NUM(0, 50_000), manganes: NUM(0, 50_000), // fibra bruta em %; cobre e manganês em mg/kg
    categoria: ENUM(['ingrediente', 'nucleo', 'sal_mineral', 'sal_adensado', 'proteinado', 'proteico_energetico', 'racao'], false),
    consumo: TXT(80), diasAlerta: NUM(0, 365, false, true), ativo: BOOL, criadoEm: CRIADO,
  },
  formulas: {
    id: ID(false), nome: TXT(80, true), tipo: ENUM(TIPOS_FORMULA_V), unidade: ENUM(['pct', 'kg']), modo: ENUM(['direto', 'batida']),
    consumoPctPV: NUM(0, 0.05, true), itens: { t: 'lista', max: 60, item: { ingredienteId: ID(), qtd: NUM(0, 1_000_000, true) } },
    custoEstoque: NUM(0, 100_000), diasAlerta: NUM(0, 365, false, true), obs: TXT(1000), criadoEm: CRIADO,
  },
  movimentos: {
    id: ID(false), ingredienteId: ID(false), formulaId: ID(false), data: DATA(), tipo: ENUM(['entrada', 'saida', 'ajuste']),
    kg: NUM(-10_000_000, 10_000_000, true), valor: NUM(0, 100_000_000), origem: ENUM(['compra', 'batida', 'fornecimento', 'ajuste']),
    refId: ID(false), obs: TXT(300), criadoEm: CRIADO,
  },
  batidas: {
    id: ID(false), formulaId: ID(), data: DATA(), kg: NUM(0.001, 10_000_000, true), custoTotal: NUM(0, 100_000_000, true),
    itens: { t: 'lista', max: 60, item: { ingredienteId: ID(), kg: NUM(0, 10_000_000, true), custo: NUM(0, 100_000_000, true) } }, criadoEm: CRIADO,
  },
  fornecimentos: {
    id: ID(false), loteId: ID(), formulaId: ID(), data: DATA(), cabecas: NUM(0, 1_000_000, true, true), pesoRef: NUM(0, 2000, true),
    kgPrevisto: NUM(0, 10_000_000, true), kgFornecido: NUM(0, 10_000_000, true), custo: NUM(0, 100_000_000, true), criadoEm: CRIADO,
  },
  config: { chave: TXT(40, true), valor: NUM(-1e12, 1e12, true) },
  lancamentos: {
    id: ID(false), data: DATA(), tipo: ENUM(['despesa', 'receita']),
    categoria: ENUM(['compra_animais', 'pasto', 'sanidade', 'mao_obra', 'frete', 'impostos', 'manutencao', 'combustivel', 'outros', 'venda_animais', 'outras_receitas']),
    descricao: TXT(120), valor: NUM(0, 1_000_000_000, true), loteId: ID(false), origem: ENUM(['manual', 'compra_lote', 'sanidade'], false), refId: ID(false), criadoEm: CRIADO,
    // dados da compra do lote, para o servidor refazer a conta
    compraQtd: NUM(0, 1_000_000, false, true), compraPreco: NUM(0, 10_000_000), compraComissao: NUM(0, 1), compraFrete: NUM(0, 100_000_000), compraNf: NUM(0, 100_000_000),
  },
  custosFixos: { id: ID(false), nome: TXT(80, true), valorMensal: NUM(0, 100_000_000, true), desde: DATA(), ate: DATA(false), criadoEm: CRIADO },
  vendas: {
    id: ID(false), loteId: ID(), data: DATA(), tipo: ENUM(['venda', 'morte']), cabecas: NUM(1, 1_000_000, true, true), pesoMedio: NUM(0, 2000),
    modo: ENUM(['arroba', 'cabeca'], false), preco: NUM(0, 10_000_000), rendimento: NUM(0, 1), comissaoPct: NUM(0, 1), frete: NUM(0, 100_000_000), outros: NUM(0, 100_000_000),
    valorBruto: NUM(0, 1_000_000_000, true), valorLiquido: NUM(-100_000_000, 1_000_000_000, true), comprador: TXT(80), obs: TXT(300), criadoEm: CRIADO,
  },
  sanidade: {
    id: ID(false), loteId: ID(), data: DATA(), feito: BOOL, tipo: ENUM(['vacina', 'vermifugo', 'carrapaticida', 'antibiotico', 'vitamina', 'exame', 'outro']),
    produto: TXT(80, true), dose: TXT(40), qtdAnimais: NUM(0, 1_000_000, false, true), custo: NUM(0, 100_000_000), carenciaDias: NUM(0, 730, false, true),
    repetirDias: NUM(0, 730, false, true), obs: TXT(300), criadoEm: CRIADO,
  },
  lembretes: { id: ID(false), titulo: TXT(100, true), mes: NUM(1, 12, true, true), dia: NUM(1, 31, true, true), antecedenciaDias: NUM(0, 365, true, true), obs: TXT(200), criadoEm: CRIADO },
  // Funcionários: o salário entra no custo da fazenda e da @. "usuarioId" liga à conta do app (pessoa da equipe na nuvem);
  // no servidor, só o dono liga, e só a quem é da equipe. O vaqueiro não recebe esta tabela.
  funcionarios: {
    id: ID(false), nome: TXT(80, true), funcao: TXT(60, true), salario: NUM(0, 1_000_000, true), encargos: NUM(0, 1_000_000),
    admissao: DATA(), saida: DATA(false), telefone: TXT(20), usuarioId: TXT(36), obs: TXT(300), criadoEm: CRIADO,
  },
  // autor, autorId e feitaPor: na nuvem quem preenche é o servidor (gatilho em 20261123170000_anotacoes.sql).
  // fotos[].foto: id da foto (uuid); o servidor confere o formato e o Storage só aceita "fazenda/foto.jpg".
  anotacoes: {
    id: ID(false), texto: TXT(1000, true), categoria: ENUM(CATEGORIAS_ANOTACAO_V, false), moduloId: ID(false), piqueteId: ID(false),
    urgente: BOOL, feita: BOOL, data: DATA(), feitaEm: DATA(false),
    fotos: { t: 'lista', max: MAX_FOTOS_ANOTACAO, item: { foto: TXT(36, true) } },
    autor: TXT(80), autorId: TXT(36), feitaPor: TXT(80), criadoEm: CRIADO,
  },
  // Ocupação do piquete. ocupanteId aponta para lotes ou grupos conforme "tipo". midias: fotos (jpg) e áudios.
  // No servidor um gatilho recusa duas ocupações do mesmo piquete (ou do mesmo ocupante) no mesmo período.
  ocupacoes: {
    id: ID(false), piqueteId: ID(), tipo: ENUM(['lote', 'grupo']), ocupanteId: ID(), entrada: DATA(), saida: DATA(false),
    cabecas: NUM(0, 1_000_000, true, true), pesoMedio: NUM(1, 2000), alturaEntrada: NUM(0, 300), alturaSaida: NUM(0, 300), massaEntrada: NUM(0, 50_000),
    notaEntrada: TXT(1000), notaSaida: TXT(1000),
    midiasEntrada: { t: 'lista', max: MAX_MIDIAS, item: MIDIA }, midiasSaida: { t: 'lista', max: MAX_MIDIAS, item: MIDIA }, criadoEm: CRIADO,
  },
  // NDVI do satélite: gravado só pelo servidor (o celular recebe pela sincronização).
  ndvi: {
    id: ID(false), piqueteId: ID(), data: DATA(), ndvi: NUM(-1, 1, true), min: NUM(-1, 1), max: NUM(-1, 1), nuvemPct: NUM(0, 100), criadoEm: CRIADO,
  },
};

/** Todas as tabelas (menos config, que usa a chave) ganham o identificador global "gid". */
export const ESQUEMAS: Record<string, Record<string, Regra>> = Object.fromEntries(
  Object.entries(ESQUEMAS_BASE).map(([t, e]) => [t, t === 'config' ? e : { ...e, gid: GID }]),
);
export type { Regra };

function dataValida(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  if (a < 1990 || a > 2100) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function checar(campo: string, regra: Regra, v: unknown, rotulo: string): unknown {
  const vazio = v === undefined || v === null || v === '';
  if (vazio) {
    if ('obrigatorio' in regra && regra.obrigatorio) throw new ErroValidacao(`${rotulo}: o campo "${campo}" é obrigatório.`);
    return regra.t === 'texto' ? undefined : v === '' ? undefined : v;
  }
  switch (regra.t) {
    case 'texto': {
      if (typeof v !== 'string') throw new ErroValidacao(`${rotulo}: "${campo}" deve ser texto.`);
      // remove caracteres de controle
      const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
      if (s.length > regra.max) throw new ErroValidacao(`${rotulo}: "${campo}" passou de ${regra.max} letras.`);
      if (!s && regra.obrigatorio) throw new ErroValidacao(`${rotulo}: o campo "${campo}" é obrigatório.`);
      return s || undefined;
    }
    case 'num': {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ErroValidacao(`${rotulo}: "${campo}" deve ser um número.`);
      if (v < regra.min || v > regra.max) throw new ErroValidacao(`${rotulo}: "${campo}" fora do limite (${regra.min} a ${regra.max}).`);
      if (regra.inteiro && !Number.isInteger(v)) throw new ErroValidacao(`${rotulo}: "${campo}" deve ser inteiro.`);
      return v;
    }
    case 'id':
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new ErroValidacao(`${rotulo}: referência "${campo}" inválida.`);
      return v;
    case 'data':
      if (!dataValida(v)) throw new ErroValidacao(`${rotulo}: data "${campo}" inválida.`);
      return v;
    case 'enum':
      if (typeof v !== 'string' || !regra.valores.includes(v)) throw new ErroValidacao(`${rotulo}: valor de "${campo}" não permitido.`);
      return v;
    case 'gid':
      if (typeof v !== 'string' || !RE_GID.test(v)) throw new ErroValidacao(`${rotulo}: identificador inválido.`);
      return v;
    case 'bool':
      if (typeof v !== 'boolean') throw new ErroValidacao(`${rotulo}: "${campo}" deve ser sim/não.`);
      return v;
    case 'lista': {
      if (!Array.isArray(v)) throw new ErroValidacao(`${rotulo}: "${campo}" deve ser uma lista.`);
      if (v.length > regra.max) throw new ErroValidacao(`${rotulo}: "${campo}" tem itens demais.`);
      return v.map((it) => limpar(regra.item, it, `${rotulo} (${campo})`));
    }
  }
}

function limpar(esquema: Record<string, Regra>, obj: unknown, rotulo: string): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ErroValidacao(`${rotulo}: registro inválido.`);
  const fonte = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [campo, regra] of Object.entries(esquema)) {
    const v = checar(campo, regra, fonte[campo], rotulo);
    if (v !== undefined) out[campo] = v;
  }
  return out; // campos desconhecidos são descartados
}

export const ROTULOS: Record<string, string> = {
  propriedades: 'Fazenda', modulos: 'Módulo', piquetes: 'Piquete', lotes: 'Lote', animais: 'Animal', pesagens: 'Pesagem',
  ingredientes: 'Ingrediente', formulas: 'Fórmula', movimentos: 'Estoque', batidas: 'Batida', fornecimentos: 'Fornecimento', config: 'Configuração',
  lancamentos: 'Lançamento', custosFixos: 'Custo fixo', vendas: 'Venda', sanidade: 'Sanidade', lembretes: 'Lembrete', funcionarios: 'Funcionário', anotacoes: 'Anotação',
  ocupacoes: 'Ocupação do piquete', ndvi: 'NDVI',
};

/** Valida e devolve uma cópia limpa do registro (sem campos desconhecidos). */
export function validarRegistro(tabela: string, obj: unknown): Record<string, unknown> {
  const esquema = ESQUEMAS[tabela];
  if (!esquema) throw new ErroValidacao(`Tabela desconhecida: ${tabela}`);
  return limpar(esquema, obj, ROTULOS[tabela] ?? tabela);
}

/** Limite de tamanho de um arquivo de cópia (evita travar o celular com arquivo gigante). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_LINHAS_TABELA = 500_000;
