// Pasto: o módulo é o conjunto de piquetes e o piquete é a variável de decisão (quem entra, quando entra, quando sai).
// Aqui ficam as contas (UA/ha, pressão de pastejo, dias de ocupação e descanso), a leitura do NDVI do satélite
// com o aviso de degradação e as gravações de entrada e saída de animais (um ocupante por piquete).
// As contas são funções puras (testadas em pasto.test.ts); a Cria usa lotacaoModulo/lotacaoAlta com os grupos de manejo.
import { db, pontosDoLote, type ExtMidia, type Midia, type Modulo, type Ndvi, type Ocupacao, type Piquete } from './db';
import { diasEntre, fmtData, fmtNum, hojeISO, pesoEstimado, somaDias } from './calc';
import type { Alerta } from './alertas';
import { ErroValidacao, MAX_MIDIAS, RE_GID } from './validar';

/** 1 UA (unidade animal) = 450 kg de peso vivo. */
export const KG_UA = 450;
export const ua = (pesoKg: number, cabecas = 1) => (pesoKg * cabecas) / KG_UA;

// ---------------------------------------------------------------- referências de capim
/**
 * Altura de entrada e de saída no pastejo rotacionado e kg de MS por hectare para cada cm de capim.
 * Valores de referência aproximados (Embrapa e literatura de manejo pela altura); o produtor ajusta no piquete.
 */
export interface RefCapim { nome: string; entrada: number; saida: number; kgMsCm: number }
export const CAPINS: RefCapim[] = [
  { nome: 'Marandu (Brizantha)', entrada: 25, saida: 15, kgMsCm: 120 },
  { nome: 'Xaraés', entrada: 30, saida: 15, kgMsCm: 110 },
  { nome: 'Piatã', entrada: 35, saida: 15, kgMsCm: 110 },
  { nome: 'Paiaguás', entrada: 30, saida: 15, kgMsCm: 110 },
  { nome: 'Ipyporã', entrada: 25, saida: 15, kgMsCm: 110 },
  { nome: 'Decumbens', entrada: 20, saida: 10, kgMsCm: 130 },
  { nome: 'Humidícola', entrada: 20, saida: 10, kgMsCm: 150 },
  { nome: 'Ruziziensis', entrada: 25, saida: 15, kgMsCm: 110 },
  { nome: 'Mombaça', entrada: 90, saida: 45, kgMsCm: 70 },
  { nome: 'Tanzânia', entrada: 70, saida: 35, kgMsCm: 70 },
  { nome: 'Zuri', entrada: 75, saida: 35, kgMsCm: 70 },
  { nome: 'Quênia', entrada: 70, saida: 35, kgMsCm: 70 },
  { nome: 'Massai', entrada: 55, saida: 25, kgMsCm: 80 },
  { nome: 'Tifton 85', entrada: 25, saida: 10, kgMsCm: 200 },
  { nome: 'Andropogon', entrada: 50, saida: 25, kgMsCm: 80 },
];
const KG_MS_CM_PADRAO = 100;
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Acha a referência pelo nome do capim (falado ou escrito: "brizanta", "mombaca"...). */
export function referenciaCapim(capim?: string | null): RefCapim | null {
  if (!capim) return null;
  const c = sem(capim);
  const apelidos: [RegExp, string][] = [[/brizant|marandu|braquiarao/, 'Marandu'], [/humid/, 'Humid'], [/tifton/, 'Tifton'], [/ruzi/, 'Ruzi']];
  for (const [re, nome] of apelidos) if (re.test(c)) return CAPINS.find((r) => r.nome.startsWith(nome)) ?? null;
  return CAPINS.find((r) => c.includes(sem(r.nome.split(' ')[0]))) ?? null;
}

/** Alvos do piquete: o que o produtor gravou ou, se vazio, a referência do capim. */
export function alvosPiquete(p: Pick<Piquete, 'capim' | 'alturaEntrada' | 'alturaSaida' | 'kgMsCm'>) {
  const ref = referenciaCapim(p.capim);
  return {
    entrada: p.alturaEntrada ?? ref?.entrada ?? null,
    saida: p.alturaSaida ?? ref?.saida ?? null,
    kgMsCm: p.kgMsCm ?? ref?.kgMsCm ?? KG_MS_CM_PADRAO,
    deReferencia: !p.alturaEntrada && !!ref,
  };
}

// ---------------------------------------------------------------- lotação e pressão de pastejo

/** Quem está no pasto (lote ou grupo de manejo), do jeito mais simples possível. */
export interface Ocupante { piqueteId: number | null | undefined; cabecas: number; pesoMedio: number | null | undefined }

export function uaDe(o: Ocupante): number {
  return o.cabecas > 0 && o.pesoMedio ? ua(o.pesoMedio, o.cabecas) : 0;
}

/** UA/ha do piquete com quem está nele agora. */
export function lotacaoPiquete(areaHa: number | undefined, ocupantes: Ocupante[]): number | null {
  if (!areaHa) return null;
  return ocupantes.reduce((s, o) => s + uaDe(o), 0) / areaHa;
}

/**
 * Lotação do módulo: UA de todos os animais nos piquetes do módulo dividida pela área do módulo inteiro.
 * No rotacionado é essa a lotação que conta (os piquetes vazios estão descansando para o mesmo gado).
 */
export function lotacaoModulo(piquetes: Pick<Piquete, 'id' | 'areaHa'>[], ocupantes: Ocupante[]) {
  const ids = new Set(piquetes.map((p) => p.id));
  const areaHa = piquetes.reduce((s, p) => s + (p.areaHa ?? 0), 0);
  const dentro = ocupantes.filter((o) => o.piqueteId != null && ids.has(o.piqueteId));
  const uaTotal = dentro.reduce((s, o) => s + uaDe(o), 0);
  const cabecas = dentro.reduce((s, o) => s + o.cabecas, 0);
  return { areaHa, ua: uaTotal, cabecas, uaHa: areaHa > 0 ? uaTotal / areaHa : null, semArea: piquetes.filter((p) => !p.areaHa).length };
}

export type NivelLotacao = 'ok' | 'atencao' | 'alta' | 'sem_dados';
export interface Lotacao { nivel: NivelLotacao; uaHa: number | null; capacidade: number | null; motivo: string }

/**
 * Lotação alta? Para a Cria e o Início usarem nas decisões.
 * 1) UA/ha acima da capacidade de suporte do módulo (90% = atenção; acima de 100% = alta);
 * 2) sem capacidade gravada: as 2 últimas saídas com o capim abaixo da altura de saída (pasto rapado) = alta.
 */
export function lotacaoAlta(
  modulo: Pick<Modulo, 'capacidadeUA'>,
  piquetes: Pick<Piquete, 'id' | 'areaHa' | 'capim' | 'alturaEntrada' | 'alturaSaida' | 'kgMsCm'>[],
  ocupantes: Ocupante[],
  ocupacoes: Pick<Ocupacao, 'piqueteId' | 'saida' | 'alturaSaida'>[] = [],
): Lotacao {
  const l = lotacaoModulo(piquetes, ocupantes);
  const cap = modulo.capacidadeUA ?? null;
  if (cap && l.uaHa != null) {
    const r = l.uaHa / cap;
    if (r > 1) return { nivel: 'alta', uaHa: l.uaHa, capacidade: cap, motivo: `${fmtNum(l.uaHa, 2)} UA/ha para um pasto que aguenta ${fmtNum(cap, 2)} UA/ha.` };
    if (r >= 0.9) return { nivel: 'atencao', uaHa: l.uaHa, capacidade: cap, motivo: `${fmtNum(l.uaHa, 2)} UA/ha, perto do limite de ${fmtNum(cap, 2)} UA/ha.` };
    return { nivel: 'ok', uaHa: l.uaHa, capacidade: cap, motivo: `${fmtNum(l.uaHa, 2)} UA/ha de ${fmtNum(cap, 2)} UA/ha possíveis.` };
  }
  const porId = new Map(piquetes.map((p) => [p.id, p]));
  const saidas = ocupacoes.filter((o) => o.saida && o.alturaSaida != null && porId.has(o.piqueteId))
    .sort((a, b) => (b.saida! < a.saida! ? -1 : 1)).slice(0, 2);
  const rapado = saidas.length === 2 && saidas.every((o) => {
    const alvo = alvosPiquete(porId.get(o.piqueteId)!).saida;
    return alvo != null && o.alturaSaida! < alvo * 0.8;
  });
  if (rapado) return { nivel: 'alta', uaHa: l.uaHa, capacidade: null, motivo: 'Os animais saíram das 2 últimas vezes com o capim bem abaixo da altura de saída (pasto rapado).' };
  if (l.uaHa == null) return { nivel: 'sem_dados', uaHa: null, capacidade: null, motivo: 'Falta a área dos piquetes.' };
  return { nivel: cap ? 'ok' : 'sem_dados', uaHa: l.uaHa, capacidade: cap, motivo: 'Grave a capacidade de suporte do módulo (UA/ha) para o app avisar quando passar.' };
}

/** kg de MS por hectare estimada pela altura do capim. */
export const massaPelaAltura = (alturaCm: number, kgMsCm: number) => alturaCm * kgMsCm;

/**
 * Pressão de pastejo e oferta de forragem na entrada.
 * pressão = kg de peso vivo por kg de MS disponível; oferta = kg de MS por 100 kg de PV por dia de ocupação.
 */
export function pressaoPastejo(a: { cabecas: number; pesoMedio: number; massaKgMsHa: number; areaHa: number; dias: number }) {
  const pv = a.cabecas * a.pesoMedio;
  const ms = a.massaKgMsHa * a.areaHa;
  if (!(pv > 0) || !(ms > 0)) return null;
  const oferta = a.dias > 0 ? (ms / (pv * a.dias)) * 100 : null;
  return { pressao: pv / ms, oferta, nivel: oferta == null ? null : oferta < 4 ? 'ruim' as const : oferta < 7 ? 'atencao' as const : 'bom' as const };
}

/** Dias que cada piquete pode ficar ocupado para o descanso planejado fechar a volta (um grupo de animais). */
export function ocupacaoIdeal(diasDescanso: number | undefined, nPiquetes: number): number | null {
  if (!diasDescanso || nPiquetes < 2) return null;
  return Math.max(1, Math.floor(diasDescanso / (nPiquetes - 1)));
}

// ---------------------------------------------------------------- situação de cada piquete

export type Situacao = 'ocupado' | 'descansando' | 'pronto' | 'sem_uso';
export interface EstadoPiquete {
  piquete: Piquete;
  situacao: Situacao;
  atual?: Ocupacao; // ocupação aberta
  ultima?: Ocupacao; // última que saiu
  diasOcupado?: number;
  diasDescanso?: number;
  alertas: Alerta[];
}

export function estadoPiquete(p: Piquete, ocupacoes: Ocupacao[], modulo: Pick<Modulo, 'sistema' | 'diasOcupacao' | 'diasDescanso'> | undefined, hoje: string): EstadoPiquete {
  const minhas = ocupacoes.filter((o) => o.piqueteId === p.id).sort((a, b) => (a.entrada < b.entrada ? -1 : 1));
  const atual = minhas.find((o) => !o.saida);
  const ultima = minhas.filter((o) => o.saida).sort((a, b) => (a.saida! < b.saida! ? -1 : 1)).pop();
  const alertas: Alerta[] = [];
  const rot = modulo?.sistema !== 'continuo';
  if (atual) {
    const dias = Math.max(0, diasEntre(atual.entrada, hoje));
    const max = modulo?.diasOcupacao;
    if (rot && max && dias > max) {
      alertas.push({ nivel: dias > max * 1.5 ? 'ruim' : 'atencao', titulo: `${p.nome}: ${dias} dias ocupado`, texto: `O planejado era sair com ${max} dias. Confira a altura do capim e mude o gado de piquete.` });
    }
    return { piquete: p, situacao: 'ocupado', atual, ultima, diasOcupado: dias, alertas };
  }
  if (!ultima) return { piquete: p, situacao: 'sem_uso', alertas };
  const descanso = Math.max(0, diasEntre(ultima.saida!, hoje));
  const alvo = modulo?.diasDescanso;
  const pronto = !alvo || descanso >= alvo;
  return { piquete: p, situacao: pronto ? 'pronto' : 'descansando', ultima, diasDescanso: descanso, alertas };
}

/** Próximo piquete para entrar: livre, com descanso cumprido e, entre esses, o que descansou mais (o NDVI desempata). */
export function sugerirProximo(estados: EstadoPiquete[], ndviAtual: Map<number, number> = new Map()): EstadoPiquete | null {
  const livres = estados.filter((e) => e.situacao === 'pronto' || e.situacao === 'sem_uso');
  if (!livres.length) return null;
  return [...livres].sort((a, b) => (b.diasDescanso ?? 9999) - (a.diasDescanso ?? 9999) || (ndviAtual.get(b.piquete.id!) ?? 0) - (ndviAtual.get(a.piquete.id!) ?? 0))[0];
}

// ---------------------------------------------------------------- NDVI do satélite

/** Só usa a leitura com até 40% do piquete coberto por nuvem. */
export const NUVEM_MAX = 40;
export const NDVI_MUITO_BAIXO = 0.35;
/** Dias depois da saída em que a queda do NDVI é normal (o capim foi comido e está rebrotando). */
export const DIAS_REBROTA = 21;

export interface PontoNdvi { data: string; ndvi: number; nuvemPct?: number }
export const leiturasBoas = (s: PontoNdvi[]) => s.filter((x) => (x.nuvemPct ?? 0) <= NUVEM_MAX).sort((a, b) => (a.data < b.data ? -1 : 1));

const mediana = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface AnaliseNdvi {
  atual: PontoNdvi | null;
  base: number | null; // mediana do próprio piquete nos 30 a 120 dias antes
  vizinhos: number | null; // mediana dos outros piquetes do módulo na mesma época
  tendencia: 'subindo' | 'estavel' | 'caindo' | null;
  alertas: Alerta[];
}

/**
 * Lê a série de NDVI do piquete e avisa a degradação antes de ela aparecer a olho:
 * - NDVI muito baixo (< 0,35): pasto rapado ou solo exposto;
 * - descansado e mesmo assim 15% (e 0,08) abaixo do que o próprio piquete costuma ter: não está rebrotando;
 * - 0,10 abaixo dos outros piquetes do módulo na mesma época: problema do piquete (e não seca, que pega todos);
 * - caindo 3 leituras seguidas sem ter gado nele.
 * Logo depois do pastejo a queda é normal, então esses avisos esperam DIAS_REBROTA dias depois da saída.
 */
export function analisarNdvi(nome: string, serie: PontoNdvi[], outros: PontoNdvi[][], estado: Pick<EstadoPiquete, 'situacao' | 'diasDescanso'>): AnaliseNdvi {
  const boas = leiturasBoas(serie);
  const atual = boas[boas.length - 1] ?? null;
  const vazio: AnaliseNdvi = { atual, base: null, vizinhos: null, tendencia: null, alertas: [] };
  if (!atual) return vazio;
  const antes = boas.filter((x) => { const d = diasEntre(x.data, atual.data); return d >= 30 && d <= 120; }).map((x) => x.ndvi);
  const base = antes.length >= 2 ? mediana(antes) : null;
  const perto = outros.map((s) => leiturasBoas(s).filter((x) => Math.abs(diasEntre(x.data, atual.data)) <= 10).pop()?.ndvi).filter((v): v is number => v != null);
  const vizinhos = perto.length >= 2 ? mediana(perto) : null;
  const ult = boas.slice(-4).map((x) => x.ndvi);
  let tendencia: AnaliseNdvi['tendencia'] = null;
  if (ult.length >= 3) {
    const d = ult[ult.length - 1] - ult[0];
    tendencia = d > 0.05 ? 'subindo' : d < -0.05 ? 'caindo' : 'estavel';
  }
  const alertas: Alerta[] = [];
  const v = fmtNum(atual.ndvi, 2);
  const quando = fmtData(atual.data);
  if (atual.ndvi < NDVI_MUITO_BAIXO) {
    alertas.push({ nivel: 'ruim', titulo: `${nome}: pasto muito baixo pelo satélite`, texto: `NDVI de ${v} em ${quando}: pouca folha verde ou solo aparecendo. Tire o gado ou alivie a lotação e confira a área.` });
  }
  const descansado = estado.situacao !== 'ocupado' && (estado.diasDescanso == null || estado.diasDescanso >= DIAS_REBROTA);
  if (descansado) {
    if (base != null && atual.ndvi < base * 0.85 && base - atual.ndvi >= 0.08) {
      alertas.push({ nivel: 'atencao', titulo: `${nome}: verde caindo pelo satélite`, texto: `NDVI de ${v} em ${quando}, abaixo do que esse piquete costuma ter (${fmtNum(base, 2)}) mesmo descansando. Pode ser o começo da degradação: veja falhas, cupim, invasoras e a adubação.` });
    }
    if (vizinhos != null && vizinhos - atual.ndvi >= 0.1) {
      alertas.push({ nivel: 'atencao', titulo: `${nome}: pior que os outros piquetes`, texto: `NDVI de ${v} contra ${fmtNum(vizinhos, 2)} nos outros piquetes do módulo na mesma época. Como os outros estão melhores, não é a seca: o problema é deste piquete.` });
    }
    const t = boas.slice(-3).map((x) => x.ndvi);
    if (t.length === 3 && t[0] > t[1] && t[1] > t[2] && t[0] - t[2] >= 0.06 && !alertas.length) {
      alertas.push({ nivel: 'atencao', titulo: `${nome}: verde caindo há 3 leituras`, texto: `O NDVI caiu de ${fmtNum(t[0], 2)} para ${fmtNum(t[2], 2)} sem gado no piquete. Vale ir lá olhar.` });
    }
  }
  return { atual, base, vizinhos, tendencia, alertas };
}

// ---------------------------------------------------------------- gravar no celular

export type TipoOcupante = 'lote' | 'grupo';
const temGrupos = () => db.tables.some((t) => t.name === 'grupos');

interface Ativo { tipo: TipoOcupante; id: number; nome: string; piqueteId?: number | null; encerrado?: boolean }

async function ativos(): Promise<Ativo[]> {
  const lotes = (await db.lotes.toArray()).filter((l) => !l.encerrado).map((l) => ({ tipo: 'lote' as const, id: l.id!, nome: l.nome, piqueteId: l.piqueteId }));
  const grupos = temGrupos()
    ? ((await db.table('grupos').toArray()) as { id: number; nome: string; piqueteId?: number | null; encerrado?: boolean }[])
      .filter((g) => !g.encerrado).map((g) => ({ tipo: 'grupo' as const, id: g.id, nome: g.nome, piqueteId: g.piqueteId }))
    : [];
  return [...lotes, ...grupos];
}

/** Quem está no piquete agora (lote ou grupo), fora "ignorar". */
export async function quemEstaNoPiquete(piqueteId: number, ignorar?: { tipo: TipoOcupante; id: number }): Promise<Ativo | null> {
  return (await ativos()).find((a) => a.piqueteId === piqueteId && !(ignorar && a.tipo === ignorar.tipo && a.id === ignorar.id)) ?? null;
}

/** Ocupantes atuais (para a lotação): lotes com o peso estimado de hoje; grupos com o que foi lançado na entrada. */
export async function ocupantesAtuais(hoje = hojeISO()): Promise<(Ocupante & { tipo: TipoOcupante; id: number; nome: string })[]> {
  const [lotes, pes, abertas] = await Promise.all([db.lotes.toArray(), db.pesagens.toArray(), db.ocupacoes.filter((o) => !o.saida).toArray()]);
  const out: (Ocupante & { tipo: TipoOcupante; id: number; nome: string })[] = [];
  for (const l of lotes) {
    if (l.encerrado || l.piqueteId == null) continue;
    const peso = pesoEstimado(pontosDoLote(pes.filter((p) => p.loteId === l.id)), hoje, l.gmdMeta);
    const ab = abertas.find((o) => o.tipo === 'lote' && o.ocupanteId === l.id);
    out.push({ tipo: 'lote', id: l.id!, nome: l.nome, piqueteId: l.piqueteId, cabecas: l.qtdCabecas, pesoMedio: peso ?? ab?.pesoMedio ?? null });
  }
  for (const a of await ativos()) {
    if (a.tipo !== 'grupo' || a.piqueteId == null) continue;
    const ab = abertas.find((o) => o.tipo === 'grupo' && o.ocupanteId === a.id);
    out.push({ tipo: 'grupo', id: a.id, nome: a.nome, piqueteId: a.piqueteId, cabecas: ab?.cabecas ?? 0, pesoMedio: ab?.pesoMedio ?? null });
  }
  return out;
}

/** Foto ou áudio novo, ainda só na tela. */
export interface MidiaNova { id: string; ext: ExtMidia; dados: ArrayBuffer }

export interface DadosEntrada {
  tipo: TipoOcupante; ocupanteId: number; piqueteId: number; data: string;
  cabecas: number; pesoMedio?: number | null; altura?: number | null; nota?: string; midias?: MidiaNova[];
}
export interface DadosSaida { data: string; altura?: number | null; nota?: string; midias?: MidiaNova[] }

function conferirMidias(m: MidiaNova[] | undefined) {
  if ((m?.length ?? 0) > MAX_MIDIAS) throw new ErroValidacao(`No máximo ${MAX_MIDIAS} fotos e áudios na entrada e na saída.`);
  if (m?.some((x) => !RE_GID.test(x.id))) throw new ErroValidacao('Foto ou áudio inválido.');
}
async function guardarMidias(m: MidiaNova[] | undefined, em: number): Promise<Midia[] | undefined> {
  if (!m?.length) return undefined;
  for (const x of m) await db.fotosAnotacao.put({ id: x.id, dados: x.dados, estado: 'enviar', em, ...(x.ext !== 'jpg' ? { ext: x.ext } : {}) });
  return m.map(({ id, ext }) => ({ id, ext }));
}
async function moverOcupante(tipo: TipoOcupante, id: number, piqueteId: number | null) {
  if (tipo === 'lote') await db.lotes.update(id, { piqueteId });
  else await db.table('grupos').update(id, { piqueteId });
}
const tabelasMov = () => [db.lotes, db.ocupacoes, db.fotosAnotacao, db.piquetes, ...(temGrupos() ? [db.table('grupos')] : [])];

/**
 * Tira os animais do piquete: fecha a ocupação aberta (altura de saída, nota, fotos e áudio) e o lote/grupo fica sem piquete.
 * Se o lote estava num piquete sem ocupação aberta (cadastro antigo), grava a saída mesmo assim.
 */
export async function sairDoPiquete(tipo: TipoOcupante, ocupanteId: number, d: DadosSaida): Promise<void> {
  conferirMidias(d.midias);
  const em = Date.now();
  await db.transaction('rw', tabelasMov(), async () => {
    const aberta = await db.ocupacoes.where('[tipo+ocupanteId]').equals([tipo, ocupanteId]).filter((o) => !o.saida).first();
    if (aberta) {
      if (d.data < aberta.entrada) throw new ErroValidacao(`A saída não pode ser antes da entrada (${fmtData(aberta.entrada)}).`);
      await db.ocupacoes.update(aberta.id!, {
        saida: d.data, alturaSaida: d.altura ?? null, notaSaida: d.nota?.trim() || undefined, midiasSaida: await guardarMidias(d.midias, em),
      });
    }
    await moverOcupante(tipo, ocupanteId, null);
  });
}

/**
 * Coloca os animais num piquete. Recusa se o piquete já tem outro lote ou grupo (a mesma regra vale no servidor).
 * Se o ocupante estava em outro piquete, fecha a ocupação de lá na mesma data (sem dados de saída).
 */
export async function entrarNoPiquete(d: DadosEntrada): Promise<number> {
  conferirMidias(d.midias);
  if (!(d.cabecas >= 0)) throw new ErroValidacao('Informe quantas cabeças entraram.');
  const em = Date.now();
  return db.transaction('rw', tabelasMov(), async () => {
    const p = await db.piquetes.get(d.piqueteId);
    if (!p) throw new ErroValidacao('Piquete não encontrado.');
    const outro = await quemEstaNoPiquete(d.piqueteId, { tipo: d.tipo, id: d.ocupanteId });
    if (outro) throw new ErroValidacao(`O piquete ${p.nome} já tem ${outro.tipo === 'lote' ? 'o lote' : 'o grupo'} ${outro.nome}. Tire de lá primeiro: um piquete recebe um lote ou grupo por vez.`);
    const choque = await db.ocupacoes.where('piqueteId').equals(d.piqueteId)
      .filter((o) => !(o.tipo === d.tipo && o.ocupanteId === d.ocupanteId) && (o.saida ?? '9999-12-31') > d.data).first();
    if (choque) throw new ErroValidacao(`O piquete ${p.nome} estava ocupado nessa data ou depois dela (de ${fmtData(choque.entrada)} a ${choque.saida ? fmtData(choque.saida) : 'hoje'}).`);
    const aberta = await db.ocupacoes.where('[tipo+ocupanteId]').equals([d.tipo, d.ocupanteId]).filter((o) => !o.saida).first();
    if (aberta) {
      if (aberta.piqueteId === d.piqueteId) throw new ErroValidacao(`Os animais já estão no ${p.nome}.`);
      if (d.data < aberta.entrada) throw new ErroValidacao(`A data é antes da entrada no piquete anterior (${fmtData(aberta.entrada)}).`);
      await db.ocupacoes.update(aberta.id!, { saida: d.data });
    }
    const alvos = alvosPiquete(p);
    const id = await db.ocupacoes.add({
      piqueteId: d.piqueteId, tipo: d.tipo, ocupanteId: d.ocupanteId, entrada: d.data, saida: null, cabecas: Math.round(d.cabecas),
      pesoMedio: d.pesoMedio ?? null, alturaEntrada: d.altura ?? null, massaEntrada: d.altura ? Math.round(massaPelaAltura(d.altura, alvos.kgMsCm)) : null,
      notaEntrada: d.nota?.trim() || undefined, midiasEntrada: await guardarMidias(d.midias, em), criadoEm: em,
    });
    await moverOcupante(d.tipo, d.ocupanteId, d.piqueteId);
    return id;
  });
}

/** Apaga um registro de ocupação errado (e marca as fotos e áudios dele para apagar da nuvem). */
export async function excluirOcupacao(id: number) {
  await db.transaction('rw', db.ocupacoes, db.fotosAnotacao, async () => {
    const o = await db.ocupacoes.get(id);
    if (!o) return;
    await db.ocupacoes.delete(id);
    for (const m of [...(o.midiasEntrada ?? []), ...(o.midiasSaida ?? [])]) {
      const l = await db.fotosAnotacao.get(m.id);
      if (l?.estado === 'enviar') await db.fotosAnotacao.delete(m.id);
      else await db.fotosAnotacao.put({ id: m.id, estado: 'apagar', em: Date.now(), ...(m.ext !== 'jpg' ? { ext: m.ext } : {}) });
    }
  });
}

// ---------------------------------------------------------------- resumo para telas e avisos

export interface ResumoModulo {
  modulo: Modulo;
  estados: EstadoPiquete[];
  lotacao: Lotacao;
  ideal: number | null;
  proximo: EstadoPiquete | null;
  ndvi: Map<number, AnaliseNdvi>;
  alertas: Alerta[];
}

export function resumirModulo(modulo: Modulo, piquetes: Piquete[], ocupacoes: Ocupacao[], ndvi: Ndvi[], ocupantes: Ocupante[], hoje: string): ResumoModulo {
  const meus = piquetes.filter((p) => p.moduloId === modulo.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
  const ids = new Set(meus.map((p) => p.id));
  const ocs = ocupacoes.filter((o) => ids.has(o.piqueteId));
  const estados = meus.map((p) => estadoPiquete(p, ocs, modulo, hoje));
  const series = new Map(meus.map((p) => [p.id!, ndvi.filter((n) => n.piqueteId === p.id)]));
  const analise = new Map(estados.map((e) => [e.piquete.id!, analisarNdvi(e.piquete.nome, series.get(e.piquete.id!)!, meus.filter((x) => x.id !== e.piquete.id).map((x) => series.get(x.id!)!), e)]));
  const lotacao = lotacaoAlta(modulo, meus, ocupantes, ocs);
  const alertas: Alerta[] = [...estados.flatMap((e) => e.alertas), ...[...analise.values()].flatMap((a) => a.alertas)];
  if (lotacao.nivel === 'alta') alertas.unshift({ nivel: 'ruim', titulo: `${modulo.nome}: lotação alta`, texto: `${lotacao.motivo} Tire animais, alugue pasto ou dê mais suplemento.` });
  else if (lotacao.nivel === 'atencao') alertas.unshift({ nivel: 'atencao', titulo: `${modulo.nome}: lotação perto do limite`, texto: lotacao.motivo });
  const atual = new Map([...analise].filter(([, a]) => a.atual).map(([id, a]) => [id, a.atual!.ndvi]));
  return { modulo, estados, lotacao, ideal: ocupacaoIdeal(modulo.diasDescanso, meus.length), proximo: modulo.sistema === 'continuo' ? null : sugerirProximo(estados, atual), ndvi: analise, alertas };
}

/** Todos os módulos com a situação e os avisos (para o Início, a tela do Pasto e a Cria). */
export async function resumoPasto(hoje = hojeISO()): Promise<ResumoModulo[]> {
  const [modulos, piquetes, ocupacoes, ndvi, ocupantes] = await Promise.all([
    db.modulos.toArray(), db.piquetes.toArray(), db.ocupacoes.toArray(), db.ndvi.where('data').aboveOrEqual(somaDias(hoje, -150)).toArray(), ocupantesAtuais(hoje),
  ]);
  return modulos.map((m) => resumirModulo(m, piquetes, ocupacoes, ndvi, ocupantes, hoje));
}
