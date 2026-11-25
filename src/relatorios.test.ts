import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { BoiForteDB, criarLote, db, usarBanco } from './db';
import { carregarExemplo } from './exemplo';
import { alertasInteligentes, carregarTudo } from './hooks';
import { montarRelatorio, ranking } from './relatorios';
import { analisarLotes } from './hooks';
import { gerarPdf, gerarXlsx, nomeAba } from './exportar';
import { hojeISO } from './calc';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('rel-' + n++)); });

describe('exportar', () => {
  it('Excel: zip com as partes obrigatórias, números como número e texto escapado', () => {
    const x = gerarXlsx([{ titulo: 'Lotes <A&B>', cabecalho: ['Lote', 'GMD'], linhas: [['=HYPERLINK("x")', 0.75], ['Fêmea & cia', null]] }]);
    const z = unzipSync(x);
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    const s = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(s).toContain('<v>0.75</v>');
    expect(s).toContain('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)');
    expect(s).not.toContain('<f>');
    expect(s).toContain('Fêmea &amp; cia');
    expect(strFromU8(z['xl/workbook.xml'])).toContain('name="Lotes &lt;A&amp;B&gt;"');
  });
  it('nome de aba válido', () => {
    const u = new Set<string>();
    expect(nomeAba('a/b:c', u)).toBe('a b c');
    expect(nomeAba('A B C', u)).toBe('A B C 2');
    expect(nomeAba('x'.repeat(40), u)).toHaveLength(31);
  });
  it('PDF: cabeçalho, xref com posições certas e várias páginas', () => {
    const linhas = Array.from({ length: 120 }, (_, i) => [`Lote (${i})`, i * 1.5, 'R$ 1.000,00']);
    const b = gerarPdf('Relatório — teste', 'Gerado hoje', [{ titulo: 'Tabela', cabecalho: ['Lote', 'Valor', 'Texto'], linhas }]);
    const s = Array.from(b, (c) => String.fromCharCode(c)).join('');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const ents = s.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
    ents.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(Number(/\/Count (\d+)/.exec(s)![1])).toBeGreaterThan(1);
    expect(s).toContain('Lote \\(0\\)');
    // cada /Length bate com o tamanho do stream
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const ini = m.index! + m[0].length;
      expect(s.slice(ini + Number(m[1]), ini + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });
});

describe('relatório com o exemplo', () => {
  it('monta as tabelas, o ranking e o resumo para o WhatsApp', async () => {
    await carregarExemplo();
    const t = await carregarTudo();
    const hoje = hojeISO();
    const rel = montarRelatorio(t, { de: '2026-01-01', ate: hoje, criterio: 'gmd', incluirEncerrados: false, nomeFazenda: 'Fazenda Exemplo' }, hoje);
    expect(rel.tabelas.map((x) => x.titulo)).toEqual(['Desempenho dos lotes', 'Resultado por lote', 'Ranking (Maior GMD)', expect.stringMatching(/^DRE de/), 'Fluxo de caixa']);
    expect(rel.tabelas[0].linhas).toHaveLength(2);
    const dre = rel.tabelas[3].linhas;
    expect(dre.find((l) => l[0] === 'Compra de animais')?.[1]).toBeLessThan(0);
    expect(rel.resumoTexto).toContain('Fazenda Exemplo');
    const an = analisarLotes(t, hoje);
    const r = ranking(an, 'custoArroba');
    const v = r.map((a) => a.dre.custoArrobaProduzida).filter((x) => x != null) as number[];
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    // os arquivos saem sem erro
    expect(gerarPdf(rel.titulo, rel.subtitulo, rel.tabelas).length).toBeGreaterThan(1000);
    expect(gerarXlsx(rel.tabelas).length).toBeGreaterThan(1000);
  });
  it('alertas do exemplo: vacina agendada, sem alarme falso de custo em lote novo', async () => {
    await carregarExemplo();
    const al = alertasInteligentes(await carregarTudo());
    expect(al.some((a) => /Vacina/.test(a.titulo))).toBe(true);
    expect(al.find((a) => /Vacina/.test(a.titulo))?.para, 'vacina marcada leva para a Sanidade').toBe('/sanidade');
    // lotes novos (menos de 45 dias no fim do mês passado) não disparam o aviso de custo da @
    expect(al.some((a) => /custo da @ subiu/.test(a.titulo))).toBe(false);
  });
  it('avisa quando o custo da @ sobe 5% ou mais no mês', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const id = await criarLote({ propriedadeId: pid, nome: 'Lote 6', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-07-01' }, 200);
    await db.pesagens.bulkAdd([
      { loteId: id, data: '2026-08-30', tipo: 'media', pesoMedio: 245, qtdPesada: 30, criadoEm: 0 },
      { loteId: id, data: '2026-10-29', tipo: 'media', pesoMedio: 290, qtdPesada: 30, criadoEm: 0 },
    ]);
    await db.lancamentos.bulkAdd([
      { data: '2026-07-10', tipo: 'despesa', categoria: 'sanidade', valor: 3000, loteId: id, origem: 'manual', criadoEm: 0 },
      { data: '2026-11-05', tipo: 'despesa', categoria: 'sanidade', valor: 3000, loteId: id, origem: 'manual', criadoEm: 0 },
    ]);
    const al = alertasInteligentes(await carregarTudo(), '2026-11-19');
    const a = al.find((x) => /Lote 6: custo da @ subiu/.test(x.titulo));
    expect(a).toBeTruthy();
    expect(a!.nivel).toBe('atencao');
    expect(a!.para, 'leva para o dinheiro do lote').toBe(`/lotes/${id}?aba=dinheiro`);
  });
});
