// Lixeira: nada do que se apaga no BoiForte some. O registro sai das telas e fica guardado aqui (e, com a nuvem,
// também no servidor, para a equipe toda) até alguém restaurar.
//  * Como entra: as funções de apagar usam naLixeira (src/db.ts). O que sai junto num toque é um "pacote"
//    (o lote com as pesagens, as vacinas e os tratos dele).
//  * Como volta: restaurar() devolve o pacote inteiro, com o mesmo gid (na nuvem é o mesmo registro que volta).
//    Se ele precisa de algo que também está na lixeira (a pesagem precisa do lote), isso volta junto;
//    a tela avisa antes, com dependencias().
//  * Cópia inteira: antes de "Apagar todos os dados", de restaurar uma cópia por cima ou de entrar numa fazenda
//    da nuvem, tudo o que estava no celular vai para a lixeira (voltarCopiaInteira).
import {
  COPIA_INTEIRA, db, guardarCopiaInteira, importarBackup, semAnotar, TABELAS,
  type Apagado, type CopiaInteira, type SobreCopia,
} from './db';
import { alvoDe, ORDEM_SINC, REFERENCIAS, trocarReferencias, VAQUEIRO_GRAVA, type LugarRef, type Papel } from './nuvem/esquema';
import { NOMES_TABELA } from './nuvem/nomes';
import { fazendaLigada } from './nuvem/sinc';
import { NOMES_CATEGORIA } from './financeiro';
import { quemEstaNoPiquete } from './pasto';
import { fmtData, fmtKg, fmtNum, hojeISO } from './calc';
import { ErroValidacao } from './validar';

type Dados = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface PacoteLixeira {
  pacote: string;
  /** O que foi apagado, como a pessoa reconhece: "Lote Nelore 1", "Pesagem do lote X em 10/11/2026". */
  titulo: string;
  /** O que saiu junto: "Junto: 12 pesagens e 3 vacinas e remédios." */
  detalhe: string;
  icone: string;
  em: number;
  /** Quem apagou (vem da nuvem). */
  por?: string;
  linhas: Apagado[];
  /** Cópia inteira do celular. */
  copia?: SobreCopia;
}

const ordem = (t: string) => { const i = (ORDEM_SINC as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
const temTabela = (t: string) => db.tables.some((x) => x.name === t);
const chave = (tabela: string, gid: unknown) => `${tabela}:${gid}`;
const moeda = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
const curto = (s: unknown, n = 60) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const juntar = (p: string[]) => (p.length <= 1 ? p.join('') : `${p.slice(0, -1).join(', ')} e ${p[p.length - 1]}`);

const ICONES: Record<string, string> = {
  propriedades: '🏡', modulos: '🗺️', piquetes: '🌱', lotes: '🐂', grupos: '🐄', animais: '🐄', pesagens: '⚖️', ingredientes: '🌽', formulas: '🧪',
  batidas: '🥣', fornecimentos: '🪣', movimentos: '📦', sanidade: '💉', vendas: '💰', lancamentos: '💵', custosFixos: '🧾', funcionarios: '👷',
  lembretes: '🔔', anotacoes: '📝', ocupacoes: '🚪',
};
/** Singular e plural, para "Junto: 12 pesagens e 1 trato". */
const CONTAGEM: Record<string, [string, string]> = {
  propriedades: ['fazenda', 'fazendas'], modulos: ['módulo', 'módulos'], piquetes: ['piquete', 'piquetes'], lotes: ['lote', 'lotes'], grupos: ['grupo', 'grupos'],
  animais: ['animal', 'animais'], pesagens: ['pesagem', 'pesagens'], ingredientes: ['ingrediente', 'ingredientes'], formulas: ['fórmula', 'fórmulas'],
  batidas: ['batida', 'batidas'], fornecimentos: ['trato', 'tratos'], movimentos: ['movimento de estoque', 'movimentos de estoque'],
  sanidade: ['vacina ou remédio', 'vacinas e remédios'], vendas: ['venda ou morte', 'vendas e mortes'], lancamentos: ['lançamento de dinheiro', 'lançamentos de dinheiro'],
  custosFixos: ['custo fixo', 'custos fixos'], funcionarios: ['funcionário', 'funcionários'], lembretes: ['lembrete', 'lembretes'],
  anotacoes: ['anotação', 'anotações'], ocupacoes: ['entrada em piquete', 'entradas em piquetes'],
};
const contar = (t: string, n: number) => { const [s, p] = CONTAGEM[t] ?? [(NOMES_TABELA[t] ?? t).toLowerCase(), (NOMES_TABELA[t] ?? t).toLowerCase()]; return `${n} ${n === 1 ? s : p}`; };
/** "o lote", "a fórmula": para a mensagem de quando falta alguma coisa. */
const COM_ARTIGO: Record<string, string> = {
  propriedades: 'a fazenda', modulos: 'o módulo', piquetes: 'o piquete', lotes: 'o lote', grupos: 'o grupo', animais: 'o animal', ingredientes: 'o ingrediente',
  formulas: 'a fórmula', batidas: 'a batida', fornecimentos: 'o trato', sanidade: 'a aplicação',
};

// ---------------------------------------------------------------- o que tem na lixeira

const COM_NOME = ['propriedades', 'modulos', 'piquetes', 'lotes', 'grupos', 'formulas', 'ingredientes'];

/** Nome de cada lote, piquete, fórmula... pelo gid (dos que estão no celular e dos que estão na lixeira). */
async function mapaDeNomes(todos: Apagado[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const t of COM_NOME) {
    if (!temTabela(t)) continue;
    for (const r of (await db.table(t).toArray()) as Dados[]) if (r.gid && r.nome) m.set(chave(t, r.gid), r.nome);
  }
  for (const a of todos) if (typeof a.dados.nome === 'string') m.set(chave(a.tabela, a.gid), a.dados.nome);
  return m;
}

function tituloDe(a: Apagado, nomes: Map<string, string>): string {
  const d = a.dados as Dados;
  const nome = (t: string, g: unknown) => (typeof g === 'string' ? nomes.get(chave(t, g)) : undefined);
  const lote = nome('lotes', d.loteId);
  const doLote = lote ? ` do lote ${lote}` : '';
  const em = d.data ? ` em ${fmtData(d.data)}` : '';
  switch (a.tabela) {
    case 'propriedades': return `Fazenda ${d.nome}`;
    case 'modulos': return `Módulo ${d.nome}`;
    case 'piquetes': return `Piquete ${d.nome}`;
    case 'lotes': return `Lote ${d.nome}`;
    case 'grupos': return `Grupo ${d.nome}`;
    case 'animais': return `Animal brinco ${d.brinco}${doLote}`;
    case 'pesagens': return `Pesagem${doLote}${em} (${fmtKg(d.pesoMedio)})`;
    case 'ingredientes': return `Ingrediente ${d.nome}`;
    case 'formulas': return `Fórmula ${d.nome}`;
    case 'batidas': { const f = nome('formulas', d.formulaId); return `Batida de ${fmtNum(d.kg, 0)} kg${f ? ` da ${f}` : ''}${em}`; }
    case 'fornecimentos': return `Trato${doLote}${em}`;
    case 'movimentos': {
      const de = nome('ingredientes', d.ingredienteId) ?? nome('formulas', d.formulaId);
      const oQue = d.origem === 'compra' ? `Compra de ${fmtNum(d.kg, 0)} kg` : d.origem === 'ajuste' ? 'Ajuste de estoque' : 'Movimento de estoque';
      return `${oQue}${de ? ` de ${de}` : ''}${em}`;
    }
    case 'sanidade': return `${d.produto}${doLote}${em}${d.feito ? '' : ' (agendado)'}`;
    case 'vendas': return `${d.tipo === 'morte' ? 'Morte' : 'Venda'} de ${d.cabecas} cabeça${d.cabecas === 1 ? '' : 's'}${doLote}${em}`;
    case 'lancamentos': return `${d.descricao || NOMES_CATEGORIA[d.categoria] || 'Lançamento'} (${moeda(d.valor)})${em}`;
    case 'custosFixos': return `Custo fixo ${d.nome}`;
    case 'funcionarios': return `Funcionário ${d.nome}`;
    case 'lembretes': return `Lembrete ${d.titulo}`;
    case 'anotacoes': return `Anotação: ${curto(d.texto)}`;
    case 'ocupacoes': {
      const quem = nome(d.tipo === 'grupo' ? 'grupos' : 'lotes', d.ocupanteId);
      const p = nome('piquetes', d.piqueteId);
      return `Entrada${quem ? ` do ${d.tipo === 'grupo' ? 'grupo' : 'lote'} ${quem}` : ''}${p ? ` no piquete ${p}` : ''} em ${fmtData(d.entrada)}`;
    }
    default: return `${NOMES_TABELA[a.tabela] ?? a.tabela}${d.nome ? ` ${d.nome}` : ''}`;
  }
}

function detalheDe(raiz: string, outras: Apagado[]): string {
  const cont = new Map<string, number>();
  for (const a of outras) {
    // o estoque da batida/do trato e a despesa da vacina fazem parte dela: não precisa contar
    if (a.tabela === 'movimentos' && (raiz === 'batidas' || raiz === 'fornecimentos')) continue;
    if (a.tabela === 'lancamentos' && raiz === 'sanidade' && a.dados.origem === 'sanidade') continue;
    cont.set(a.tabela, (cont.get(a.tabela) ?? 0) + 1);
  }
  const partes = [...cont].sort((x, y) => ordem(x[0]) - ordem(y[0])).map(([t, n]) => contar(t, n));
  return partes.length ? `Junto: ${juntar(partes)}.` : '';
}

const TITULO_COPIA: Record<SobreCopia['motivo'], (s: SobreCopia) => string> = {
  apagar_tudo: () => 'Tudo o que estava no celular antes de "Apagar todos os dados"',
  restaurar_arquivo: () => 'Tudo o que estava no celular antes de restaurar uma cópia',
  entrar_fazenda: (s) => `Tudo o que estava no celular antes de entrar na fazenda ${s.fazenda ?? 'da nuvem'}`,
  voltar_copia: () => 'Tudo o que estava no celular antes de voltar uma cópia inteira',
};

function resumoCopia(r: Record<string, number>): string {
  const ts = Object.keys(r).filter((t) => r[t] > 0).sort((a, b) => ordem(a) - ordem(b));
  const principais = ts.slice(0, 5).map((t) => contar(t, r[t]));
  const resto = ts.slice(5).reduce((s, t) => s + r[t], 0);
  return principais.length ? `${juntar(resto ? [...principais, `mais ${resto} registro${resto === 1 ? '' : 's'}`] : principais)}.` : 'Só o que já estava na lixeira.';
}

function descrever(pacote: string, linhas: Apagado[], nomes: Map<string, string>): PacoteLixeira {
  const em = Math.max(...linhas.map((a) => a.em));
  const por = linhas.find((a) => a.por)?.por;
  const c = linhas.find((a) => a.tabela === COPIA_INTEIRA);
  if (c) {
    const s = c.dados as unknown as SobreCopia;
    return { pacote, titulo: TITULO_COPIA[s.motivo]?.(s) ?? 'Cópia inteira do celular', detalhe: resumoCopia(s.resumo ?? {}), icone: '📱', em, linhas, copia: s };
  }
  // O principal é o que vem antes na ordem da nuvem: a fazenda antes do lote, o lote antes da pesagem.
  const menor = Math.min(...linhas.map((a) => ordem(a.tabela)));
  const raiz = linhas.filter((a) => ordem(a.tabela) === menor);
  const t = raiz[0].tabela;
  const titulo = raiz.length === 1 ? tituloDe(raiz[0], nomes)
    : `${contar(t, raiz.length)}: ${juntar(raiz.slice(0, 4).map((a) => (typeof a.dados.nome === 'string' ? a.dados.nome : tituloDe(a, nomes))))}${raiz.length > 4 ? '…' : ''}`;
  return { pacote, titulo, detalhe: detalheDe(t, linhas.filter((a) => !raiz.includes(a))), icone: ICONES[t] ?? '🗑️', em, ...(por ? { por } : {}), linhas };
}

function agrupar(todos: Apagado[]): Map<string, Apagado[]> {
  const g = new Map<string, Apagado[]>();
  for (const a of todos) { const l = g.get(a.pacote); if (l) l.push(a); else g.set(a.pacote, [a]); }
  return g;
}

/** Tudo o que está na lixeira, agrupado pelo que foi apagado junto, do mais novo para o mais velho. */
export async function listarLixeira(): Promise<PacoteLixeira[]> {
  const todos = (await db.lixeira.toArray()).filter((a) => a.tabela === COPIA_INTEIRA || temTabela(a.tabela));
  const nomes = await mapaDeNomes(todos);
  return [...agrupar(todos)].map(([p, l]) => descrever(p, l, nomes)).sort((a, b) => b.em - a.em);
}

/** Quantos itens (pacotes) estão na lixeira. */
export async function contarLixeira(): Promise<number> {
  return (await db.lixeira.orderBy('pacote').uniqueKeys()).length;
}

// ---------------------------------------------------------------- o que precisa voltar junto

/**
 * Referências que podem voltar vazias, com aviso (o lote volta sem piquete, a anotação volta sem o lugar).
 * Qualquer outra referência que tinha valor precisa existir: se está na lixeira, volta junto; se não existe mais, não volta.
 */
const PODE_FICAR_SEM: Record<string, Record<string, string>> = {
  lotes: { piqueteId: 'voltou sem piquete, porque o piquete foi apagado.', formulaId: 'voltou sem dieta, porque a fórmula não existe mais.' },
  grupos: { piqueteId: 'voltou sem piquete, porque o piquete foi apagado.' },
  anotacoes: { moduloId: 'voltou sem o lugar, porque ele foi apagado.', piqueteId: 'voltou sem o piquete, porque ele foi apagado.' },
};
/** Destas, as que nem puxam da lixeira o que apontam (o lote volta sem piquete em vez de trazer o piquete junto). */
const NAO_PUXA: Record<string, string[]> = { lotes: ['piqueteId'], grupos: ['piqueteId'], anotacoes: ['moduloId', 'piqueteId'] };

interface Ref { alvo: string; gid: string; lugar: LugarRef }
function refsDe(a: Apagado): Ref[] {
  const out: Ref[] = [];
  const refs = REFERENCIAS[a.tabela];
  if (!refs) return out;
  for (const [campo, al] of Object.entries(refs.campos)) {
    const g = a.dados[campo];
    const alvo = alvoDe(al, a.dados);
    if (typeof g === 'string' && alvo) out.push({ alvo, gid: g, lugar: { campo } });
  }
  for (const [lista, campos] of Object.entries(refs.listas ?? {})) {
    const itens = a.dados[lista];
    if (!Array.isArray(itens)) continue;
    for (const it of itens as Dados[]) {
      for (const [campo, al] of Object.entries(campos)) {
        const g = it?.[campo];
        const alvo = it ? alvoDe(al, it) : null;
        if (typeof g === 'string' && alvo) out.push({ alvo, gid: g, lugar: { campo, lista } });
      }
    }
  }
  return out;
}

function existeNoCelular() {
  const sim = new Set<string>();
  return async (tabela: string, gid: string) => {
    const k = chave(tabela, gid);
    if (sim.has(k)) return true;
    if (!temTabela(tabela) || !(await db.table(tabela).where('gid').equals(gid).count())) return false;
    sim.add(k);
    return true;
  };
}

/** O pacote e os outros pacotes da lixeira de que ele precisa (a pesagem precisa do lote, que também foi apagado). */
async function fechamento(pacote: string, todos: Apagado[]): Promise<Set<string>> {
  const naLixeira = new Map(todos.map((a) => [chave(a.tabela, a.gid), a]));
  const porPacote = agrupar(todos);
  const existe = existeNoCelular();
  const fech = new Set([pacote]);
  const fila = [pacote];
  while (fila.length) {
    for (const a of porPacote.get(fila.pop()!) ?? []) {
      for (const r of refsDe(a)) {
        if (!r.lugar.lista && NAO_PUXA[a.tabela]?.includes(r.lugar.campo)) continue;
        const dep = naLixeira.get(chave(r.alvo, r.gid));
        if (!dep || fech.has(dep.pacote) || (await existe(r.alvo, r.gid))) continue;
        fech.add(dep.pacote);
        fila.push(dep.pacote);
      }
    }
  }
  return fech;
}

/** Outros itens da lixeira que voltam junto com este (para a tela perguntar antes). */
export async function dependencias(pacote: string): Promise<PacoteLixeira[]> {
  const todos = await db.lixeira.toArray();
  const fech = await fechamento(pacote, todos);
  fech.delete(pacote);
  if (!fech.size) return [];
  const nomes = await mapaDeNomes(todos);
  const grupos = agrupar(todos);
  return [...fech].map((p) => descrever(p, grupos.get(p) ?? [], nomes)).sort((a, b) => b.em - a.em);
}

// ---------------------------------------------------------------- quem pode restaurar

/**
 * Por que esta pessoa não pode restaurar (null = pode). Sem nuvem, pode tudo. Com nuvem, segue as regras do servidor
 * (que confere de novo: isto só evita a pessoa tentar e dar erro depois).
 */
export function motivoNaoRestaura(linhas: Apagado[], papel: Papel | null | undefined, ligado: boolean): string | null {
  if (linhas.some((a) => a.tabela === COPIA_INTEIRA)) {
    return ligado ? 'Este celular está ligado à nuvem. Para voltar a cópia inteira, desligue antes em Nuvem e equipe (os dados da nuvem continuam guardados lá).' : null;
  }
  if (!ligado || !papel || papel === 'dono') return null;
  if (papel === 'consultor') return 'O consultor só olha. Peça ao dono ou ao gerente para restaurar.';
  if (papel === 'gerente') return linhas.some((a) => a.tabela === 'funcionarios' && a.dados.usuarioId) ? 'Só o dono restaura o cadastro de quem usa o app.' : null;
  const pode = (a: Apagado) => (VAQUEIRO_GRAVA as readonly string[]).includes(a.tabela) && a.tabela !== 'lotes'
    && (a.tabela !== 'lancamentos' || a.dados.origem === 'sanidade');
  return linhas.every(pode) ? null : 'Só o dono ou o gerente podem restaurar isto.';
}

// ---------------------------------------------------------------- restaurar

export interface QuemRestaura { papel?: Papel | null; ligado?: boolean }
export interface ResultadoRestaurar { registros: number; pacotes: number; avisos: string[] }

/**
 * Devolve o pacote (e o que ele precisa) para as tabelas, com o mesmo gid e, se der, o mesmo id deste celular.
 * Tudo numa transação: se algo não puder voltar, nada muda. Com a nuvem, sobe como gravação normal
 * (o servidor confere a permissão e se as referências existem).
 */
export async function restaurar(pacote: string, quem: QuemRestaura = {}): Promise<ResultadoRestaurar> {
  return db.transaction('rw', db.tables, async () => {
    const todos = await db.lixeira.toArray();
    const meu = todos.filter((a) => a.pacote === pacote);
    if (!meu.length) throw new ErroValidacao('Isto já não está na lixeira (alguém pode ter restaurado).');
    if (meu.some((a) => a.tabela === COPIA_INTEIRA)) throw new ErroValidacao('Para a cópia inteira, use "Voltar esta cópia".');
    const fech = await fechamento(pacote, todos);
    const linhas = ordenarParaVoltar(todos
      .filter((a) => fech.has(a.pacote) && a.tabela !== COPIA_INTEIRA && a.tabela !== 'config' && a.tabela !== 'ndvi' && temTabela(a.tabela)));
    const motivo = motivoNaoRestaura(linhas, quem.papel, !!quem.ligado);
    if (motivo) throw new ErroValidacao(motivo);
    const r = new Restauracao(linhas, await mapaDeNomes(todos));
    for (const a of linhas) await r.voltar(a);
    await r.depois();
    return { registros: r.voltaram.length, pacotes: fech.size, avisos: r.avisos };
  });
}

/**
 * Quem é usado volta antes de quem usa: na ordem da nuvem (fazenda, módulo, piquete, lote, pesagem...) e, dentro da mesma
 * tabela, o referenciado antes (a mãe antes do bezerro). Com ciclo, segue a ordem da nuvem.
 */
function ordenarParaVoltar(linhas: Apagado[]): Apagado[] {
  const fila = [...linhas].sort((a, b) => ordem(a.tabela) - ordem(b.tabela) || a.em - b.em || (a.idLocal ?? 0) - (b.idLocal ?? 0));
  const voltando = new Set(fila.map((a) => chave(a.tabela, a.gid)));
  const feitos = new Set<string>();
  const out: Apagado[] = [];
  let resto = fila;
  while (resto.length) {
    const depois: Apagado[] = [];
    for (const a of resto) {
      const eu = chave(a.tabela, a.gid);
      if (refsDe(a).every((r) => { const k = chave(r.alvo, r.gid); return k === eu || !voltando.has(k) || feitos.has(k); })) { out.push(a); feitos.add(eu); }
      else depois.push(a);
    }
    if (depois.length === resto.length) { out.push(...depois); break; }
    resto = depois;
  }
  return out;
}

class Restauracao {
  avisos: string[] = [];
  voltaram: { a: Apagado; id: number; reg: Dados }[] = [];
  private ids = new Map<string, number>();
  private voltando: Set<string>;

  constructor(linhas: Apagado[], private nomes: Map<string, string>) {
    this.voltando = new Set(linhas.map((a) => chave(a.tabela, a.gid)));
  }

  private async idDe(tabela: string, gid: string): Promise<number | null> {
    const k = chave(tabela, gid);
    if (this.ids.has(k)) return this.ids.get(k)!;
    if (!temTabela(tabela)) return null;
    const r = (await db.table(tabela).where('gid').equals(gid).first()) as Dados | undefined;
    if (r?.id == null) return null;
    this.ids.set(k, r.id);
    return r.id;
  }

  async voltar(a: Apagado) {
    const titulo = tituloDe(a, this.nomes);
    let falta: string | null = null;
    // gid -> id deste celular. Referência que tinha valor e não existe mais: só pode ficar vazia se estiver em PODE_FICAR_SEM.
    const reg: Dados = await trocarReferencias(a.tabela, a.dados, async (alvo, v, lugar) => {
      if (v == null || !alvo || typeof v !== 'string') return undefined;
      const id = await this.idDe(alvo, v);
      if (id != null) return id;
      if (lugar.lista) return undefined; // o item sai da lista (abaixo)
      const aviso = PODE_FICAR_SEM[a.tabela]?.[lugar.campo];
      if (aviso) this.avisos.push(`${titulo} ${aviso}`);
      else falta ??= alvo;
      return undefined;
    });
    if (falta) throw new ErroValidacao(`Não dá para voltar "${titulo}": ${COM_ARTIGO[falta] ?? (NOMES_TABELA[falta] ?? falta).toLowerCase()} que ele usava não existe mais.`);
    for (const [lista, campos] of Object.entries(REFERENCIAS[a.tabela]?.listas ?? {})) {
      const orig = a.dados[lista];
      if (!Array.isArray(orig) || !Array.isArray(reg[lista])) continue;
      const ficam = (reg[lista] as Dados[]).filter((it, i) => Object.keys(campos).every((c) => (orig[i] as Dados)?.[c] == null || it[c] != null));
      if (ficam.length < orig.length) this.avisos.push(`${titulo}: ${orig.length - ficam.length} item(ns) ficaram de fora, porque não existem mais.`);
      reg[lista] = ficam;
    }
    if (!(await this.ajustarAntes(a, reg, titulo))) return;
    const tab = db.table(a.tabela);
    let id: number;
    if (a.idLocal != null && !(await tab.get(a.idLocal))) { await tab.put({ ...reg, id: a.idLocal, gid: a.gid }); id = a.idLocal; }
    else id = (await tab.add({ ...reg, gid: a.gid })) as number;
    this.ids.set(chave(a.tabela, a.gid), id);
    this.voltaram.push({ a, id, reg });
    await db.lixeira.delete([a.tabela, a.gid]);
  }

  /** Acertos antes de gravar, para o celular e a nuvem continuarem certos. false = fica na lixeira. */
  private async ajustarAntes(a: Apagado, reg: Dados, titulo: string): Promise<boolean> {
    switch (a.tabela) {
      case 'lotes':
      case 'grupos': {
        // Um lote ou grupo por piquete: se outro entrou no lugar, volta sem piquete.
        if (reg.encerrado || reg.piqueteId == null) return true;
        const outro = await quemEstaNoPiquete(reg.piqueteId);
        if (outro) {
          const p = await db.piquetes.get(reg.piqueteId);
          this.avisos.push(`${titulo} voltou sem piquete: o piquete ${p?.nome ?? ''} agora tem ${outro.tipo === 'lote' ? 'o lote' : 'o grupo'} ${outro.nome}.`);
          reg.piqueteId = null;
        }
        return true;
      }
      case 'vendas': {
        // Desfazer a venda devolveu as cabeças ao lote; voltar a venda tira de novo (se o lote não volta junto).
        if (this.voltando.has(chave('lotes', a.dados.loteId))) return true;
        const lote = await db.lotes.get(reg.loteId);
        if (!lote) return true;
        if (lote.qtdCabecas < reg.cabecas) {
          throw new ErroValidacao(`Não dá para voltar "${titulo}": o lote ${lote.nome} tem ${lote.qtdCabecas} cabeça${lote.qtdCabecas === 1 ? '' : 's'} agora.`);
        }
        const resto = lote.qtdCabecas - reg.cabecas;
        await db.lotes.update(lote.id!, resto === 0 ? { qtdCabecas: 0, encerrado: true, dataSaida: reg.data } : { qtdCabecas: resto });
        return true;
      }
      case 'fornecimentos': {
        if (await db.fornecimentos.where('[loteId+data]').equals([reg.loteId, reg.data]).first()) {
          throw new ErroValidacao(`Não dá para voltar "${titulo}": o trato desse lote nesse dia já foi marcado de novo. Desmarque o novo antes.`);
        }
        return true;
      }
      case 'lancamentos': {
        // Despesa da compra do lote ou da vacina: só existe uma por compra/aplicação.
        if ((reg.origem === 'compra_lote' || reg.origem === 'sanidade') && reg.refId != null
            && (await db.lancamentos.where('[origem+refId]').equals([reg.origem, reg.refId]).first())) {
          throw new ErroValidacao(`Não dá para voltar "${titulo}": ${reg.origem === 'compra_lote' ? 'a compra desse lote' : 'a despesa dessa aplicação'} já está lançada.`);
        }
        return true;
      }
      case 'ocupacoes': return this.ajustarOcupacao(reg, titulo);
    }
    return true;
  }

  /** Entrada em piquete não pode cruzar com outra do mesmo piquete nem dos mesmos animais (regra do celular e do servidor). */
  private async ajustarOcupacao(o: Dados, titulo: string): Promise<boolean> {
    const fim = (x: Dados) => x.saida ?? '9999-12-31';
    const outras = [
      ...(await db.ocupacoes.where('piqueteId').equals(o.piqueteId).toArray()),
      ...(await db.ocupacoes.where('[tipo+ocupanteId]').equals([o.tipo, o.ocupanteId]).toArray()),
    ];
    const cruzam = outras.filter((x) => x.entrada < fim(o) && fim(x) > o.entrada);
    if (!cruzam.length) return true;
    // Ainda aberta e tudo o que cruza começou depois: fecha no dia em que o outro entrou.
    if (!o.saida && cruzam.every((x) => x.entrada > o.entrada)) {
      o.saida = cruzam.map((x) => x.entrada).sort()[0];
      this.avisos.push(`${titulo}: voltou com a saída em ${fmtData(o.saida)}, porque depois disso o piquete ou os animais tiveram outra entrada.`);
      return true;
    }
    this.avisos.push(`${titulo}: ficou na lixeira, porque o piquete ou os animais já têm outra entrada nesse período.`);
    return false;
  }

  /** Depois de tudo de volta: a entrada aberta que voltou leva o lote de volta ao piquete (se ele estiver livre). */
  async depois() {
    for (const { a, id, reg } of this.voltaram) {
      if (a.tabela !== 'ocupacoes' || reg.saida) continue;
      const tab = reg.tipo === 'grupo' ? 'grupos' : 'lotes';
      if (!temTabela(tab)) continue;
      const quem = (await db.table(tab).get(reg.ocupanteId)) as Dados | undefined;
      if (!quem || quem.encerrado || quem.piqueteId === reg.piqueteId) continue;
      if (quem.piqueteId == null && !(await quemEstaNoPiquete(reg.piqueteId))) {
        await db.table(tab).update(quem.id, { piqueteId: reg.piqueteId });
        const p = await db.piquetes.get(reg.piqueteId);
        this.avisos.push(`${tab === 'lotes' ? 'O lote' : 'O grupo'} ${quem.nome} voltou para o piquete ${p?.nome ?? ''}.`);
      } else {
        // os animais estão em outro lugar agora: a entrada que voltou fica fechada
        const hoje = hojeISO();
        await db.ocupacoes.update(id, { saida: hoje > reg.entrada ? hoje : reg.entrada });
      }
    }
  }
}

// ---------------------------------------------------------------- cópia inteira do celular

const LOCAIS = [...TABELAS, 'pendentes', 'sincEstado', 'sincEspera', 'fotosAnotacao', 'lixeira', 'copias'];

/**
 * Volta a cópia inteira: o que está no celular agora vira outra cópia inteira (dá para voltar de novo) e a cópia
 * escolhida volta com as fotos e a lixeira dela. Só fora da nuvem, para não mandar dados antigos para a fazenda.
 */
export async function voltarCopiaInteira(pacote: string): Promise<void> {
  if (await fazendaLigada()) throw new ErroValidacao(motivoNaoRestaura([{ tabela: COPIA_INTEIRA } as Apagado], null, true)!);
  await semAnotar(LOCAIS, async () => {
    const a = await db.lixeira.where('pacote').equals(pacote).first();
    const c = a?.tabela === COPIA_INTEIRA ? await db.copias.get(a.gid) : undefined;
    if (!a || !c) throw new ErroValidacao('Esta cópia já não está na lixeira.');
    await guardarCopiaInteira('voltar_copia');
    await importarBackup(c.backup);
    await db.lixeira.where('tabela').notEqual(COPIA_INTEIRA).delete();
    if (c.lixeira?.length) await db.lixeira.bulkPut(c.lixeira);
    await db.fotosAnotacao.clear();
    if (c.fotos?.length) await db.fotosAnotacao.bulkPut(c.fotos);
    await db.pendentes.clear();
    await db.lixeira.delete([a.tabela, a.gid]);
    await db.copias.delete(a.gid);
  });
}

/**
 * "Apagar todos os dados": tudo sai do celular, mas fica numa cópia inteira na lixeira (dá para voltar).
 * Se estava ligado à nuvem, desliga (na nuvem nada muda).
 */
export async function apagarTodosOsDados(): Promise<void> {
  await semAnotar(LOCAIS, async () => {
    await guardarCopiaInteira('apagar_tudo');
    for (const t of TABELAS) await db.table(t).clear();
    await db.pendentes.clear();
    await db.sincEspera.clear();
    await db.sincEstado.clear();
    await db.fotosAnotacao.clear();
    await db.lixeira.where('tabela').notEqual(COPIA_INTEIRA).delete();
  });
}

/** Restaura um arquivo de cópia por cima do que está no celular; o que estava antes vai para a lixeira. */
export async function trocarPeloArquivo(bk: unknown): Promise<void> {
  if (await fazendaLigada()) throw new ErroValidacao('Este celular está ligado à nuvem. Desligue em Nuvem e equipe antes de restaurar uma cópia.');
  await semAnotar(LOCAIS, async () => {
    await guardarCopiaInteira('restaurar_arquivo');
    await importarBackup(bk);
    await db.lixeira.where('tabela').notEqual(COPIA_INTEIRA).delete();
    await db.pendentes.clear();
  });
}

export type { CopiaInteira };
