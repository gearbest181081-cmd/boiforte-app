// Geradores de Excel (.xlsx) e PDF sem bibliotecas de terceiros pesadas (só o fflate para o zip).
import { strToU8, zipSync } from 'fflate';

export type Celula = string | number | null | undefined;
export interface Tabela { titulo: string; cabecalho: string[]; linhas: Celula[][]; nota?: string }

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

function planilha(t: Tabela): string {
  const linhas: Celula[][] = [[t.titulo], [], t.cabecalho, ...t.linhas];
  if (t.nota) linhas.push([], [t.nota]);
  const rows = linhas.map((l, r) => {
    const estilo = r === 0 ? ' s="1"' : r === 2 ? ' s="2"' : '';
    const cels = l.map((c, ci) => {
      const ref = `${colunaLetra(ci)}${r + 1}`;
      if (c == null || c === '') return '';
      if (typeof c === 'number') return Number.isFinite(c) ? `<c r="${ref}"${estilo}><v>${+c.toFixed(6)}</v></c>` : '';
      return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${xml(String(c))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cels}</row>`;
  }).join('');
  const ncol = Math.max(1, t.cabecalho.length);
  const cols = Array.from({ length: ncol }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 28 : 16}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

export function gerarXlsx(tabelas: Tabela[]): Uint8Array {
  const usados = new Set<string>();
  const nomes = tabelas.map((t) => nomeAba(t.titulo, usados));
  const arquivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabelas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabelas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${tabelas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>`),
  };
  tabelas.forEach((t, i) => { arquivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(planilha(t)); });
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
const fmtCel = (c: Celula) => (c == null ? '' : typeof c === 'number' ? fmtNumeroCelula(c) : String(c));

export function gerarPdf(titulo: string, subtitulo: string, tabelas: Tabela[]): Uint8Array {
  const W = 595, H = 842, M = 36, rodape = 30;
  const paginas: string[] = [];
  let ops: string[] = [];
  let y = 0;
  const txt = (x: number, yy: number, s: string, tam: number, negrito = false, cor = '0 0 0') =>
    ops.push(`BT ${cor} rg /${negrito ? 'F2' : 'F1'} ${tam} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${pdfTexto(s)}) Tj ET`);
  const novaPagina = () => {
    if (ops.length) paginas.push(ops.join('\n'));
    ops = [];
    y = H - M;
    txt(M, y - 4, 'BoiForte', 9, true, '0.11 0.37 0.13');
    txt(W - M - larguraTexto(subtitulo, 8), y - 4, subtitulo, 8, false, '0.4 0.4 0.4');
    y -= 22;
  };
  const precisa = (h: number) => { if (y - h < M + rodape) novaPagina(); };
  novaPagina();
  txt(M, y - 14, titulo, 16, true);
  y -= 30;

  for (const t of tabelas) {
    const n = Math.max(1, t.cabecalho.length);
    const util = W - 2 * M;
    const tam = n > 7 ? 7.5 : 9;
    const primeira = n === 1 ? util : Math.max(util * 0.26, Math.min(util * 0.4, util / n * 1.6));
    const outras = n === 1 ? 0 : (util - primeira) / (n - 1);
    const largs = Array.from({ length: n }, (_, i) => (i === 0 ? primeira : outras));
    const linhaH = tam + 5;
    const desenhaLinha = (l: Celula[], negrito: boolean, fundo?: string, quebrar = false) => {
      // no cabeçalho o texto quebra em até 2 linhas; nas linhas de dados é cortado com "..."
      const partes = l.slice(0, n).map((c, i) => (quebrar ? quebrarTexto(fmtCel(c), largs[i] - 4, tam) : [cortar(fmtCel(c), largs[i] - 4, tam)]));
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
    txt(M, y - 12, t.titulo, 12, true, '0.11 0.37 0.13');
    y -= 20;
    desenhaLinha(t.cabecalho, true, '0.9 0.93 0.9', true);
    t.linhas.forEach((l, i) => desenhaLinha(l, false, i % 2 ? '0.97 0.97 0.97' : undefined));
    if (t.linhas.length === 0) { precisa(linhaH); txt(M + 2, y - tam, 'Sem dados.', tam, false, '0.4 0.4 0.4'); y -= linhaH; }
    if (t.nota) { precisa(linhaH); txt(M + 2, y - 8, cortar(t.nota, util, 7.5), 7.5, false, '0.4 0.4 0.4'); y -= linhaH; }
    y -= 8;
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
