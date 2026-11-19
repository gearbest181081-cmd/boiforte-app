import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoiForteDB, usarBanco, db, criarLote, garantirIngredientesPadrao, comprarInsumo, saldoIngrediente, saldoMistura,
  registrarBatida, desfazerBatida, registrarFornecimento, desfazerFornecimento, ajustarEstoque, excluirFormula, excluirIngrediente,
  importarBackup, exportarBackup, lerArquivoBackup, excluirLote,
} from './db';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('t2-' + n++)); });

async function montar(modo: 'direto' | 'batida') {
  await garantirIngredientesPadrao();
  const ings = await db.ingredientes.toArray();
  const id = (p: string) => ings.find((i) => i.nome.startsWith(p))!.id!;
  const milho = id('Milho'), soja = id('Farelo de soja'), nucleo = id('Núcleo TIP');
  const formulaId = await db.formulas.add({ nome: 'RIP', tipo: 'rip', unidade: 'kg', modo, consumoPctPV: 0.007, itens: [{ ingredienteId: milho, qtd: 575 }, { ingredienteId: soja, qtd: 275 }, { ingredienteId: nucleo, qtd: 150 }], criadoEm: 0 });
  const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
  const loteId = await criarLote({ propriedadeId: pid, nome: 'Fêmeas', fase: 'recria', sexo: 'femea', controle: 'lote', qtdCabecas: 40, dataEntrada: '2026-10-01', formulaId }, 250);
  return { milho, soja, nucleo, formulaId, loteId };
}

describe('nutrição e estoque no banco', () => {
  it('coloca os ingredientes padrão só uma vez', async () => {
    await garantirIngredientesPadrao();
    const c = await db.ingredientes.count();
    await db.ingredientes.clear();
    await garantirIngredientesPadrao();
    expect(c).toBeGreaterThan(10);
    expect(await db.ingredientes.count()).toBe(0); // produtor apagou, não volta sozinho
  });

  it('compra atualiza saldo e preço médio', async () => {
    const { milho } = await montar('direto');
    await comprarInsumo(milho, '2026-11-01', 1000, 1000); // R$ 1,00/kg
    await comprarInsumo(milho, '2026-11-02', 1000, 1400); // R$ 1,40/kg
    expect(await saldoIngrediente(milho)).toBe(2000);
    expect((await db.ingredientes.get(milho))!.preco).toBeCloseTo(1.2, 4);
    await expect(comprarInsumo(milho, '2026-11-02', 0, 10)).rejects.toThrow('quantidade');
  });

  it('fornecimento direto desconta os ingredientes e grava o custo', async () => {
    const { milho, soja, loteId } = await montar('direto');
    const fid = await registrarFornecimento({ loteId, data: '2026-11-10', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 250 });
    expect(await saldoIngrediente(milho)).toBeCloseTo(-40.25, 6);
    expect(await saldoIngrediente(soja)).toBeCloseTo(-19.25, 6);
    expect((await db.fornecimentos.get(fid))!.custo).toBeCloseTo(70 * 1.87425, 2);
    await expect(registrarFornecimento({ loteId, data: '2026-11-10', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 250 })).rejects.toThrow('já foi marcado');
    await desfazerFornecimento(fid);
    expect(await saldoIngrediente(milho)).toBeCloseTo(0, 9);
    expect(await db.fornecimentos.count()).toBe(0);
  });

  it('batida tira ingredientes e põe a mistura no estoque; trato tira a mistura', async () => {
    const { milho, formulaId, loteId } = await montar('batida');
    await comprarInsumo(milho, '2026-11-01', 1000, 1200);
    const b = await registrarBatida(formulaId, '2026-11-05', 950);
    expect(await saldoIngrediente(milho)).toBeCloseTo(1000 - 546.25, 6);
    expect(await saldoMistura(formulaId)).toBe(950);
    expect((await db.batidas.get(b))!.custoTotal).toBeCloseTo(950 * 1.87425, 2);
    await registrarFornecimento({ loteId, data: '2026-11-06', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 250 });
    expect(await saldoMistura(formulaId)).toBe(880);
    expect(await saldoIngrediente(milho)).toBeCloseTo(453.75, 6); // trato não mexe nos ingredientes
    await ajustarEstoque({ formulaId }, '2026-11-07', 860);
    expect(await saldoMistura(formulaId)).toBe(860);
    await desfazerBatida(b);
    expect(await saldoIngrediente(milho)).toBe(1000);
  });

  it('não apaga fórmula em uso nem ingrediente usado em fórmula', async () => {
    const { formulaId, milho, loteId } = await montar('direto');
    await expect(excluirFormula(formulaId)).rejects.toThrow('dieta de 1 lote');
    await expect(excluirIngrediente(milho)).rejects.toThrow('fórmula');
    await registrarFornecimento({ loteId, data: '2026-11-10', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 250 });
    await excluirLote(loteId);
    expect(await db.fornecimentos.count()).toBe(0);
    expect(await db.movimentos.count()).toBe(0);
    await excluirFormula(formulaId);
  });

  it('o banco recusa gravação inválida, venha de onde vier', async () => {
    await expect(db.pesagens.add({ loteId: 1, data: '2026-13-01', tipo: 'media', pesoMedio: 300, qtdPesada: 1, criadoEm: 0 })).rejects.toThrow('data');
    const id = await db.propriedades.add({ nome: 'X', criadoEm: 0, ...({ extra: 'lixo' } as any) });
    expect(await db.propriedades.get(id)).toEqual({ id, nome: 'X', criadoEm: 0 });
    await expect(db.propriedades.update(id, { nome: '' })).rejects.toThrow('obrigatório');
  });

  it('cópia com registro adulterado não altera nada', async () => {
    await montar('direto');
    const bk = JSON.parse(JSON.stringify(await exportarBackup()));
    const antes = await db.lotes.count();
    bk.dados.pesagens.push({ loteId: 1, data: '2026-10-01', tipo: 'media', pesoMedio: -5, qtdPesada: 1 });
    await expect(importarBackup(bk)).rejects.toThrow();
    expect(await db.lotes.count()).toBe(antes); // tudo continua como estava
    expect(() => lerArquivoBackup('{oi')).toThrow('não é uma cópia');
    await expect(importarBackup({ app: 'BoiForte', versao: 9, dados: {} })).rejects.toThrow('versão');
  });

  it('cópia completa volta igual', async () => {
    const { milho, loteId } = await montar('direto');
    await comprarInsumo(milho, '2026-11-01', 500, 600);
    await registrarFornecimento({ loteId, data: '2026-11-10', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 250 });
    const bk = JSON.parse(JSON.stringify(await exportarBackup()));
    usarBanco(new BoiForteDB('t2r-' + n++));
    await importarBackup(bk);
    expect(await saldoIngrediente(milho)).toBeCloseTo(500 - 40.25, 6);
    expect(await db.fornecimentos.count()).toBe(1);
  });
});
