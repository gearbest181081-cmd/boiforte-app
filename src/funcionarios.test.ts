import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, exportarBackup, importarBackup } from './db';
import { carregarTudo, analisarLotes } from './hooks';
import { PCT_13_FERIAS } from './pages/Funcionarios';

let n = 0;
beforeEach(() => { usarBanco(new BoiForteDB('func-' + n++)); });
const joao = { nome: 'João', funcao: 'Vaqueiro', salario: 2400, encargos: 800, admissao: '2026-09-01', criadoEm: 0 };

describe('cadastro de funcionários no celular', () => {
  it('grava, ganha gid e vai para a fila da nuvem', async () => {
    const id = await db.funcionarios.add({ ...joao, nome: '  João \u0007' });
    const f = await db.funcionarios.get(id);
    expect(f).toMatchObject({ nome: 'João', salario: 2400, gid: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await db.pendentes.toArray()).toEqual([expect.objectContaining({ tabela: 'funcionarios', chave: id, op: 'put' })]);
  });

  it('confere os campos como o servidor', async () => {
    await expect(db.funcionarios.add({ ...joao, nome: '' })).rejects.toThrow(/obrigatório/);
    await expect(db.funcionarios.add({ ...joao, funcao: '' })).rejects.toThrow(/obrigatório/);
    await expect(db.funcionarios.add({ ...joao, salario: -1 })).rejects.toThrow(/fora do limite/);
    await expect(db.funcionarios.add({ ...joao, admissao: '2026-13-01' })).rejects.toThrow(/inválida/);
  });

  it('desligar a conta do app apaga o campo', async () => {
    const id = await db.funcionarios.add({ ...joao, usuarioId: '00000000-0000-4000-8000-000000000001' });
    await db.funcionarios.update(id, { usuarioId: null });
    expect((await db.funcionarios.get(id))!.usuarioId).toBeUndefined();
  });

  it('entra na cópia de segurança; cópia antiga (sem funcionários) continua abrindo', async () => {
    await db.funcionarios.add(joao);
    const bk = await exportarBackup();
    expect((bk.dados as Record<string, unknown[]>).funcionarios).toHaveLength(1);
    await importarBackup(bk);
    expect(await db.funcionarios.count()).toBe(1);
    const antiga = { ...bk, dados: { ...bk.dados } as Record<string, unknown> };
    delete antiga.dados.funcionarios;
    await importarBackup(antiga);
    expect(await db.funcionarios.count()).toBe(0);
  });

  it('o salário entra no custo do lote (custo da @ produzida)', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const loteId = await db.lotes.add({ propriedadeId: pid, nome: 'L', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-10-01', criadoEm: 0 });
    await db.pesagens.bulkAdd([
      { loteId, data: '2026-10-01', tipo: 'media', pesoMedio: 200, qtdPesada: 30, criadoEm: 0 },
      { loteId, data: '2026-10-31', tipo: 'media', pesoMedio: 230, qtdPesada: 30, criadoEm: 0 },
    ]);
    const antes = analisarLotes(await carregarTudo(), '2026-10-31')[0].dre;
    await db.funcionarios.add({ ...joao, admissao: '2026-10-01' });
    const depois = analisarLotes(await carregarTudo(), '2026-10-31')[0].dre;
    expect(depois.custos.folha).toBeCloseTo(3200 * 12 / 365 * 31, 4); // único lote: leva a folha toda
    expect(depois.custoArrobaProduzida! - (antes.custoArrobaProduzida ?? 0)).toBeCloseTo(depois.custos.folha / depois.arrobasProduzidas, 6);
  });

  it('13º e férias somam 19,44% do salário por mês', () => {
    expect(PCT_13_FERIAS).toBeCloseTo(0.19444, 4);
  });
});
