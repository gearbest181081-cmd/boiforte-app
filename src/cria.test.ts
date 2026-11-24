import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { BoiForteDB, usarBanco, db, excluirPropriedade, type Animal, type EventoReprodutivo, type Estacao } from './db';
import {
  calcularIpm, cabecasGrupo, custoBezerro, decisoesCria, historicoMatriz, p205, partoNaEpoca, projecaoDesmama, projetarRebanho,
  reterNovilhas, resumoPacote, saidaPrevista, alertaPermanencia, sugestoesDescarte, tourosNecessarios, venderOuRecriar, proximaVersao,
} from './cria';
import { coberturaEmMassa, desfazerDesmama, desmamar, lotacaoDaCria, pesarCria, piqueteOcupado, registrarParto, salvarAnimalCria, salvarEvento, salvarGrupo } from './criaDb';
import { custoCriaPeriodo, carregarTudo, analisarLotes } from './hooks';

const A = (x: Partial<Animal> & { id: number }): Animal => ({ brinco: String(x.id), ativo: true, criadoEm: 0, grupoId: 1, sexo: 'femea', categoria: 'matriz', ...x });
const E = (x: Partial<EventoReprodutivo>): EventoReprodutivo => ({ matrizId: 1, data: '2025-01-01', tipo: 'parto', criadoEm: 0, ...x });
const EST: Estacao[] = [{ id: 1, nome: 'Estação 24/25', inicio: '2024-11-01', fim: '2025-01-31', metodo: 'monta', criadoEm: 0 }];

describe('contas da Cria', () => {
  it('cabeças do grupo somam touros lançados por lote e ignoram quem saiu', () => {
    const animais = [A({ id: 1 }), A({ id: 2, categoria: 'touro', sexo: 'macho', qtd: 3 }), A({ id: 3, saida: '2026-01-01', ativo: false }), A({ id: 4, grupoId: 2 }), A({ id: 5, loteId: 9, grupoId: null })];
    expect(cabecasGrupo(1, animais)).toBe(4);
  });
  it('projeção da desmama: padrão sem pesagem, creep soma ganho, pesagens mandam', () => {
    const b = A({ id: 10, categoria: 'bezerro', nascimento: '2026-09-01', pesoNascer: 30 });
    const p = projecaoDesmama(b, [], '2026-10-01')!;
    expect(p.data).toBe('2027-03-30');
    expect(p.peso).toBeCloseTo(30 + 0.75 * 210, 1);
    expect(projecaoDesmama({ ...b, creep: true }, [], '2026-10-01')!.peso).toBeCloseTo(30 + 0.87 * 210, 1);
    const pes = [{ animalId: 10, data: '2026-11-30', peso: 90, criadoEm: 0 }];
    const q = projecaoDesmama(b, pes, '2026-12-01')!;
    expect(q.origem).toBe('pesagens');
    expect(q.gmd).toBeCloseTo(60 / 90, 3);
  });
  it('P205 ajusta o peso para 205 dias', () => {
    expect(p205(200, 210, 30)).toBeCloseTo(((200 - 30) / 210) * 205 + 30, 1);
    expect(p205(200, 60)).toBeNull();
  });
  it('histórico da vaca: crias, sexo, intervalo entre partos, prenhe e parto previsto', () => {
    const animais = [A({ id: 1, nascimento: '2020-01-01' }), A({ id: 11, sexo: 'macho', categoria: 'bezerro', maeId: 1 }), A({ id: 12, sexo: 'femea', categoria: 'bezerro', maeId: 1 })];
    const ev = [
      E({ data: '2024-09-10', bezerroId: 11 }), E({ data: '2025-10-10', bezerroId: 12 }),
      E({ tipo: 'monta', data: '2025-12-01' }), E({ tipo: 'diagnostico', data: '2026-03-01', resultado: 'prenhe' }),
    ];
    const h = historicoMatriz(animais[0], ev, animais, [], EST, '2026-03-10');
    expect(h.nCrias).toBe(2);
    expect(h.pctMachos).toBe(0.5);
    expect(h.iepMedio).toBe(395);
    expect(h.prenhe).toBe(true);
    expect(h.partoPrevisto).toBe('2026-09-17');
    expect(h.idadePrimeiroParto).toBe(1714);
    expect(h.crias[1].foraEpoca).toBe(false); // 10/10/2025 cai em 01/11/24 + 270 até 31/01/25 + 310
  });
  it('parto fora da estação', () => {
    expect(partoNaEpoca('2025-09-01', EST)).toBe(true);
    expect(partoNaEpoca('2025-03-01', EST)).toBe(false);
    expect(partoNaEpoca('2025-03-01', [])).toBeNull();
  });
  it('IPM, ranking e motivos de descarte', () => {
    const animais = [
      A({ id: 1 }), A({ id: 2 }),
      A({ id: 11, categoria: 'bezerro', sexo: 'macho' }), A({ id: 12, categoria: 'bezerro', sexo: 'macho' }), A({ id: 13, categoria: 'bezerro', sexo: 'femea' }),
    ];
    const ev = [
      E({ matrizId: 1, data: '2024-09-01', bezerroId: 11 }), E({ matrizId: 1, data: '2025-09-01', bezerroId: 12 }),
      E({ matrizId: 2, data: '2024-09-01', bezerroId: 13 }), E({ matrizId: 2, tipo: 'diagnostico', data: '2025-04-01', resultado: 'vazia' }), E({ matrizId: 2, tipo: 'diagnostico', data: '2026-04-01', resultado: 'vazia' }),
    ];
    const desm = [{ id: 1, data: '2025-04-01', ano: 2025, versao: 1, fase: 'recria' as const, cabecas: 2, kgTotal: 400, pesoMedio: 200, criadoEm: 0, itens: [
      { animalId: 11, peso: 210, sexo: 'macho' as const, idadeDias: 212, destino: 'lote' as const }, { animalId: 13, peso: 170, sexo: 'femea' as const, idadeDias: 212, destino: 'lote' as const },
    ] }, { id: 2, data: '2026-04-01', ano: 2026, versao: 1, fase: 'recria' as const, cabecas: 1, kgTotal: 205, pesoMedio: 205, criadoEm: 0, itens: [
      { animalId: 12, peso: 205, sexo: 'macho' as const, idadeDias: 212, destino: 'lote' as const },
    ] }];
    const l = calcularIpm(animais.slice(0, 2), ev, animais, desm, [], '2026-09-01');
    expect(l[0].matriz.id).toBe(1);
    expect(l[0].ipm).toBeGreaterThan(l[1].ipm!);
    expect(l[1].motivos[0]).toBe('Vazia em dois diagnósticos seguidos');
    expect(sugestoesDescarte(l).map((x) => x.matriz.id)).toEqual([2]);
  });
  it('permanência no lugar do peso alvo', () => {
    const t = A({ id: 5, categoria: 'touro', sexo: 'macho', entrada: '2021-01-01', permanenciaMeses: 60 });
    expect(saidaPrevista(t)).toBe('2026-01-01');
    expect(alertaPermanencia(t, '2026-01-10')!.nivel).toBe('ruim');
    expect(alertaPermanencia(t, '2025-11-01')!.nivel).toBe('atencao');
    expect(alertaPermanencia(t, '2024-01-01')).toBeNull();
  });
  it('custo do bezerro por cabeça, kg e @ (30 kg)', () => {
    const c = custoBezerro(30000, [{ itens: [{ animalId: 1, peso: 200, sexo: 'macho', idadeDias: 210, destino: 'lote' }, { animalId: 2, peso: 100, sexo: 'femea', idadeDias: 210, destino: 'lote' }] }]);
    expect(c.porCabeca).toBe(15000);
    expect(c.porKg).toBe(100);
    expect(c.porArroba).toBe(3000);
  });
  it('pacote: média ponderada e versão por ano', () => {
    const r = resumoPacote([{ animalId: 1, peso: 200, sexo: 'macho', idadeDias: 210, destino: 'lote' }, { animalId: 2, peso: 170, sexo: 'femea', idadeDias: 200, destino: 'lote' }, { animalId: 3, peso: 230, sexo: 'macho', idadeDias: 220, destino: 'lote' }]);
    expect(r.pesoMedio).toBe(200);
    expect(r.pesoMachos).toBe(215);
    expect(proximaVersao([{ ano: 2026, versao: 1 }, { ano: 2026, versao: 2 }, { ano: 2025, versao: 5 }], 2026)).toBe(3);
  });
  it('touros: 1 para 25 na monta, metade na IATF com repasse, nenhum só com IA', () => {
    expect(tourosNecessarios(100, 'monta')).toBe(4);
    expect(tourosNecessarios(100, 'ia_repasse')).toBe(2);
    expect(tourosNecessarios(100, 'iatf')).toBe(0);
  });
  it('simulador: vender na desmama ou recriar', () => {
    const r = venderOuRecriar({ cabecas: 100, pesoDesmama: 200, precoBezerroKg: 14, diasRecria: 300, gmd: 0.5, custoCabDia: 3, precoArrobaVenda: 330, mortalidade: 0.02, jurosMes: 0.01 });
    expect(r.pesoFinal).toBe(350);
    expect(r.receitaAgora).toBe(280000);
    expect(r.melhor).toBe(r.ganhoRecria > 0 ? 'recriar' : 'vender');
    expect(r.precoEmpate).toBeGreaterThan(0);
  });
  it('reter novilhas: tempo para pagar', () => {
    const r = reterNovilhas({ novilhas: 10, valorVendaCab: 2500, custoMes: 60, mesesAtePrimeiroParto: 24, taxaPrenhez: 0.8, valorBezerro: 2800, jurosMes: 0 });
    expect(r.investimentoCab).toBe(2500 + 1440);
    expect(r.anosParaPagar).toBeCloseTo(3940 / 2240, 3);
  });
  it('projeção de 5 anos: novilhas retidas entram como matrizes', () => {
    const p = projetarRebanho({ matrizes: 100, novilhas: 20, touros: 4, natalidade: 0.8, mortBezerros: 0.03, mortAdultos: 0.02, descarte: 0.15, retencaoFemeas: 0.5, idadePrimeiraCria: 2 });
    expect(p).toHaveLength(5);
    expect(p[0].matrizes).toBe(100);
    expect(p[1].matrizes).toBe(Math.round(100 - 15 - 2 + 20));
    expect(p[0].bezerros).toBe(78);
    expect(p[0].desfrute).toBeGreaterThan(0.3);
  });
});

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('cria-' + n++)); });

async function base() {
  const pid = await db.propriedades.add({ nome: 'F', criadoEm: 0 });
  const mod = await db.modulos.add({ propriedadeId: pid, nome: 'M', criadoEm: 0 });
  const pq = await db.piquetes.add({ moduloId: mod, nome: 'P1', criadoEm: 0 });
  const g = await salvarGrupo({ propriedadeId: pid, nome: 'Vacas', tipo: 'matrizes', piqueteId: pq });
  return { pid, pq, g };
}

describe('Cria no banco', () => {
  it('piquete não recebe dois grupos (nem grupo e lote)', async () => {
    const { pid, pq } = await base();
    await expect(salvarGrupo({ propriedadeId: pid, nome: 'Touros', tipo: 'touros', piqueteId: pq })).rejects.toThrow('já está com o grupo Vacas');
    expect(await piqueteOcupado(pq)).toBe('o grupo Vacas');
  });
  it('matriz individual, touro por lote, brinco repetido barrado, mãe tem de ser fêmea', async () => {
    const { g } = await base();
    const v = await salvarAnimalCria({ grupoId: g, brinco: '101', sexo: 'femea', categoria: 'matriz', ativo: true, nascimento: '2019-05-01' });
    await expect(salvarAnimalCria({ grupoId: g, brinco: '101', sexo: 'femea', categoria: 'matriz', ativo: true })).rejects.toThrow('já é de outro animal');
    await expect(salvarAnimalCria({ grupoId: g, brinco: 'Vacas x', sexo: 'femea', categoria: 'matriz', ativo: true, qtd: 5 })).rejects.toThrow('Só touro');
    const t = await salvarAnimalCria({ grupoId: g, brinco: 'Touros Nelore', sexo: 'macho', categoria: 'touro', ativo: true, qtd: 4 });
    await expect(salvarAnimalCria({ grupoId: g, brinco: 'B1', sexo: 'macho', categoria: 'bezerro', ativo: true, maeId: t })).rejects.toThrow('não é uma fêmea');
    await expect(salvarAnimalCria({ grupoId: g, brinco: 'B1', sexo: 'macho', categoria: 'bezerro', ativo: true, sisbov: '123' })).rejects.toThrow('15 números');
    expect((await db.animais.get(v))!.loteId).toBeNull();
  });
  it('parto cria o bezerro com mãe e pai; novilha que pare vira matriz', async () => {
    const { g } = await base();
    const nov = await salvarAnimalCria({ grupoId: g, brinco: '200', sexo: 'femea', categoria: 'novilha', ativo: true, raca: 'Nelore' });
    const touro = await salvarAnimalCria({ grupoId: g, brinco: 'T1', sexo: 'macho', categoria: 'touro', ativo: true });
    await coberturaEmMassa([nov], { data: '2025-12-01', tipo: 'monta', touroId: touro });
    await salvarEvento({ matrizId: nov, data: '2026-02-15', tipo: 'diagnostico', resultado: 'prenhe' });
    const { bezerroId } = await registrarParto({ matrizId: nov, data: '2026-09-10', partoTipo: 'normal', bezerro: { brinco: '200-1', sexo: 'macho', pesoNascer: 31, paiId: touro } });
    const b = (await db.animais.get(bezerroId!))!;
    expect(b.maeId).toBe(nov);
    expect(b.paiId).toBe(touro);
    expect(b.raca).toBe('Nelore');
    expect(b.categoria).toBe('bezerro');
    expect((await db.animais.get(nov))!.categoria).toBe('matriz');
    expect(await db.reproducao.count()).toBe(3);
  });
  it('desmama: pacote versionado, lote de recria ponderado, fêmea de reposição fica na Cria, desfazer volta', async () => {
    const { pid, g } = await base();
    const rep = await salvarGrupo({ propriedadeId: pid, nome: 'Novilhas', tipo: 'novilhas' });
    const ids: number[] = [];
    for (const [i, sexo] of (['macho', 'macho', 'femea', 'femea'] as const).entries()) ids.push(await salvarAnimalCria({ grupoId: g, brinco: `B${i}`, sexo, categoria: 'bezerro', ativo: true, nascimento: '2026-03-01', pesoNascer: 30 }));
    await pesarCria('2026-06-01', ids.map((animalId) => ({ animalId, peso: 120 })));
    const itens = [
      { animalId: ids[0], peso: 210, sexo: 'macho' as const, idadeDias: 214, destino: 'lote' as const },
      { animalId: ids[1], peso: 190, sexo: 'macho' as const, idadeDias: 214, destino: 'lote' as const },
      { animalId: ids[2], peso: 180, sexo: 'femea' as const, idadeDias: 214, destino: 'lote' as const },
      { animalId: ids[3], peso: 185, sexo: 'femea' as const, idadeDias: 214, destino: 'reposicao' as const },
    ];
    const r = await desmamar({ data: '2026-10-01', grupoId: g, fase: 'rip', propriedadeId: pid, itens, separarSexos: false, nomeLote: 'Desmama 2026', grupoReposicaoId: rep });
    const lote = (await db.lotes.get(r.lotes[0]))!;
    expect(lote.fase).toBe('rip');
    expect(lote.qtdCabecas).toBe(3);
    const pes = await db.pesagens.where('loteId').equals(lote.id!).toArray();
    expect(pes[0].pesoMedio).toBe(193.3);
    expect((await db.animais.get(ids[0]))!.loteId).toBe(lote.id);
    expect((await db.animais.get(ids[0]))!.grupoId).toBeNull();
    const nov = (await db.animais.get(ids[3]))!;
    expect([nov.grupoId, nov.categoria]).toEqual([rep, 'novilha']);
    const d = (await db.desmamas.get(r.desmamaId))!;
    expect([d.ano, d.versao, d.cabecas]).toEqual([2026, 1, 4]);
    expect(d.itens[0].grupoId).toBe(g);
    await expect(desmamar({ data: '2026-10-02', grupoId: g, fase: 'recria', propriedadeId: pid, itens: [itens[0]], separarSexos: false, nomeLote: 'x' })).rejects.toThrow('já saiu da Cria');
    await desfazerDesmama(r.desmamaId);
    expect((await db.animais.get(ids[0]))!.grupoId).toBe(g);
    expect(await db.lotes.count()).toBe(0);
    // desmama separando machos e fêmeas: dois lotes; versão continua contando
    const r2 = await desmamar({ data: '2026-10-03', grupoId: g, fase: 'recria', propriedadeId: pid, itens: itens.slice(0, 3), separarSexos: true, nomeLote: 'D' });
    expect(r2.lotes).toHaveLength(2);
    expect((await db.desmamas.get(r2.desmamaId))!.versao).toBe(1);
  });
  it('custo da Cria: despesas do grupo + parte dos custos gerais pelas cabeças', async () => {
    const { g } = await base();
    for (let i = 0; i < 10; i++) await salvarAnimalCria({ grupoId: g, brinco: `V${i}`, sexo: 'femea', categoria: 'matriz', ativo: true, entrada: '2026-01-01' });
    await db.lotes.add({ propriedadeId: 1, nome: 'L', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 10, dataEntrada: '2026-01-01', criadoEm: 0 });
    await db.lancamentos.add({ data: '2026-03-10', tipo: 'despesa', categoria: 'sanidade', valor: 500, grupoId: g, criadoEm: 0 });
    await db.lancamentos.add({ data: '2026-03-10', tipo: 'despesa', categoria: 'outros', valor: 1000, criadoEm: 0 });
    const t = await carregarTudo();
    const c = custoCriaPeriodo(t, '2026-01-01', '2026-12-31');
    expect(c.diretos).toBe(500);
    expect(c.rateio).toBeCloseTo(500, 6);
    // o lote fica só com a metade do custo geral e não recebe a despesa da Cria
    expect(analisarLotes(t, '2026-12-31')[0].dre.custos.fixos).toBeCloseTo(500, 6);
  });
  it('decisões: comprar touro e diagnosticar', async () => {
    const { g } = await base();
    const vs: number[] = [];
    for (let i = 0; i < 30; i++) vs.push(await salvarAnimalCria({ grupoId: g, brinco: `V${i}`, sexo: 'femea', categoria: 'matriz', ativo: true }));
    await salvarAnimalCria({ grupoId: g, brinco: 'T', sexo: 'macho', categoria: 'touro', ativo: true });
    await db.estacoes.add({ nome: 'Estação', inicio: '2025-11-01', fim: '2026-01-31', metodo: 'monta', criadoEm: 0 });
    await coberturaEmMassa(vs, { data: '2025-11-05', tipo: 'monta' });
    const t = await carregarTudo();
    const d = decisoesCria({ animais: t.animais, eventos: await db.reproducao.toArray(), pesos: [], desmamas: [], estacoes: await db.estacoes.toArray(), hoje: '2026-04-01' });
    expect(d.find((x) => x.titulo.startsWith('Comprar 1 touro'))).toBeTruthy();
    expect(d.find((x) => x.titulo.startsWith('Fazer diagnóstico de gestação em 30'))).toBeTruthy();
  });
  it('decisões: lotação alta no módulo onde está o grupo (contas do Pasto)', async () => {
    const { g, pq } = await base();
    const p = (await db.piquetes.get(pq))!;
    await db.modulos.update(p.moduloId, { capacidadeUA: 2 });
    await db.piquetes.update(pq, { areaHa: 10 });
    for (let i = 0; i < 30; i++) await salvarAnimalCria({ grupoId: g, brinco: `V${i}`, sexo: 'femea', categoria: 'matriz', ativo: true });
    const lot = await lotacaoDaCria('2026-04-01');
    expect(lot).toHaveLength(1);
    expect(lot[0].nivel).toBe('alta');
    expect(lot[0].grupos).toEqual(['Vacas']);
    const t = await carregarTudo();
    const d = decisoesCria({ animais: t.animais, eventos: [], pesos: [], desmamas: [], estacoes: [], hoje: '2026-04-01', lotacao: lot });
    expect(d.find((x) => x.titulo === 'Lotação alta no M' && x.nivel === 'ruim')).toBeTruthy();
    await db.modulos.update(p.moduloId, { capacidadeUA: 5 });
    expect(await lotacaoDaCria('2026-04-01')).toHaveLength(0);
  });
  it('apagar a fazenda apaga os grupos da Cria e os animais deles', async () => {
    const { g, pid } = await base();
    const v = await salvarAnimalCria({ grupoId: g, brinco: 'V1', sexo: 'femea', categoria: 'matriz', ativo: true });
    await salvarEvento({ matrizId: v, data: '2026-01-01', tipo: 'monta' });
    await excluirPropriedade(pid);
    expect(await db.grupos.count()).toBe(0);
    expect(await db.animais.count()).toBe(0);
    expect(await db.reproducao.count()).toBe(0);
  });
});
