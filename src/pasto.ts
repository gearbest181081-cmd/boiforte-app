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
export interface Ocupante { piqueteId: number | null | undefined; cabecas: number; pesoMedio: number | null | undefined; tipo?: TipoOcupante; id?: number; nome?: string }

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
 * A área é a gravada no módulo; módulo antigo, sem área, usa a soma das áreas dos piquetes.
 */
export function lotacaoModulo(piquetes: Pick<Piquete, 'id' | 'areaHa'>[], ocupantes: Ocupante[], areaModulo?: number | null) {
  const ids = new Set(piquetes.map((p) => p.id));
  const areaPiquetes = piquetes.reduce((s, p) => s + (p.areaHa ?? 0), 0);
  const areaHa = areaModulo && areaModulo > 0 ? areaModulo : areaPiquetes;
  const dentro = ocupantes.filter((o) => o.piqueteId != null && ids.has(o.piqueteId));
  const uaTotal = dentro.reduce((s, o) => s + uaDe(o), 0);
  const cabecas = dentro.reduce((s, o) => s + o.cabecas, 0);
  return { areaHa, areaPiquetes, ua: uaTotal, cabecas, uaHa: areaHa > 0 ? uaTotal / areaHa : null, semArea: piquetes.filter((p) => !p.areaHa).length };
}

export type NivelLotacao = 'ok' | 'atencao' | 'alta' | 'sem_dados';
export interface Lotacao { nivel: NivelLotacao; uaHa: number | null; capacidade: number | null; motivo: string }

/**
 * Lotação alta? Para a Cria e o Início usarem nas decisões.
 * 1) UA/ha acima da capacidade de suporte do módulo (90% = atenção; acima de 100% = alta);
 * 2) sem capacidade gravada: as 2 últimas saídas com o capim abaixo da altura de saída (pasto rapado) = alta.
 */
export function lotacaoAlta(
  modulo: Pick<Modulo, 'capacidadeUA' | 'areaHa'>,
  piquetes: Pick<Piquete, 'id' | 'areaHa' | 'capim' | 'alturaEntrada' | 'alturaSaida' | 'kgMsCm'>[],
  ocupantes: Ocupante[],
  ocupacoes: Pick<Ocupacao, 'piqueteId' | 'saida' | 'alturaSaida'>[] = [],
): Lotacao {
  const l = lotacaoModulo(piquetes, ocupantes, modulo.areaHa);
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
  if (l.uaHa == null) return { nivel: 'sem_dados', uaHa: null, capacidade: null, motivo: 'Falta a área do módulo.' };
  return { nivel: cap ? 'ok' : 'sem_dados', uaHa: l.uaHa, capacidade: cap, motivo: 'Grave a capacidade de suporte do módulo (UA/ha) para o app avisar quando passar.' };
}

/** kg de MS por hectare estimada pela altura do capim. */
export const massaPelaAltura = (alturaCm: number, kgMsCm: number) => alturaCm * kgMsCm;

/**
 * Pressão de pastejo e oferta de forragem na entrada.
 * pressão = kg de peso vivo por kg de MS disponível; oferta = kg de MS por 100 kg de PV por dia de ocupação.
 * Oferta abaixo de 4 falta capim; de 7 a 20 está boa; acima de 20 sobra capim (cabe mais animal ou o capim passa do ponto).
 */
export function pressaoPastejo(a: { cabecas: number; pesoMedio: number; massaKgMsHa: number; areaHa: number; dias: number }) {
  const pv = a.cabecas * a.pesoMedio;
  const ms = a.massaKgMsHa * a.areaHa;
  if (!(pv > 0) || !(ms > 0)) return null;
  const oferta = a.dias > 0 ? (ms / (pv * a.dias)) * 100 : null;
  return { pressao: pv / ms, oferta, nivel: oferta == null ? null : oferta < 4 ? 'ruim' as const : oferta < 7 ? 'atencao' as const : oferta > 20 ? 'sobra' as const : 'bom' as const };
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
  ocupante?: Ocupante; // quem está lá agora (lote ou grupo)
  uaHa?: number | null; // lotação do piquete agora
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

/**
 * Próximo piquete para entrar: livre, com descanso cumprido e, entre esses, o que descansou mais (o NDVI desempata).
 * Se nenhum cumpriu o descanso, o que está mais perto de cumprir.
 */
export function sugerirProximo(estados: EstadoPiquete[], ndviAtual: Map<number, number> = new Map()): EstadoPiquete | null {
  let livres = estados.filter((e) => e.situacao === 'pronto' || e.situacao === 'sem_uso');
  if (!livres.length) livres = estados.filter((e) => e.situacao === 'descansando');
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

// ---------------------------------------------------------------- área do módulo × área dos piquetes
// A soma das áreas dos piquetes não pode passar da área do módulo (senão a lotação em UA/ha sai errada).
// A mesma regra vale no servidor (gatilho em 20261124204700_area_modulo.sql).

/** Folga para o arredondamento (10 m²): 3,33 + 3,33 + 3,34 dá 10,000000000000002 no computador. O servidor usa a mesma. */
export const FOLGA_AREA_HA = 0.001;
const ha = (v: number) => `${fmtNum(v, 2)} ha`;

export interface UsoArea {
  /** Área gravada no módulo; null = módulo antigo, sem área (sem limite). */
  areaModulo: number | null;
  /** Soma das áreas dos piquetes (sem contar o piquete "fora"). */
  usada: number;
  /** Quanto ainda cabe em piquetes; null = sem limite. */
  livre: number | null;
}

/** Quanto da área do módulo os piquetes já usam. "fora": o piquete que está sendo editado (não entra na soma). */
export function usoDaArea(modulo: Pick<Modulo, 'areaHa'> | null | undefined, piquetes: Pick<Piquete, 'id' | 'areaHa'>[], fora?: number): UsoArea {
  const usada = piquetes.filter((p) => fora == null || p.id !== fora).reduce((s, p) => s + (p.areaHa ?? 0), 0);
  const areaModulo = modulo?.areaHa && modulo.areaHa > 0 ? modulo.areaHa : null;
  return { areaModulo, usada, livre: areaModulo == null ? null : Math.max(0, areaModulo - usada) };
}

/** Frase embaixo do campo Área do piquete: quanto ainda cabe no módulo. */
export function dicaAreaPiquete(uso: UsoArea): string | undefined {
  if (uso.livre == null) return undefined;
  return uso.livre > FOLGA_AREA_HA ? `Cabe até ${ha(uso.livre)} neste módulo.` : 'O módulo já está todo dividido em piquetes.';
}

/** Confere se um piquete com esta área cabe no módulo. Se não cabe, a mensagem diz quanto cabe. */
export function conferirAreaPiquete(modulo: Pick<Modulo, 'nome' | 'areaHa'>, piquetes: Pick<Piquete, 'id' | 'areaHa'>[], areaHa: number | null | undefined, fora?: number) {
  if (!areaHa || areaHa <= 0) return; // piquete sem área não pesa na soma
  const u = usoDaArea(modulo, piquetes, fora);
  if (u.areaModulo == null || u.usada + areaHa <= u.areaModulo + FOLGA_AREA_HA) return;
  const outros = u.usada > FOLGA_AREA_HA ? ` e os outros piquetes já usam ${ha(u.usada)}` : '';
  throw new ErroValidacao(u.livre! > FOLGA_AREA_HA
    ? `O módulo ${modulo.nome} tem ${ha(u.areaModulo)}${outros}. Este piquete pode ter no máximo ${ha(u.livre!)}.`
    : `O módulo ${modulo.nome} tem ${ha(u.areaModulo)}${outros}: não sobra área para este piquete. Diminua a área de outro piquete ou aumente a do módulo.`);
}

/** Confere a área do módulo: maior que zero e nunca menor que a soma dos piquetes dele. */
export function conferirAreaModulo(nome: string, areaHa: number, piquetes: Pick<Piquete, 'areaHa'>[]) {
  if (!(areaHa > 0)) throw new ErroValidacao('A área do módulo precisa ser maior que zero.');
  const usada = piquetes.reduce((s, p) => s + (p.areaHa ?? 0), 0);
  if (usada > areaHa + FOLGA_AREA_HA) {
    throw new ErroValidacao(`Os piquetes do módulo ${nome} já somam ${ha(usada)}. A área do módulo não pode ser menor que isso (ou diminua a área dos piquetes antes).`);
  }
}

/** Cadastra um módulo. A área é obrigatória: é ela que limita a soma dos piquetes. */
export async function novoModulo(d: { propriedadeId: number; nome: string; areaHa: number | null | undefined }): Promise<number> {
  const nome = d.nome.trim();
  if (!nome) throw new ErroValidacao('Dê um nome ao módulo. Ex.: "Retiro de cima".');
  if (d.areaHa == null) throw new ErroValidacao('Informe a área do módulo em hectares.');
  conferirAreaModulo(nome, d.areaHa, []);
  return db.modulos.add({ propriedadeId: d.propriedadeId, nome, areaHa: d.areaHa, criadoEm: Date.now() });
}

export type MudancaModulo = Partial<Pick<Modulo, 'nome' | 'areaHa' | 'sistema' | 'diasOcupacao' | 'diasDescanso' | 'capacidadeUA'>>;

/** Muda o módulo. A área nova não pode ser menor que a soma dos piquetes, nem ficar em branco depois de gravada. */
export async function atualizarModulo(id: number, mud: MudancaModulo): Promise<void> {
  await db.transaction('rw', db.modulos, db.piquetes, async () => {
    const m = await db.modulos.get(id);
    if (!m) throw new ErroValidacao('Módulo não encontrado.');
    if ('areaHa' in mud) {
      if (mud.areaHa == null) { if (m.areaHa != null) throw new ErroValidacao('Informe a área do módulo em hectares.'); }
      // Igual ao servidor: só confere quando a área é informada pela primeira vez ou diminui. Manter a área
      // (mudando só o manejo) ou aumentar sempre pode, mesmo que os piquetes já passem dela.
      else if (m.areaHa == null || mud.areaHa < m.areaHa) {
        conferirAreaModulo(mud.nome ?? m.nome, mud.areaHa, await db.piquetes.where('moduloId').equals(id).toArray());
      }
    }
    await db.modulos.update(id, mud);
  });
}

export type MudancaPiquete = Partial<Omit<Piquete, 'id' | 'gid' | 'criadoEm'>>;

/** Cadastra um piquete. A área (se informada) precisa caber no que sobra do módulo. */
export async function novoPiquete(d: Omit<Piquete, 'id' | 'gid' | 'criadoEm'>): Promise<number> {
  return db.transaction('rw', db.modulos, db.piquetes, async () => {
    const m = await db.modulos.get(d.moduloId);
    if (!m) throw new ErroValidacao('Módulo não encontrado.');
    conferirAreaPiquete(m, await db.piquetes.where('moduloId').equals(d.moduloId).toArray(), d.areaHa);
    return db.piquetes.add({ ...d, criadoEm: Date.now() });
  });
}

/**
 * Muda o piquete. Se a área crescer (ou o piquete for para outro módulo), confere que cabe no módulo;
 * diminuir a área ou mudar só o nome, o capim ou o contorno sempre pode (igual ao servidor).
 */
export async function atualizarPiquete(id: number, mud: MudancaPiquete): Promise<void> {
  await db.transaction('rw', db.modulos, db.piquetes, async () => {
    const p = await db.piquetes.get(id);
    if (!p) throw new ErroValidacao('Piquete não encontrado.');
    const moduloId = mud.moduloId ?? p.moduloId;
    const area = 'areaHa' in mud ? mud.areaHa : p.areaHa;
    if (moduloId !== p.moduloId || (area ?? 0) > (p.areaHa ?? 0)) {
      const m = await db.modulos.get(moduloId);
      if (!m) throw new ErroValidacao('Módulo não encontrado.');
      conferirAreaPiquete(m, await db.piquetes.where('moduloId').equals(moduloId).toArray(), area, id);
    }
    await db.piquetes.update(id, mud);
  });
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
  return m.map(({ id, ext }) => ({ arq: id, ext }));
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
      const l = await db.fotosAnotacao.get(m.arq);
      if (l?.estado === 'enviar') await db.fotosAnotacao.delete(m.arq);
      else await db.fotosAnotacao.put({ id: m.arq, estado: 'apagar', em: Date.now(), ...(m.ext !== 'jpg' ? { ext: m.ext } : {}) });
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
  const estados = meus.map((p) => {
    const e = estadoPiquete(p, ocs, modulo, hoje);
    const quem = ocupantes.find((o) => o.piqueteId === p.id);
    if (quem) {
      e.ocupante = quem;
      e.uaHa = lotacaoPiquete(p.areaHa, [quem]);
      if (e.situacao !== 'ocupado') { e.situacao = 'ocupado'; delete e.diasDescanso; } // lote antigo, sem registro de entrada
    }
    return e;
  });
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
