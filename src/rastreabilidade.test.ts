import { describe, it, expect } from 'vitest';
import { anoItrEsperado, carValido, conferirRastreabilidade, fichaLote, lotesSemGtaEntrada, notaRastreabilidade, sisbovValido, vendasSemGta, type DadosRastro } from './rastreabilidade';
import type { Gta, Lote, Propriedade } from './db';

const prop: Propriedade = { id: 1, nome: 'Canaã', municipio: 'Campo Grande', uf: 'MS', areaHa: 100, criadoEm: 0 };
const lote = (id: number, extra: Partial<Lote> = {}): Lote => ({ id, propriedadeId: 1, nome: `Lote ${id}`, fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 20, dataEntrada: '2026-01-10', criadoEm: 0, ...extra });
const gta = (extra: Partial<Gta>): Gta => ({ propriedadeId: 1, sentido: 'entrada', numero: '1', emissao: '2026-01-10', machos: 20, femeas: 0, criadoEm: 0, ...extra });
const contorno = [{ lat: -20.45, lon: -54.62 }, { lat: -20.45, lon: -54.61 }, { lat: -20.44, lon: -54.61 }, { lat: -20.44, lon: -54.62 }];

const base = (extra: Partial<DadosRastro> = {}): DadosRastro => ({
  prop, propsTotal: 1, lotes: [lote(1), lote(2)], animais: [], gtas: [], vendas: [], lancamentos: [], sanidade: [], hoje: '2026-11-24', ...extra,
});

describe('rastreabilidade', () => {
  it('números dos documentos', () => {
    expect(carValido('MS-5002704-0123.4567.89AB.CDEF.0123.4567.89ab.cdef')).toBe(true);
    expect(carValido('MS-500-123')).toBe(false);
    expect(sisbovValido('105 500 012 345 678')).toBe(true);
    expect(sisbovValido('12345')).toBe(false);
    expect(anoItrEsperado('2026-09-30')).toBe(2025);
    expect(anoItrEsperado('2026-10-01')).toBe(2026);
  });

  it('fazenda sem nada cadastrado tem nota baixa e diz o que falta', () => {
    const itens = conferirRastreabilidade(base());
    const nivel = Object.fromEntries(itens.map((i) => [i.chave, i.nivel]));
    expect(nivel).toMatchObject({ sede: 'ruim', contorno: 'ruim', car: 'ruim', itr: 'ruim', pnib: 'atencao', gtaEntrada: 'bom', sanidade: 'ruim' });
    expect(notaRastreabilidade(itens)).toBeLessThan(40);
  });

  it('fazenda em dia', () => {
    const p: Propriedade = { ...prop, lat: -20.445, lon: -54.615, contorno, semDesmate: true, car: 'MS-5002704-0123456789ABCDEF0123456789ABCDEF', carSituacao: 'ativo', cib: '12345678', itrAno: 2026, ccir: '123', ccirAno: 2026, codEstab: '5000123' };
    const itens = conferirRastreabilidade(base({
      prop: p, hoje: '2026-11-24',
      animais: [{ id: 1, loteId: 1, brinco: '1', sisbov: '105500012345678', ativo: true, criadoEm: 0 }],
      sanidade: [1, 2].map((l) => ({ loteId: l, data: '2026-05-01', feito: true, tipo: 'vacina' as const, produto: 'Aftosa', criadoEm: 0 })),
    }));
    expect(itens.filter((i) => i.nivel !== 'bom')).toEqual([]);
    expect(notaRastreabilidade(itens)).toBe(100);
  });

  it('ITR atrasado depois de setembro e CAR pendente', () => {
    const itens = conferirRastreabilidade(base({ prop: { ...prop, cib: '12345678', itrAno: 2025, car: 'MS-5002704-0123456789ABCDEF0123456789ABCDEF', carSituacao: 'pendente' } }));
    expect(itens.find((i) => i.chave === 'itr')).toMatchObject({ nivel: 'ruim' });
    expect(itens.find((i) => i.chave === 'itr')!.texto).toMatch(/2026/);
    expect(itens.find((i) => i.chave === 'car')).toMatchObject({ nivel: 'ruim' });
  });

  it('GTA de entrada dos lotes comprados e de saída das vendas', () => {
    const lotes = [lote(1), lote(2)];
    const compra = { data: '2026-01-10', tipo: 'despesa' as const, categoria: 'compra_animais' as const, valor: 1, loteId: 1, origem: 'compra_lote' as const, criadoEm: 0 };
    expect(lotesSemGtaEntrada(lotes, [], [compra]).map((l) => l.id)).toEqual([1]);
    expect(lotesSemGtaEntrada(lotes, [gta({ loteId: 1 })], [compra])).toEqual([]);
    const venda = { loteId: 2, data: '2026-10-01', tipo: 'venda' as const, cabecas: 15, valorBruto: 1, valorLiquido: 1, criadoEm: 0 };
    expect(vendasSemGta(lotes, [gta({ loteId: 2, sentido: 'saida', machos: 10 })], [venda])).toEqual([{ lote: lotes[1], vendidas: 15, comGta: 10 }]);
    expect(vendasSemGta(lotes, [gta({ loteId: 2, sentido: 'saida', machos: 10, femeas: 5 })], [venda])).toEqual([]);
  });

  it('animais sem lote (Cria) contam quando há uma fazenda só', () => {
    const animais = [{ id: 1, loteId: null, brinco: '7', ativo: true, criadoEm: 0 }, { id: 2, loteId: 1, brinco: '8', sisbov: '105500012345678', ativo: true, criadoEm: 0 }] as DadosRastro['animais'];
    expect(conferirRastreabilidade(base({ animais })).find((i) => i.chave === 'pnib')!.texto).toMatch(/1 de 2/);
    expect(conferirRastreabilidade(base({ animais, propsTotal: 2 })).find((i) => i.chave === 'pnib')!.texto).toMatch(/1 de 1/);
  });

  it('ficha do lote para o comprador', () => {
    const f = fichaLote({
      prop: { ...prop, contorno, car: 'MS-5002704-0123456789ABCDEF0123456789ABCDEF', carSituacao: 'ativo', semDesmate: true },
      lote: lote(1), hoje: '2026-11-24',
      animais: [{ id: 1, loteId: 1, brinco: '12', sisbov: '105500012345678', chip: '982000123456789', sexo: 'macho', ativo: true, criadoEm: 0 }],
      gtas: [gta({ loteId: 1, outroNome: 'Faz. Boa Vista', outroMunicipio: 'Jaraguari', outroUf: 'MS', finalidade: 'recria' }), gta({ loteId: 2 })],
      pesagens: [{ loteId: 1, data: '2026-02-01', tipo: 'media', pesoMedio: 250, qtdPesada: 20, criadoEm: 0 }],
      sanidade: [{ loteId: 1, data: '2026-05-01', feito: true, tipo: 'vacina', produto: 'Clostridiose', criadoEm: 0 }],
    });
    expect(f.titulo).toBe('Rastreabilidade · Lote 1');
    expect(f.nomeArquivo).toBe('rastreabilidade-lote-1');
    const gtas = f.blocos.find((b) => 'titulo' in b && b.titulo === 'GTAs (trânsito)') as { linhas: unknown[][] };
    expect(gtas.linhas).toHaveLength(1);
    expect(gtas.linhas[0][5]).toBe('Faz. Boa Vista · Jaraguari/MS');
    const an = f.blocos.find((b) => 'titulo' in b && b.titulo === 'Animais') as { linhas: unknown[][] };
    expect(an.linhas[0].slice(0, 3)).toEqual(['12', '105500012345678', '982000123456789']);
    expect(f.resumo).toMatch(/CAR: ativo/);
    expect(f.resumo).toMatch(/Sem desmatamento/);
    expect(f.resumo).toMatch(/1\/1 com código oficial/);
  });
});
