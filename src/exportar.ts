// Geradores de Excel (.xlsx) e PDF sem bibliotecas de terceiros pesadas (só o fflate para o zip).
import { strToU8, zipSync } from 'fflate';
import { diaNum, fmtData, fmtNum, type PontoPeso, type Projecao } from './calc';
import { escalaCurva, escalaGmd } from './curva';

/** Data numa célula: no Excel vira data de verdade (dá para ordenar e filtrar); no PDF, dd/mm/aaaa. */
export interface DataCelula { data: string }
export type Celula = string | number | null | undefined | DataCelula;
export const dataCel = (iso: string): DataCelula => ({ data: iso });

/** Gráfico nativo do Excel, montado com as colunas de uma das tabelas do arquivo. */
export interface GraficoXlsx {
  tipo: 'linhas' | 'colunas';
  titulo: string;
  /** Índice (na lista passada ao gerarXlsx) da tabela de onde vêm os dados. */
  dados: number;
  /** Coluna (0 = A) do eixo de baixo: as datas. */
  x: number;
  /** Primeira linha de dados usada (0 = primeira); o resto vai até o fim da tabela. */
  aPartirDe?: number;
  /** Em "colunas", a série com comoLinha vira uma linha por cima das barras (ex.: a meta). */
  series: { col: number; nome: string; cor: string; tracejado?: boolean; comoLinha?: boolean }[];
  eixoY: string;
  yMin?: number; yMax?: number;
  /** Só nas linhas: começo e fim do eixo das datas (AAAA-MM-DD). */
  xDe?: string; xAte?: string;
}
export interface Tabela {
  tipo?: 'tabela'; titulo: string; cabecalho: string[]; linhas: Celula[][]; nota?: string;
  /** Gráficos do Excel que ficam nesta aba, abaixo da tabela. */
  graficos?: GraficoXlsx[];
  /** Largura de cada coluna no PDF, em proporção (ex.: [2, 1, 1]). Sem isso, a primeira é mais larga. */
  larguras?: number[];
}

/** Quadros com números grandes (só no PDF). */
export interface BlocoIndicadores { tipo: 'indicadores'; titulo?: string; itens: { rotulo: string; valor: string; sub?: string; ruim?: boolean }[] }
/** Curva de peso: real, meta de GMD, peso alvo e projeção (só no PDF). */
export interface BlocoCurva { tipo: 'curva'; titulo: string; pontos: PontoPeso[]; gmdMeta?: number | null; pesoAlvo?: number | null; projecao?: Projecao | null }
/** GMD de cada período em barras (só no PDF). */
export interface BlocoBarras { tipo: 'barras'; titulo: string; periodos: { ate: string; gmd: number | null }[]; gmdMeta?: number | null }
/** Parágrafo de aviso (só no PDF). */
export interface BlocoTexto { tipo: 'texto'; titulo?: string; texto: string; nivel?: 'ruim' | 'atencao' | 'bom' }
export type Bloco = Tabela | BlocoIndicadores | BlocoCurva | BlocoBarras | BlocoTexto;
const ehTabela = (b: Bloco): b is Tabela => !b.tipo || b.tipo === 'tabela';

// ---------- Excel ----------

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colunaLetra(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ e sem repetir. */
export function nomeAba(nome: string, usados: Set<string>): string {
  const base = (nome.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Planilha').slice(0, 31);
  let n = base, k = 2;
  while (usados.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
  usados.add(n.toLowerCase());
  return n;
}

// Observação de segurança: todo texto vai como "inlineStr", que o Excel nunca interpreta como fórmula,
// então um nome de lote como "=HYPERLINK(...)" aparece como texto e não executa nada.

/** Número de série do Excel para a data (dias desde 30/12/1899). */
export const serialExcel = (iso: string) => diaNum(iso) + 25569;
const ehData = (c: Celula): c is DataCelula => typeof c === 'object' && c != null && typeof (c as DataCelula).data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test((c as DataCelula).data);

/** Linhas usadas pela tabela na planilha (título, linha vazia, cabeçalho, dados, nota). */
const linhasDaPlanilha = (t: Tabela) => 3 + t.linhas.length + (t.nota ? 2 : 0);

function planilha(t: Tabela, comDesenho: boolean): string {
  const linhas: Celula[][] = [[t.titulo], [], t.cabecalho, ...t.linhas];
  if (t.nota) linhas.push([], [t.nota]);
  const rows = linhas.map((l, r) => {
    const estilo = r === 0 ? ' s="1"' : r === 2 ? ' s="2"' : '';
    const cels = l.map((c, ci) => {
      const ref = `${colunaLetra(ci)}${r + 1}`;
      if (c == null || c === '') return '';
      if (ehData(c)) return `<c r="${ref}" s="3"><v>${serialExcel(c.data)}</v></c>`;
      if (typeof c === 'object') return '';
      if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}"${estilo}><v>${+c.toFixed(6)}</v></c>` : '';
      return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${xml(String(c))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cels}</row>`;
  }).join('');
  const ncol = Math.max(1, t.cabecalho.length);
  const cols = Array.from({ length: ncol }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 28 : 16}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols>${cols}</cols><sheetData>${rows}</sheetData>${comDesenho ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

const NS_C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const cor = (hex: string) => hex.replace(/[^0-9a-f]/gi, '').slice(0, 6).padEnd(6, '0').toUpperCase();
const textoRico = (s: string, tam: number, negrito: boolean) =>
  `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${tam}" b="${negrito ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="${tam}" b="${negrito ? 1 : 0}"/><a:t>${xml(s)}</a:t></a:r></a:p></c:rich></c:tx>`;
const tituloEixo = (s: string) => `<c:title>${textoRico(s, 900, false)}<c:overlay val="0"/></c:title>`;
const linhaSerie = (c: string, tracejado?: boolean, larg = 28575) =>
  `<c:spPr><a:ln w="${larg}" cap="rnd"><a:solidFill><a:srgbClr val="${cor(c)}"/></a:solidFill>${tracejado ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr>`;

/** XML de um gráfico (linhas = dispersão com datas de verdade no eixo; colunas = barras por período). */
function graficoXml(g: GraficoXlsx, aba: string, t: Tabela): string {
  const ini = 4 + (g.aPartirDe ?? 0), fim = 3 + t.linhas.length;
  const ref = (col: number) => `'${aba.replace(/'/g, "''")}'!$${colunaLetra(col)}$${ini}:$${colunaLetra(col)}$${fim}`;
  const escala = `<c:scaling><c:orientation val="minMax"/>${g.yMax != null ? `<c:max val="${g.yMax}"/>` : ''}${g.yMin != null ? `<c:min val="${g.yMin}"/>` : ''}</c:scaling>`;
  const eixoValor = (id: number, cruza: number, pos: 'l' | 'b', titulo: string, formato: string, grade: boolean, esc = '<c:scaling><c:orientation val="minMax"/></c:scaling>') =>
    `<c:valAx><c:axId val="${id}"/>${esc}<c:delete val="0"/><c:axPos val="${pos}"/>${grade ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}${titulo ? tituloEixo(titulo) : ''}<c:numFmt formatCode="${xml(formato)}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="${cruza}"/><c:crosses val="autoZero"/><c:crossBetween val="${pos === 'b' ? 'midCat' : 'between'}"/></c:valAx>`;
  let corpo: string;
  if (g.tipo === 'linhas') {
    const series = g.series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.nome)}</c:v></c:tx>${linhaSerie(s.cor, s.tracejado, s.tracejado ? 19050 : 31750)}<c:marker>${s.tracejado ? '<c:symbol val="none"/>' : `<c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${cor(s.cor)}"/></a:solidFill></a:ln></c:spPr>`}</c:marker><c:xVal><c:numRef><c:f>${xml(ref(g.x))}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${xml(ref(s.col))}</c:f></c:numRef></c:yVal><c:smooth val="0"/></c:ser>`).join('');
    corpo = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:axId val="501"/><c:axId val="502"/></c:scatterChart>`
      + eixoValor(501, 502, 'b', 'Data', 'dd/mm/yy', false, `<c:scaling><c:orientation val="minMax"/>${g.xAte ? `<c:max val="${serialExcel(g.xAte)}"/>` : ''}${g.xDe ? `<c:min val="${serialExcel(g.xDe)}"/>` : ''}</c:scaling>`)
      + eixoValor(502, 501, 'l', g.eixoY, '#,##0', true, escala);
  } else {
    const cat = `<c:cat><c:numRef><c:f>${xml(ref(g.x))}</c:f></c:numRef></c:cat>`;
    const barras = g.series.filter((s) => !s.comoLinha), linhas = g.series.filter((s) => s.comoLinha);
    const ser = (s: GraficoXlsx['series'][number], i: number, extra: string) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.nome)}</c:v></c:tx>${extra}${cat}<c:val><c:numRef><c:f>${xml(ref(s.col))}</c:f></c:numRef></c:val>`;
    corpo = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${barras.map((s, i) => ser(s, i, `<c:spPr><a:solidFill><a:srgbClr val="${cor(s.cor)}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>`) + '</c:ser>').join('')}<c:gapWidth val="60"/><c:axId val="601"/><c:axId val="602"/></c:barChart>`
      + (linhas.length ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${linhas.map((s, i) => ser(s, barras.length + i, linhaSerie(s.cor, s.tracejado, 19050) + '<c:marker><c:symbol val="none"/></c:marker>') + '<c:smooth val="0"/></c:ser>').join('')}<c:marker val="1"/><c:axId val="601"/><c:axId val="602"/></c:lineChart>` : '')
      + `<c:catAx><c:axId val="601"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="dd/mm/yy" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:crossAx val="602"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
      + eixoValor(602, 601, 'l', g.eixoY, '0.000', true, escala);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${NS_C}><c:roundedCorners val="0"/><c:chart><c:title>${textoRico(g.titulo, 1200, true)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${corpo}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

/** Desenho que segura os gráficos da aba, um embaixo do outro, logo abaixo da tabela. */
function desenhoXml(qtd: number, linhaInicial: number): string {
  const ALTURA = 18, LARGURA = 5;
  const ancoras = Array.from({ length: qtd }, (_, i) => {
    const r0 = linhaInicial + i * (ALTURA + 1);
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${LARGURA}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0 + ALTURA}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Grafico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${ancoras}</xdr:wsDr>`;
}

export function gerarXlsx(tabelas: Tabela[]): Uint8Array {
  const usados = new Set<string>();
  const nomes = tabelas.map((t) => nomeAba(t.titulo, usados));
  // Gráficos só com dados que existem (tabela de origem válida e com linhas suficientes).
  const graficos = tabelas.map((t) => (t.graficos ?? []).filter((g) => tabelas[g.dados] && tabelas[g.dados].linhas.length > (g.aPartirDe ?? 0)));
  const extras: string[] = [];
  let nGrafico = 0;
  const arquivosGraficos: Record<string, Uint8Array> = {};
  graficos.forEach((gs, i) => {
    if (!gs.length) return;
    const d = i + 1;
    arquivosGraficos[`xl/worksheets/_rels/sheet${d}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`);
    arquivosGraficos[`xl/drawings/drawing${d}.xml`] = strToU8(desenhoXml(gs.length, linhasDaPlanilha(tabelas[i]) + 1));
    extras.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const rels: string[] = [];
    gs.forEach((g, k) => {
      const n = ++nGrafico;
      arquivosGraficos[`xl/charts/chart${n}.xml`] = strToU8(graficoXml(g, nomes[g.dados], tabelas[g.dados]));
      extras.push(`<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      rels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>`);
    });
    arquivosGraficos[`xl/drawings/_rels/drawing${d}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  });
  const arquivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabelas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${extras.join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabelas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tabelas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    ...arquivosGraficos,
  };
  tabelas.forEach((t, i) => { arquivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(planilha(t, graficos[i].length > 0)); });
  return zipSync(arquivos, { level: 6 });
}

// ---------- PDF ----------

// Larguras da Helvetica (1/1000 do tamanho da fonte) para os caracteres mais comuns; o resto usa a média.
const LARG: Record<string, number> = { ' ': 278, ',': 278, '.': 278, '/': 278, ':': 278, '-': 333, '(': 333, ')': 333, '%': 889, '@': 1015, $: 556, R: 722, i: 222, l: 222, j: 222, f: 278, t: 278, r: 333, m: 833, w: 722, M: 833, W: 944, I: 278 };
const larguraTexto = (s: string, tam: number) => [...s].reduce((t, c) => t + (LARG[c] ?? (c >= '0' && c <= '9' ? 556 : c === c.toUpperCase() && c !== c.toLowerCase() ? 667 : 520)), 0) * tam / 1000;

/** Converte para os bytes da WinAnsi (Latin-1 cobre os acentos do português). */
function paraWinAnsi(s: string): string {
  return s.replace(/[  ]/g, ' ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/›/g, '>')
    .replace(/[^ -~¡-ÿ]/g, '?');
}
const pdfTexto = (s: string) => paraWinAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function cortar(s: string, larg: number, tam: number): string {
  if (larguraTexto(s, tam) <= larg) return s;
  while (s.length > 1 && larguraTexto(s + '...', tam) > larg) s = s.slice(0, -1);
  return s + '...';
}

function quebrarTexto(s: string, larg: number, tam: number): string[] {
  if (larguraTexto(s, tam) <= larg) return [s];
  const pal = s.split(' ');
  let a = '';
  let i = 0;
  for (; i < pal.length; i++) {
    const t = a ? `${a} ${pal[i]}` : pal[i];
    if (a && larguraTexto(t, tam) > larg) break;
    a = t;
  }
  const resto = pal.slice(i).join(' ');
  return resto ? [cortar(a, larg, tam), cortar(resto, larg, tam)] : [cortar(a, larg, tam)];
}

/** Número no jeito brasileiro: inteiro sem casas, quebrado com 2 ou 3 casas (0,716 kg/dia; 1.874,50). */
export const fmtNumeroCelula = (v: number) => (Number.isInteger(v) ? v.toLocaleString('pt-BR') : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }));
/** Texto da célula como aparece na tela e no PDF. */
export const fmtCelula = (c: Celula): string => (c == null ? '' : typeof c === 'number' ? fmtNumeroCelula(c) : typeof c === 'object' ? (ehData(c) ? fmtData(c.data) : '') : String(c));

/** Quebra um parágrafo em quantas linhas precisar. */
function quebrarLinhas(s: string, larg: number, tam: number): string[] {
  const out: string[] = [];
  let a = '';
  for (const p of s.split(/\s+/).filter(Boolean)) {
    const t = a ? `${a} ${p}` : p;
    if (a && larguraTexto(t, tam) > larg) { out.push(a); a = p; } else a = t;
  }
  if (a) out.push(a);
  return out.map((l) => cortar(l, larg, tam));
}

// Cores do PDF (RGB de 0 a 1), as mesmas da tela.
const COR = { verde: '0.18 0.49 0.2', verdeTitulo: '0.11 0.37 0.13', vermelho: '0.78 0.16 0.16', ouro: '0.72 0.53 0.04', cinza: '0.4 0.4 0.4', grade: '0.86 0.86 0.86', fundo: '0.95 0.97 0.95', aviso: '0.6 0.4 0', avisoFundo: '1 0.96 0.86', ruimFundo: '1 0.92 0.92', bomFundo: '0.91 0.96 0.91' };

export function gerarPdf(titulo: string, subtitulo: string, blocos: Bloco[]): Uint8Array {
  const W = 595, H = 842, M = 36, rodape = 30;
  const util = W - 2 * M;
  const paginas: string[] = [];
  let ops: string[] = [];
  let y = 0;
  const txt = (x: number, yy: number, s: string, tam: number, negrito = false, cor = '0 0 0') =>
    ops.push(`BT ${cor} rg /${negrito ? 'F2' : 'F1'} ${tam} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${pdfTexto(s)}) Tj ET`);
  const txtDir = (x: number, yy: number, s: string, tam: number, negrito = false, cor = '0 0 0') => txt(x - larguraTexto(s, tam), yy, s, tam, negrito, cor);
  const txtMeio = (x: number, yy: number, s: string, tam: number, negrito = false, cor = '0 0 0') => txt(x - larguraTexto(s, tam) / 2, yy, s, tam, negrito, cor);
  const linha = (x1: number, y1: number, x2: number, y2: number, cor: string, larg = 1, traco = '') =>
    ops.push(`q ${cor} RG ${larg} w ${traco ? `[${traco}] 0 d ` : ''}1 J ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
  const caminho = (pts: [number, number][], cor: string, larg: number) =>
    ops.push(`q ${cor} RG ${larg} w 1 j 1 J ${pts.map(([px, py], i) => `${px.toFixed(2)} ${py.toFixed(2)} ${i ? 'l' : 'm'}`).join(' ')} S Q`);
  const retangulo = (x: number, yy: number, w: number, h: number, cor: string) => ops.push(`${cor} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  const circulo = (cx: number, cy: number, r: number, borda: string) => {
    const k = r * 0.5523;
    ops.push(`q 1 1 1 rg ${borda} RG 1.6 w ${(cx + r).toFixed(2)} ${cy.toFixed(2)} m ${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c ${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c ${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c ${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c B Q`);
  };
  const novaPagina = () => {
    if (ops.length) paginas.push(ops.join('\n'));
    ops = [];
    y = H - M;
    txt(M, y - 4, 'BoiForte', 9, true, COR.verdeTitulo);
    txt(W - M - larguraTexto(subtitulo, 8), y - 4, subtitulo, 8, false, '0.4 0.4 0.4');
    y -= 22;
  };
  const precisa = (h: number) => { if (y - h < M + rodape) novaPagina(); };
  const tituloBloco = (s: string) => { txt(M, y - 12, s, 12, true, COR.verdeTitulo); y -= 20; };
  const legenda = (itens: { cor: string; texto: string; traco?: string }[]) => {
    let x = M + 4;
    for (const it of itens) {
      linha(x, y - 4, x + 16, y - 4, it.cor, 2.5, it.traco);
      txt(x + 20, y - 7, it.texto, 8, false, COR.cinza);
      x += 30 + larguraTexto(it.texto, 8);
    }
    y -= 14;
  };
  novaPagina();
  txt(M, y - 14, titulo, 16, true);
  y -= 30;

  const desenharTabela = (t: Tabela) => {
    const n = Math.max(1, t.cabecalho.length);
    const tam = n > 7 ? 7.5 : 9;
    const primeira = n === 1 ? util : Math.max(util * 0.26, Math.min(util * 0.4, util / n * 1.6));
    const outras = n === 1 ? 0 : (util - primeira) / (n - 1);
    const pesos = t.larguras?.length === n && t.larguras.every((v) => v > 0) ? t.larguras : null;
    const somaPesos = pesos ? pesos.reduce((a, b) => a + b, 0) : 1;
    const largs = Array.from({ length: n }, (_, i) => (pesos ? (util * pesos[i]) / somaPesos : i === 0 ? primeira : outras));
    const linhaH = tam + 5;
    const desenhaLinha = (l: Celula[], negrito: boolean, fundo?: string, quebrar = false) => {
      // no cabeçalho o texto quebra em até 2 linhas; nas linhas de dados é cortado com "..."
      const partes = l.slice(0, n).map((c, i) => (quebrar ? quebrarTexto(fmtCelula(c), largs[i] - 4, tam) : [cortar(fmtCelula(c), largs[i] - 4, tam)]));
      const nl = Math.max(1, ...partes.map((p) => p.length));
      const h = linhaH + (nl - 1) * (tam + 1);
      precisa(h);
      if (fundo) ops.push(`${fundo} rg ${M} ${(y - h + 3).toFixed(2)} ${util} ${h} re f`);
      let x = M;
      partes.forEach((ps, i) => {
        ps.forEach((s, k) => txt(i > 0 ? x + largs[i] - 2 - larguraTexto(s, tam) : x + 2, y - tam - k * (tam + 1), s, tam, negrito));
        x += largs[i];
      });
      y -= h;
    };
    precisa(18 + linhaH * 3);
    y -= 6;
    tituloBloco(t.titulo);
    desenhaLinha(t.cabecalho, true, '0.9 0.93 0.9', true);
    t.linhas.forEach((l, i) => desenhaLinha(l, false, i % 2 ? '0.97 0.97 0.97' : undefined));
    if (t.linhas.length === 0) { precisa(linhaH); txt(M + 2, y - tam, 'Sem dados.', tam, false, '0.4 0.4 0.4'); y -= linhaH; }
    if (t.nota) {
      for (const l of quebrarLinhas(t.nota, util - 4, 7.5)) { precisa(linhaH); txt(M + 2, y - 8, l, 7.5, false, '0.4 0.4 0.4'); y -= 10; }
      y -= 3;
    }
    y -= 8;
  };

  const desenharIndicadores = (b: BlocoIndicadores) => {
    const col = 3, gap = 6, lw = (util - gap * (col - 1)) / col, h = 44;
    if (b.titulo) { precisa(20 + h); y -= 6; tituloBloco(b.titulo); }
    for (let i = 0; i < b.itens.length; i += col) {
      precisa(h + gap);
      b.itens.slice(i, i + col).forEach((it, k) => {
        const x = M + k * (lw + gap);
        retangulo(x, y - h, lw, h, it.ruim ? COR.ruimFundo : COR.fundo);
        txt(x + 7, y - 12, cortar(it.rotulo, lw - 14, 8), 8, false, COR.cinza);
        txt(x + 7, y - 28, cortar(it.valor, lw - 14, 13), 13, true, it.ruim ? COR.vermelho : '0 0 0');
        if (it.sub) txt(x + 7, y - 39, cortar(it.sub, lw - 14, 7), 7, false, COR.cinza);
      });
      y -= h + gap;
    }
    y -= 6;
  };

  const desenharCurva = (b: BlocoCurva) => {
    const e = escalaCurva(b.pontos, b);
    const h = 210;
    precisa(20 + h + 18);
    y -= 6;
    tituloBloco(b.titulo);
    if (!e) { txt(M + 2, y - 9, 'Sem pesagens ainda.', 9, false, COR.cinza); y -= 16; return; }
    const m = { e: 40, d: 10, t: 12, b: 22 };
    const topo = y, base = y - h;
    const sx = (d: number) => M + m.e + ((d - e.x0) / (e.xFim - e.x0)) * (util - m.e - m.d);
    const sy = (p: number) => base + m.b + ((p - e.yMin) / (e.yMax - e.yMin)) * (h - m.t - m.b);
    for (const v of e.ys) {
      linha(M + m.e, sy(v), M + util - m.d, sy(v), COR.grade, 0.6);
      txtDir(M + m.e - 5, sy(v) - 3, fmtNum(v, 0), 8, false, COR.cinza);
    }
    txt(M + m.e - 30, topo - 4, 'kg', 8, false, COR.cinza);
    // datas no eixo de baixo: as das pesagens quando cabem, senão a primeira e a última
    const ult = b.pontos[b.pontos.length - 1];
    const datas = b.pontos.map((p) => p.data);
    if (e.proj) datas.push(e.proj.dataPrevista);
    const xs = datas.map((d) => sx(diaNum(d)));
    const xUlt = xs[xs.length - 1];
    let ultimoX = -1e9;
    datas.forEach((d, i) => {
      const ultima = i === datas.length - 1;
      if (!(i === 0 || ultima || (xs[i] - ultimoX >= 44 && xUlt - xs[i] >= 44))) return;
      const f = fmtData(d);
      txtMeio(Math.min(Math.max(xs[i], M + m.e + 18), M + util - 22), base + 8, f.slice(0, 6) + f.slice(-2), 7.5, false, COR.cinza);
      ultimoX = xs[i];
    });
    if (b.pesoAlvo) {
      linha(M + m.e, sy(b.pesoAlvo), M + util - m.d, sy(b.pesoAlvo), COR.ouro, 1.2, '2 3');
      txt(M + m.e + 4, sy(b.pesoAlvo) + 4, `alvo ${fmtNum(b.pesoAlvo, 0)} kg`, 8, true, COR.ouro);
    }
    if (e.meta) linha(sx(e.meta.x1), sy(e.meta.y1), sx(e.meta.x2), sy(e.meta.y2), COR.cinza, 1.2, '5 3');
    if (e.proj && b.pesoAlvo) linha(sx(diaNum(ult.data)), sy(ult.peso), sx(diaNum(e.proj.dataPrevista)), sy(b.pesoAlvo), COR.verde, 1.8, '4 4');
    caminho(b.pontos.map((p) => [sx(diaNum(p.data)), sy(p.peso)]), COR.verde, 2.4);
    b.pontos.forEach((p) => circulo(sx(diaNum(p.data)), sy(p.peso), 3.2, COR.verde));
    if (b.pontos.length <= 14) b.pontos.forEach((p) => txtMeio(sx(diaNum(p.data)), sy(p.peso) + 7, fmtNum(p.peso, 0), 7.5, true));
    y = base;
    legenda([
      { cor: COR.verde, texto: 'Peso real' },
      ...(e.proj ? [{ cor: COR.verde, texto: 'Projeção', traco: '4 4' }] : []),
      ...(e.meta ? [{ cor: COR.cinza, texto: 'Pela meta de GMD', traco: '5 3' }] : []),
      ...(b.pesoAlvo ? [{ cor: COR.ouro, texto: 'Peso alvo', traco: '2 3' }] : []),
    ]);
    y -= 6;
  };

  const desenharBarras = (b: BlocoBarras) => {
    const ps = b.periodos.filter((p) => p.gmd != null) as { ate: string; gmd: number }[];
    const h = 170;
    precisa(20 + h + 18);
    y -= 6;
    tituloBloco(b.titulo);
    if (!ps.length) { txt(M + 2, y - 9, 'O ganho por período aparece a partir da segunda pesagem.', 9, false, COR.cinza); y -= 16; return; }
    const meta = b.gmdMeta && b.gmdMeta > 0 ? b.gmdMeta : null;
    const { min, max, ys } = escalaGmd(ps.map((p) => p.gmd), meta);
    const m = { e: 40, d: 10, t: 14, b: 20 };
    const base = y - h;
    const sy = (v: number) => base + m.b + ((v - min) / (max - min)) * (h - m.t - m.b);
    for (const v of ys) {
      linha(M + m.e, sy(v), M + util - m.d, sy(v), v === 0 ? COR.cinza : COR.grade, v === 0 ? 0.8 : 0.6);
      txtDir(M + m.e - 5, sy(v) - 3, fmtNum(v, 2), 8, false, COR.cinza);
    }
    txt(M + m.e - 34, y - 4, 'kg/dia', 8, false, COR.cinza);
    const larg = (util - m.e - m.d) / ps.length;
    const barra = Math.min(40, larg * 0.62);
    ps.forEach((p, i) => {
      const cx = M + m.e + larg * i + larg / 2;
      const ruim = meta != null && p.gmd < meta * 0.9;
      const y1 = sy(Math.min(0, p.gmd)), y2 = sy(Math.max(0, p.gmd));
      retangulo(cx - barra / 2, y1, barra, Math.max(0.8, y2 - y1), ruim ? COR.vermelho : COR.verde);
      if (ps.length <= 16) txtMeio(cx, p.gmd >= 0 ? y2 + 3 : y1 - 9, p.gmd.toFixed(3).replace('.', ','), 7.5, true);
      if (ps.length <= 12 || i === 0 || i === ps.length - 1) txtMeio(cx, base + 7, fmtData(p.ate).slice(0, 5), 7.5, false, COR.cinza);
    });
    if (meta != null) {
      linha(M + m.e, sy(meta), M + util - m.d, sy(meta), COR.cinza, 1.2, '5 3');
      txtDir(M + util - m.d, sy(meta) + 3, `meta ${meta.toFixed(3).replace('.', ',')}`, 7.5, true, COR.cinza);
    }
    y = base;
    legenda([{ cor: COR.verde, texto: 'GMD do período' }, ...(meta != null ? [{ cor: COR.vermelho, texto: 'Mais de 10% abaixo da meta' }] : [])]);
    y -= 6;
  };

  const desenharTexto = (b: BlocoTexto) => {
    const tam = 9.5;
    const linhas = quebrarLinhas(b.texto, util - 20, tam);
    const h = 12 + linhas.length * (tam + 3) + (b.titulo ? 14 : 0);
    precisa(h + 6);
    const fundo = b.nivel === 'ruim' ? COR.ruimFundo : b.nivel === 'atencao' ? COR.avisoFundo : b.nivel === 'bom' ? COR.bomFundo : COR.fundo;
    const cor = b.nivel === 'ruim' ? COR.vermelho : b.nivel === 'atencao' ? COR.aviso : b.nivel === 'bom' ? COR.verdeTitulo : '0 0 0';
    retangulo(M, y - h, util, h, fundo);
    let yy = y - 6;
    if (b.titulo) { txt(M + 10, yy - 10, b.titulo, 10.5, true, cor); yy -= 14; }
    for (const l of linhas) { txt(M + 10, yy - tam, l, tam, false, cor); yy -= tam + 3; }
    y -= h + 8;
  };

  for (const b of blocos) {
    if (ehTabela(b)) desenharTabela(b);
    else if (b.tipo === 'indicadores') desenharIndicadores(b);
    else if (b.tipo === 'curva') desenharCurva(b);
    else if (b.tipo === 'barras') desenharBarras(b);
    else if (b.tipo === 'texto') desenharTexto(b);
  }
  paginas.push(ops.join('\n'));

  // Monta os objetos: 1 catálogo, 2 páginas, 3 e 4 fontes, depois (página, conteúdo) para cada página.
  const objs: string[] = [];
  const kids = paginas.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  paginas.forEach((conteudo, i) => {
    const num = `${i + 1} / ${paginas.length}`;
    const c = `${conteudo}\nBT 0.4 0.4 0.4 rg /F1 8 Tf ${(W - M - larguraTexto(num, 8)).toFixed(2)} ${M - 10} Td (${num}) Tj ET`;
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`;
  });
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

// ---------- Compartilhar ----------

/** Compartilha o arquivo (WhatsApp, e-mail…) quando o celular deixa; senão baixa. Devolve como foi. */
export async function compartilharArquivo(bytes: Uint8Array, nome: string, tipo: string, titulo: string): Promise<'compartilhado' | 'baixado' | 'cancelado'> {
  const blob = new Blob([bytes as BlobPart], { type: tipo });
  const file = new File([blob], nome, { type: tipo });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: titulo }); return 'compartilhado'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelado'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'baixado';
}

export const linkWhatsApp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;
