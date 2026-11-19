import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, criarLote, registrarPesagemIndividual, pontosDoLote, pontosDoAnimal, exportarBackup, importarBackup, excluirPropriedade } from './db';
import { resumo } from './calc';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('teste-' + n++)); });

async function base() {
  const propriedadeId = await db.propriedades.add({ nome: 'Fazenda Teste', criadoEm: 0 });
  return propriedadeId;
}

describe('banco local', () => {
  it('cria lote com pesagem de entrada', async () => {
    const pid = await base();
    const id = await criarLote({ propriedadeId: pid, nome: 'Macho 1º lote', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-28', pesoAlvo: 360, gmdMeta: 0.75 }, 200);
    const pes = await db.pesagens.where('loteId').equals(id).toArray();
    expect(pes).toHaveLength(1);
    expect(pes[0].pesoMedio).toBe(200);
    expect(pes[0].qtdPesada).toBe(30);
  });

  it('pesagem individual cria animais, calcula média e GMD por animal', async () => {
    const pid = await base();
    const id = await criarLote({ propriedadeId: pid, nome: 'Novilhas', fase: 'recria', sexo: 'femea', controle: 'individual', qtdCabecas: 0, dataEntrada: '2026-10-01' });
    await registrarPesagemIndividual(id, '2026-10-01', [{ brinco: '1', peso: 200 }, { brinco: '2', peso: 220 }]);
    await registrarPesagemIndividual(id, '2026-10-31', [{ brinco: '1', peso: 221 }, { brinco: ' 2 ', peso: 238 }, { brinco: '3', peso: 0 }]);
    const animais = await db.animais.where('loteId').equals(id).toArray();
    expect(animais.map((a) => a.brinco).sort()).toEqual(['1', '2']);
    const lote = await db.lotes.get(id);
    expect(lote!.qtdCabecas).toBe(2);
    const pes = await db.pesagens.where('loteId').equals(id).toArray();
    expect(resumo(pontosDoLote(pes)).gmdTotal).toBeCloseTo((229.5 - 210) / 30, 6);
    const a1 = animais.find((a) => a.brinco === '1')!;
    expect(resumo(pontosDoAnimal(pes, a1.id!)).gmdTotal).toBeCloseTo(0.7, 6);
  });

  it('recusa pesagem individual vazia', async () => {
    const pid = await base();
    const id = await criarLote({ propriedadeId: pid, nome: 'X', fase: 'cria', sexo: 'misto', controle: 'individual', qtdCabecas: 0, dataEntrada: '2026-10-01' });
    await expect(registrarPesagemIndividual(id, '2026-10-01', [{ brinco: '', peso: 300 }])).rejects.toThrow();
  });

  it('cópia de segurança volta igual', async () => {
    const pid = await base();
    await criarLote({ propriedadeId: pid, nome: 'L', fase: 'tip', sexo: 'macho', controle: 'lote', qtdCabecas: 10, dataEntrada: '2026-09-01' }, 300);
    const bk = JSON.parse(JSON.stringify(await exportarBackup()));
    usarBanco(new BoiForteDB('restaurado-' + n++));
    await importarBackup(bk);
    expect(await db.lotes.count()).toBe(1);
    expect(await db.pesagens.count()).toBe(1);
    await expect(importarBackup({ foo: 1 })).rejects.toThrow('não é uma cópia');
  });

  it('excluir propriedade apaga tudo dela', async () => {
    const pid = await base();
    const mid = await db.modulos.add({ propriedadeId: pid, nome: 'M1', criadoEm: 0 });
    await db.piquetes.add({ moduloId: mid, nome: 'P1', criadoEm: 0 });
    await criarLote({ propriedadeId: pid, nome: 'L', fase: 'tip', sexo: 'macho', controle: 'lote', qtdCabecas: 10, dataEntrada: '2026-09-01' }, 300);
    await excluirPropriedade(pid);
    for (const t of ['propriedades', 'modulos', 'piquetes', 'lotes', 'pesagens']) expect(await db.table(t).count()).toBe(0);
  });
});
