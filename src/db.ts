// Banco de dados local (IndexedDB via Dexie). Tudo fica guardado no próprio celular.
import Dexie, { type Table } from 'dexie';
import { media, ordenar, type PontoPeso } from './calc';

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

export class BoiForteDB extends Dexie {
  propriedades!: Table<Propriedade, number>;
  modulos!: Table<Modulo, number>;
  piquetes!: Table<Piquete, number>;
  lotes!: Table<Lote, number>;
  animais!: Table<Animal, number>;
  pesagens!: Table<Pesagem, number>;

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
  }
}

export let db = new BoiForteDB();
/** Só para testes: troca o banco por outro isolado. */
export function usarBanco(novo: BoiForteDB) { db = novo; }

export const TABELAS = ['propriedades', 'modulos', 'piquetes', 'lotes', 'animais', 'pesagens'] as const;

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
  await db.transaction('rw', db.lotes, db.pesagens, db.animais, async () => {
    await db.pesagens.where('loteId').equals(id).delete();
    await db.animais.where('loteId').equals(id).delete();
    await db.lotes.delete(id);
  });
}

export async function excluirPropriedade(id: number) {
  await db.transaction('rw', [db.propriedades, db.modulos, db.piquetes, db.lotes, db.pesagens, db.animais], async () => {
    const mods = await db.modulos.where('propriedadeId').equals(id).toArray();
    for (const m of mods) await db.piquetes.where('moduloId').equals(m.id!).delete();
    await db.modulos.where('propriedadeId').equals(id).delete();
    const lotes = await db.lotes.where('propriedadeId').equals(id).toArray();
    for (const l of lotes) {
      await db.pesagens.where('loteId').equals(l.id!).delete();
      await db.animais.where('loteId').equals(l.id!).delete();
    }
    await db.lotes.where('propriedadeId').equals(id).delete();
    await db.propriedades.delete(id);
  });
}

// ---------- Cópia de segurança ----------

export interface Backup { app: 'BoiForte'; versao: 1; geradoEm: string; dados: Record<string, unknown[]> }

export async function exportarBackup(): Promise<Backup> {
  const dados: Record<string, unknown[]> = {};
  for (const t of TABELAS) dados[t] = await db.table(t).toArray();
  return { app: 'BoiForte', versao: 1, geradoEm: new Date().toISOString(), dados };
}

export async function importarBackup(b: unknown): Promise<void> {
  const bk = b as Backup;
  if (!bk || bk.app !== 'BoiForte' || !bk.dados) throw new Error('Este arquivo não é uma cópia do BoiForte.');
  await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => {
    for (const t of TABELAS) {
      await db.table(t).clear();
      const linhas = bk.dados[t];
      if (Array.isArray(linhas) && linhas.length) await db.table(t).bulkAdd(linhas);
    }
  });
}
