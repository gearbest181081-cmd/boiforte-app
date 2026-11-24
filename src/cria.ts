// Cria: contas e regras do rebanho de matrizes, touros e bezerros (funções puras, testadas em cria.test.ts).
// A Cria é separada da Recria/RIP/TIP/Confinamento: trabalha com GRUPO DE MANEJO, não com lote.
import { diasEntre, fmtData, ordenar, somaDias, type PontoPeso } from './calc';
import type { Alerta } from './alertas';
import type { Animal, CategoriaCria, Desmama, Estacao, EventoReprodutivo, PesoCria, TipoGrupo, MetodoMonta } from './db';

// ---------- números de referência (ficam à vista para o produtor entender as contas) ----------

/** Gestação média de vaca de corte (zebu ~290 dias, taurino ~283). */
export const GESTACAO_DIAS = 290;
/** Idade de desmama padrão: 7 meses. */
export const IDADE_DESMAMA_DIAS = 210;
/** Ganho do bezerro ao pé da vaca sem creep e o que o creep feed costuma somar. */
export const GMD_PRE_DESMAMA = 0.75;
export const GMD_CREEP_EXTRA = 0.12;
export const PESO_NASCER_PADRAO = 32;
/** Vacas por touro na monta natural. */
export const VACAS_POR_TOURO = 25;
/** Intervalo entre partos acima disso (15 meses) é sinal de vaca pouco produtiva. */
export const IEP_LONGO_DIAS = 450;
/** Arroba de peso vivo (decisão do Luiz): 30 kg. */
export const KG_ARROBA_VIVO = 30;
/** Permanência sugerida (meses) quando a pessoa não informa. */
export const PERMANENCIA_PADRAO: Record<CategoriaCria, number | null> = { matriz: 120, touro: 60, novilha: 36, bezerro: null };

export const CATEGORIAS_CRIA: Record<CategoriaCria, string> = { matriz: 'Matriz', novilha: 'Novilha', touro: 'Touro', bezerro: 'Bezerro(a)' };
export const TIPOS_GRUPO: Record<TipoGrupo, string> = {
  matrizes: 'Vacas (matrizes)', paridas: 'Vacas paridas com bezerro', novilhas: 'Novilhas de reposição', touros: 'Touros', bezerros: 'Bezerros', misto: 'Misto',
};
export const METODOS_MONTA: Record<MetodoMonta, string> = {
  monta: 'Monta natural (touro)', ia: 'Inseminação (IA)', iatf: 'IATF (inseminação em tempo fixo)', ia_repasse: 'IA/IATF com repasse de touro',
};
export const TIPOS_REPRODUCAO = { monta: 'Monta (touro)', ia: 'Inseminação', diagnostico: 'Diagnóstico de gestação', parto: 'Parto', aborto: 'Aborto' } as const;

// ---------- básico ----------

export const ehCria = (a: Animal) => a.grupoId != null && !a.loteId;
export const ativoCria = (a: Animal) => ehCria(a) && a.ativo && !a.saida;
/** Cabeças que o registro representa (touros lançados por lote têm qtd). */
export const cabecas = (a: Animal) => Math.max(1, a.qtd ?? 1);

export function idadeDias(a: Pick<Animal, 'nascimento'>, hoje: string): number | null {
  return a.nascimento ? Math.max(0, diasEntre(a.nascimento, hoje)) : null;
}
export function idadeTexto(dias: number | null): string {
  if (dias == null) return '—';
  if (dias < 60) return `${dias} dias`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 24) return `${meses} meses`;
  const anos = Math.floor(meses / 12), resto = meses % 12;
  return resto ? `${anos} anos e ${resto} m` : `${anos} anos`;
}

/** Nome curto para mostrar: brinco, ou "3 touros" quando lançado por lote. */
export function rotuloAnimal(a: Animal): string {
  if ((a.qtd ?? 1) > 1) return `${a.nome || a.brinco} (${a.qtd} cab)`;
  return a.nome ? `${a.brinco} · ${a.nome}` : a.brinco;
}

export function cabecasGrupo(grupoId: number, animais: Animal[]): number {
  return animais.filter((a) => a.grupoId === grupoId && ativoCria(a)).reduce((s, a) => s + cabecas(a), 0);
}

/** Peso de referência para UA quando não há pesagem. */
const PESO_REF: Record<CategoriaCria, number> = { matriz: 450, novilha: 330, touro: 650, bezerro: 120 };
/** Unidade animal (450 kg de peso vivo). */
export function uaAnimal(a: Animal, pesoAtual?: number | null): number {
  const peso = pesoAtual ?? PESO_REF[a.categoria ?? 'matriz'];
  return (peso / 450) * cabecas(a);
}
export function uaGrupo(grupoId: number, animais: Animal[], pesos: PesoCria[] = []): number {
  const ult = ultimosPesos(pesos);
  return animais.filter((a) => a.grupoId === grupoId && ativoCria(a)).reduce((s, a) => s + uaAnimal(a, ult.get(a.id!)?.peso), 0);
}

/** Última pesagem de cada animal. */
export function ultimosPesos(pesos: PesoCria[]): Map<number, PesoCria> {
  const m = new Map<number, PesoCria>();
  for (const p of pesos) { const a = m.get(p.animalId); if (!a || p.data >= a.data) m.set(p.animalId, p); }
  return m;
}

/** Pontos da curva de um animal: peso ao nascer + pesagens. */
export function pontosAnimal(a: Animal, pesos: PesoCria[]): PontoPeso[] {
  const p: PontoPeso[] = pesos.filter((x) => x.animalId === a.id).map((x) => ({ data: x.data, peso: x.peso }));
  if (a.nascimento && a.pesoNascer && !p.some((x) => x.data === a.nascimento)) p.push({ data: a.nascimento, peso: a.pesoNascer });
  return ordenar(p);
}

// ---------- bezerro: projeção da desmama ----------

export interface ProjecaoDesmama { data: string; peso: number; gmd: number; origem: 'pesagens' | 'padrao'; diasFaltando: number }

export function projecaoDesmama(a: Animal, pesos: PesoCria[], hoje: string, idadeDesmama = IDADE_DESMAMA_DIAS): ProjecaoDesmama | null {
  if (!a.nascimento) return null;
  const pts = pontosAnimal(a, pesos);
  const data = somaDias(a.nascimento, idadeDesmama);
  let gmd = GMD_PRE_DESMAMA + (a.creep ? GMD_CREEP_EXTRA : 0);
  let origem: ProjecaoDesmama['origem'] = 'padrao';
  const ultimo = pts[pts.length - 1];
  if (pts.length >= 2) {
    const dias = diasEntre(pts[0].data, ultimo.data);
    if (dias >= 20) { gmd = (ultimo.peso - pts[0].peso) / dias; origem = 'pesagens'; }
  }
  const base = ultimo ?? { data: a.nascimento, peso: a.pesoNascer ?? PESO_NASCER_PADRAO };
  const peso = base.peso + gmd * Math.max(0, diasEntre(base.data, data));
  return { data, peso: Math.round(peso * 10) / 10, gmd, origem, diasFaltando: diasEntre(hoje, data) };
}

/** Peso ajustado aos 205 dias (padrão para comparar bezerros desmamados em idades diferentes). */
export function p205(peso: number, idadeDias: number, pesoNascer = PESO_NASCER_PADRAO): number | null {
  if (idadeDias < 120 || idadeDias > 330) return null; // fora disso o ajuste distorce
  return Math.round((((peso - pesoNascer) / idadeDias) * 205 + pesoNascer) * 10) / 10;
}

// ---------- matriz: histórico de crias ----------

export interface CriaDaVaca { bezerroId?: number | null; data: string; sexo?: 'macho' | 'femea'; natimorto: boolean; pesoDesmama?: number; p205?: number | null; foraEpoca: boolean | null }
export interface HistoricoMatriz {
  crias: CriaDaVaca[];
  nCrias: number; machos: number; femeas: number; pctMachos: number | null; pctFemeas: number | null;
  ieps: number[]; iepMedio: number | null; idadePrimeiroParto: number | null;
  ultimoParto: string | null; abortos: number; natimortos: number;
  diagnosticos: { data: string; resultado: 'prenhe' | 'vazia' }[];
  prenhe: boolean | null; partoPrevisto: string | null; cobertaNaEstacao: boolean;
  partosForaEpoca: number;
}

/** O parto está "na época certa" quando cai entre a estação de monta + gestação (com 20 dias de folga). */
export function partoNaEpoca(data: string, estacoes: Pick<Estacao, 'inicio' | 'fim'>[]): boolean | null {
  if (!estacoes.length) return null;
  return estacoes.some((e) => data >= somaDias(e.inicio, GESTACAO_DIAS - 20) && data <= somaDias(e.fim, GESTACAO_DIAS + 20));
}

export function historicoMatriz(m: Animal, eventos: EventoReprodutivo[], animais: Animal[], desmamas: Desmama[], estacoes: Estacao[], hoje: string): HistoricoMatriz {
  const ev = eventos.filter((e) => e.matrizId === m.id).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const porId = new Map(animais.map((a) => [a.id!, a]));
  const pesoDesm = new Map<number, { peso: number; idade: number }>();
  for (const d of desmamas) for (const it of d.itens) pesoDesm.set(it.animalId, { peso: it.peso, idade: it.idadeDias });
  const crias: CriaDaVaca[] = [];
  const partos = ev.filter((e) => e.tipo === 'parto');
  for (const p of partos) {
    const b = p.bezerroId ? porId.get(p.bezerroId) : undefined;
    const d = p.bezerroId ? pesoDesm.get(p.bezerroId) : undefined;
    crias.push({
      bezerroId: p.bezerroId, data: p.data, sexo: b?.sexo === 'macho' || b?.sexo === 'femea' ? b.sexo : undefined, natimorto: p.partoTipo === 'natimorto',
      pesoDesmama: d?.peso, p205: d ? p205(d.peso, d.idade, b?.pesoNascer ?? undefined) : null, foraEpoca: (() => { const n = partoNaEpoca(p.data, estacoes); return n == null ? null : !n; })(),
    });
  }
  // bezerro com a mãe apontada mas sem evento de parto (lançado direto no cadastro do bezerro)
  for (const b of animais) {
    if (b.maeId !== m.id || !b.nascimento || partos.some((p) => p.bezerroId === b.id)) continue;
    const d = pesoDesm.get(b.id!);
    const n = partoNaEpoca(b.nascimento, estacoes);
    crias.push({ bezerroId: b.id, data: b.nascimento, sexo: b.sexo === 'macho' || b.sexo === 'femea' ? b.sexo : undefined, natimorto: false, pesoDesmama: d?.peso, p205: d ? p205(d.peso, d.idade, b.pesoNascer ?? undefined) : null, foraEpoca: n == null ? null : !n });
  }
  crias.sort((a, b) => (a.data < b.data ? -1 : 1));
  const machos = crias.filter((c) => c.sexo === 'macho').length, femeas = crias.filter((c) => c.sexo === 'femea').length;
  const ieps: number[] = [];
  for (let i = 1; i < crias.length; i++) ieps.push(diasEntre(crias[i - 1].data, crias[i].data));
  const diagnosticos = ev.filter((e) => e.tipo === 'diagnostico' && e.resultado).map((e) => ({ data: e.data, resultado: e.resultado! }));
  const ultimoParto = crias.length ? crias[crias.length - 1].data : null;
  const ultDiag = diagnosticos[diagnosticos.length - 1];
  // prenhe = último diagnóstico positivo depois do último parto
  const prenhe = ultDiag && (!ultimoParto || ultDiag.data > ultimoParto) ? ultDiag.resultado === 'prenhe' : null;
  let partoPrevisto: string | null = null;
  if (prenhe) {
    const d = ev.filter((e) => e.tipo === 'diagnostico' && e.data === ultDiag.data).pop();
    const cob = ev.filter((e) => (e.tipo === 'monta' || e.tipo === 'ia') && e.data <= ultDiag.data && (!ultimoParto || e.data > ultimoParto)).pop();
    if (d?.diasGestacao) partoPrevisto = somaDias(d.data, GESTACAO_DIAS - d.diasGestacao);
    else if (cob) partoPrevisto = somaDias(cob.data, GESTACAO_DIAS);
  }
  const estAtual = estacoes.find((e) => e.inicio <= hoje && hoje <= somaDias(e.fim, 60));
  const cobertaNaEstacao = !!estAtual && ev.some((e) => (e.tipo === 'monta' || e.tipo === 'ia') && e.data >= estAtual.inicio && e.data <= estAtual.fim);
  return {
    crias, nCrias: crias.filter((c) => !c.natimorto).length, machos, femeas,
    pctMachos: machos + femeas ? machos / (machos + femeas) : null, pctFemeas: machos + femeas ? femeas / (machos + femeas) : null,
    ieps, iepMedio: ieps.length ? ieps.reduce((a, b) => a + b, 0) / ieps.length : null,
    idadePrimeiroParto: m.nascimento && crias.length ? diasEntre(m.nascimento, crias[0].data) : null,
    ultimoParto, abortos: ev.filter((e) => e.tipo === 'aborto').length, natimortos: crias.filter((c) => c.natimorto).length,
    diagnosticos, prenhe, partoPrevisto, cobertaNaEstacao, partosForaEpoca: crias.filter((c) => c.foraEpoca === true).length,
  };
}

// ---------- permanência (no lugar do peso alvo) ----------

/** Data prevista de saída: entrada (ou nascimento) + período de permanência. */
export function saidaPrevista(a: Animal): string | null {
  if (!a.permanenciaMeses) return null;
  const base = a.entrada ?? a.nascimento;
  if (!base) return null;
  return somaMeses(base, a.permanenciaMeses);
}

/** Soma meses de calendário (31/01 + 1 mês = 28 ou 29/02). */
export function somaMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const total = a * 12 + (m - 1) + Math.round(meses);
  const ano = Math.floor(total / 12), mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export function alertaPermanencia(a: Animal, hoje: string): Alerta | null {
  const s = saidaPrevista(a);
  if (!s || !ativoCria(a)) return null;
  const d = diasEntre(hoje, s);
  const nome = `${CATEGORIAS_CRIA[a.categoria ?? 'matriz']} ${rotuloAnimal(a)}`;
  if (d < 0) return { nivel: 'ruim', titulo: `${nome}: passou do tempo de permanência`, texto: `A saída estava prevista para ${fmtData(s)}. Decida se vende, descarta ou estende o prazo.` };
  if (d <= 90) return { nivel: 'atencao', titulo: `${nome}: sai em ${d} dias`, texto: `Fim do período de permanência em ${fmtData(s)}. Já planeje a reposição.` };
  return null;
}

// ---------- IPM: índice de produtividade da matriz ----------

export interface LinhaIpm {
  matriz: Animal; hist: HistoricoMatriz;
  kgDesmamados: number; anos: number;
  ipm: number | null; // kg de bezerro desmamado (ajustado 205 dias) por ano de vaca no rebanho
  relativo: number | null; // 100 = média do rebanho
  motivos: string[]; // possíveis motivos de descarte
  pontos: number; // gravidade dos motivos (para ordenar a lista de descarte)
}

/**
 * IPM = soma dos pesos ajustados aos 205 dias dos bezerros desmamados ÷ anos da vaca no rebanho de cria.
 * Junta fertilidade (quantos bezerros por ano) e habilidade materna (quanto o bezerro pesa na desmama).
 * Anos no rebanho: desde o primeiro parto (ou a entrada), no mínimo 1.
 */
export function calcularIpm(matrizes: Animal[], eventos: EventoReprodutivo[], animais: Animal[], desmamas: Desmama[], estacoes: Estacao[], hoje: string): LinhaIpm[] {
  const linhas: LinhaIpm[] = matrizes.map((m) => {
    const hist = historicoMatriz(m, eventos, animais, desmamas, estacoes, hoje);
    const kg = hist.crias.reduce((s, c) => s + (c.p205 ?? c.pesoDesmama ?? 0), 0);
    const inicio = hist.crias[0]?.data ?? m.entrada ?? null;
    const anos = inicio ? Math.max(1, diasEntre(inicio, hoje) / 365) : 1;
    const temDesmama = hist.crias.some((c) => c.pesoDesmama);
    return { matriz: m, hist, kgDesmamados: kg, anos, ipm: temDesmama || hist.crias.length ? Math.round((kg / anos) * 10) / 10 : null, relativo: null, motivos: [], pontos: 0 };
  });
  const comIpm = linhas.filter((l) => l.ipm != null && l.hist.crias.some((c) => c.pesoDesmama));
  const media = comIpm.length ? comIpm.reduce((s, l) => s + l.ipm!, 0) / comIpm.length : null;
  for (const l of linhas) {
    if (media && l.ipm != null) l.relativo = Math.round((l.ipm / media) * 100);
    const { motivos, pontos } = motivosDescarte(l, hoje);
    l.motivos = motivos; l.pontos = pontos;
  }
  return linhas.sort((a, b) => (b.ipm ?? -1) - (a.ipm ?? -1));
}

function motivosDescarte(l: LinhaIpm, hoje: string): { motivos: string[]; pontos: number } {
  const { matriz: m, hist: h } = l;
  const out: [string, number][] = [];
  const diag = h.diagnosticos;
  const ult = diag[diag.length - 1];
  if (ult?.resultado === 'vazia' && (!h.ultimoParto || ult.data > h.ultimoParto)) {
    const duas = diag.length >= 2 && diag[diag.length - 2].resultado === 'vazia' && (!h.ultimoParto || diag[diag.length - 2].data > h.ultimoParto);
    out.push(duas ? ['Vazia em dois diagnósticos seguidos', 5] : [`Vazia no diagnóstico de ${fmtData(ult.data)}`, 3]);
  }
  if (h.iepMedio != null && h.iepMedio > IEP_LONGO_DIAS) out.push([`Intervalo entre partos longo (${Math.round(h.iepMedio / 30.44)} meses)`, 2]);
  const desde = h.ultimoParto ?? m.entrada ?? null;
  if (desde && diasEntre(desde, hoje) > 730 && !h.prenhe) out.push([h.ultimoParto ? `Sem parir há ${Math.round(diasEntre(desde, hoje) / 30.44)} meses` : 'Nunca pariu desde que entrou', 4]);
  const recente = somaDias(hoje, -730);
  if (h.abortos) out.push([`Aborto registrado${h.abortos > 1 ? ` (${h.abortos})` : ''}`, h.abortos > 1 ? 3 : 1]);
  if (h.crias.some((c) => c.natimorto && c.data >= recente)) out.push(['Bezerro nasceu morto nos últimos 2 anos', 1]);
  if (l.relativo != null && l.relativo < 80 && h.nCrias >= 2) out.push([`Desmama bezerros leves (IPM ${l.relativo}% da média)`, 2]);
  if (h.partosForaEpoca >= 2) out.push([`Pariu fora da estação ${h.partosForaEpoca} vezes`, 1]);
  const idade = idadeDias(m, hoje);
  if (idade != null && idade > 12 * 365) out.push([`Idade avançada (${Math.floor(idade / 365)} anos)`, 2]);
  const s = saidaPrevista(m);
  if (s && s < hoje) out.push(['Passou do tempo de permanência', 2]);
  if (m.descarte) out.push([m.motivoDescarte ? `Marcada para descarte: ${m.motivoDescarte}` : 'Marcada para descarte', 5]);
  return { motivos: out.map((x) => x[0]), pontos: out.reduce((s, x) => s + x[1], 0) };
}

/** Lista de descarte: vacas com motivo, da mais urgente para a menos. */
export function sugestoesDescarte(linhas: LinhaIpm[]): LinhaIpm[] {
  return linhas.filter((l) => l.pontos >= 2).sort((a, b) => b.pontos - a.pontos || (a.ipm ?? 0) - (b.ipm ?? 0));
}

// ---------- custo do bezerro desmamado ----------

export interface CustoBezerro { custoTotal: number; bezerros: number; kg: number; porCabeca: number | null; porKg: number | null; porArroba: number | null }

export function custoBezerro(custoTotal: number, desmamas: Pick<Desmama, 'itens'>[]): CustoBezerro {
  const itens = desmamas.flatMap((d) => d.itens);
  const kg = itens.reduce((s, i) => s + i.peso, 0);
  const n = itens.length;
  return {
    custoTotal, bezerros: n, kg,
    porCabeca: n ? custoTotal / n : null, porKg: kg ? custoTotal / kg : null, porArroba: kg ? custoTotal / (kg / KG_ARROBA_VIVO) : null,
  };
}

// ---------- desmama: pacote ----------

export interface ItemDesmama { animalId: number; peso: number; sexo: 'macho' | 'femea'; idadeDias: number; destino: 'lote' | 'reposicao'; grupoId?: number | null }

/** Peso médio ponderado do pacote (total de kg ÷ cabeças) e P205 médio. */
export function resumoPacote(itens: ItemDesmama[], pesoNascer: (id: number) => number | undefined = () => undefined) {
  const kgTotal = itens.reduce((s, i) => s + i.peso, 0);
  const p = itens.map((i) => p205(i.peso, i.idadeDias, pesoNascer(i.animalId))).filter((x): x is number => x != null);
  const machos = itens.filter((i) => i.sexo === 'macho'), femeas = itens.filter((i) => i.sexo === 'femea');
  const med = (l: ItemDesmama[]) => (l.length ? l.reduce((s, i) => s + i.peso, 0) / l.length : null);
  return {
    cabecas: itens.length, kgTotal, pesoMedio: itens.length ? kgTotal / itens.length : 0,
    p205Medio: p.length ? p.reduce((a, b) => a + b, 0) / p.length : null,
    machos: machos.length, femeas: femeas.length, pesoMachos: med(machos), pesoFemeas: med(femeas),
    idadeMedia: itens.length ? itens.reduce((s, i) => s + i.idadeDias, 0) / itens.length : 0,
  };
}

/** Próxima versão do pacote no ano (1, 2, 3...). */
export function proximaVersao(desmamas: Pick<Desmama, 'ano' | 'versao'>[], ano: number): number {
  return desmamas.filter((d) => d.ano === ano).reduce((m, d) => Math.max(m, d.versao), 0) + 1;
}

// ---------- simulador ----------

export interface EntradaVenderOuRecriar {
  cabecas: number; pesoDesmama: number; precoBezerroKg: number;
  diasRecria: number; gmd: number; custoCabDia: number; precoArrobaVenda: number; mortalidade: number; jurosMes: number;
}
export function venderOuRecriar(e: EntradaVenderOuRecriar) {
  const receitaAgora = e.cabecas * e.pesoDesmama * e.precoBezerroKg;
  const pesoFinal = e.pesoDesmama + e.gmd * e.diasRecria;
  const vivos = e.cabecas * (1 - e.mortalidade);
  const receitaRecria = vivos * (pesoFinal / KG_ARROBA_VIVO) * e.precoArrobaVenda;
  const custo = e.cabecas * e.custoCabDia * e.diasRecria;
  const oportunidade = receitaAgora * (Math.pow(1 + e.jurosMes, e.diasRecria / 30.44) - 1);
  const ganhoRecria = receitaRecria - custo - oportunidade - receitaAgora;
  // preço da @ que empata as duas opções
  const empate = vivos && pesoFinal ? ((receitaAgora + custo + oportunidade) / (vivos * (pesoFinal / KG_ARROBA_VIVO))) : null;
  return { receitaAgora, pesoFinal, receitaRecria, custo, oportunidade, ganhoRecria, melhor: ganhoRecria > 0 ? 'recriar' as const : 'vender' as const, precoEmpate: empate };
}

export interface EntradaReterNovilhas {
  novilhas: number; valorVendaCab: number; custoMes: number; mesesAtePrimeiroParto: number;
  taxaPrenhez: number; valorBezerro: number; jurosMes: number;
}
/** Reter a novilha custa a venda que não foi feita + a recria até parir; paga com os bezerros dela. */
export function reterNovilhas(e: EntradaReterNovilhas) {
  const investimentoCab = e.valorVendaCab * Math.pow(1 + e.jurosMes, e.mesesAtePrimeiroParto) + e.custoMes * e.mesesAtePrimeiroParto;
  const retornoAnoCab = e.taxaPrenhez * e.valorBezerro;
  const anosParaPagar = retornoAnoCab > 0 ? investimentoCab / retornoAnoCab : null;
  return { investimentoCab, investimentoTotal: investimentoCab * e.novilhas, retornoAnoCab, anosParaPagar, bezerrosAno: Math.round(e.novilhas * e.taxaPrenhez) };
}

export interface EntradaProjecao {
  matrizes: number; novilhas: number; touros: number;
  natalidade: number; mortBezerros: number; mortAdultos: number; descarte: number; retencaoFemeas: number;
  idadePrimeiraCria: 2 | 3; anos?: number;
}
export interface AnoProjecao {
  ano: number; matrizes: number; novilhas: number; bezerros: number;
  vendidosMachos: number; vendidasFemeas: number; descartadas: number; retidas: number;
  rebanho: number; vendidos: number; desfrute: number; tourosNecessarios: number;
}
/**
 * Projeção do rebanho de cria. Cada ano: bezerros desmamados = matrizes × natalidade × (1 − mortalidade);
 * metade machos (vendidos na desmama); das fêmeas, a parte retida vira novilha e pare com a idade da 1ª cria.
 * Desfrute = cabeças vendidas no ano ÷ rebanho no início do ano.
 */
export function projetarRebanho(e: EntradaProjecao): AnoProjecao[] {
  const anos = e.anos ?? 5;
  let matrizes = e.matrizes;
  // novilhas em recria por "anos até virar matriz"; as atuais entram no próximo ano
  const fila: number[] = Array(e.idadePrimeiraCria).fill(0);
  fila[0] = e.novilhas;
  const out: AnoProjecao[] = [];
  for (let ano = 1; ano <= anos; ano++) {
    const entram = fila.shift() ?? 0;
    fila.push(0);
    const novilhas = fila.reduce((a, b) => a + b, 0);
    const rebanho = matrizes + novilhas + e.touros;
    const bezerros = matrizes * e.natalidade * (1 - e.mortBezerros);
    const machos = bezerros / 2, femeas = bezerros / 2;
    const retidas = femeas * e.retencaoFemeas;
    const descartadas = matrizes * e.descarte;
    const mortas = matrizes * e.mortAdultos;
    fila[fila.length - 1] += retidas * (1 - e.mortAdultos);
    const vendidos = machos + (femeas - retidas) + descartadas;
    out.push({
      ano, matrizes: Math.round(matrizes), novilhas: Math.round(novilhas), bezerros: Math.round(bezerros),
      vendidosMachos: Math.round(machos), vendidasFemeas: Math.round(femeas - retidas), descartadas: Math.round(descartadas), retidas: Math.round(retidas),
      rebanho: Math.round(rebanho), vendidos: Math.round(vendidos), desfrute: rebanho ? vendidos / rebanho : 0,
      tourosNecessarios: Math.ceil(matrizes / VACAS_POR_TOURO),
    });
    matrizes = matrizes - descartadas - mortas + entram;
  }
  return out;
}

// ---------- decisões e avisos ----------

export interface DadosCria {
  animais: Animal[]; eventos: EventoReprodutivo[]; pesos: PesoCria[]; desmamas: Desmama[]; estacoes: Estacao[]; hoje: string;
  idadeDesmama?: number;
}

export function tourosAtivos(animais: Animal[]): number {
  return animais.filter((a) => a.categoria === 'touro' && ativoCria(a)).reduce((s, a) => s + cabecas(a), 0);
}

/** Quantos touros a estação precisa. Na IATF com repasse, o touro cobre só as que não pegaram (~50%). */
export function tourosNecessarios(vacas: number, metodo: MetodoMonta | undefined): number {
  if (metodo === 'ia' || metodo === 'iatf') return 0;
  const expostas = metodo === 'ia_repasse' ? vacas * 0.5 : vacas;
  return Math.ceil(expostas / VACAS_POR_TOURO);
}

export interface Decisao { nivel: 'ruim' | 'atencao' | 'bom'; titulo: string; texto: string; ids?: number[] }

/** Sugestões para o produtor decidir: descarte, touros, novilhas, diagnóstico, desmama e partos. */
export function decisoesCria(d: DadosCria): Decisao[] {
  const out: Decisao[] = [];
  const ativos = d.animais.filter(ativoCria);
  const matrizes = ativos.filter((a) => a.categoria === 'matriz');
  const novilhas = ativos.filter((a) => a.categoria === 'novilha');
  const linhas = calcularIpm(matrizes, d.eventos, d.animais, d.desmamas, d.estacoes, d.hoje);
  const descarte = sugestoesDescarte(linhas);
  if (descarte.length) {
    out.push({
      nivel: 'atencao', titulo: `Descartar ${descarte.length} vaca${descarte.length > 1 ? 's' : ''}`,
      texto: descarte.slice(0, 5).map((l) => `${rotuloAnimal(l.matriz)}: ${l.motivos[0]}`).join('; ') + (descarte.length > 5 ? '…' : '.'),
      ids: descarte.map((l) => l.matriz.id!),
    });
  }
  // touros
  const est = estacaoAtualOuProxima(d.estacoes, d.hoje);
  const precisa = tourosNecessarios(matrizes.length + novilhas.length, est?.metodo ?? 'monta');
  const temTouros = tourosAtivos(ativos);
  const vencidos = ativos.filter((a) => a.categoria === 'touro' && saidaPrevista(a) && saidaPrevista(a)! < d.hoje).reduce((s, a) => s + cabecas(a), 0);
  if (precisa > temTouros - vencidos && matrizes.length) {
    const falta = precisa - (temTouros - vencidos);
    out.push({ nivel: 'ruim', titulo: `Comprar ${falta} touro${falta > 1 ? 's' : ''}`, texto: `Para ${matrizes.length + novilhas.length} vacas e novilhas ${est ? `na ${est.nome} (${METODOS_MONTA[est.metodo].toLowerCase()})` : 'em monta natural'} são precisos ${precisa} touros (1 para ${VACAS_POR_TOURO}). Você tem ${temTouros}${vencidos ? `, ${vencidos} já passaram do tempo de permanência` : ''}.` });
  } else if (matrizes.length && temTouros) {
    out.push({ nivel: 'bom', titulo: 'Touros suficientes', texto: `${temTouros} touro(s) para ${matrizes.length + novilhas.length} fêmeas${est ? ` na ${est.nome}` : ''}.` });
  }
  // novilhas de reposição: repor as que saem (descarte sugerido ou taxa de 15%) e as que morrem, com 80% de prenhez
  if (matrizes.length) {
    const saem = Math.max(descarte.length, Math.round(matrizes.length * 0.15)) + Math.round(matrizes.length * 0.02);
    const reter = Math.ceil(saem / 0.8);
    out.push({
      nivel: novilhas.length >= reter ? 'bom' : 'atencao', titulo: `Reter ${reter} novilha${reter > 1 ? 's' : ''} por ano`,
      texto: `Para manter ${matrizes.length} matrizes repondo ~${saem} que saem por ano (descarte e morte), com 80% das novilhas emprenhando. Você tem ${novilhas.length} novilha(s) de reposição.`,
    });
  }
  // diagnóstico de gestação: estação terminou há 45+ dias e a vaca não tem diagnóstico depois do fim
  for (const e of d.estacoes) {
    const desde = diasEntre(e.fim, d.hoje);
    if (desde < 45 || desde > 200) continue;
    const sem = matrizes.concat(novilhas).filter((m) => d.eventos.some((x) => x.matrizId === m.id && (x.tipo === 'monta' || x.tipo === 'ia') && x.data >= e.inicio && x.data <= e.fim)
      && !d.eventos.some((x) => x.matrizId === m.id && x.tipo === 'diagnostico' && x.data >= e.inicio));
    if (sem.length) out.push({ nivel: 'atencao', titulo: `Fazer diagnóstico de gestação em ${sem.length} vaca(s)`, texto: `A ${e.nome} terminou em ${fmtData(e.fim)}. Toque para lançar o resultado.`, ids: sem.map((m) => m.id!) });
  }
  // desmama
  const idade = d.idadeDesmama ?? IDADE_DESMAMA_DIAS;
  const prontos = ativos.filter((a) => a.categoria === 'bezerro' && (idadeDias(a, d.hoje) ?? 0) >= idade - 15);
  if (prontos.length) out.push({ nivel: 'atencao', titulo: `${prontos.length} bezerro(s) na idade de desmamar`, texto: `Já têm ${Math.round(idade / 30.44)} meses ou mais. Pese e faça o pacote da desmama.`, ids: prontos.map((a) => a.id!) });
  // partos nos próximos 30 dias
  const partos = linhas.concat(calcularIpm(novilhas, d.eventos, d.animais, d.desmamas, d.estacoes, d.hoje))
    .filter((l) => l.hist.partoPrevisto && diasEntre(d.hoje, l.hist.partoPrevisto) <= 30 && diasEntre(d.hoje, l.hist.partoPrevisto) >= -15);
  if (partos.length) out.push({ nivel: 'atencao', titulo: `${partos.length} parto(s) previsto(s) em 30 dias`, texto: partos.slice(0, 6).map((l) => `${rotuloAnimal(l.matriz)} (${fmtData(l.hist.partoPrevisto)})`).join(', ') + '. Deixe essas vacas no piquete maternidade.', ids: partos.map((l) => l.matriz.id!) });
  return out;
}

export function estacaoAtualOuProxima(estacoes: Estacao[], hoje: string): Estacao | undefined {
  const ord = [...estacoes].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  return ord.find((e) => e.inicio <= hoje && hoje <= e.fim) ?? ord.find((e) => e.inicio > hoje) ?? ord[ord.length - 1];
}

/** Avisos da Cria para a tela inicial (permanência e decisões que pedem ação). */
export function alertasCria(d: DadosCria): Alerta[] {
  const out: Alerta[] = [];
  for (const a of d.animais) { const x = alertaPermanencia(a, d.hoje); if (x) out.push(x); }
  for (const x of decisoesCria(d)) if (x.nivel !== 'bom') out.push({ nivel: x.nivel, titulo: `Cria: ${x.titulo}`, texto: x.texto });
  return out;
}
