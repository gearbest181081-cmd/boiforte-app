import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, criarLote, registrarCompraLote, registrarSaida, desfazerSaida, salvarEventoSanitario, concluirEventoSanitario, excluirEventoSanitario, garantirLembretesPadrao, excluirLote, exportarBackup, importarBackup } from './db';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('t3-' + n++)); });
async function lote(qtd = 30) {
  const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
  return criarLote({ propriedadeId: pid, nome: 'Macho 1º lote', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: qtd, dataEntrada: '2026-09-28' }, 200);
}

describe('financeiro no banco', () => {
  it('compra do lote com a fórmula da planilha, sem duplicar ao refazer', async () => {
    const id = await lote();
    await registrarCompraLote(id, { data: '2026-09-28', precoCab: 3260, comissaoPct: 0.02, frete: 850, nfGta: 0 });
    await registrarCompraLote(id, { data: '2026-09-28', precoCab: 3260, comissaoPct: 0.02, frete: 850, nfGta: 0 });
    const l = await db.lancamentos.toArray();
    expect(l).toHaveLength(1);
    expect(l[0].valor).toBe(100606);
  });
  it('venda parcial, venda total encerra o lote, desfazer reabre', async () => {
    const id = await lote();
    await registrarSaida(id, { data: '2026-12-01', tipo: 'morte', cabecas: 1 });
    expect((await db.lotes.get(id))!.qtdCabecas).toBe(29);
    await expect(registrarSaida(id, { data: '2026-12-02', tipo: 'venda', cabecas: 30, modo: 'cabeca', preco: 4000 })).rejects.toThrow('só tem 29');
    const v = await registrarSaida(id, { data: '2027-01-15', tipo: 'venda', cabecas: 29, modo: 'arroba', pesoMedio: 360, rendimento: 0.5, preco: 320, comissaoPct: 0.02, frete: 200 });
    const lt = await db.lotes.get(id);
    expect(lt!.encerrado).toBe(true);
    expect(lt!.dataSaida).toBe('2027-01-15');
    expect((await db.vendas.get(v))!.valorLiquido).toBeCloseTo(29 * 12 * 320 * 0.98 - 200, 2);
    await desfazerSaida(v);
    expect((await db.lotes.get(id))!.encerrado).toBe(false);
    expect((await db.lotes.get(id))!.qtdCabecas).toBe(29);
  });
  it('venda exige preço e peso quando por arroba', async () => {
    const id = await lote();
    await expect(registrarSaida(id, { data: '2026-12-01', tipo: 'venda', cabecas: 1, modo: 'arroba', preco: 320 })).rejects.toThrow('peso médio');
    await expect(registrarSaida(id, { data: '2026-12-01', tipo: 'venda', cabecas: 1, modo: 'cabeca' })).rejects.toThrow('preço');
  });
});

describe('sanidade no banco', () => {
  it('aplicação feita vira despesa; agendada não; concluir agenda a próxima', async () => {
    const id = await lote();
    const ag = await salvarEventoSanitario({ loteId: id, data: '2026-11-20', feito: false, tipo: 'vermifugo', produto: 'Ivermectina', custo: 300, carenciaDias: 35, repetirDias: 90 });
    expect(await db.lancamentos.count()).toBe(0);
    await concluirEventoSanitario(ag, '2026-11-21');
    const ls = await db.lancamentos.toArray();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ categoria: 'sanidade', valor: 300, loteId: id });
    const prox = await db.sanidade.where('feito').equals(0 as any).toArray().catch(() => []);
    const todos = await db.sanidade.toArray();
    expect(todos.filter((e) => !e.feito).map((e) => e.data)).toEqual(['2027-02-19']);
    expect(prox).toBeDefined();
    await excluirEventoSanitario(ag);
    expect(await db.lancamentos.count()).toBe(0);
  });
  it('lembretes padrão uma vez só', async () => {
    await garantirLembretesPadrao();
    await garantirLembretesPadrao();
    expect(await db.lembretes.count()).toBe(3);
  });
  it('apagar o lote apaga financeiro e sanidade dele; cópia inclui as tabelas novas', async () => {
    const id = await lote();
    await registrarCompraLote(id, { data: '2026-09-28', precoCab: 3000, comissaoPct: 0, frete: 0, nfGta: 0 });
    await salvarEventoSanitario({ loteId: id, data: '2026-10-01', feito: true, tipo: 'vacina', produto: 'Clostridiose', custo: 100 });
    const bk = JSON.parse(JSON.stringify(await exportarBackup()));
    expect(bk.dados.lancamentos).toHaveLength(2);
    await excluirLote(id);
    expect(await db.lancamentos.count()).toBe(0);
    expect(await db.sanidade.count()).toBe(0);
    await importarBackup(bk);
    expect(await db.lancamentos.count()).toBe(2);
  });
});
