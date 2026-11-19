// Monta as tabelas dos relatórios (as mesmas vão para a tela, o PDF e o Excel).
import { analisarLotes, type AnaliseLote, type Tudo } from './hooks';
import { drePeriodo, fluxoCaixa, mesNome, NOMES_CATEGORIA } from './financeiro';
import { FASES } from './db';
import { fmtData, hojeISO } from './calc';
import type { Tabela } from './exportar';

export type Criterio = 'gmd' | 'custoArroba' | 'margem' | 'resultado';
export const CRITERIOS: Record<Criterio, string> = { gmd: 'Maior GMD', custoArroba: 'Menor custo da @', margem: 'Maior margem', resultado: 'Maior lucro' };

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const gmdDe = (a: AnaliseLote) => a.info.resumo.gmdTotal;

export function tabelaDesempenho(an: AnaliseLote[]): Tabela {
  return {
    titulo: 'Desempenho dos lotes',
    cabecalho: ['Lote', 'Fase', 'Cab.', 'Peso entrada (kg)', 'Peso atual (kg)', 'GMD (kg/dia)', 'Meta GMD', 'Dias', '@ produzidas', 'Saída prevista'],
    linhas: an.map((a) => [
      a.info.lote.nome + (a.info.lote.encerrado ? ' (encerrado)' : ''), FASES[a.info.lote.fase], a.dre.cabecasAtuais, r2(a.dre.pesoEntrada), r2(a.dre.pesoAtual),
      r3(gmdDe(a)), r3(a.info.lote.gmdMeta), a.dre.dias, r2(a.dre.arrobasProduzidas), a.info.projecao && !a.info.lote.encerrado ? fmtData(a.info.projecao.dataPrevista) : '',
    ]),
    nota: 'Peso atual estimado pela última pesagem e o GMD. @ = peso x rendimento de carcaça / 15.',
  };
}

export function tabelaFinanceiroLotes(an: AnaliseLote[]): Tabela {
  return {
    titulo: 'Resultado por lote',
    cabecalho: ['Lote', 'Custos (R$)', 'Custo do dinheiro (R$)', 'Vendas (R$)', 'Rebanho hoje (R$)', 'Resultado (R$)', 'Margem (%)', 'Custo @ prod. (R$)', 'Custo/cab (R$)'],
    linhas: an.map((a) => [
      a.info.lote.nome, r2(a.dre.custoTotal), r2(a.dre.oportunidade), r2(a.dre.receitas), r2(a.dre.valorRebanho), r2(a.dre.resultado),
      a.dre.margemCusto == null ? null : r2(a.dre.margemCusto * 100), r2(a.dre.custoArrobaProduzida), r2(a.dre.custoCabeca),
    ]),
    nota: 'Resultado = vendas + valor do rebanho que ainda está na fazenda - custos - custo do dinheiro parado.',
  };
}

export function ranking(an: AnaliseLote[], c: Criterio): AnaliseLote[] {
  const val = (a: AnaliseLote): number | null =>
    c === 'gmd' ? gmdDe(a) : c === 'custoArroba' ? a.dre.custoArrobaProduzida : c === 'margem' ? a.dre.margemCusto : a.dre.resultado;
  const com = an.filter((a) => val(a) != null);
  const sem = an.filter((a) => val(a) == null);
  com.sort((a, b) => (c === 'custoArroba' ? val(a)! - val(b)! : val(b)! - val(a)!));
  return [...com, ...sem];
}

export function tabelaRanking(an: AnaliseLote[], c: Criterio): Tabela {
  return {
    titulo: `Ranking (${CRITERIOS[c]})`,
    cabecalho: ['Lote', 'Posição', 'GMD (kg/dia)', 'Custo @ prod. (R$)', 'Margem (%)', 'Resultado (R$)'],
    linhas: ranking(an, c).map((a, i) => [a.info.lote.nome, i + 1, r3(gmdDe(a)), r2(a.dre.custoArrobaProduzida), a.dre.margemCusto == null ? null : r2(a.dre.margemCusto * 100), r2(a.dre.resultado)]),
  };
}

export function tabelasPeriodo(t: Tudo, de: string, ate: string): Tabela[] {
  const dre = drePeriodo(de, ate, t.lancamentos, t.vendas, t.fornecimentos, t.custosFixos);
  const compras = t.movimentos.filter((m) => m.origem === 'compra' && m.valor).map((m) => ({ data: m.data, valor: m.valor! }));
  const todos = fluxoCaixa(de, ate, t.lancamentos, t.vendas, compras, t.custosFixos);
  // meses vazios do começo do período não ajudam a ler o caixa
  const primeiro = todos.findIndex((m) => m.entradas || m.saidas);
  const fluxo = primeiro < 0 ? [] : todos.slice(primeiro);
  const linhas: (string | number | null)[][] = [];
  for (const [k, v] of Object.entries(dre.receitas)) linhas.push([NOMES_CATEGORIA[k] ?? k, r2(v)]);
  linhas.push(['Total de receitas', r2(dre.totalReceitas)]);
  for (const [k, v] of Object.entries(dre.despesas)) linhas.push([NOMES_CATEGORIA[k] ?? k, r2(-v)]);
  linhas.push(['Total de despesas', r2(-dre.totalDespesas)], ['Resultado do período', r2(dre.resultado)]);
  return [
    { titulo: `DRE de ${fmtData(de)} a ${fmtData(ate)}`, cabecalho: ['Conta', 'Valor (R$)'], linhas, nota: 'Regime de competência: o trato entra quando é fornecido, não quando o insumo é comprado.' },
    { titulo: 'Fluxo de caixa', cabecalho: ['Mês', 'Entradas (R$)', 'Saídas (R$)', 'Saldo do mês (R$)', 'Acumulado (R$)'], linhas: fluxo.map((m) => [mesNome(m.mes), r2(m.entradas), r2(m.saidas), r2(m.saldo), r2(m.acumulado)]) },
  ];
}

export interface Relatorio { titulo: string; subtitulo: string; tabelas: Tabela[]; resumoTexto: string }

export function montarRelatorio(t: Tudo, opc: { de: string; ate: string; criterio: Criterio; incluirEncerrados: boolean; nomeFazenda?: string }, hoje = hojeISO()): Relatorio {
  const an = analisarLotes(t, hoje).filter((a) => opc.incluirEncerrados || !a.info.lote.encerrado);
  const tabelas = [tabelaDesempenho(an), tabelaFinanceiroLotes(an), tabelaRanking(an, opc.criterio), ...tabelasPeriodo(t, opc.de, opc.ate)];
  const cab = an.reduce((s, a) => s + a.dre.cabecasAtuais, 0);
  const res = an.reduce((s, a) => s + a.dre.resultado, 0);
  const top = ranking(an, opc.criterio)[0];
  const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
  const resumoTexto = [
    `*BoiForte${opc.nomeFazenda ? ` - ${opc.nomeFazenda}` : ''}*`,
    `Relatório de ${fmtData(hoje)}`,
    `${an.length} lote(s), ${cab} cabeça(s).`,
    `Resultado estimado dos lotes: ${moeda(res)}.`,
    top ? `${CRITERIOS[opc.criterio]}: ${top.info.lote.nome}.` : '',
  ].filter(Boolean).join('\n');
  return { titulo: opc.nomeFazenda ? `Relatório - ${opc.nomeFazenda}` : 'Relatório da fazenda', subtitulo: `Gerado em ${fmtData(hoje)}`, tabelas, resumoTexto };
}
