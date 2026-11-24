import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, criarLote, type Lote, type Pesagem } from './db';
import { mudarFase, pesoAlvoDoLote, PESO_ALVO_SUGERIDO, trechosDeFase, usaPesoAlvo } from './fases';
import { montarInfo } from './hooks';
import { validarRegistro } from './validar';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('fases-' + n++)); });

async function loteRip() {
  const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
  const rip = await db.formulas.add({ nome: 'RIP fêmeas', tipo: 'rip', unidade: 'kg', modo: 'direto', consumoPctPV: 0.007, itens: [], criadoEm: 0 });
  const tip = await db.formulas.add({ nome: 'TIP 1,5%', tipo: 'tip', unidade: 'kg', modo: 'direto', consumoPctPV: 0.015, itens: [], criadoEm: 0 });
  const id = await criarLote({ propriedadeId: pid, nome: 'Fêmea 4º lote', fase: 'rip', sexo: 'femea', controle: 'lote', qtdCabecas: 40, dataEntrada: '2026-01-01', pesoAlvo: 390, gmdMeta: 0.8, formulaId: rip, consumoPctPV: 0.008 }, 300);
  await db.pesagens.add({ loteId: id, data: '2026-03-02', tipo: 'media', pesoMedio: 348, qtdPesada: 40, criadoEm: 0 });
  return { id, rip, tip };
}

describe('mudança de fase RIP → TIP', () => {
  it('troca fase, dieta e metas, grava a pesagem do dia e guarda o histórico', async () => {
    const { id, tip } = await loteRip();
    await mudarFase(id, { data: '2026-04-01', para: 'tip', formulaId: tip, pesoAlvo: 540, gmdMeta: 0.95, pesoMedio: 372 });
    const l = (await db.lotes.get(id))!;
    expect(l.fase).toBe('tip');
    expect(l.formulaId).toBe(tip);
    expect(l.consumoPctPV).toBeNull();
    expect(l.pesoAlvo).toBe(540);
    expect(l.gmdMeta).toBe(0.95);
    expect(l.fases).toEqual([{ data: '2026-04-01', de: 'rip', para: 'tip', pesoMedio: 372, dieta: 'RIP fêmeas' }]);
    const p = await db.pesagens.where('loteId').equals(id).toArray();
    expect(p.find((x) => x.data === '2026-04-01')).toMatchObject({ pesoMedio: 372, qtdPesada: 40, obs: 'Entrada na TIP' });
  });

  it('sem peso no dia, usa a estimativa pela última pesagem', async () => {
    const { id, tip } = await loteRip();
    await mudarFase(id, { data: '2026-04-01', para: 'tip', formulaId: tip, pesoAlvo: 540, gmdMeta: 0.95 });
    const l = (await db.lotes.get(id))!;
    // 300 → 348 em 60 dias = 0,8 kg/dia; mais 30 dias = 372
    expect(l.fases![0].pesoMedio).toBe(372);
    expect(await db.pesagens.where('loteId').equals(id).count()).toBe(2);
  });

  it('recusa data antes da entrada, no futuro, mesma fase e lote encerrado', async () => {
    const { id, tip } = await loteRip();
    const base = { para: 'tip' as const, formulaId: tip, pesoAlvo: 540, gmdMeta: 0.95 };
    await expect(mudarFase(id, { ...base, data: '2025-12-31' })).rejects.toThrow(/antes da entrada/);
    await expect(mudarFase(id, { ...base, data: '2099-01-01' })).rejects.toThrow(/futuro/);
    await expect(mudarFase(id, { ...base, para: 'rip', data: '2026-04-01' })).rejects.toThrow(/já está/);
    await db.lotes.update(id, { encerrado: true });
    await expect(mudarFase(id, { ...base, data: '2026-04-01' })).rejects.toThrow(/encerrado/);
    expect((await db.lotes.get(id))!.fase).toBe('rip');
  });

  it('não aceita mudança antes da última mudança de fase', async () => {
    const { id, tip } = await loteRip();
    await mudarFase(id, { data: '2026-04-01', para: 'tip', formulaId: tip, pesoAlvo: 540, gmdMeta: 0.95 });
    await expect(mudarFase(id, { data: '2026-03-01', para: 'confinamento', formulaId: null, pesoAlvo: 540, gmdMeta: 1.35 })).rejects.toThrow(/última mudança/);
  });
});

describe('trechos de fase', () => {
  it('separa ganho e GMD de cada fase', async () => {
    const { id, tip } = await loteRip();
    await mudarFase(id, { data: '2026-04-01', para: 'tip', formulaId: tip, pesoAlvo: 540, gmdMeta: 0.95, pesoMedio: 372 });
    await db.pesagens.add({ loteId: id, data: '2026-05-01', tipo: 'media', pesoMedio: 402, qtdPesada: 40, criadoEm: 0 });
    const l = (await db.lotes.get(id))!;
    const pontos = (await db.pesagens.where('loteId').equals(id).toArray()).map((p) => ({ data: p.data, peso: p.pesoMedio }));
    const t = trechosDeFase(l, pontos, '2026-05-10');
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ fase: 'rip', inicio: '2026-01-01', fim: '2026-04-01', dias: 90, pesoInicio: 300, pesoFim: 372, ganho: 72, dieta: 'RIP fêmeas' });
    expect(t[0].gmd).toBeCloseTo(0.8);
    expect(t[1]).toMatchObject({ fase: 'tip', inicio: '2026-04-01', fim: null, dias: 39, pesoInicio: 372, pesoFim: 402, ganho: 30 });
    expect(t[1].gmd).toBeCloseTo(1);
  });

  it('lote sem mudança tem um trecho só', () => {
    const t = trechosDeFase({ propriedadeId: 1, nome: 'L', fase: 'rip', sexo: 'macho', controle: 'lote', qtdCabecas: 1, dataEntrada: '2026-01-01', criadoEm: 0 }, [], '2026-01-11');
    expect(t).toEqual([{ fase: 'rip', inicio: '2026-01-01', fim: null, dias: 10, pesoInicio: null, pesoFim: null, ganho: null, gmd: null, dieta: undefined }]);
  });
});

describe('validação do histórico', () => {
  it('aceita a fase RIP e o histórico, recusa fase inventada', () => {
    const base = { propriedadeId: 1, nome: 'L', fase: 'rip', sexo: 'macho', controle: 'lote', qtdCabecas: 1, dataEntrada: '2026-01-01' };
    const ok = validarRegistro('lotes', { ...base, fases: [{ data: '2026-02-01', de: 'rip', para: 'tip', pesoMedio: 380, dieta: 'RIP' }] }) as any;
    expect(ok.fases).toHaveLength(1);
    expect(() => validarRegistro('lotes', { ...base, fases: [{ data: '2026-02-01', de: 'rip', para: 'xyz' }] })).toThrow();
  });
});

describe('Cria sem peso alvo', () => {
  it('só a Cria fica sem peso alvo, e um peso guardado antes num lote de Cria não vale', () => {
    expect(usaPesoAlvo('cria')).toBe(false);
    for (const f of ['recria', 'rip', 'engorda_pasto', 'tip', 'confinamento'] as const) expect(usaPesoAlvo(f)).toBe(true);
    expect('cria' in PESO_ALVO_SUGERIDO).toBe(false);
    expect(pesoAlvoDoLote({ fase: 'cria', pesoAlvo: 210 })).toBeNull();
    expect(pesoAlvoDoLote({ fase: 'recria', pesoAlvo: 360 })).toBe(360);
    expect(pesoAlvoDoLote({ fase: 'tip', pesoAlvo: null })).toBeNull();
  });

  it('passar o lote para a Cria tira o peso alvo; sair da Cria grava o novo', async () => {
    const { id } = await loteRip();
    await mudarFase(id, { data: '2026-04-01', para: 'cria', formulaId: null, pesoAlvo: 390, gmdMeta: 0.7 });
    expect((await db.lotes.get(id))!.pesoAlvo).toBeNull();
    await mudarFase(id, { data: '2026-05-01', para: 'recria', formulaId: null, pesoAlvo: 360, gmdMeta: 0.6 });
    expect((await db.lotes.get(id))!.pesoAlvo).toBe(360);
  });

  it('lote de Cria com peso alvo guardado: sem previsão de saída e sem aviso de peso alvo', () => {
    const lote: Lote = { id: 1, propriedadeId: 1, nome: 'Bezerros', fase: 'cria', sexo: 'misto', controle: 'lote', qtdCabecas: 20, dataEntrada: '2026-01-01', pesoAlvo: 210, gmdMeta: 0.7, criadoEm: 0 };
    const pes: Pesagem[] = [
      { id: 1, loteId: 1, data: '2026-01-01', tipo: 'media', pesoMedio: 150, qtdPesada: 20, criadoEm: 1 },
      { id: 2, loteId: 1, data: '2026-04-01', tipo: 'media', pesoMedio: 215, qtdPesada: 20, criadoEm: 2 },
    ];
    const cria = montarInfo(lote, pes, '2026-04-02');
    expect(cria.projecao).toBeNull();
    expect(cria.alertas.map((a) => a.titulo).join(' | ')).not.toMatch(/peso alvo/);
    // o mesmo lote na Recria continua com a previsão e o aviso
    const recria = montarInfo({ ...lote, fase: 'recria' }, pes, '2026-04-02');
    expect(recria.projecao?.jaAtingiu).toBe(true);
    expect(recria.alertas.some((a) => /atingiu o peso alvo/.test(a.titulo))).toBe(true);
  });
});
