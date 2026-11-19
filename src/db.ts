// Banco de dados local (IndexedDB via Dexie). Tudo fica guardado no próprio celular.
import Dexie, { type Table } from 'dexie';
import { media, ordenar, type PontoPeso } from './calc';
import { calcularFormula, INGREDIENTES_PADRAO, type IngredienteNut, type ItemFormula, type TipoFormula } from './nutricao';
import { precoMedioAposCompra, saldo, type TipoMov } from './estoque';
import { ErroValidacao, MAX_BACKUP_BYTES, MAX_LINHAS_TABELA, validarRegistro } from './validar';

export type Fase = 'cria' | 'recria' | 'engorda_pasto' | 'tip' | 'confinamento';
export type Sexo = 'macho' | 'femea' | 'misto';
export type Controle = 'lote' | 'individual';

export const FASES: Record<Fase, string> = {
  cria: 'Cria',
  recria: 'Recria',
  engorda_pasto: 'Engorda a pasto',
  tip: 'TIP (terminação intensiva a pasto)',
  confinamento: 'Confinamento',
};
export const SEXOS: Record<Sexo, string> = { macho: 'Macho', femea: 'Fêmea', misto: 'Misto' };

export interface Propriedade { id?: number; nome: string; municipio?: string; uf?: string; areaHa?: number; criadoEm: number }
export interface Modulo { id?: number; propriedadeId: number; nome: string; criadoEm: number }
export interface Piquete { id?: number; moduloId: number; nome: string; areaHa?: number; capim?: string; criadoEm: number }
export interface Lote {
  id?: number;
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
  obs?: string;
  criadoEm: number;
}
export interface Animal { id?: number; loteId: number; brinco: string; sexo?: Sexo; raca?: string; ativo: boolean; criadoEm: number }
export interface PesoAnimal { animalId: number; peso: number }
export interface Pesagem {
  id?: number;
  loteId: number;
  data: string;
  tipo: 'media' | 'individual';
  pesoMedio: number;
  qtdPesada: number;
  pesos?: PesoAnimal[];
  obs?: string;
  criadoEm: number;
}

export interface Ingrediente extends IngredienteNut { id?: number; diasAlerta?: number; ativo?: boolean; criadoEm: number }
export interface Formula {
  id?: number;
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
export interface Batida { id?: number; formulaId: number; data: string; kg: number; custoTotal: number; itens: { ingredienteId: number; kg: number; custo: number }[]; criadoEm: number }
export interface Fornecimento {
  id?: number;
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

export const TABELAS = ['propriedades', 'modulos', 'piquetes', 'lotes', 'animais', 'pesagens', 'ingredientes', 'formulas', 'movimentos', 'batidas', 'fornecimentos', 'config'] as const;

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
    // Toda gravação passa pela validação, venha de onde vier.
    for (const t of TABELAS) {
      const tabela = this.table(t);
      tabela.hook('creating', (_pk, obj) => {
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

export async function excluirLote(id: number) {
  await db.transaction('rw', [db.lotes, db.pesagens, db.animais, db.fornecimentos, db.movimentos], async () => {
    const fs = await db.fornecimentos.where('loteId').equals(id).primaryKeys();
    for (const f of fs) await db.movimentos.where('[origem+refId]').equals(['fornecimento', f]).delete();
    await db.fornecimentos.where('loteId').equals(id).delete();
    await db.pesagens.where('loteId').equals(id).delete();
    await db.animais.where('loteId').equals(id).delete();
    await db.lotes.delete(id);
  });
}

export async function excluirPropriedade(id: number) {
  await db.transaction('rw', [db.propriedades, db.modulos, db.piquetes, db.lotes, db.pesagens, db.animais, db.fornecimentos, db.movimentos], async () => {
    const mods = await db.modulos.where('propriedadeId').equals(id).toArray();
    for (const m of mods) await db.piquetes.where('moduloId').equals(m.id!).delete();
    await db.modulos.where('propriedadeId').equals(id).delete();
    const lotes = await db.lotes.where('propriedadeId').equals(id).toArray();
    for (const l of lotes) {
      const fs = await db.fornecimentos.where('loteId').equals(l.id!).primaryKeys();
      for (const f of fs) await db.movimentos.where('[origem+refId]').equals(['fornecimento', f]).delete();
      await db.fornecimentos.where('loteId').equals(l.id!).delete();
      await db.pesagens.where('loteId').equals(l.id!).delete();
      await db.animais.where('loteId').equals(l.id!).delete();
    }
    await db.lotes.where('propriedadeId').equals(id).delete();
    await db.propriedades.delete(id);
  });
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

export async function desfazerBatida(batidaId: number) {
  await db.transaction('rw', db.movimentos, db.batidas, async () => {
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

export async function desfazerFornecimento(fornecimentoId: number) {
  await db.transaction('rw', db.movimentos, db.fornecimentos, async () => {
    await db.movimentos.where('[origem+refId]').equals(['fornecimento', fornecimentoId]).delete();
    await db.fornecimentos.delete(fornecimentoId);
  });
}

export async function excluirFormula(id: number) {
  const emUso = await db.lotes.where('formulaId').equals(id).count();
  if (emUso) throw new ErroValidacao(`Esta fórmula é a dieta de ${emUso} lote(s). Troque a dieta deles antes de apagar.`);
  await db.formulas.delete(id);
}

export async function excluirIngrediente(id: number) {
  const fs = await db.formulas.toArray();
  const usado = fs.filter((f) => f.itens.some((i) => i.ingredienteId === id));
  if (usado.length) throw new ErroValidacao(`Este ingrediente está em ${usado.length} fórmula(s): ${usado.map((f) => f.nome).join(', ')}.`);
  await db.transaction('rw', db.ingredientes, db.movimentos, async () => {
    await db.movimentos.where('ingredienteId').equals(id).delete();
    await db.ingredientes.delete(id);
  });
}
