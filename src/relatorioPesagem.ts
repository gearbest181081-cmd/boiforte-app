// Relatório de pesagem de um lote ou de um animal: evolução do peso, curva de ganho e GMD por período.
// O mesmo conteúdo vai para a tela, o PDF, o Excel (com gráficos de verdade) e o texto do WhatsApp.
// Tudo é calculado no celular, sem internet.
import { arrobas, desvioMeta, diasEntre, fmtData, fmtGmd, fmtKg, fmtNum, fmtPct, gmd, ordenar, periodos, projetar, resumo, type PontoPeso, type Projecao } from './calc';
import { alertasDoLote, type Alerta } from './alertas';
import { pontosDoAnimal, pontosDoLote, type Animal, type Lote, type Pesagem } from './db';
import { dataCel, type Bloco, type BlocoIndicadores, type Celula, type GraficoXlsx, type Tabela } from './exportar';

export interface Indicador { rotulo: string; valor: string; sub?: string; ruim?: boolean }

export interface RelatorioPesagem {
  titulo: string;
  subtitulo: string;
  nomeArquivo: string;
  pontos: PontoPeso[];
  periodos: { ate: string; gmd: number | null }[];
  projecao: Projecao | null;
  indicadores: Indicador[];
  alertas: Alerta[];
  evolucao: Tabela;
  animais: Tabela | null;
  blocosPdf: Bloco[];
  tabelasXlsx: Tabela[];
  resumoTexto: string;
}

export interface DadosRelatorioPesagem {
  lote: Lote;
  pesagens: Pesagem[];
  animais: Animal[];
  nomeFazenda?: string;
  /** Com animalId, o relatório é só deste animal. */
  animalId?: number | null;
  rendimento?: number;
  hoje: string;
}

const r1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const kg0 = (v: number | null | undefined) => fmtKg(v, 0);
const pctAbs = (v: number) => fmtPct(Math.abs(v)).replace('+', '');
const ganhoTxt = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtKg(v, 1)}`);

/** Nome de arquivo sem acento nem espaço (alguns celulares estranham). */
export function nomeArquivo(...partes: string[]): string {
  return partes.join('-').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'relatorio';
}

/** Desempenho de cada animal pesado do lote, do maior para o menor GMD. */
export function desempenhoAnimais(animais: Animal[], pesagens: Pesagem[], gmdMeta?: number | null) {
  return animais
    .map((a) => ({ a, pontos: pontosDoAnimal(pesagens, a.id!) }))
    .filter((x) => x.pontos.length > 0)
    .map(({ a, pontos }) => ({ animal: a, pontos, r: resumo(pontos), desvio: desvioMeta(resumo(pontos).gmdTotal, gmdMeta) }))
    .sort((x, y) => (y.r.gmdTotal ?? -99) - (x.r.gmdTotal ?? -99) || x.animal.brinco.localeCompare(y.animal.brinco, 'pt-BR', { numeric: true }));
}

/**
 * Tabela de evolução: uma linha por pesagem. As colunas mudam um pouco entre lote e animal;
 * por isso a função devolve também onde ficou cada coluna (para os gráficos do Excel).
 */
function tabelaEvolucao(linhas: { data: string; peso: number; cab?: number; obs?: string }[], gmdMeta: number | null | undefined, doLote: boolean) {
  const comMeta = !!(gmdMeta && gmdMeta > 0);
  const cab: string[] = ['Data', 'Dias desde a 1ª pesagem', doLote ? 'Peso médio (kg)' : 'Peso (kg)', 'Ganho no período (kg)', 'Dias no período', 'GMD no período', 'GMD acumulado'];
  if (comMeta) cab.push('Peso pela meta (kg)');
  if (doLote) cab.push('Cab. pesadas', 'Observação');
  const prim = linhas[0];
  const out: Celula[][] = linhas.map((l, i) => {
    const ant = i > 0 ? linhas[i - 1] : null;
    const dias = prim ? diasEntre(prim.data, l.data) : 0;
    const diasPer = ant ? diasEntre(ant.data, l.data) : null;
    const row: Celula[] = [
      dataCel(l.data), dias, r1(l.peso),
      ant ? r1(l.peso - ant.peso) : null, diasPer,
      ant ? r3(gmd(ant, l)) : null,
      i > 0 ? r3(gmd(prim, l)) : null,
    ];
    if (comMeta) row.push(r1(prim.peso + gmdMeta! * dias));
    if (doLote) row.push(l.cab ?? null, l.obs ?? '');
    return row;
  });
  const larguras = [1.25, 0.95, 1, 1, 0.9, 1, 1.05, ...(comMeta ? [1] : []), ...(doLote ? [0.8, 1.8] : [])];
  return {
    tabela: { titulo: 'Evolução do peso', cabecalho: cab, linhas: out, larguras, nota: 'GMD = ganho médio diário, em kg por dia. "Peso pela meta" é quanto pesaria se ganhasse exatamente a meta de GMD desde a 1ª pesagem.' } as Tabela,
    col: { data: 0, peso: 2, gmd: 5, meta: comMeta ? 7 : -1 },
  };
}

export function montarRelatorioPesagem(d: DadosRelatorioPesagem): RelatorioPesagem | null {
  const { lote, pesagens, animais, hoje } = d;
  const animal = d.animalId != null ? animais.find((a) => a.id === d.animalId) ?? null : null;
  if (d.animalId != null && !animal) return null;
  const meta = lote.gmdMeta && lote.gmdMeta > 0 ? lote.gmdMeta : null;
  const fazenda = d.nomeFazenda ? ` - ${d.nomeFazenda}` : '';

  // Linhas de pesagem: no lote, pela pesagem (com cabeças e observação); no animal, pelo peso dele.
  const ordenadas = [...pesagens].sort((a, b) => a.data.localeCompare(b.data) || a.criadoEm - b.criadoEm);
  const linhas = animal
    ? ordenar(pontosDoAnimal(pesagens, animal.id!)).map((p) => ({ data: p.data, peso: p.peso }))
    : ordenadas.map((p) => ({ data: p.data, peso: p.pesoMedio, cab: p.qtdPesada, obs: p.obs }));
  const pontos = animal ? pontosDoAnimal(pesagens, animal.id!) : pontosDoLote(pesagens);
  const r = resumo(pontos);
  const per = periodos(pontos);
  const projecao = lote.pesoAlvo ? projetar(pontos, lote.pesoAlvo, lote.gmdMeta) : null;
  const ultimo = per.length ? per[per.length - 1] : null;
  const ultPesagem = ordenadas[ordenadas.length - 1];
  const gmdRef = r.gmdUltimo ?? r.gmdTotal;
  const desvio = desvioMeta(gmdRef, meta);
  const abaixo = (v: number | null) => v != null && (v < 0 || (meta != null && v < meta * 0.9));

  const quem = animal ? `Animal ${animal.brinco}` : lote.nome;
  const titulo = animal ? `Pesagem do animal ${animal.brinco} (${lote.nome})` : `Pesagem - ${lote.nome}`;
  const subtitulo = `${d.nomeFazenda ? d.nomeFazenda + ' · ' : ''}gerado em ${fmtData(hoje)}`;

  // ---------- indicadores ----------
  const ind: Indicador[] = [];
  if (r.pesoAtual != null) {
    ind.push({
      rotulo: `${animal ? 'Peso' : 'Peso médio'} em ${fmtData(r.dataUltima)}`, valor: kg0(r.pesoAtual),
      sub: animal ? undefined : ultPesagem ? `${ultPesagem.qtdPesada} cab. pesadas` : undefined,
    });
    ind.push({
      rotulo: 'GMD desde a pesagem anterior', valor: fmtGmd(r.gmdUltimo), ruim: abaixo(r.gmdUltimo),
      sub: ultimo ? `${ganhoTxt(ultimo.ganho)} em ${ultimo.dias} dias (desde ${fmtData(ultimo.de.data).slice(0, 5)})` : 'primeira pesagem',
    });
    ind.push({ rotulo: 'GMD desde a 1ª pesagem', valor: fmtGmd(r.gmdTotal), sub: r.diasAcompanhados ? `${r.diasAcompanhados} dias` : undefined, ruim: abaixo(r.gmdTotal) });
    ind.push({ rotulo: 'Ganho total', valor: ganhoTxt(r.ganhoTotal), sub: `de ${kg0(r.pesoInicial)} para ${kg0(r.pesoAtual)}` });
    ind.push({ rotulo: 'Meta de GMD', valor: meta ? fmtGmd(meta) : 'sem meta', sub: desvio != null ? `${pctAbs(desvio)} ${desvio < 0 ? 'abaixo' : 'acima'} (último período)` : undefined, ruim: desvio != null && desvio <= -0.1 });
    const a = arrobas(r.pesoAtual, d.rendimento);
    ind.push({ rotulo: animal ? 'Arrobas' : 'Arrobas por cabeça', valor: `${fmtNum(a, 1)} @`, sub: animal ? 'carcaça' : `${fmtNum(a * lote.qtdCabecas, 0)} @ no lote (${lote.qtdCabecas} cab.)` });
    if (lote.pesoAlvo) {
      ind.push({
        rotulo: `Previsão de ${fmtNum(lote.pesoAlvo, 0)} kg`,
        valor: projecao == null ? '—' : projecao.jaAtingiu ? 'Já atingiu' : fmtData(projecao.dataPrevista),
        sub: projecao && !projecao.jaAtingiu ? `faltam ${projecao.diasFaltando} dias` : undefined,
      });
    }
  }

  // ---------- animais (lote por cabeça) ----------
  const desemp = !animal && lote.controle === 'individual' ? desempenhoAnimais(animais, pesagens, meta) : [];
  if (animal) {
    const todos = desempenhoAnimais(animais, pesagens, meta).filter((x) => x.r.gmdTotal != null);
    const pos = todos.findIndex((x) => x.animal.id === animal.id);
    if (pos >= 0 && todos.length > 1) ind.push({ rotulo: 'Posição no lote (GMD)', valor: `${pos + 1}º de ${todos.length}`, sub: 'do maior para o menor ganho' });
  } else if (desemp.length > 1) {
    const com = desemp.filter((x) => x.r.gmdTotal != null);
    if (com.length > 1) {
      ind.push({ rotulo: 'Melhor animal', valor: `${com[0].animal.brinco}`, sub: fmtGmd(com[0].r.gmdTotal) });
      ind.push({ rotulo: 'Menor ganho', valor: `${com[com.length - 1].animal.brinco}`, sub: fmtGmd(com[com.length - 1].r.gmdTotal), ruim: abaixo(com[com.length - 1].r.gmdTotal) });
    }
  }
  const tabAnimais: Tabela | null = desemp.length ? {
    titulo: 'Animais',
    cabecalho: ['Brinco', 'Peso inicial (kg)', 'Peso atual (kg)', 'Ganho (kg)', 'Dias', 'GMD total (kg/dia)', 'GMD último (kg/dia)', 'Frente à meta (%)'],
    larguras: [1.4, 1, 1, 1, 0.7, 1, 1, 1],
    linhas: desemp.map((x) => [
      x.animal.brinco + (x.animal.ativo ? '' : ' (saiu)'), r1(x.r.pesoInicial), r1(x.r.pesoAtual), r1(x.r.ganhoTotal), x.r.diasAcompanhados,
      r3(x.r.gmdTotal), r3(x.r.gmdUltimo), x.desvio == null ? null : Math.round(x.desvio * 1000) / 10,
    ]),
    nota: `Do maior para o menor GMD. ${meta ? `${desemp.filter((x) => x.desvio != null && x.desvio <= -0.1).length} animal(is) 10% ou mais abaixo da meta.` : ''}`.trim(),
  } : null;

  // ---------- alertas ----------
  const alertas = animal ? alertasDoLote({ nome: quem, pesoAlvo: lote.pesoAlvo, gmdMeta: lote.gmdMeta }, pontos, hoje).filter((a) => !/dias sem pesar/.test(a.titulo))
    : alertasDoLote(lote, pontos, hoje);

  // ---------- tabelas ----------
  const ev = tabelaEvolucao(linhas, meta, !animal);
  const resumoTab: Tabela = {
    titulo: animal ? `Resumo - ${animal.brinco}` : `Resumo - ${lote.nome}`,
    cabecalho: ['Indicador', 'Valor', ''],
    linhas: ind.map((i) => [i.rotulo, i.valor, i.sub ?? '']),
    nota: `${lote.nome}${fazenda}. GMD em kg por dia. Arroba de carcaça com rendimento de ${fmtNum((d.rendimento ?? 0.5) * 100, 0)}%.`,
  };
  const graficos: GraficoXlsx[] = [];
  if (linhas.length) {
    graficos.push({
      tipo: 'linhas', titulo: 'Curva de ganho de peso', dados: 1, x: ev.col.data, eixoY: 'kg', ...(linhas.length > 1 ? { xDe: linhas[0].data, xAte: linhas[linhas.length - 1].data } : {}),
      series: [{ col: ev.col.peso, nome: animal ? 'Peso' : 'Peso médio', cor: '2E7D32' }, ...(ev.col.meta >= 0 ? [{ col: ev.col.meta, nome: 'Pela meta de GMD', cor: '808080', tracejado: true }] : [])],
    });
  }
  if (linhas.length > 1) {
    const menor = Math.min(0, ...per.map((p) => p.gmd ?? 0));
    graficos.push({ tipo: 'colunas', titulo: 'GMD por período (kg/dia)', dados: 1, x: ev.col.data, aPartirDe: 1, eixoY: 'kg/dia', yMin: Math.floor(menor * 10) / 10, series: [{ col: ev.col.gmd, nome: 'GMD do período', cor: '2E7D32' }] });
  }
  resumoTab.graficos = graficos;

  const tabelasXlsx: Tabela[] = [resumoTab, ev.tabela];
  if (tabAnimais) {
    tabelasXlsx.push(tabAnimais);
    // Planilha "um animal por linha, uma pesagem por coluna", boa para quem gosta de mexer no Excel.
    const datas = ordenadas.filter((p) => p.pesos?.length).map((p) => p.data);
    const unicas = [...new Set(datas)];
    if (unicas.length) {
      tabelasXlsx.push({
        titulo: 'Pesos por animal',
        cabecalho: ['Brinco', ...unicas.map((x) => fmtData(x))],
        linhas: desemp.map((x) => [x.animal.brinco, ...unicas.map((dt) => r1(x.pontos.filter((p) => p.data === dt).pop()?.peso))]),
        nota: 'Peso em kg de cada animal em cada pesagem.',
      });
    }
  }

  // ---------- PDF ----------
  const blocoInd: BlocoIndicadores = { tipo: 'indicadores', itens: ind };
  const blocosPdf: Bloco[] = [
    blocoInd,
    ...alertas.map((a): Bloco => ({ tipo: 'texto', titulo: a.titulo, texto: a.texto, nivel: a.nivel })),
    { tipo: 'curva', titulo: 'Curva de ganho de peso', pontos, gmdMeta: meta, pesoAlvo: lote.pesoAlvo, projecao },
    { tipo: 'barras', titulo: 'GMD por período (kg/dia)', periodos: per.map((p) => ({ ate: p.ate.data, gmd: p.gmd })), gmdMeta: meta },
    ev.tabela,
    ...(tabAnimais ? [tabAnimais] : []),
  ];

  // ---------- WhatsApp ----------
  const txt = [
    `*BoiForte${fazenda}*`,
    animal ? `Pesagem do animal *${animal.brinco}* (lote ${lote.nome})` : `Pesagem do lote *${lote.nome}*`,
    r.pesoAtual != null ? `${animal ? 'Peso' : 'Peso médio'} em ${fmtData(r.dataUltima)}: *${kg0(r.pesoAtual)}*${!animal && ultPesagem ? ` (${ultPesagem.qtdPesada} cab.)` : ''}` : 'Ainda sem pesagem.',
    ultimo ? `GMD desde ${fmtData(ultimo.de.data).slice(0, 5)}: *${fmtGmd(ultimo.gmd)}* (${ganhoTxt(ultimo.ganho)} em ${ultimo.dias} dias)` : '',
    meta ? `Meta: ${fmtGmd(meta)}${desvio != null ? ` (${pctAbs(desvio)} ${desvio < 0 ? 'abaixo' : 'acima'})` : ''}` : '',
    r.gmdTotal != null ? `Desde a 1ª pesagem: ${ganhoTxt(r.ganhoTotal)} em ${r.diasAcompanhados} dias (${fmtGmd(r.gmdTotal)})` : '',
    lote.pesoAlvo && projecao ? (projecao.jaAtingiu ? `Já atingiu o peso alvo de ${fmtNum(lote.pesoAlvo, 0)} kg.` : `Previsão de ${fmtNum(lote.pesoAlvo, 0)} kg: ${fmtData(projecao.dataPrevista)}`) : '',
    ...alertas.filter((a) => a.nivel === 'ruim').map((a) => `⚠️ ${a.titulo}`),
  ].filter(Boolean).join('\n');

  return {
    titulo, subtitulo,
    nomeArquivo: nomeArquivo('pesagem', lote.nome, animal ? animal.brinco : '', r.dataUltima ?? hoje),
    pontos, periodos: per.map((p) => ({ ate: p.ate.data, gmd: p.gmd })), projecao,
    indicadores: ind, alertas, evolucao: ev.tabela, animais: tabAnimais,
    blocosPdf, tabelasXlsx, resumoTexto: txt,
  };
}
