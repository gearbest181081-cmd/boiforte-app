import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, criarLote, excluirLote, excluirPropriedade, exportarBackup, importarBackup } from './db';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('rastro-' + n++)); });

describe('rastreabilidade no banco do celular', () => {
  it('documentos e contorno da fazenda são validados', async () => {
    const pid = await db.propriedades.add({ nome: 'Canaã', criadoEm: 0 });
    await db.propriedades.update(pid, { lat: -20.4, lon: -54.6, contorno: [{ lat: -20, lon: -54 }, { lat: -20.1, lon: -54 }, { lat: -20.1, lon: -54.1 }], car: 'MS-1', carSituacao: 'ativo', itrAno: 2026, semDesmate: true });
    expect(await db.propriedades.get(pid)).toMatchObject({ lat: -20.4, carSituacao: 'ativo', semDesmate: true });
    await expect(db.propriedades.update(pid, { lat: 95 })).rejects.toThrow(/lat/);
    await expect(db.propriedades.update(pid, { itrAno: 1800 })).rejects.toThrow(/itrAno/);
    await expect(db.propriedades.update(pid, { contorno: [{ lat: -20, lon: Number.NaN }] })).rejects.toThrow();
  });

  it('GTA fica guardada quando o lote é apagado, some com a fazenda e vai na cópia', async () => {
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const lid = await criarLote({ propriedadeId: pid, nome: 'L', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 10, dataEntrada: '2026-09-01' });
    const gid = await db.gtas.add({ propriedadeId: pid, loteId: lid, sentido: 'entrada', numero: '99', emissao: '2026-09-01', machos: 10, femeas: 0, criadoEm: 0 });
    await expect(db.gtas.add({ propriedadeId: pid, sentido: 'subida' as never, numero: '1', emissao: '2026-09-01', machos: 1, femeas: 0, criadoEm: 0 })).rejects.toThrow();
    const bk = await exportarBackup();
    expect(bk.dados.gtas).toHaveLength(1);
    await excluirLote(lid);
    expect((await db.gtas.get(gid))!.loteId).toBeNull();
    await excluirPropriedade(pid);
    expect(await db.gtas.count()).toBe(0);
    await importarBackup(bk);
    expect(await db.gtas.count()).toBe(1);
    expect((await db.pendentes.toArray()).some((p) => p.tabela === 'gtas')).toBe(true);
  });
});
