// Banco de dados local (IndexedDB via Dexie). Tudo fica guardado no próprio celular.
import Dexie, { type Transaction, type DBCore, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreTransaction, type Middleware, type Table } from 'dexie';
import { media, ordenar, type PontoPeso } from './calc';
import { calcularFormula, INGREDIENTES_PADRAO, type IngredienteNut, type ItemFormula, type TipoFormula } from './nutricao';
import { precoMedioAposCompra, saldo, type TipoMov } from './estoque';
import { ErroValidacao, MAX_BACKUP_BYTES, MAX_LINHAS_TABELA, validarRegistro } from './validar';
import { calcularVenda, custoCompra, type Categoria } from './financeiro';
import { LEMBRETES_PADRAO, type TipoSanidade } from './sanidade';
import { somaDias } from './calc';
import { trocarReferencias } from './nuvem/esquema';

export type Fase = 'cria' | 'recria' | 'rip' | 'engorda_pasto' | 'tip' | 'confinamento';
export type Sexo = 'macho' | 'femea' | 'misto';
export type Controle = 'lote' | 'individual';

export const FASES: Record<Fase, string> = {
  cria: 'Cria',
  recria: 'Recria',
  rip: 'RIP (recria intensiva a pasto)',
  engorda_pasto: 'Engorda a pasto',
  tip: 'TIP (terminação intensiva a pasto)',
  confinamento: 'Confinamento',
};
export const SEXOS: Record<Sexo, string> = { macho: 'Macho', femea: 'Fêmea', misto: 'Misto' };

export interface Propriedade { id?: number; gid?: string; nome: string; municipio?: string; uf?: string; areaHa?: number; criadoEm: number }
/**
 * Módulo de pastejo: o conjunto de piquetes por onde os mesmos animais rodam.
 * sistema: rotacionado (os animais mudam de piquete) ou contínuo. diasOcupacao/diasDescanso: o planejado.
 * capacidadeUA: quantas UA por hectare o módulo aguenta (lotação de suporte), para o aviso de lotação alta.
 */
export interface Modulo {
  id?: number; gid?: string; propriedadeId: number; nome: string;
  sistema?: 'rotacionado' | 'continuo'; diasOcupacao?: number; diasDescanso?: number; capacidadeUA?: number;
  criadoEm: number;
}
/**
 * Piquete: a variável de decisão do pasto (quem entra, quando entra, quando sai).
 * alturaEntrada/alturaSaida: altura do capim (cm) para entrar e para tirar os animais.
 * kgMsCm: kg de matéria seca por hectare para cada cm de capim (estima a massa de forragem pela altura).
 * contorno: pontos {lat, lon} do piquete (o satélite usa para o NDVI).
 */
export interface Piquete {
  id?: number; gid?: string; moduloId: number; nome: string; areaHa?: number; capim?: string;
  alturaEntrada?: number; alturaSaida?: number; kgMsCm?: number; contorno?: { lat: number; lon: number }[];
  criadoEm: number;
}
/** Arquivo de foto ou áudio guardado com a ocupação (o arquivo fica em fotosAnotacao e no Storage). */
export interface Midia { arq: string; ext: ExtMidia } // arq: id do arquivo (o servidor descarta campos chamados "id")
export type ExtMidia = 'jpg' | 'webm' | 'ogg' | 'm4a';
/**
 * Ocupação de um piquete: quem entrou, quando entrou e quando saiu, com a altura do capim, foto e áudio
 * na entrada e na saída. tipo "lote" (recria/engorda) ou "grupo" (grupo de manejo da cria).
 * Um piquete só tem um ocupante por vez (conferido no celular e no servidor).
 */
export interface Ocupacao {
  id?: number; gid?: string; piqueteId: number; tipo: 'lote' | 'grupo'; ocupanteId: number;
  entrada: string; saida?: string | null; cabecas: number; pesoMedio?: number | null;
  alturaEntrada?: number | null; alturaSaida?: number | null; massaEntrada?: number | null;
  notaEntrada?: string; notaSaida?: string; midiasEntrada?: Midia[]; midiasSaida?: Midia[];
  criadoEm: number;
}
/** NDVI do satélite (Sentinel-2) num piquete, numa data. Quem grava é o servidor; o celular só lê. */
export interface Ndvi { id?: number; gid?: string; piqueteId: number; data: string; ndvi: number; min?: number; max?: number; nuvemPct?: number; criadoEm?: number }
export interface Lote {
  id?: number;
  gid?: string;
  propriedadeId: number;
  piqueteId?: number | null;
  nome: string;
  fase: Fase;
  sexo: Sexo;
  controle: Controle;
  qtdCabecas: number;
  dataEntrada: string;
  pesoAlvo?: number | null;
  gmdMeta?: number | null;
  formulaId?: number | null; // dieta/suplemento do lote
  consumoPctPV?: number | null; // consumo do lote (se vazio, usa o da fórmula)
  encerrado?: boolean;
  dataSaida?: string | null; // quando o lote acabou (última venda/baixa)
  obs?: string;
  fases?: MudancaFase[]; // histórico: cada vez que o lote mudou de fase (ex.: RIP → TIP)
  criadoEm: number;
}
/** Uma mudança de fase do lote. "dieta" guarda o nome da dieta que o lote comia ATÉ essa data. */
export interface MudancaFase { data: string; de: Fase; para: Fase; pesoMedio?: number; dieta?: string }
export interface Animal { id?: number; gid?: string; loteId: number; brinco: string; sexo?: Sexo; raca?: string; ativo: boolean; criadoEm: number }
export interface PesoAnimal { animalId: number; peso: number }
export interface Pesagem {
  id?: number;
  gid?: string;
  loteId: number;
  data: string;
  tipo: 'media' | 'individual';
  pesoMedio: number;
  qtdPesada: number;
  pesos?: PesoAnimal[];
  obs?: string;
  criadoEm: number;
}

export interface Ingrediente extends IngredienteNut { id?: number; gid?: string; diasAlerta?: number; ativo?: boolean; criadoEm: number }
export interface Formula {
  id?: number;
  gid?: string;
  nome: string;
  tipo: TipoFormula;
  unidade: 'pct' | 'kg';
  modo: 'direto' | 'batida'; // direto: desconta os ingredientes no trato; batida: mistura feita antes e estocada
  consumoPctPV: number;
  itens: ItemFormula[];
  custoEstoque?: number; // R$/kg médio da mistura batida em estoque
  diasAlerta?: number;
  obs?: string;
  criadoEm: number;
}
export interface Movimento {
  id?: number;
  gid?: string;
  ingredienteId?: number; // estoque de um insumo...
  formulaId?: number; // ...ou de uma mistura batida
  data: string;
  tipo: TipoMov;
  kg: number;
  valor?: number; // R$ total (compras)
  origem: 'compra' | 'batida' | 'fornecimento' | 'ajuste';
  refId?: number;
  obs?: string;
  criadoEm: number;
}
export interface Batida { id?: number; gid?: string; formulaId: number; data: string; kg: number; custoTotal: number; itens: { ingredienteId: number; kg: number; custo: number }[]; criadoEm: number }
export interface Fornecimento {
  id?: number;
  gid?: string;
  loteId: number;
  formulaId: number;
  data: string;
  cabecas: number;
  pesoRef: number;
  kgPrevisto: number;
  kgFornecido: number;
  custo: number;
  criadoEm: number;
}
export interface Config { chave: string; valor: number }
export interface Lancamento {
  id?: number; gid?: string; data: string; tipo: 'despesa' | 'receita'; categoria: Categoria; descricao?: string; valor: number;
  loteId?: number | null; // vazio = custo indireto, rateado entre os lotes
  origem?: 'manual' | 'compra_lote' | 'sanidade'; refId?: number; criadoEm: number;
  compraQtd?: number; compraPreco?: number; compraComissao?: number; compraFrete?: number; compraNf?: number;
}
export interface CustoFixo { id?: number; gid?: string; nome: string; valorMensal: number; desde: string; ate?: string | null; criadoEm: number }
export interface Venda {
  id?: number; gid?: string; loteId: number; data: string; tipo: 'venda' | 'morte'; cabecas: number; pesoMedio?: number; modo?: 'arroba' | 'cabeca'; preco?: number;
  rendimento?: number; comissaoPct?: number; frete?: number; outros?: number; valorBruto: number; valorLiquido: number; comprador?: string; obs?: string; criadoEm: number;
}
export interface EventoSanitario {
  id?: number; gid?: string; loteId: number; data: string; feito: boolean; tipo: TipoSanidade; produto: string; dose?: string; qtdAnimais?: number; custo?: number;
  carenciaDias?: number; repetirDias?: number; obs?: string; criadoEm: number;
}
export interface Lembrete { id?: number; gid?: string; titulo: string; mes: number; dia: number; antecedenciaDias: number; obs?: string; criadoEm: number }
/** Funcionário da fazenda. Salário + encargos (por mês) entram no custo da fazenda e da @ produzida. */
export interface Funcionario {
  id?: number; gid?: string; nome: string; funcao: string; salario: number; encargos?: number; admissao: string; saida?: string | null;
  telefone?: string; usuarioId?: string | null; // conta do app (pessoa da equipe na nuvem); vazio = não usa o app
  obs?: string; criadoEm: number;
}

/** Anotação da ronda: o que precisa ser corrigido na fazenda, com foto e lugar (módulo/piquete). */
export interface Anotacao {
  id?: number; gid?: string; texto: string; categoria?: CategoriaAnotacao; moduloId?: number | null; piqueteId?: number | null;
  urgente?: boolean; feita?: boolean; data: string; feitaEm?: string | null;
  fotos?: { foto: string }[]; // ids das fotos (os arquivos ficam em fotosAnotacao e no Storage da nuvem)
  autor?: string; autorId?: string; feitaPor?: string; // quem anotou / quem resolveu (na nuvem, o servidor é quem preenche)
  criadoEm: number;
}
export type CategoriaAnotacao = 'cerca' | 'agua' | 'cocho' | 'pasto' | 'animal' | 'estrutura' | 'outro';
/**
 * Foto de anotação guardada no celular (não vai na cópia de segurança nem na fila de registros).
 * estado: "enviar" = ainda não subiu para a nuvem; "ok" = igual à nuvem; "apagar" = apagar da nuvem.
 */
export interface FotoLocal { id: string; dados?: ArrayBuffer; estado: 'enviar' | 'ok' | 'apagar'; em: number; erro?: string; ext?: ExtMidia } // ext vazio = foto jpg

/**
 * Registro na lixeira. Nada do que a pessoa apaga some: o registro sai da tabela dele e fica aqui até alguém restaurar.
 * pacote: o que foi apagado junto num toque (ex.: o lote com as pesagens e as vacinas).
 * dados: o registro como vai para a nuvem (referências pelo gid), para voltar certo em qualquer celular da equipe.
 * idLocal: o id que ele tinha neste celular (volta com o mesmo, se estiver livre). por: quem apagou (vem da nuvem).
 * tabela "*" (COPIA_INTEIRA): cópia inteira do celular, guardada antes de "Apagar todos os dados" ou de restaurar uma cópia.
 */
export interface Apagado { tabela: string; gid: string; pacote: string; dados: Record<string, unknown>; idLocal?: number; em: number; por?: string }
export const COPIA_INTEIRA = '*';

export const TABELAS = ['propriedades', 'modulos', 'piquetes', 'lotes', 'animais', 'pesagens', 'ingredientes', 'formulas', 'movimentos', 'batidas', 'fornecimentos', 'config', 'lancamentos', 'custosFixos', 'vendas', 'sanidade', 'lembretes', 'funcionarios', 'anotacoes', 'ocupacoes', 'ndvi'] as const;

export class BoiForteDB extends Dexie {
  propriedades!: Table<Propriedade, number>;
  modulos!: Table<Modulo, number>;
  piquetes!: Table<Piquete, number>;
  lotes!: Table<Lote, number>;
  animais!: Table<Animal, number>;
  pesagens!: Table<Pesagem, number>;
  ingredientes!: Table<Ingrediente, number>;
  formulas!: Table<Formula, number>;
  movimentos!: Table<Movimento, number>;
  batidas!: Table<Batida, number>;
  fornecimentos!: Table<Fornecimento, number>;
  config!: Table<Config, string>;
  lancamentos!: Table<Lancamento, number>;
  custosFixos!: Table<CustoFixo, number>;
  vendas!: Table<Venda, number>;
  sanidade!: Table<EventoSanitario, number>;
  lembretes!: Table<Lembrete, number>;
  funcionarios!: Table<Funcionario, number>;
  anotacoes!: Table<Anotacao, number>;
  ocupacoes!: Table<Ocupacao, number>;
  ndvi!: Table<Ndvi, number>;
  fotosAnotacao!: Table<FotoLocal, string>;
  lixeira!: Table<Apagado, [string, string]>;
  pendentes!: Table<Pendente, [string, number | string]>;
  sincEstado!: Table<{ chave: string; valor: unknown }, string>;
  sincEspera!: Table<{ tabela: string; gid: string; linha: unknown }, [string, string]>;

  constructor(nome = 'boiforte') {
    super(nome);
    this.version(1).stores({
      propriedades: '++id, nome',
      modulos: '++id, propriedadeId',
      piquetes: '++id, moduloId',
      lotes: '++id, propriedadeId, piqueteId, encerrado',
      animais: '++id, loteId, brinco',
      pesagens: '++id, loteId, data',
    });
    this.version(2).stores({
      lotes: '++id, propriedadeId, piqueteId, encerrado, formulaId',
      ingredientes: '++id, nome',
      formulas: '++id, tipo',
      movimentos: '++id, ingredienteId, formulaId, data, [origem+refId]',
      batidas: '++id, formulaId, data',
      fornecimentos: '++id, loteId, data, [loteId+data], formulaId',
      config: 'chave',
    });
    this.version(3).stores({
      lancamentos: '++id, data, loteId, categoria, [origem+refId]',
      custosFixos: '++id',
      vendas: '++id, loteId, data',
      sanidade: '++id, loteId, data, feito',
      lembretes: '++id',
    });
    // Etapa 4: cada registro ganha um identificador global (gid) para a nuvem, e toda gravação
    // fica anotada em "pendentes" (na mesma transação) até ser enviada.
    this.version(4).stores({
      propriedades: '++id, nome, &gid',
      modulos: '++id, propriedadeId, &gid',
      piquetes: '++id, moduloId, &gid',
      lotes: '++id, propriedadeId, piqueteId, encerrado, formulaId, &gid',
      animais: '++id, loteId, brinco, &gid',
      pesagens: '++id, loteId, data, &gid',
      ingredientes: '++id, nome, &gid',
      formulas: '++id, tipo, &gid',
      movimentos: '++id, ingredienteId, formulaId, data, [origem+refId], &gid',
      batidas: '++id, formulaId, data, &gid',
      fornecimentos: '++id, loteId, data, [loteId+data], formulaId, &gid',
      lancamentos: '++id, data, loteId, categoria, [origem+refId], &gid',
      custosFixos: '++id, &gid',
      vendas: '++id, loteId, data, &gid',
      sanidade: '++id, loteId, data, feito, &gid',
      lembretes: '++id, &gid',
      pendentes: '[tabela+chave], tabela',
      sincEstado: 'chave',
      sincEspera: '[tabela+gid]',
    }).upgrade(async (tx) => {
      (tx as Transaction & { __silencioso?: boolean }).__silencioso = true;
      for (const t of TABELAS) {
        // tabelas criadas em versões depois da 4 ainda não existem aqui (e nascem já com gid)
        if (t === 'config' || !tx.idbtrans.objectStoreNames.contains(t)) continue;
        await tx.table(t).toCollection().modify((r: { gid?: string }) => { if (!r.gid) r.gid = novoGid(); });
      }
    });
    this.version(5).stores({ funcionarios: '++id, &gid' });
    // Anotações e tarefas da ronda.
    this.version(6).stores({
      anotacoes: '++id, &gid, moduloId, piqueteId, data',
      fotosAnotacao: 'id, estado',
    });
    // Pasto: ocupação dos piquetes (entrada/saída) e NDVI do satélite.
    this.version(8).stores({
      ocupacoes: '++id, &gid, piqueteId, [tipo+ocupanteId], entrada',
      ndvi: '++id, &gid, piqueteId, data',
    });
    // Lixeira: o que foi apagado fica guardado para poder voltar (7 = Cria, 9 = Rastreabilidade).
    this.version(10).stores({ lixeira: '[tabela+gid], pacote, em' });
    this.use(middlewarePendentes);
    // Toda gravação passa pela validação, venha de onde vier.
    for (const t of TABELAS) {
      const tabela = this.table(t);
      tabela.hook('creating', (_pk, obj) => {
        if (t !== 'config' && !(obj as { gid?: string }).gid) (obj as { gid?: string }).gid = novoGid();
        const limpo = validarRegistro(t, obj);
        for (const k of Object.keys(obj)) if (!(k in limpo)) delete (obj as any)[k];
        Object.assign(obj, limpo);
      });
      tabela.hook('updating', (mods, _pk, obj) => {
        const junto: Record<string, unknown> = { ...(obj as object) };
        for (const [k, v] of Object.entries(mods)) { if (v === undefined) delete junto[k]; else junto[k] = v; }
        const limpo = validarRegistro(t, junto);
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(mods)) out[k] = k in limpo ? limpo[k] : undefined;
        return out;
      });
    }
  }
}

// ---------- Anotação das alterações para a nuvem ----------

export function novoGid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (c.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16)); // navegadores antigos, sem randomUUID
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Alteração esperando para subir. lixeira: no "del", o pacote da lixeira (a nuvem guarda o registro apagado junto com ele). */
export interface Pendente { tabela: string; chave: number | string; op: 'put' | 'del'; gid?: string; em: number; erro?: string; lixeira?: string }
// O NDVI vem só do servidor (satélite): o celular nunca manda.
export const SO_DO_SERVIDOR = new Set<string>(['ndvi']);
const SINC = new Set<string>(TABELAS.filter((t) => !SO_DO_SERVIDOR.has(t)));

/** Marca a transação atual (e as de dentro dela) para NÃO irem para a nuvem. */
function silenciosa(): boolean {
  for (let t = Dexie.currentTransaction as (Transaction & { __silencioso?: boolean; parent?: unknown }) | null; t; t = t.parent as typeof t) if (t.__silencioso) return true;
  return false;
}

/** Apagando dentro de naLixeira: tudo o que sair das tabelas vai para a lixeira com o mesmo pacote. */
interface CtxLixeira { pacote: string; em: number; apagados: { tabela: string; reg: Record<string, unknown> }[] }
function lixeiraAtual(): CtxLixeira | null {
  for (let t = Dexie.currentTransaction as (Transaction & { __lixeira?: CtxLixeira; parent?: unknown }) | null; t; t = t.parent as typeof t) if (t.__lixeira) return t.__lixeira;
  return null;
}

/**
 * Apaga mandando para a lixeira: tudo o que fn tirar das tabelas (o lote, as pesagens dele...) fica guardado num pacote
 * e pode voltar com restaurarPacote (src/lixeira.ts). Na nuvem, o servidor também guarda (só marca como apagado).
 * Devolve o pacote (ou null se nada foi apagado). Dentro de outra naLixeira, usa o pacote dela.
 */
export async function naLixeira(fn: () => Promise<unknown>): Promise<string | null> {
  const ja = lixeiraAtual();
  if (ja) { await fn(); return ja.pacote; }
  const ctx: CtxLixeira = { pacote: novoGid(), em: Date.now(), apagados: [] };
  await db.transaction('rw', db.tables, async (tx) => {
    (tx as Transaction & { __lixeira?: CtxLixeira }).__lixeira = ctx;
    await fn();
    if (!ctx.apagados.length) return;
    // Referências viram gid: do que continua no celular ou do que foi apagado junto (já não está na tabela).
    const gidApagado = new Map(ctx.apagados.map((a) => [`${a.tabela}:${a.reg.id}`, a.reg.gid as string]));
    const tabelas = new Set(db.tables.map((t) => t.name));
    const linhas: Apagado[] = [];
    for (const a of ctx.apagados) {
      if (typeof a.reg.gid !== 'string') continue;
      const dados = await trocarReferencias(a.tabela, a.reg, async (alvo, v) => {
        if (v == null || !alvo || typeof v !== 'number') return undefined;
        return gidApagado.get(`${alvo}:${v}`) ?? (tabelas.has(alvo) ? ((await db.table(alvo).get(v)) as { gid?: string } | undefined)?.gid : undefined);
      });
      linhas.push({ tabela: a.tabela, gid: a.reg.gid, pacote: ctx.pacote, dados, idLocal: a.reg.id as number, em: ctx.em });
    }
    await db.lixeira.bulkPut(linhas);
  });
  return ctx.apagados.length ? ctx.pacote : null;
}

/**
 * Grava sem marcar para envio (apagar o celular, aplicar o que veio da nuvem).
 * Tudo o que for feito dentro de fn, na mesma transação, fica de fora da fila.
 */
export function semAnotar<T>(tabelas: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tabelas, async (tx) => {
    (tx as Transaction & { __silencioso?: boolean }).__silencioso = true;
    return fn();
  });
}

const middlewarePendentes: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'pendentes',
  create(down) {
    return {
      ...down,
      transaction(stores, mode, opts) {
        const lista = mode === 'readwrite' && stores.some((s) => SINC.has(s)) && !stores.includes('pendentes') ? [...stores, 'pendentes'] : stores;
        return down.transaction(lista, mode, opts);
      },
      table(nome) {
        const t = down.table(nome);
        if (!SINC.has(nome)) return t;
        const anotar = (trans: DBCoreTransaction, lista: Pendente[]) =>
          lista.length ? down.table('pendentes').mutate({ type: 'put', trans, values: lista }) : Promise.resolve();
        return {
          ...t,
          async mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
            if (silenciosa()) return t.mutate(req);
            const em = Date.now();
            if (req.type === 'delete' || req.type === 'deleteRange') {
              let chaves: unknown[];
              if (req.type === 'delete') chaves = req.keys;
              else chaves = (await t.query({ trans: req.trans, query: { index: t.schema.primaryKey, range: req.range }, values: false })).result;
              const antes = nome === 'config' ? [] : await t.getMany({ trans: req.trans, keys: chaves });
              const lx = lixeiraAtual();
              if (lx) for (const r of antes) if (r) lx.apagados.push({ tabela: nome, reg: r as Record<string, unknown> });
              const res = await t.mutate(req);
              await anotar(req.trans, chaves.map((k, i) => ({
                tabela: nome, chave: k as number | string, op: 'del', gid: nome === 'config' ? String(k) : (antes[i] as { gid?: string } | undefined)?.gid, em,
                ...(lx ? { lixeira: lx.pacote } : {}),
              })));
              return res;
            }
            const res = await t.mutate(req);
            const chaves = (res.results ?? []).filter((_, i) => !res.failures?.[i]);
            await anotar(req.trans, chaves.map((k) => ({ tabela: nome, chave: k as number | string, op: 'put', em })));
            return res;
          },
        };
      },
    };
  },
};

export let db = new BoiForteDB();
/** Só para testes: troca o banco por outro isolado. */
export function usarBanco(novo: BoiForteDB) { db = novo; }


// ---------- Regras de negócio ----------

/** Cria o lote e, se informado, registra a pesagem de entrada. */
export async function criarLote(dados: Omit<Lote, 'id' | 'criadoEm'>, pesoEntrada?: number | null): Promise<number> {
  return db.transaction('rw', db.lotes, db.pesagens, async () => {
    const id = await db.lotes.add({ ...dados, criadoEm: Date.now() });
    if (pesoEntrada && pesoEntrada > 0) {
      await db.pesagens.add({ loteId: id, data: dados.dataEntrada, tipo: 'media', pesoMedio: pesoEntrada, qtdPesada: dados.qtdCabecas, obs: 'Entrada', criadoEm: Date.now() });
    }
    return id;
  });
}

/** Registra pesagem individual: cria os animais que ainda não existem pelo brinco. */
export async function registrarPesagemIndividual(loteId: number, data: string, itens: { brinco: string; peso: number }[], obs?: string): Promise<number> {
  const validos = itens.filter((i) => i.brinco.trim() && i.peso > 0);
  if (!validos.length) throw new Error('Informe ao menos um animal com peso.');
  return db.transaction('rw', db.animais, db.pesagens, db.lotes, async () => {
    const existentes = await db.animais.where('loteId').equals(loteId).toArray();
    const porBrinco = new Map(existentes.map((a) => [a.brinco.trim().toUpperCase(), a]));
    const pesos: PesoAnimal[] = [];
    for (const it of validos) {
      const chave = it.brinco.trim().toUpperCase();
      let a = porBrinco.get(chave);
      if (!a) {
        const id = await db.animais.add({ loteId, brinco: it.brinco.trim(), ativo: true, criadoEm: Date.now() });
        a = { id, loteId, brinco: it.brinco.trim(), ativo: true, criadoEm: Date.now() };
        porBrinco.set(chave, a);
      }
      const ja = pesos.findIndex((p) => p.animalId === a!.id);
      if (ja >= 0) pesos[ja].peso = it.peso; // brinco repetido: vale o último
      else pesos.push({ animalId: a.id!, peso: it.peso });
    }
    const pesoMedio = media(pesos.map((p) => p.peso))!;
    const id = await db.pesagens.add({ loteId, data, tipo: 'individual', pesoMedio, qtdPesada: pesos.length, pesos, obs, criadoEm: Date.now() });
    const ativos = [...porBrinco.values()].filter((x) => x.ativo).length;
    const lote = await db.lotes.get(loteId);
    if (lote && lote.controle === 'individual' && ativos > lote.qtdCabecas) await db.lotes.update(loteId, { qtdCabecas: ativos });
    return id;
  });
}

export function pontosDoLote(pesagens: Pesagem[]): PontoPeso[] {
  return ordenar(pesagens.map((p) => ({ data: p.data, peso: p.pesoMedio })));
}

export function pontosDoAnimal(pesagens: Pesagem[], animalId: number): PontoPeso[] {
  const out: PontoPeso[] = [];
  for (const p of pesagens) {
    const pa = p.pesos?.find((x) => x.animalId === animalId);
    if (pa) out.push({ data: p.data, peso: pa.peso });
  }
  return ordenar(out);
}

// Tudo o que a pessoa apaga vai para a lixeira (naLixeira) e pode voltar. Cada função devolve o pacote da lixeira,
// que a tela usa no botão "Desfazer".

/** Apaga o lote com tudo o que é dele: pesagens, animais, trato, vendas, vacinas, lançamentos e entradas em piquetes. */
export async function excluirLote(id: number) {
  return naLixeira(async () => {
    await db.ocupacoes.where('[tipo+ocupanteId]').equals(['lote', id]).delete();
    await db.lancamentos.where('loteId').equals(id).delete();
    await db.vendas.where('loteId').equals(id).delete();
    await db.sanidade.where('loteId').equals(id).delete();
    const fs = await db.fornecimentos.where('loteId').equals(id).primaryKeys();
    for (const f of fs) await db.movimentos.where('[origem+refId]').equals(['fornecimento', f]).delete();
    await db.fornecimentos.where('loteId').equals(id).delete();
    await db.pesagens.where('loteId').equals(id).delete();
    await db.animais.where('loteId').equals(id).delete();
    await db.lotes.delete(id);
  });
}

/** Apaga piquetes com o histórico de ocupação e o NDVI deles; lote que estava lá fica sem piquete. */
export async function excluirPiquetes(ids: number[]) {
  if (!ids.length) return null;
  return naLixeira(async () => {
    const grupos = db.tables.find((t) => t.name === 'grupos'); // grupos de manejo da cria (quando existir)
    await db.lotes.where('piqueteId').anyOf(ids).modify({ piqueteId: null });
    if (grupos) await grupos.filter((g: { piqueteId?: number | null }) => g.piqueteId != null && ids.includes(g.piqueteId)).modify({ piqueteId: null });
    await db.ocupacoes.where('piqueteId').anyOf(ids).delete();
    // O NDVI só vem do satélite: some daqui e, na nuvem, fica guardado e volta junto com o piquete.
    await db.ndvi.where('piqueteId').anyOf(ids).delete();
    await db.piquetes.bulkDelete(ids);
  });
}

/** Apaga o módulo com os piquetes dele. */
export async function excluirModulo(id: number) {
  return naLixeira(async () => {
    await excluirPiquetes(await db.piquetes.where('moduloId').equals(id).primaryKeys());
    await db.modulos.delete(id);
  });
}

export async function excluirPropriedade(id: number) {
  return naLixeira(async () => {
    // Os lotes saem antes dos piquetes: assim cada lote vai para a lixeira ainda com o piquete onde estava
    // e, se a fazenda voltar, volta para o mesmo lugar.
    for (const l of await db.lotes.where('propriedadeId').equals(id).primaryKeys()) await excluirLote(l);
    for (const m of await db.modulos.where('propriedadeId').equals(id).primaryKeys()) await excluirModulo(m);
    await db.propriedades.delete(id);
  });
}

/** Apaga um registro sozinho (pesagem, lançamento, custo fixo, lembrete, funcionário...), mandando para a lixeira. */
export async function excluirRegistro(tabela: (typeof TABELAS)[number], id: number) {
  return naLixeira(() => db.table(tabela).delete(id));
}

// ---------- Cópia de segurança ----------

export interface Backup { app: 'BoiForte'; versao: 1 | 2; geradoEm: string; dados: Record<string, unknown[]> }

export async function exportarBackup(): Promise<Backup> {
  const dados: Record<string, unknown[]> = {};
  for (const t of TABELAS) dados[t] = await db.table(t).toArray();
  return { app: 'BoiForte', versao: 2, geradoEm: new Date().toISOString(), dados };
}

/** Lê o texto de um arquivo de cópia com limite de tamanho. */
export function lerArquivoBackup(texto: string): unknown {
  if (texto.length > MAX_BACKUP_BYTES) throw new ErroValidacao('Arquivo grande demais para ser uma cópia do BoiForte.');
  try { return JSON.parse(texto); } catch { throw new ErroValidacao('Este arquivo não é uma cópia do BoiForte.'); }
}

/**
 * Restaura uma cópia. Cada linha passa pela validação do banco; se qualquer linha
 * for inválida, nada é alterado (a transação inteira é desfeita).
 */
export async function importarBackup(b: unknown): Promise<void> {
  const bk = b as Backup;
  if (!bk || typeof bk !== 'object' || bk.app !== 'BoiForte' || !bk.dados || typeof bk.dados !== 'object') throw new ErroValidacao('Este arquivo não é uma cópia do BoiForte.');
  if (bk.versao !== 1 && bk.versao !== 2) throw new ErroValidacao('Cópia feita por uma versão desconhecida do BoiForte.');
  for (const t of TABELAS) {
    const linhas = bk.dados[t];
    if (linhas !== undefined && !Array.isArray(linhas)) throw new ErroValidacao('Cópia corrompida.');
    if (Array.isArray(linhas) && linhas.length > MAX_LINHAS_TABELA) throw new ErroValidacao('Cópia com registros demais.');
  }
  await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      await db.table(t).clear();
      const linhas = bk.dados[t];
      if (Array.isArray(linhas) && linhas.length) await db.table(t).bulkAdd(linhas.map((l) => (l && typeof l === 'object' ? { ...l } : l)));
    }
  });
}

// ---------- Nutrição, estoque e fornecimento ----------

/** Coloca os ingredientes de partida na primeira vez que o produtor abre a nutrição. */
export async function garantirIngredientesPadrao() {
  await db.transaction('rw', db.ingredientes, db.config, async () => {
    const feito = await db.config.get('ingredientesPadrao');
    if (feito) return;
    if ((await db.ingredientes.count()) === 0) {
      await db.ingredientes.bulkAdd(INGREDIENTES_PADRAO.map((i) => ({ ...i, ativo: true, diasAlerta: 7, criadoEm: Date.now() })));
    }
    await db.config.put({ chave: 'ingredientesPadrao', valor: 1 });
  });
}

export const CONFIG_PADRAO = { precoArroba: 320, rendimento: 0.5 } as const;
export async function lerConfig(): Promise<{ precoArroba: number; rendimento: number }> {
  const [a, r] = await Promise.all([db.config.get('precoArroba'), db.config.get('rendimento')]);
  return { precoArroba: a?.valor ?? CONFIG_PADRAO.precoArroba, rendimento: r?.valor ?? CONFIG_PADRAO.rendimento };
}

export async function saldoIngrediente(id: number) {
  return saldo(await db.movimentos.where('ingredienteId').equals(id).toArray());
}
export async function saldoMistura(formulaId: number) {
  return saldo(await db.movimentos.where('formulaId').equals(formulaId).toArray());
}

/** Compra de insumo: entra no estoque e atualiza o preço médio. */
export async function comprarInsumo(ingredienteId: number, data: string, kg: number, valorTotal: number, obs?: string) {
  if (!(kg > 0)) throw new ErroValidacao('Informe a quantidade comprada em kg.');
  if (!(valorTotal >= 0)) throw new ErroValidacao('Informe o valor pago.');
  return db.transaction('rw', db.ingredientes, db.movimentos, async () => {
    const ing = await db.ingredientes.get(ingredienteId);
    if (!ing) throw new ErroValidacao('Insumo não encontrado.');
    const s = await saldoIngrediente(ingredienteId);
    const novoPreco = precoMedioAposCompra(s, ing.preco, kg, valorTotal / kg);
    await db.ingredientes.update(ingredienteId, { preco: Math.round(novoPreco * 10000) / 10000 });
    return db.movimentos.add({ ingredienteId, data, tipo: 'entrada', kg, valor: valorTotal, origem: 'compra', obs, criadoEm: Date.now() });
  });
}

export async function ajustarEstoque(alvo: { ingredienteId?: number; formulaId?: number }, data: string, kgContado: number) {
  return db.transaction('rw', db.movimentos, async () => {
    const atual = alvo.ingredienteId ? await saldoIngrediente(alvo.ingredienteId) : await saldoMistura(alvo.formulaId!);
    const dif = kgContado - atual;
    if (Math.abs(dif) < 1e-9) return null;
    return db.movimentos.add({ ...alvo, data, tipo: 'ajuste', kg: dif, origem: 'ajuste', obs: `Contagem: ${kgContado} kg`, criadoEm: Date.now() });
  });
}

async function ingredientesDaFormula(f: Formula): Promise<Ingrediente[]> {
  const ids = [...new Set(f.itens.map((i) => i.ingredienteId))];
  const ings = await db.ingredientes.bulkGet(ids);
  return ings.filter((x): x is Ingrediente => !!x);
}

/** Bate X kg de uma mistura: tira os ingredientes do estoque e põe a mistura no estoque. */
export async function registrarBatida(formulaId: number, data: string, kg: number) {
  if (!(kg > 0)) throw new ErroValidacao('Informe quantos kg foram batidos.');
  return db.transaction('rw', [db.formulas, db.ingredientes, db.movimentos, db.batidas], async () => {
    const f = await db.formulas.get(formulaId);
    if (!f) throw new ErroValidacao('Fórmula não encontrada.');
    const ings = await ingredientesDaFormula(f);
    const r = calcularFormula(f.itens, ings);
    if (r.ingredientesFaltando.length) throw new ErroValidacao('A fórmula tem ingrediente que não existe mais.');
    const precos = new Map(ings.map((i) => [i.id!, i.preco]));
    const itens = r.inclusao.map((i) => {
      const kgI = (i.pct / 100) * kg;
      return { ingredienteId: i.ingredienteId, kg: kgI, custo: kgI * (precos.get(i.ingredienteId) ?? 0) };
    });
    const custoTotal = itens.reduce((s, i) => s + i.custo, 0);
    const batidaId = await db.batidas.add({ formulaId, data, kg, custoTotal, itens, criadoEm: Date.now() });
    for (const i of itens) await db.movimentos.add({ ingredienteId: i.ingredienteId, data, tipo: 'saida', kg: i.kg, origem: 'batida', refId: batidaId, criadoEm: Date.now() });
    const s = await saldoMistura(formulaId);
    const novoCusto = precoMedioAposCompra(s, f.custoEstoque ?? r.custoKg, kg, custoTotal / kg);
    await db.movimentos.add({ formulaId, data, tipo: 'entrada', kg, valor: custoTotal, origem: 'batida', refId: batidaId, criadoEm: Date.now() });
    await db.formulas.update(formulaId, { custoEstoque: Math.round(novoCusto * 10000) / 10000 });
    return batidaId;
  });
}

/** Desfaz a batida (os ingredientes voltam para o estoque). A batida fica na lixeira. */
export async function desfazerBatida(batidaId: number) {
  return naLixeira(async () => {
    await db.movimentos.where('[origem+refId]').equals(['batida', batidaId]).delete();
    await db.batidas.delete(batidaId);
  });
}

/**
 * Marca o trato do dia de um lote como fornecido: desconta do estoque
 * (mistura batida ou ingredientes, conforme a fórmula) e grava o custo no lote.
 */
export async function registrarFornecimento(dados: { loteId: number; data: string; kgFornecido: number; kgPrevisto: number; cabecas: number; pesoRef: number }) {
  if (!(dados.kgFornecido >= 0)) throw new ErroValidacao('Quantidade fornecida inválida.');
  return db.transaction('rw', [db.lotes, db.formulas, db.ingredientes, db.movimentos, db.fornecimentos], async () => {
    const lote = await db.lotes.get(dados.loteId);
    if (!lote) throw new ErroValidacao('Lote não encontrado.');
    if (!lote.formulaId) throw new ErroValidacao('Este lote não tem dieta definida.');
    const f = await db.formulas.get(lote.formulaId);
    if (!f) throw new ErroValidacao('A dieta deste lote foi apagada.');
    const ja = await db.fornecimentos.where('[loteId+data]').equals([dados.loteId, dados.data]).first();
    if (ja) throw new ErroValidacao('O trato deste lote já foi marcado neste dia.');
    const ings = await ingredientesDaFormula(f);
    const r = calcularFormula(f.itens, ings);
    let custo: number;
    const fid = await db.fornecimentos.add({ ...dados, formulaId: f.id!, custo: 0, criadoEm: Date.now() });
    if (f.modo === 'batida') {
      custo = dados.kgFornecido * (f.custoEstoque ?? r.custoKg);
      await db.movimentos.add({ formulaId: f.id!, data: dados.data, tipo: 'saida', kg: dados.kgFornecido, origem: 'fornecimento', refId: fid, criadoEm: Date.now() });
    } else {
      const precos = new Map(ings.map((i) => [i.id!, i.preco]));
      custo = 0;
      for (const i of r.inclusao) {
        const kgI = (i.pct / 100) * dados.kgFornecido;
        custo += kgI * (precos.get(i.ingredienteId) ?? 0);
        await db.movimentos.add({ ingredienteId: i.ingredienteId, data: dados.data, tipo: 'saida', kg: kgI, origem: 'fornecimento', refId: fid, criadoEm: Date.now() });
      }
    }
    await db.fornecimentos.update(fid, { custo: Math.round(custo * 100) / 100 });
    return fid;
  });
}

/** Desmarca o trato do dia (o estoque volta). O trato desmarcado fica na lixeira. */
export async function desfazerFornecimento(fornecimentoId: number) {
  return naLixeira(async () => {
    await db.movimentos.where('[origem+refId]').equals(['fornecimento', fornecimentoId]).delete();
    await db.fornecimentos.delete(fornecimentoId);
  });
}

export async function excluirFormula(id: number) {
  const emUso = await db.lotes.where('formulaId').equals(id).count();
  if (emUso) throw new ErroValidacao(`Esta fórmula é a dieta de ${emUso} lote(s). Troque a dieta deles antes de apagar.`);
  return naLixeira(() => db.formulas.delete(id));
}

export async function excluirIngrediente(id: number) {
  const fs = await db.formulas.toArray();
  const usado = fs.filter((f) => f.itens.some((i) => i.ingredienteId === id));
  if (usado.length) throw new ErroValidacao(`Este ingrediente está em ${usado.length} fórmula(s): ${usado.map((f) => f.nome).join(', ')}.`);
  return naLixeira(async () => {
    await db.movimentos.where('ingredienteId').equals(id).delete();
    await db.ingredientes.delete(id);
  });
}

// ---------- Financeiro ----------

export const CONFIG_FIN_PADRAO = { oportunidadeMes: 0.01, comissaoVenda: 0.02 } as const;
export async function lerConfigFin() {
  const [o, c] = await Promise.all([db.config.get('oportunidadeMes'), db.config.get('comissaoVenda')]);
  return { oportunidadeMes: o?.valor ?? CONFIG_FIN_PADRAO.oportunidadeMes, comissaoVenda: c?.valor ?? CONFIG_FIN_PADRAO.comissaoVenda };
}

/** Lança a compra do lote com a fórmula da planilha (comissão, frete e NF/GTA). */
export async function registrarCompraLote(loteId: number, d: { data: string; precoCab: number; comissaoPct: number; frete: number; nfGta: number }) {
  if (!(d.precoCab > 0)) throw new ErroValidacao('Informe o preço pago por cabeça.');
  return db.transaction('rw', db.lotes, db.lancamentos, db.vendas, async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) throw new ErroValidacao('Lote não encontrado.');
    const vendidas = await db.vendas.where('loteId').equals(loteId).toArray();
    const qtd = lote.qtdCabecas + vendidas.reduce((t, v) => t + v.cabecas, 0);
    const valor = custoCompra(qtd, d.precoCab, d.comissaoPct, d.frete, d.nfGta);
    await db.lancamentos.where('[origem+refId]').equals(['compra_lote', loteId]).delete();
    const desc = `${qtd} cab × R$ ${d.precoCab.toLocaleString('pt-BR')} + ${(d.comissaoPct * 100).toLocaleString('pt-BR')}% comissão + frete + NF/GTA`;
    return db.lancamentos.add({
      data: d.data, tipo: 'despesa', categoria: 'compra_animais', descricao: desc, valor: Math.round(valor * 100) / 100, loteId, origem: 'compra_lote', refId: loteId,
      compraQtd: qtd, compraPreco: d.precoCab, compraComissao: d.comissaoPct, compraFrete: d.frete, compraNf: d.nfGta, criadoEm: Date.now(),
    });
  });
}

/** Venda (ou morte) de animais do lote: baixa as cabeças e encerra o lote se zerar. */
export async function registrarSaida(loteId: number, d: { data: string; tipo: 'venda' | 'morte'; cabecas: number; pesoMedio?: number; modo?: 'arroba' | 'cabeca'; preco?: number; rendimento?: number; comissaoPct?: number; frete?: number; outros?: number; comprador?: string; obs?: string }) {
  return db.transaction('rw', db.lotes, db.vendas, db.animais, async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) throw new ErroValidacao('Lote não encontrado.');
    if (!Number.isInteger(d.cabecas) || d.cabecas < 1) throw new ErroValidacao('Informe quantas cabeças saíram.');
    if (d.cabecas > lote.qtdCabecas) throw new ErroValidacao(`O lote só tem ${lote.qtdCabecas} cabeças.`);
    if (d.data < lote.dataEntrada) throw new ErroValidacao('A data é antes da entrada do lote.');
    let valorBruto = 0, valorLiquido = 0;
    if (d.tipo === 'venda') {
      if (!(d.preco! > 0)) throw new ErroValidacao('Informe o preço da venda.');
      if (d.modo === 'arroba' && !(d.pesoMedio! > 0)) throw new ErroValidacao('Para vender por arroba, informe o peso médio de saída.');
      const v = calcularVenda({ cabecas: d.cabecas, pesoMedio: d.pesoMedio ?? 0, rendimento: d.rendimento ?? 0.5, modo: d.modo ?? 'arroba', preco: d.preco!, comissaoPct: d.comissaoPct ?? 0, frete: d.frete ?? 0, outros: d.outros });
      valorBruto = Math.round(v.bruto * 100) / 100; valorLiquido = Math.round(v.liquido * 100) / 100;
    }
    const id = await db.vendas.add({ loteId, ...d, valorBruto, valorLiquido, criadoEm: Date.now() });
    const resto = lote.qtdCabecas - d.cabecas;
    await db.lotes.update(loteId, resto === 0 ? { qtdCabecas: 0, encerrado: true, dataSaida: d.data } : { qtdCabecas: resto });
    return id;
  });
}

/** Desfaz a venda/morte: as cabeças voltam para o lote. A saída fica na lixeira (restaurar tira as cabeças de novo). */
export async function desfazerSaida(vendaId: number) {
  return naLixeira(async () => {
    const v = await db.vendas.get(vendaId);
    if (!v) return;
    const lote = await db.lotes.get(v.loteId);
    if (lote) await db.lotes.update(v.loteId, { qtdCabecas: lote.qtdCabecas + v.cabecas, encerrado: false, dataSaida: null });
    await db.vendas.delete(vendaId);
  });
}

// ---------- Sanidade ----------

/** Grava uma aplicação (feita ou agendada). O custo vira despesa de sanidade do lote. */
export async function salvarEventoSanitario(ev: Omit<EventoSanitario, 'id' | 'criadoEm'>, id?: number) {
  return db.transaction('rw', db.sanidade, db.lancamentos, async () => {
    const eid = id ?? (await db.sanidade.add({ ...ev, criadoEm: Date.now() }));
    if (id) await db.sanidade.update(id, ev);
    await db.lancamentos.where('[origem+refId]').equals(['sanidade', eid]).delete();
    if (ev.feito && ev.custo && ev.custo > 0) {
      await db.lancamentos.add({ data: ev.data, tipo: 'despesa', categoria: 'sanidade', descricao: ev.produto, valor: ev.custo, loteId: ev.loteId, origem: 'sanidade', refId: eid, criadoEm: Date.now() });
    }
    return eid;
  });
}

/** Marca uma aplicação agendada como feita e, se repetir, agenda a próxima. */
export async function concluirEventoSanitario(id: number, data: string, custo?: number) {
  return db.transaction('rw', db.sanidade, db.lancamentos, async () => {
    const e = await db.sanidade.get(id);
    if (!e) throw new ErroValidacao('Aplicação não encontrada.');
    const { id: _i, criadoEm: _c, gid: _g, ...resto } = e;
    await salvarEventoSanitario({ ...resto, feito: true, data, custo: custo ?? e.custo }, id);
    if (e.repetirDias) await db.sanidade.add({ ...resto, feito: false, data: somaDias(data, e.repetirDias), custo: e.custo, criadoEm: Date.now() });
  });
}

/** Apaga a aplicação (ou o agendamento) com a despesa dela. Vai para a lixeira. */
export async function excluirEventoSanitario(id: number) {
  return naLixeira(async () => {
    await db.lancamentos.where('[origem+refId]').equals(['sanidade', id]).delete();
    await db.sanidade.delete(id);
  });
}

export async function garantirLembretesPadrao() {
  await db.transaction('rw', db.lembretes, db.config, async () => {
    if (await db.config.get('lembretesPadrao')) return;
    if ((await db.lembretes.count()) === 0) await db.lembretes.bulkAdd(LEMBRETES_PADRAO.map((l) => ({ ...l, criadoEm: Date.now() })));
    await db.config.put({ chave: 'lembretesPadrao', valor: 1 });
  });
}
