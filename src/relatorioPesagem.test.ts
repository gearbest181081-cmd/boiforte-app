import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Animal, Lote, Pesagem } from './db';
import { montarRelatorioPesagem, nomeArquivo } from './relatorioPesagem';
import { gerarPdf, gerarXlsx, serialExcel } from './exportar';

const lote: Lote = { id: 1, propriedadeId: 1, nome: 'Lote 5', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01', pesoAlvo: 450, gmdMeta: 0.9, criadoEm: 0 };
const pes: Pesagem[] = [
  { id: 1, loteId: 1, data: '2026-09-01', tipo: 'media', pesoMedio: 300, qtdPesada: 30, obs: 'Entrada', criadoEm: 1 },
  { id: 2, loteId: 1, data: '2026-10-01', tipo: 'media', pesoMedio: 324, qtdPesada: 30, criadoEm: 2 },
  { id: 3, loteId: 1, data: '2026-10-31', tipo: 'media', pesoMedio: 347.3, qtdPesada: 3, obs: 'média de 3 animais', criadoEm: 3 },
];

describe('relatório de pesagem do lote', () => {
  const r = montarRelatorioPesagem({ lote, pesagens: pes, animais: [], nomeFazenda: 'Fazenda Boa Vista', hoje: '2026-10-31' })!;
  it('evolução com GMD por período e acumulado', () => {
    expect(r.evolucao.cabecalho).toEqual(['Data', 'Dias desde a 1ª pesagem', 'Peso médio (kg)', 'Ganho no período (kg)', 'Dias no período', 'GMD no período', 'GMD acumulado', 'Peso pela meta (kg)', 'Cab. pesadas', 'Observação']);
    expect(r.evolucao.linhas[0]).toEqual([{ data: '2026-09-01' }, 0, 300, null, null, null, null, 300, 30, 'Entrada']);
    expect(r.evolucao.linhas[1]).toEqual([{ data: '2026-10-01' }, 30, 324, 24, 30, 0.8, 0.8, 327, 30, '']);
    expect(r.evolucao.linhas[2].slice(0, 8)).toEqual([{ data: '2026-10-31' }, 60, 347.3, 23.3, 30, 0.777, 0.788, 354]);
    expect(r.periodos.map((p) => p.gmd?.toFixed(3))).toEqual(['0.800', '0.777']);
  });
  it('indicadores, alerta da meta e texto do WhatsApp', () => {
    const ind = Object.fromEntries(r.indicadores.map((i) => [i.rotulo, i]));
    expect(ind['Peso médio em 31/10/2026'].valor).toBe('347 kg');
    expect(ind['GMD desde a pesagem anterior']).toMatchObject({ valor: '0,777 kg/dia', ruim: true });
    expect(ind['Meta de GMD'].sub).toBe('14% abaixo (último período)');
    expect(ind['Previsão de 450 kg'].valor).toBe('13/03/2027'); // (450 - 347,3) / 0,777 = 133 dias
    expect(r.alertas.some((a) => a.nivel === 'ruim' && /abaixo do GMD projetado/.test(a.titulo))).toBe(true);
    expect(r.resumoTexto).toContain('*BoiForte - Fazenda Boa Vista*');
    expect(r.resumoTexto).toContain('Pesagem do lote *Lote 5*');
    expect(r.resumoTexto).toContain('GMD desde 01/10: *0,777 kg/dia* (+23,3 kg em 30 dias)');
    expect(r.resumoTexto).toContain('Previsão de 450 kg: 13/03/2027');
    expect(r.nomeArquivo).toBe('pesagem-lote-5-2026-10-31');
  });
  it('Excel: datas de verdade e dois gráficos nativos na aba Resumo', () => {
    const z = unzipSync(gerarXlsx(r.tabelasXlsx));
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['xl/drawings/drawing1.xml', 'xl/charts/chart1.xml', 'xl/charts/chart2.xml', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/drawings/_rels/drawing1.xml.rels']));
    expect(strFromU8(z['xl/worksheets/sheet1.xml'])).toContain('<drawing r:id="rId1"/>');
    expect(strFromU8(z['xl/worksheets/sheet2.xml'])).not.toContain('<drawing');
    expect(strFromU8(z['xl/worksheets/sheet2.xml'])).toContain(`<c r="A4" s="3"><v>${serialExcel('2026-09-01')}</v></c>`);
    expect(serialExcel('2026-09-01')).toBe(46266);
    const c1 = strFromU8(z['xl/charts/chart1.xml']);
    expect(c1).toContain('<c:scatterChart>');
    expect(c1).toContain("<c:f>'Evolução do peso'!$A$4:$A$6</c:f>");
    expect(c1).toContain("<c:f>'Evolução do peso'!$C$4:$C$6</c:f>");
    expect(c1).toContain("<c:f>'Evolução do peso'!$H$4:$H$6</c:f>");
    const c2 = strFromU8(z['xl/charts/chart2.xml']);
    expect(c2).toContain('<c:barChart>');
    expect(c2).toContain("<c:f>'Evolução do peso'!$F$5:$F$6</c:f>");
    const tipos = strFromU8(z['[Content_Types].xml']);
    expect(tipos).toContain('/xl/charts/chart2.xml');
    expect(tipos).toContain('/xl/drawings/drawing1.xml');
    expect(strFromU8(z['xl/styles.xml'])).toContain('formatCode="dd/mm/yyyy"');
  });
  it('PDF com curva, barras e tabelas', () => {
    const b = gerarPdf(r.titulo, r.subtitulo, r.blocosPdf);
    const s = Array.from(b, (c) => String.fromCharCode(c)).join('');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('(Curva de ganho de peso) Tj');
    expect(s).toContain('(GMD por per\xedodo \\(kg/dia\\)) Tj');
    expect(s).toContain('(Evolu\xe7\xe3o do peso) Tj');
    expect(s).toContain('(0,777) Tj');
    expect(s).toMatch(/ c B Q/); // pontos da curva
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const ini = m.index! + m[0].length;
      expect(s.slice(ini + Number(m[1]), ini + Number(m[1]) + 10)).toBe('\nendstream');
    }
    if (process.env.SALVAR_RELATORIO) {
      mkdirSync('e2e/screens', { recursive: true });
      writeFileSync('e2e/screens/pesagem-lote.pdf', b);
      writeFileSync('e2e/screens/pesagem-lote.xlsx', gerarXlsx(r.tabelasXlsx));
    }
  });
});

describe('relatório de pesagem de lote de Cria', () => {
  it('sem previsão nem peso alvo, mesmo com um peso alvo guardado de antes', () => {
    const r = montarRelatorioPesagem({ lote: { ...lote, nome: 'Bezerros', fase: 'cria', pesoAlvo: 450 }, pesagens: pes, animais: [], hoje: '2026-10-31' })!;
    expect(r.projecao).toBeNull();
    expect(r.indicadores.map((i) => i.rotulo).join(' | ')).not.toMatch(/Previsão/);
    expect(r.alertas.map((a) => a.titulo).join(' | ')).not.toMatch(/peso alvo/);
    expect(r.resumoTexto).not.toMatch(/Previsão|peso alvo/);
    expect(r.blocosPdf.find((b) => b.tipo === 'curva')).toMatchObject({ pesoAlvo: null, projecao: null });
    expect(r.indicadores.find((i) => i.rotulo === 'Meta de GMD')?.valor).toBe('0,900 kg/dia'); // o GMD esperado continua
  });
});

describe('relatório de pesagem por cabeça', () => {
  const ind: Lote = { ...lote, id: 2, nome: 'Novilhas', controle: 'individual', qtdCabecas: 3, gmdMeta: 0.6, pesoAlvo: null };
  const animais: Animal[] = [
    { id: 11, loteId: 2, brinco: 'A1', ativo: true, criadoEm: 0 },
    { id: 12, loteId: 2, brinco: 'A2', ativo: true, criadoEm: 0 },
    { id: 13, loteId: 2, brinco: 'A3', ativo: false, criadoEm: 0 },
  ];
  const pesagens: Pesagem[] = [
    { id: 21, loteId: 2, data: '2026-10-01', tipo: 'individual', pesoMedio: 205, qtdPesada: 2, pesos: [{ animalId: 11, peso: 200 }, { animalId: 12, peso: 210 }], criadoEm: 1 },
    { id: 22, loteId: 2, data: '2026-10-31', tipo: 'individual', pesoMedio: 223, qtdPesada: 2, pesos: [{ animalId: 11, peso: 221 }, { animalId: 12, peso: 225 }], criadoEm: 2 },
  ];
  it('lote: tabela dos animais do melhor para o pior e planilha de pesos', () => {
    const r = montarRelatorioPesagem({ lote: ind, pesagens, animais, hoje: '2026-10-31' })!;
    expect(r.animais!.linhas.map((l) => l[0])).toEqual(['A1', 'A2']);
    expect(r.animais!.linhas[0].slice(5, 8)).toEqual([0.7, 0.7, 16.7]);
    expect(r.animais!.linhas[1].slice(5, 8)).toEqual([0.5, 0.5, -16.7]);
    expect(r.animais!.nota).toContain('1 animal(is) 10% ou mais abaixo da meta');
    expect(r.indicadores.find((i) => i.rotulo === 'Melhor animal')?.valor).toBe('A1');
    const matriz = r.tabelasXlsx.find((t) => t.titulo === 'Pesos por animal')!;
    expect(matriz.cabecalho).toEqual(['Brinco', '01/10/2026', '31/10/2026']);
    expect(matriz.linhas).toEqual([['A1', 200, 221], ['A2', 210, 225]]);
    expect(gerarXlsx(r.tabelasXlsx).length).toBeGreaterThan(2000);
  });
  it('animal: curva própria, posição no lote e arquivo com o brinco', () => {
    const r = montarRelatorioPesagem({ lote: ind, pesagens, animais, animalId: 12, nomeFazenda: 'São José', hoje: '2026-10-31' })!;
    expect(r.titulo).toBe('Pesagem do animal A2 (Novilhas)');
    expect(r.pontos).toEqual([{ data: '2026-10-01', peso: 210 }, { data: '2026-10-31', peso: 225 }]);
    expect(r.indicadores.find((i) => i.rotulo === 'Posição no lote (GMD)')?.valor).toBe('2º de 2');
    expect(r.evolucao.cabecalho).not.toContain('Cab. pesadas');
    expect(r.resumoTexto).toContain('Pesagem do animal *A2* (lote Novilhas)');
    expect(r.nomeArquivo).toBe('pesagem-novilhas-a2-2026-10-31');
    expect(r.animais).toBeNull();
    expect(montarRelatorioPesagem({ lote: ind, pesagens, animais, animalId: 99, hoje: '2026-10-31' })).toBeNull();
  });
  it('nome de arquivo sem acento', () => {
    expect(nomeArquivo('pesagem', 'Bezerras da Água', '2026-01-01')).toBe('pesagem-bezerras-da-agua-2026-01-01');
  });
  it('sem pesagem ainda: relatório vazio mas válido', () => {
    const r = montarRelatorioPesagem({ lote, pesagens: [], animais: [], hoje: '2026-10-31' })!;
    expect(r.indicadores).toEqual([]);
    expect(r.resumoTexto).toContain('Ainda sem pesagem.');
    expect(gerarPdf(r.titulo, r.subtitulo, r.blocosPdf).length).toBeGreaterThan(500);
    expect(unzipSync(gerarXlsx(r.tabelasXlsx))['xl/charts/chart1.xml']).toBeUndefined();
  });
});
