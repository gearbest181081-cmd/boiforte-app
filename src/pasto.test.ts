import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  alvosPiquete, analisarNdvi, entrarNoPiquete, estadoPiquete, lotacaoAlta, lotacaoModulo, ocupacaoIdeal, pressaoPastejo,
  quemEstaNoPiquete, referenciaCapim, sairDoPiquete, sugerirProximo, ua, resumoPasto, excluirOcupacao,
  atualizarModulo, atualizarPiquete, conferirAreaModulo, conferirAreaPiquete, dicaAreaPiquete, novoModulo, novoPiquete, usoDaArea,
} from './pasto';
import { areaHa, aceitarPonto, lerContorno, limparContorno, paraGeoJson } from './pastoGeo';
import { BoiForteDB, db, usarBanco, type Ocupacao, type Piquete } from './db';
import { somaDias } from './calc';

describe('contas do pasto', () => {
  it('UA e lotação do módulo (área do módulo inteiro)', () => {
    expect(ua(450)).toBe(1);
    expect(ua(300, 30)).toBe(20);
    const pqs = [{ id: 1, areaHa: 10 }, { id: 2, areaHa: 10 }];
    const l = lotacaoModulo(pqs, [{ piqueteId: 1, cabecas: 30, pesoMedio: 300 }, { piqueteId: 9, cabecas: 99, pesoMedio: 400 }]);
    expect(l.ua).toBe(20);
    expect(l.uaHa).toBe(1);
    expect(l.cabecas).toBe(30);
  });

  it('lotação do módulo usa a área do módulo; sem ela, a soma dos piquetes', () => {
    const pqs = [{ id: 1, areaHa: 10 }, { id: 2, areaHa: 10 }];
    const oc = [{ piqueteId: 1, cabecas: 30, pesoMedio: 300 }]; // 20 UA
    expect(lotacaoModulo(pqs, oc, 40)).toMatchObject({ areaHa: 40, areaPiquetes: 20, uaHa: 0.5 });
    expect(lotacaoModulo(pqs, oc, null)).toMatchObject({ areaHa: 20, uaHa: 1 });
    expect(lotacaoModulo([{ id: 1 }], oc, 25).uaHa).toBe(0.8); // piquete sem área: o módulo tem
    // a capacidade de suporte é comparada com a lotação na área do módulo
    expect(lotacaoAlta({ capacidadeUA: 0.55, areaHa: 40 }, pqs, oc).nivel).toBe('atencao'); // 0,5 de 0,55
    expect(lotacaoAlta({ capacidadeUA: 0.55 }, pqs, oc).nivel).toBe('alta'); // 1 de 0,55 (só os 20 ha dos piquetes)
    expect(lotacaoAlta({}, [{ id: 1 }], oc).motivo).toBe('Falta a área do módulo.');
  });

  it('lotação alta pela capacidade de suporte', () => {
    const pqs = [{ id: 1, areaHa: 10 }];
    const oc = (cab: number) => [{ piqueteId: 1, cabecas: cab, pesoMedio: 450 }];
    expect(lotacaoAlta({ capacidadeUA: 2 }, pqs, oc(25)).nivel).toBe('alta');
    expect(lotacaoAlta({ capacidadeUA: 2 }, pqs, oc(19)).nivel).toBe('atencao');
    expect(lotacaoAlta({ capacidadeUA: 2 }, pqs, oc(10)).nivel).toBe('ok');
    expect(lotacaoAlta({}, [{ id: 1 }], oc(10)).nivel).toBe('sem_dados');
  });

  it('lotação alta quando o gado sai 2 vezes com o pasto rapado', () => {
    const pqs: Pick<Piquete, 'id' | 'areaHa' | 'capim'>[] = [{ id: 1, areaHa: 5, capim: 'Mombaça' }, { id: 2, areaHa: 5, capim: 'Mombaça' }];
    const saidas = [{ piqueteId: 1, saida: '2026-10-01', alturaSaida: 25 }, { piqueteId: 2, saida: '2026-10-20', alturaSaida: 30 }];
    expect(lotacaoAlta({}, pqs, [], saidas).nivel).toBe('alta');
    expect(lotacaoAlta({}, pqs, [], [saidas[0], { ...saidas[1], alturaSaida: 45 }]).nivel).not.toBe('alta');
  });

  it('referência do capim pelo nome falado', () => {
    expect(referenciaCapim('brizanta')?.entrada).toBe(25);
    expect(referenciaCapim('capim mombaca')?.entrada).toBe(90);
    expect(referenciaCapim('Tifton')?.saida).toBe(10);
    expect(referenciaCapim('capim desconhecido')).toBeNull();
    expect(alvosPiquete({ capim: 'Mombaça', alturaEntrada: 80 })).toMatchObject({ entrada: 80, saida: 45, kgMsCm: 70 });
  });

  it('pressão de pastejo e oferta de forragem', () => {
    // 30 cab × 300 kg = 9.000 kg PV; 4.000 kg MS/ha × 5 ha = 20.000 kg MS; 3 dias
    const r = pressaoPastejo({ cabecas: 30, pesoMedio: 300, massaKgMsHa: 4000, areaHa: 5, dias: 3 })!;
    expect(r.pressao).toBeCloseTo(0.45, 2);
    expect(r.oferta).toBeCloseTo(74.07, 1);
    expect(r.nivel).toBe('sobra');
    expect(pressaoPastejo({ cabecas: 100, pesoMedio: 400, massaKgMsHa: 4000, areaHa: 5, dias: 5 })!.nivel).toBe('bom');
    expect(pressaoPastejo({ cabecas: 100, pesoMedio: 400, massaKgMsHa: 1500, areaHa: 5, dias: 7 })!.nivel).toBe('ruim');
    expect(pressaoPastejo({ cabecas: 0, pesoMedio: 400, massaKgMsHa: 1500, areaHa: 5, dias: 7 })).toBeNull();
  });

  it('ocupação ideal fecha o descanso planejado', () => {
    expect(ocupacaoIdeal(30, 6)).toBe(6);
    expect(ocupacaoIdeal(30, 1)).toBeNull();
  });

  it('situação do piquete, aviso de ocupação longa e sugestão do próximo', () => {
    const hoje = '2026-11-24';
    const p = (id: number): Piquete => ({ id, moduloId: 1, nome: `P${id}`, criadoEm: 0 });
    const oc: Ocupacao[] = [
      { piqueteId: 1, tipo: 'lote', ocupanteId: 1, entrada: '2026-11-10', cabecas: 30, criadoEm: 0 },
      { piqueteId: 2, tipo: 'lote', ocupanteId: 1, entrada: '2026-10-01', saida: '2026-10-07', cabecas: 30, criadoEm: 0 },
      { piqueteId: 3, tipo: 'lote', ocupanteId: 1, entrada: '2026-11-01', saida: '2026-11-10', cabecas: 30, criadoEm: 0 },
    ];
    const mod = { sistema: 'rotacionado' as const, diasOcupacao: 7, diasDescanso: 30 };
    const e1 = estadoPiquete(p(1), oc, mod, hoje);
    expect(e1).toMatchObject({ situacao: 'ocupado', diasOcupado: 14 });
    expect(e1.alertas[0].nivel).toBe('ruim'); // 14 dias com 7 planejados
    expect(estadoPiquete(p(2), oc, mod, hoje)).toMatchObject({ situacao: 'pronto', diasDescanso: 48 });
    expect(estadoPiquete(p(3), oc, mod, hoje)).toMatchObject({ situacao: 'descansando', diasDescanso: 14 });
    expect(estadoPiquete(p(4), oc, mod, hoje).situacao).toBe('sem_uso');
    const estados = [1, 2, 3].map((i) => estadoPiquete(p(i), oc, mod, hoje));
    expect(sugerirProximo(estados)?.piquete.id).toBe(2);
  });
});

describe('NDVI', () => {
  const serie = (vals: [string, number][], nuvem = 0) => vals.map(([data, ndvi]) => ({ data, ndvi, nuvemPct: nuvem }));
  const base: [string, number][] = [['2026-07-01', 0.7], ['2026-07-20', 0.72], ['2026-08-10', 0.7], ['2026-09-01', 0.71]];
  const descansando = { situacao: 'descansando' as const, diasDescanso: 40 };

  it('queda em relação ao próprio piquete, descansando', () => {
    const a = analisarNdvi('P1', serie([...base, ['2026-10-20', 0.55]]), [], descansando);
    expect(a.base).toBeCloseTo(0.705, 3);
    expect(a.alertas.map((x) => x.titulo)).toContain('P1: verde caindo pelo satélite');
  });

  it('logo depois do pastejo a queda é normal', () => {
    expect(analisarNdvi('P1', serie([...base, ['2026-10-20', 0.55]]), [], { situacao: 'descansando', diasDescanso: 5 }).alertas).toEqual([]);
    expect(analisarNdvi('P1', serie([...base, ['2026-10-20', 0.55]]), [], { situacao: 'ocupado' }).alertas).toEqual([]);
  });

  it('pior que os vizinhos (não é seca)', () => {
    const viz = [serie([['2026-10-18', 0.68]]), serie([['2026-10-22', 0.66]])];
    const a = analisarNdvi('P1', serie([['2026-10-20', 0.55]]), viz, descansando);
    expect(a.vizinhos).toBeCloseTo(0.67, 2);
    expect(a.alertas.some((x) => x.titulo.includes('pior que os outros'))).toBe(true);
  });

  it('muito baixo avisa mesmo com gado, e leitura com nuvem é ignorada', () => {
    expect(analisarNdvi('P1', serie([['2026-10-20', 0.3]]), [], { situacao: 'ocupado' }).alertas[0].nivel).toBe('ruim');
    expect(analisarNdvi('P1', serie([['2026-10-20', 0.1]], 80), [], { situacao: 'ocupado' }).atual).toBeNull();
  });

  it('tendência', () => {
    expect(analisarNdvi('P1', serie([['2026-10-01', 0.5], ['2026-10-10', 0.55], ['2026-10-20', 0.62]]), [], descansando).tendencia).toBe('subindo');
  });
});

describe('contorno do piquete', () => {
  // quadrado de ~100 m × 100 m perto do equador = ~1 ha
  const q = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.000898 }, { lat: 0.000898, lon: 0.000898 }, { lat: 0.000898, lon: 0 }];
  it('área em hectares', () => { expect(areaHa(q)).toBeCloseTo(1, 1); });
  it('lê KML e GeoJSON', () => {
    const kml = '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>-54.1,-20.1,0 -54.1,-20.2,0 -54.2,-20.2,0 -54.1,-20.1,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>';
    expect(lerContorno(kml)).toEqual([{ lat: -20.1, lon: -54.1 }, { lat: -20.2, lon: -54.1 }, { lat: -20.2, lon: -54.2 }]);
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: paraGeoJson(q) }] });
    expect(lerContorno(gj)).toHaveLength(4);
    expect(lerContorno('qualquer coisa')).toBeNull();
  });
  it('limpa e limita pontos; GPS impreciso ou parado não entra', () => {
    expect(limparContorno([{ lat: 1.12345678, lon: 2 }, { lat: 1.12345678, lon: 2 }, { lat: 91, lon: 0 }])).toEqual([{ lat: 1.123457, lon: 2 }]);
    expect(limparContorno(Array.from({ length: 900 }, (_, i) => ({ lat: i / 1e4, lon: 0 })))).toHaveLength(500);
    expect(aceitarPonto([], { lat: 0, lon: 0 }, 40)).toBe(false);
    expect(aceitarPonto([{ lat: 0, lon: 0 }], { lat: 0.00001, lon: 0 }, 5)).toBe(false);
    expect(aceitarPonto([{ lat: 0, lon: 0 }], { lat: 0.0001, lon: 0 }, 5)).toBe(true);
  });
});

describe('entrada e saída de piquete (celular)', () => {
  let pq1: number, pq2: number, l1: number, l2: number;
  beforeEach(async () => {
    usarBanco(new BoiForteDB('pasto-' + Math.random()));
    const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    const mod = await db.modulos.add({ propriedadeId: pid, nome: 'M', sistema: 'rotacionado', diasOcupacao: 5, diasDescanso: 30, capacidadeUA: 2, criadoEm: 0 });
    pq1 = await db.piquetes.add({ moduloId: mod, nome: 'P1', areaHa: 10, capim: 'Mombaça', criadoEm: 0 });
    pq2 = await db.piquetes.add({ moduloId: mod, nome: 'P2', areaHa: 10, criadoEm: 0 });
    const base = { propriedadeId: pid, fase: 'recria' as const, sexo: 'macho' as const, controle: 'lote' as const, qtdCabecas: 30, dataEntrada: '2026-10-01', criadoEm: 0 };
    l1 = await db.lotes.add({ ...base, nome: 'L1' });
    l2 = await db.lotes.add({ ...base, nome: 'L2' });
  });

  it('um piquete recebe um lote por vez', async () => {
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: l1, piqueteId: pq1, data: '2026-11-01', cabecas: 30, pesoMedio: 300, altura: 90 });
    expect((await db.lotes.get(l1))?.piqueteId).toBe(pq1);
    expect((await quemEstaNoPiquete(pq1))?.nome).toBe('L1');
    await expect(entrarNoPiquete({ tipo: 'lote', ocupanteId: l2, piqueteId: pq1, data: '2026-11-02', cabecas: 30 })).rejects.toThrow(/já tem o lote L1/);
    const o = (await db.ocupacoes.toArray())[0];
    expect(o).toMatchObject({ alturaEntrada: 90, massaEntrada: 6300, saida: null });
  });

  it('mudar de piquete fecha a ocupação anterior; sair grava altura e áudio', async () => {
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: l1, piqueteId: pq1, data: '2026-11-01', cabecas: 30 });
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: l1, piqueteId: pq2, data: '2026-11-06', cabecas: 30 });
    const [a, b] = await db.ocupacoes.orderBy('entrada').toArray();
    expect(a.saida).toBe('2026-11-06');
    expect(b.saida).toBeNull();
    // o piquete 1 ficou livre: o lote 2 pode entrar no mesmo dia em que o 1 saiu
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: l2, piqueteId: pq1, data: '2026-11-06', cabecas: 30 });
    // mas não numa data em que o lote 1 ainda estava lá
    await sairDoPiquete('lote', l2, { data: '2026-11-07' });
    const audio = { id: '11111111-1111-4111-8111-111111111111', ext: 'webm' as const, dados: new ArrayBuffer(8) };
    await sairDoPiquete('lote', l1, { data: '2026-11-10', altura: 40, nota: 'capim bem pastejado', midias: [audio] });
    expect((await db.lotes.get(l1))?.piqueteId).toBeNull();
    await expect(entrarNoPiquete({ tipo: 'lote', ocupanteId: l2, piqueteId: pq2, data: '2026-11-03', cabecas: 30 })).rejects.toThrow(/ocupado nessa data/);
    const fechada = (await db.ocupacoes.where('piqueteId').equals(pq2).first())!;
    expect(fechada).toMatchObject({ saida: '2026-11-10', alturaSaida: 40, notaSaida: 'capim bem pastejado', midiasSaida: [{ arq: audio.id, ext: 'webm' }] });
    expect(await db.fotosAnotacao.get(audio.id)).toMatchObject({ estado: 'enviar', ext: 'webm' });
    await excluirOcupacao(fechada.id!);
    expect(await db.fotosAnotacao.get(audio.id)).toBeUndefined();
  });

  it('resumo do pasto com lotação e avisos', async () => {
    await db.pesagens.add({ loteId: l1, data: somaDias('2026-11-24', -1), tipo: 'media', pesoMedio: 450, qtdPesada: 30, criadoEm: 0 });
    await db.lotes.update(l1, { qtdCabecas: 50 });
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: l1, piqueteId: pq1, data: '2026-11-10', cabecas: 50 });
    const [r] = await resumoPasto('2026-11-24');
    expect(r.lotacao.uaHa).toBeCloseTo(2.5, 1); // 50 UA em 20 ha
    expect(r.lotacao.nivel).toBe('alta');
    expect(r.alertas.map((a) => a.titulo)).toEqual(expect.arrayContaining(['M: lotação alta', 'P1: 14 dias ocupado']));
    expect(r.proximo?.piquete.nome).toBe('P2');
  });
});

describe('área do módulo × piquetes', () => {
  const m = { nome: 'Retiro', areaHa: 30 };
  const pqs = [{ id: 1, areaHa: 12 }, { id: 2, areaHa: 12 }, { id: 3 }];

  it('quanto já foi usado e quanto sobra', () => {
    expect(usoDaArea(m, pqs)).toEqual({ areaModulo: 30, usada: 24, livre: 6 });
    expect(usoDaArea(m, pqs, 1)).toEqual({ areaModulo: 30, usada: 12, livre: 18 }); // editando o piquete 1
    expect(usoDaArea({}, pqs)).toEqual({ areaModulo: null, usada: 24, livre: null }); // módulo antigo: sem limite
    expect(usoDaArea({ areaHa: 20 }, pqs).livre).toBe(0); // nunca negativo
    expect(dicaAreaPiquete(usoDaArea(m, pqs))).toBe('Cabe até 6 ha neste módulo.');
    expect(dicaAreaPiquete(usoDaArea({ areaHa: 24 }, pqs))).toBe('O módulo já está todo dividido em piquetes.');
    expect(dicaAreaPiquete(usoDaArea({}, pqs))).toBeUndefined();
  });

  it('piquete que não cabe: diz quanto cabe', () => {
    expect(() => conferirAreaPiquete(m, pqs, 6)).not.toThrow();
    expect(() => conferirAreaPiquete(m, pqs, 6.5)).toThrow('O módulo Retiro tem 30 ha e os outros piquetes já usam 24 ha. Este piquete pode ter no máximo 6 ha.');
    expect(() => conferirAreaPiquete({ nome: 'R', areaHa: 24 }, pqs, 1)).toThrow(/não sobra área para este piquete/);
    expect(() => conferirAreaPiquete({ nome: 'R', areaHa: 10 }, [], 11)).toThrow('O módulo R tem 10 ha. Este piquete pode ter no máximo 10 ha.');
    expect(() => conferirAreaPiquete(m, pqs, 18, 1)).not.toThrow(); // o próprio piquete não conta duas vezes
    expect(() => conferirAreaPiquete(m, pqs, undefined)).not.toThrow(); // sem área não pesa
    expect(() => conferirAreaPiquete({ nome: 'Antigo' }, pqs, 999)).not.toThrow(); // módulo sem área: sem limite
    // arredondamento: 3,33 + 3,33 + 3,34 = 10 (no computador dá 10,000000000000002)
    expect(() => conferirAreaPiquete({ nome: 'R', areaHa: 10 }, [{ id: 1, areaHa: 3.33 }, { id: 2, areaHa: 3.33 }], 3.34)).not.toThrow();
  });

  it('módulo não pode ficar menor que os piquetes', () => {
    expect(() => conferirAreaModulo('Retiro', 24, pqs)).not.toThrow();
    expect(() => conferirAreaModulo('Retiro', 23.9, pqs)).toThrow('Os piquetes do módulo Retiro já somam 24 ha.');
    expect(() => conferirAreaModulo('Retiro', 0, [])).toThrow('maior que zero');
  });

  describe('no celular', () => {
    let pid: number;
    beforeEach(async () => {
      usarBanco(new BoiForteDB('area-' + Math.random()));
      pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
    });

    it('módulo novo precisa de área; piquetes até completar a área', async () => {
      await expect(novoModulo({ propriedadeId: pid, nome: 'Retiro', areaHa: null })).rejects.toThrow('Informe a área do módulo');
      await expect(novoModulo({ propriedadeId: pid, nome: '  ', areaHa: 10 })).rejects.toThrow(/nome ao módulo/);
      const mod = await novoModulo({ propriedadeId: pid, nome: ' Retiro ', areaHa: 30 });
      expect(await db.modulos.get(mod)).toMatchObject({ nome: 'Retiro', areaHa: 30 });
      const p1 = await novoPiquete({ moduloId: mod, nome: 'P1', areaHa: 12 });
      await novoPiquete({ moduloId: mod, nome: 'P2', areaHa: 12 });
      await expect(novoPiquete({ moduloId: mod, nome: 'P3', areaHa: 7 })).rejects.toThrow('Este piquete pode ter no máximo 6 ha.');
      expect(await db.piquetes.count()).toBe(2); // nada gravado
      await novoPiquete({ moduloId: mod, nome: 'P3', areaHa: 6 });
      await novoPiquete({ moduloId: mod, nome: 'Sem área' }); // sem área ainda pode
      // crescer não cabe; diminuir e mudar o nome pode
      await expect(atualizarPiquete(p1, { areaHa: 13 })).rejects.toThrow(/no máximo 12 ha/);
      await atualizarPiquete(p1, { areaHa: 10, nome: 'P1 novo' });
      expect(await db.piquetes.get(p1)).toMatchObject({ nome: 'P1 novo', areaHa: 10 });
      await atualizarPiquete(p1, { areaHa: 12 });
      // o módulo não fica menor que os piquetes (30 ha usados), nem em branco
      await expect(atualizarModulo(mod, { areaHa: 29 })).rejects.toThrow('já somam 30 ha');
      await expect(atualizarModulo(mod, { areaHa: undefined })).rejects.toThrow('Informe a área do módulo');
      await atualizarModulo(mod, { areaHa: 40, diasDescanso: 30 });
      expect(await db.modulos.get(mod)).toMatchObject({ areaHa: 40, diasDescanso: 30 });
      await atualizarPiquete(p1, { areaHa: 22 });
    });

    it('módulo antigo, sem área: sem limite até informar a área', async () => {
      const mod = await db.modulos.add({ propriedadeId: pid, nome: 'Antigo', criadoEm: 0 });
      const p1 = await novoPiquete({ moduloId: mod, nome: 'P1', areaHa: 50 });
      await atualizarPiquete(p1, { areaHa: 60 });
      await atualizarModulo(mod, { diasDescanso: 28 }); // sem mexer na área
      await expect(atualizarModulo(mod, { areaHa: 55 })).rejects.toThrow('já somam 60 ha');
      await atualizarModulo(mod, { areaHa: 60 });
      await expect(novoPiquete({ moduloId: mod, nome: 'P2', areaHa: 1 })).rejects.toThrow(/não sobra área/);
    });

    it('dado antigo acima da área: ainda dá para mudar o nome e diminuir, mas não crescer', async () => {
      const mod = await db.modulos.add({ propriedadeId: pid, nome: 'M', areaHa: 10, criadoEm: 0 });
      const p1 = await db.piquetes.add({ moduloId: mod, nome: 'P1', areaHa: 8, criadoEm: 0 });
      await db.piquetes.add({ moduloId: mod, nome: 'P2', areaHa: 8, criadoEm: 0 }); // 16 de 10 (veio assim de antes)
      await atualizarPiquete(p1, { nome: 'P1 renomeado', capim: 'Mombaça' });
      await atualizarPiquete(p1, { areaHa: 5 });
      await expect(atualizarPiquete(p1, { areaHa: 6 })).rejects.toThrow('Este piquete pode ter no máximo 2 ha.');
      // no módulo: mudar só o manejo ou aumentar a área pode (13 de 12 ainda passa); diminuir não
      await atualizarModulo(mod, { areaHa: 10, diasDescanso: 30 });
      await atualizarModulo(mod, { areaHa: 12 });
      await expect(atualizarModulo(mod, { areaHa: 11 })).rejects.toThrow('já somam 13 ha');
      expect(usoDaArea(await db.modulos.get(mod), await db.piquetes.where('moduloId').equals(mod).toArray()))
        .toEqual({ areaModulo: 12, usada: 13, livre: 0 });
    });
  });
});
