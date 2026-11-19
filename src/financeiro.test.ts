import { describe, it, expect } from 'vitest';
import { cabecaDias, cabecasNoDia, calcularVenda, custoCompra, drePeriodo, dreLote, fluxoCaixa, ratear, variacao, type LoteFin, type VendaFin } from './financeiro';

describe('compra e venda (planilha)', () => {
  it('custo de compra do Macho 1º lote: 30 × 3.260 × 1,02 + 850 = R$ 100.606', () => {
    expect(custoCompra(30, 3260, 0.02, 850, 0)).toBeCloseTo(100606, 6);
  });
  it('venda por cabeça como na planilha: 30 × 3.950, frete 200, comissão 2%', () => {
    const v = calcularVenda({ cabecas: 30, pesoMedio: 0, rendimento: 0.5, modo: 'cabeca', preco: 3950, comissaoPct: 0.02, frete: 200 });
    expect(v.liquido).toBeCloseTo(118500 - 2370 - 200, 6);
    expect(v.liquidoCab).toBeCloseTo(115930 / 30, 6); // mesma fórmula da coluna Q da planilha
  });
  it('venda por arroba', () => {
    const v = calcularVenda({ cabecas: 10, pesoMedio: 360, rendimento: 0.5, modo: 'arroba', preco: 320, comissaoPct: 0, frete: 0 });
    expect(v.arrobasCab).toBe(12);
    expect(v.bruto).toBe(38400);
  });
});

const A: LoteFin = { id: 1, nome: 'A', dataEntrada: '2026-11-01', qtdCabecas: 30 };
const B: LoteFin = { id: 2, nome: 'B', dataEntrada: '2026-11-16', qtdCabecas: 10 };

describe('cabeças e rateio', () => {
  const saidas: VendaFin[] = [{ loteId: 1, data: '2026-11-10', tipo: 'venda', cabecas: 10, valorLiquido: 1 }];
  it('cabeças no dia considera saídas', () => {
    const a = { ...A, qtdCabecas: 20 };
    expect(cabecasNoDia(a, saidas, '2026-10-31')).toBe(0);
    expect(cabecasNoDia(a, saidas, '2026-11-10')).toBe(30);
    expect(cabecasNoDia(a, saidas, '2026-11-11')).toBe(20);
    expect(cabecaDias(a, saidas, '2026-11-01', '2026-11-30')).toBe(30 * 10 + 20 * 20);
  });
  it('lançamento indireto é dividido por cabeça-dia do mês', () => {
    // A: 30 cab × 30 dias = 900; B: 10 × 15 = 150 → A recebe 900/1050
    const r = ratear([A, B], [], [{ data: '2026-11-05', tipo: 'despesa', categoria: 'mao_obra', valor: 1050, loteId: null }], [], '2026-11-30');
    expect(r.get(1)).toBeCloseTo(900, 6);
    expect(r.get(2)).toBeCloseTo(150, 6);
  });
  it('custo fixo mensal vira valor diário por cabeça (salário do vaqueiro)', () => {
    const r = ratear([A], [], [], [{ nome: 'Vaqueiro', valorMensal: 1300, desde: '2026-01-01' }], '2026-11-30');
    expect(r.get(1)).toBeCloseTo((1300 * 12 / 365) * 30, 6);
  });
  it('lançamento direto do lote não entra no rateio', () => {
    const r = ratear([A, B], [], [{ data: '2026-11-05', tipo: 'despesa', categoria: 'sanidade', valor: 500, loteId: 1 }], [], '2026-11-30');
    expect(r.get(1)).toBe(0);
  });
});

describe('DRE do lote', () => {
  const pontos = [{ data: '2026-09-28', peso: 200 }, { data: '2026-11-27', peso: 245 }];
  const base = {
    lote: { id: 1, nome: 'M', dataEntrada: '2026-09-28', qtdCabecas: 30 }, pontos, gmdMeta: 0.75, saidas: [] as VendaFin[],
    lancamentos: [
      { data: '2026-09-28', tipo: 'despesa' as const, categoria: 'compra_animais' as const, valor: 100606, loteId: 1 },
      { data: '2026-09-24', tipo: 'despesa' as const, categoria: 'sanidade' as const, valor: 855, loteId: 1 },
    ],
    fornecimentos: [{ loteId: 1, data: '2026-10-10', custo: 3000 }], rateio: 2000, precoArroba: 320, rendimento: 0.5, taxaOportunidadeMes: 0.01, ate: '2026-11-27',
  };
  it('soma os custos, calcula oportunidade, valor do rebanho e resultado', () => {
    const d = dreLote(base);
    expect(d.dias).toBe(60);
    expect(d.custoTotal).toBeCloseTo(100606 + 855 + 3000 + 2000, 6);
    expect(d.oportunidade).toBeCloseTo((100606 + (855 + 3000 + 2000) / 2) * 0.01 * 2, 6);
    expect(d.valorRebanho).toBeCloseTo(30 * (245 * 0.5 / 15) * 320, 6);
    expect(d.arrobasProduzidas).toBeCloseTo(30 * 45 * 0.5 / 15, 6);
    expect(d.custoArrobaProduzida).toBeCloseTo((855 + 3000 + 2000) / 45, 6);
    expect(d.resultado).toBeCloseTo(d.valorRebanho - d.custoTotal - d.oportunidade, 6);
  });
  it('lote vendido: receita da venda e @ pelo peso de saída', () => {
    const d = dreLote({ ...base, lote: { ...base.lote, qtdCabecas: 0, encerrado: true, dataSaida: '2026-11-27' }, saidas: [{ loteId: 1, data: '2026-11-27', tipo: 'venda', cabecas: 30, pesoMedio: 250, valorLiquido: 115000 }] });
    expect(d.cabecasEntrada).toBe(30);
    expect(d.cabecasAtuais).toBe(0);
    expect(d.valorRebanho).toBe(0);
    expect(d.receitas).toBe(115000);
    expect(d.arrobasProduzidas).toBeCloseTo(30 * 50 * 0.5 / 15, 6);
  });
});

describe('DRE do período e fluxo de caixa', () => {
  const lanc = [
    { data: '2026-10-05', tipo: 'despesa' as const, categoria: 'pasto' as const, valor: 1000 },
    { data: '2026-11-05', tipo: 'receita' as const, categoria: 'outras_receitas' as const, valor: 300 },
  ];
  const vendas: VendaFin[] = [{ loteId: 1, data: '2026-11-20', tipo: 'venda', cabecas: 10, valorLiquido: 30000 }];
  it('DRE por competência', () => {
    const d = drePeriodo('2026-10-01', '2026-11-30', lanc, vendas, [{ loteId: 1, data: '2026-10-10', custo: 500 }], [{ nome: 'v', valorMensal: 365 / 12 * 10, desde: '2026-01-01' }]);
    expect(d.totalReceitas).toBe(30300);
    expect(d.despesas.nutricao).toBe(500);
    expect(d.despesas.fixos).toBeCloseTo(10 * 61, 6);
    expect(d.resultado).toBeCloseTo(30300 - 1000 - 500 - 610, 6);
  });
  it('fluxo de caixa por mês com saldo acumulado', () => {
    const f = fluxoCaixa('2026-10-01', '2026-11-30', lanc, vendas, [{ data: '2026-10-02', valor: 2000 }], [{ nome: 'v', valorMensal: 1300, desde: '2026-01-01' }]);
    expect(f.map((m) => m.mes)).toEqual(['2026-10', '2026-11']);
    expect(f[0].saidas).toBe(1000 + 2000 + 1300);
    expect(f[1].entradas).toBe(30300);
    expect(f[1].acumulado).toBeCloseTo(-4300 + 30300 - 1300, 6);
  });
  it('variação percentual', () => {
    expect(variacao(100, 105)).toBeCloseTo(0.05, 9);
    expect(variacao(null, 105)).toBeNull();
  });
});
