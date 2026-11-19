import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { BoiForteDB, usarBanco, db, criarLote, semAnotar, registrarCompraLote } from '../db';

let n = 0;
beforeEach(() => { usarBanco(new BoiForteDB('pend-' + n++)); });
const pend = () => db.pendentes.toArray();

describe('anotação das alterações para a nuvem', () => {
  it('cada registro ganha um gid e cada gravação vira pendente', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const p = await db.propriedades.get(pid);
    expect(p!.gid).toMatch(/^[0-9a-f]{8}-/);
    expect(await pend()).toEqual([expect.objectContaining({ tabela: 'propriedades', chave: pid, op: 'put' })]);
    await db.propriedades.update(pid, { nome: 'G' });
    expect((await pend())).toHaveLength(1); // a mesma linha, atualizada
    await db.config.put({ chave: 'precoArroba', valor: 330 });
    expect((await pend()).some((x) => x.tabela === 'config' && x.chave === 'precoArroba')).toBe(true);
  });

  it('apagar guarda o gid do registro (para apagar na nuvem também)', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const lote = await criarLote({ propriedadeId: pid, nome: 'L', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 10, dataEntrada: '2026-09-01' }, 200);
    const pes = await db.pesagens.where('loteId').equals(lote).first();
    await db.pesagens.where('loteId').equals(lote).delete(); // apagar por consulta (deleteRange/where)
    const p = (await pend()).find((x) => x.tabela === 'pesagens')!;
    expect(p.op).toBe('del');
    expect(p.gid).toBe(pes!.gid);
    await db.propriedades.clear(); // clear também anota
    expect((await pend()).find((x) => x.tabela === 'propriedades')!.op).toBe('del');
  });

  it('transação desfeita não deixa pendente', async () => {
    await expect(db.transaction('rw', db.propriedades, async () => {
      await db.propriedades.add({ nome: 'F', criadoEm: 0 });
      throw new Error('falhou');
    })).rejects.toThrow('falhou');
    expect(await pend()).toEqual([]);
    expect(await db.propriedades.count()).toBe(0);
  });

  it('semAnotar grava sem marcar para envio', async () => {
    await semAnotar(['propriedades'], async () => { await db.propriedades.add({ nome: 'F', criadoEm: 0 }); });
    expect(await pend()).toEqual([]);
    // e não vaza para a próxima transação
    await db.propriedades.add({ nome: 'G', criadoEm: 0 });
    expect(await pend()).toHaveLength(1);
  });

  it('compra do lote guarda os números para o servidor refazer a conta', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const lote = await criarLote({ propriedadeId: pid, nome: 'L', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01' }, 200);
    await registrarCompraLote(lote, { data: '2026-09-01', precoCab: 3260, comissaoPct: 0.02, frete: 850, nfGta: 0 });
    const l = await db.lancamentos.toCollection().first();
    expect(l).toMatchObject({ compraQtd: 30, compraPreco: 3260, compraComissao: 0.02, compraFrete: 850, compraNf: 0 });
  });

  it('atualização da versão 3 dá gid para os registros que já existiam', async () => {
    const nome = 'v3-' + n++;
    const velho = new Dexie(nome);
    velho.version(3).stores({ propriedades: '++id, nome', modulos: '++id, propriedadeId', piquetes: '++id, moduloId', lotes: '++id, propriedadeId, piqueteId, encerrado, formulaId', animais: '++id, loteId, brinco', pesagens: '++id, loteId, data', ingredientes: '++id, nome', formulas: '++id, tipo', movimentos: '++id, ingredienteId, formulaId, data, [origem+refId]', batidas: '++id, formulaId, data', fornecimentos: '++id, loteId, data, [loteId+data], formulaId', config: 'chave', lancamentos: '++id, data, loteId, categoria, [origem+refId]', custosFixos: '++id', vendas: '++id, loteId, data', sanidade: '++id, loteId, data, feito', lembretes: '++id' });
    await velho.table('propriedades').bulkAdd([{ nome: 'A', criadoEm: 0 }, { nome: 'B', criadoEm: 0 }]);
    velho.close();
    const novo = new BoiForteDB(nome);
    const ps = await novo.propriedades.toArray();
    expect(ps.every((p) => /^[0-9a-f-]{36}$/.test(p.gid!))).toBe(true);
    expect(new Set(ps.map((p) => p.gid)).size).toBe(2);
    expect(await novo.pendentes.count()).toBe(0); // dados antigos só sobem quando ligar a nuvem
  });
});
