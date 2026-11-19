// Sincronização com a nuvem. O celular continua sendo o lugar onde se trabalha (funciona sem sinal);
// quando tem internet, envia o que mudou e baixa o que outras pessoas da equipe lançaram.
// Conflito: vale a última gravação que chegou ao servidor. O servidor confere e pode corrigir tudo.
import { db, semAnotar, TABELAS, type Pendente } from '../db';
import { alvoDe, ORDEM_SINC, REFERENCIAS, type Papel } from './esquema';

export interface OpEnvio { tabela: string; gid: string; op: 'put' | 'del'; dados?: Record<string, unknown> }
export interface Resultado { tabela: string; gid: string; ok: boolean; erro?: string; versao?: number }
export interface LinhaRemota { tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean; versao: number | string }
export interface Transporte {
  enviar(fazendaId: string, ops: OpEnvio[]): Promise<Resultado[]>;
  baixar(fazendaId: string, desde: number, limite: number): Promise<LinhaRemota[]>;
}
export interface FazendaNuvem { id: string; nome: string; papel: Papel }
export interface RelatorioSinc { enviados: number; recebidos: number; erros: { tabela: string; erro: string }[] }

const LOTE_ENVIO = 200;
const LOTE_BAIXA = 500;
const ordem = (t: string) => { const i = (ORDEM_SINC as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
const TABS_SINC = [...TABELAS, 'pendentes', 'sincEstado', 'sincEspera'];

// ---------- estado ----------

export async function lerEstado<T>(chave: string): Promise<T | undefined> {
  return (await db.sincEstado.get(chave))?.valor as T | undefined;
}
async function gravarEstado(chave: string, valor: unknown) { await db.sincEstado.put({ chave, valor }); }

export const fazendaLigada = () => lerEstado<FazendaNuvem>('fazenda');

/** Há dados no celular? (para não misturar fazendas sem querer) */
export async function temDadosLocais(): Promise<boolean> {
  for (const t of ['propriedades', 'lotes', 'pesagens', 'lancamentos'] as const) if ((await db.table(t).count()) > 0) return true;
  return false;
}

/**
 * Liga o celular a uma fazenda da nuvem.
 * "enviar": os dados deste celular sobem para a fazenda (fazenda nova).
 * "baixar": o celular é limpo e recebe os dados da fazenda (entrar numa equipe).
 */
export async function ligarFazenda(f: FazendaNuvem, modo: 'enviar' | 'baixar') {
  await semAnotar(TABS_SINC, async () => {
    await db.pendentes.clear();
    await db.sincEspera.clear();
    await db.sincEstado.clear();
    if (modo === 'baixar') {
      for (const t of TABELAS) await db.table(t).clear();
    } else {
      const em = Date.now();
      for (const t of TABELAS) {
        const chaves = (await db.table(t).toCollection().primaryKeys()) as (number | string)[];
        if (chaves.length) await db.pendentes.bulkPut(chaves.map((chave) => ({ tabela: t, chave, op: 'put' as const, em })));
      }
    }
    await gravarEstado('fazenda', f);
    await gravarEstado('versao', 0);
  });
}

/** Desliga da nuvem. Os dados continuam no celular. */
export async function desligarFazenda() {
  await semAnotar(TABS_SINC, async () => {
    await db.pendentes.clear();
    await db.sincEspera.clear();
    await db.sincEstado.clear();
  });
}

// ---------- tradução entre o celular (ids numéricos) e a nuvem (gid) ----------

type Reg = Record<string, unknown>;

class Tradutor {
  private gidPorId = new Map<string, string | null>();
  private idPorGid = new Map<string, number | null>();
  async gid(tabela: string, id: unknown): Promise<string | null> {
    if (typeof id !== 'number') return null;
    const k = `${tabela}:${id}`;
    if (!this.gidPorId.has(k)) this.gidPorId.set(k, ((await db.table(tabela).get(id)) as Reg | undefined)?.gid as string ?? null);
    return this.gidPorId.get(k)!;
  }
  async id(tabela: string, gid: unknown): Promise<number | null> {
    if (typeof gid !== 'string') return null;
    const k = `${tabela}:${gid}`;
    if (!this.idPorGid.has(k) || this.idPorGid.get(k) == null) {
      const r = (await db.table(tabela).where('gid').equals(gid).first()) as Reg | undefined;
      this.idPorGid.set(k, (r?.id as number) ?? null);
    }
    return this.idPorGid.get(k)!;
  }
  lembrar(tabela: string, id: number, gid: string) { this.idPorGid.set(`${tabela}:${gid}`, id); this.gidPorId.set(`${tabela}:${id}`, gid); }
}

async function traduzir(tabela: string, r: Reg, para: 'nuvem' | 'local', tr: Tradutor): Promise<{ reg: Reg; faltou: boolean }> {
  const refs = REFERENCIAS[tabela] ?? { campos: {} };
  const out: Reg = { ...r };
  delete out.id; delete out.gid;
  let faltou = false;
  const conv = async (alvo: string | null, v: unknown) => {
    if (v == null || !alvo) return undefined;
    const x = para === 'nuvem' ? await tr.gid(alvo, v) : await tr.id(alvo, v);
    if (x == null) faltou = true;
    return x ?? undefined;
  };
  for (const [campo, a] of Object.entries(refs.campos)) {
    if (!(campo in out)) continue;
    const v = await conv(alvoDe(a, r), out[campo]);
    if (v === undefined) delete out[campo]; else out[campo] = v;
  }
  for (const [lista, campos] of Object.entries(refs.listas ?? {})) {
    if (!Array.isArray(out[lista])) continue;
    out[lista] = await Promise.all((out[lista] as Reg[]).map(async (item) => {
      const novo: Reg = { ...item };
      for (const [campo, a] of Object.entries(campos)) {
        const v = await conv(alvoDe(a, item), item[campo]);
        if (v === undefined) delete novo[campo]; else novo[campo] = v;
      }
      return novo;
    }));
  }
  // referência para algo que não existe mais no celular: para a nuvem é só deixar sem; do servidor, espera chegar.
  return { reg: out, faltou: para === 'local' && faltou };
}

// ---------- envio ----------

async function enviar(t: Transporte, f: FazendaNuvem, rel: RelatorioSinc) {
  for (let rodada = 0; rodada < 50; rodada++) {
    const todos = (await db.pendentes.toArray()).filter((p) => !p.erro).sort((a, b) => ordem(a.tabela) - ordem(b.tabela));
    if (!todos.length) return;
    const lote = todos.slice(0, LOTE_ENVIO);
    const tr = new Tradutor();
    const ops: OpEnvio[] = [];
    const de: Pendente[] = [];
    const sobra: Pendente[] = [];
    for (const p of lote) {
      if (p.op === 'del') {
        const gid = p.tabela === 'config' ? String(p.chave) : p.gid;
        if (!gid) { sobra.push(p); continue; }
        ops.push({ tabela: p.tabela, gid, op: 'del' }); de.push(p);
        continue;
      }
      const r = (await db.table(p.tabela).get(p.chave)) as Reg | undefined;
      if (!r) { sobra.push(p); continue; }
      const gid = p.tabela === 'config' ? String(r.chave) : (r.gid as string);
      const { reg } = await traduzir(p.tabela, r, 'nuvem', tr);
      ops.push({ tabela: p.tabela, gid, op: 'put', dados: reg }); de.push(p);
    }
    if (sobra.length) await removerSeIgual(sobra);
    if (!ops.length) continue;
    const res = await t.enviar(f.id, ops);
    const ok: Pendente[] = [];
    await db.transaction('rw', db.pendentes, async () => {
      for (let i = 0; i < de.length; i++) {
        const r = res[i];
        const atual = await db.pendentes.get([de[i].tabela, de[i].chave]);
        if (!atual || atual.em !== de[i].em) continue; // mudou enquanto enviava: vai de novo
        if (r?.ok) ok.push(atual);
        else {
          await db.pendentes.put({ ...atual, erro: r?.erro ?? 'Não foi enviado.' });
          rel.erros.push({ tabela: de[i].tabela, erro: r?.erro ?? 'Não foi enviado.' });
        }
      }
      await db.pendentes.bulkDelete(ok.map((p) => [p.tabela, p.chave] as [string, number | string]));
    });
    rel.enviados += ok.length;
  }
}

async function removerSeIgual(lista: Pendente[]) {
  await db.transaction('rw', db.pendentes, async () => {
    for (const p of lista) {
      const a = await db.pendentes.get([p.tabela, p.chave]);
      if (a && a.em === p.em) await db.pendentes.delete([p.tabela, p.chave]);
    }
  });
}

// ---------- recebimento ----------

async function aplicar(linhas: LinhaRemota[], rel: RelatorioSinc) {
  await semAnotar(TABS_SINC, async () => {
    const espera = (await db.sincEspera.toArray()).map((e) => e.linha as LinhaRemota);
    const fila = [...espera, ...linhas].filter((l) => (TABELAS as readonly string[]).includes(l.tabela))
      .sort((a, b) => ordem(a.tabela) - ordem(b.tabela) || Number(a.versao) - Number(b.versao));
    const tr = new Tradutor();
    for (const l of fila) {
      const tab = db.table(l.tabela);
      const cfg = l.tabela === 'config';
      const local = cfg ? ((await tab.get(l.gid)) as Reg | undefined) : ((await tab.where('gid').equals(l.gid).first()) as Reg | undefined);
      const chave = cfg ? l.gid : (local?.id as number | undefined);
      const pend = chave != null ? await db.pendentes.get([l.tabela, chave]) : undefined;
      if (pend && !pend.erro) { await db.sincEspera.delete([l.tabela, l.gid]); continue; } // a mudança daqui ainda vai subir
      if (l.excluido || !l.dados) {
        if (chave != null) await tab.delete(chave);
      } else {
        const { reg, faltou } = await traduzir(l.tabela, l.dados, 'local', tr);
        if (faltou) { await db.sincEspera.put({ tabela: l.tabela, gid: l.gid, linha: l }); continue; }
        try {
          if (cfg) await tab.put(reg);
          else if (chave != null) await tab.put({ ...reg, id: chave, gid: l.gid });
          else tr.lembrar(l.tabela, (await tab.add({ ...reg, gid: l.gid })) as number, l.gid);
        } catch (e) {
          rel.erros.push({ tabela: l.tabela, erro: (e as Error).message });
          continue;
        }
      }
      if (chave != null) await db.pendentes.delete([l.tabela, chave]);
      await db.sincEspera.delete([l.tabela, l.gid]);
      rel.recebidos++;
    }
  });
}

async function baixar(t: Transporte, f: FazendaNuvem, rel: RelatorioSinc) {
  for (let rodada = 0; rodada < 1000; rodada++) {
    const desde = (await lerEstado<number>('versao')) ?? 0;
    const linhas = await t.baixar(f.id, desde, LOTE_BAIXA);
    if (linhas.length) {
      await aplicar(linhas, rel);
      await gravarEstado('versao', Math.max(desde, ...linhas.map((l) => Number(l.versao))));
    } else if (rodada === 0 && (await db.sincEspera.count())) {
      await aplicar([], rel); // tenta de novo o que estava esperando
    }
    if (linhas.length < LOTE_BAIXA) return;
  }
}

let rodando: Promise<RelatorioSinc> | null = null;

/** Envia e depois baixa. Se já estiver rodando, espera a mesma rodada. */
export function sincronizar(t: Transporte): Promise<RelatorioSinc> {
  if (rodando) return rodando;
  rodando = (async () => {
    const f = await fazendaLigada();
    const rel: RelatorioSinc = { enviados: 0, recebidos: 0, erros: [] };
    if (!f) return rel;
    if (f.papel !== 'consultor') await enviar(t, f, rel);
    await baixar(t, f, rel);
    await gravarEstado('ultima', Date.now());
    return rel;
  })().finally(() => { rodando = null; });
  return rodando;
}

/** Tenta de novo o que o servidor recusou (depois de a pessoa corrigir, ou numa nova versão do app). */
export async function tentarDeNovo() {
  await db.pendentes.toCollection().modify((p: Pendente) => { delete p.erro; });
}
