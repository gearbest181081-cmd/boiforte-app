import { describe, it, expect } from 'vitest';
import { seMudarGmd, seSegurar, simularCompra } from './simulacao';

describe('simulador de compra (aba SIMULADOR MACHO 1º LOTE)', () => {
  const r = simularCompra({ pesoEntrada: 200, precoCompra: 3260, dias: 108, precoArroba: 320, custoKgSuplemento: 1.7, consumoPctPV: 0.003, gmd: 0.75, rendimento: 0.5, maoObraMes: 20, outrosCab: 20, oportunidadeMes: 0.01 });
  it('reproduz os números da planilha', () => {
    expect(r.pesoFinal).toBe(281);
    expect(r.consumoDia).toBeCloseTo(0.7215, 6);
    expect(r.custoSuplemento).toBeCloseTo(132.4674, 4);
    expect(r.custoMaoObra).toBeCloseTo(72, 6);
    expect(r.valorVenda).toBeCloseTo(2997.33, 2); // planilha: R$ 2.997,33/cab
    expect(r.custoTotal).toBeCloseTo(3605.87, 2);
    expect(r.lucro).toBeCloseTo(2997.33 - 3605.87, 1);
  });
  it('break-even de compra zera o lucro', () => {
    const z = simularCompra({ pesoEntrada: 200, precoCompra: r.breakEvenCompra, dias: 108, precoArroba: 320, custoKgSuplemento: 1.7, consumoPctPV: 0.003, gmd: 0.75, rendimento: 0.5, maoObraMes: 20, outrosCab: 20, oportunidadeMes: 0.01 });
    expect(z.lucro).toBeCloseTo(0, 6);
  });
  it('ágio da compra', () => {
    expect(r.agioPorArroba).toBeCloseTo(3260 / (200 * 0.5 / 15) - 320, 6);
  });
});

describe('E se', () => {
  it('subir o GMD de 0,600 para 0,800 antecipa a saída', () => {
    const s = seMudarGmd(300, 450, 0.6, 0.8, 5)!;
    expect(s.diasAtual).toBe(250);
    expect(s.diasNovo).toBe(188);
    expect(s.antecipa).toBe(62);
    expect(s.economiaCab).toBe(310);
  });
  it('segurar 30 dias com a @ travada', () => {
    const s = seSegurar({ pesoHoje: 480, gmd: 0.9, dias: 30, rendimento: 0.5, arrobaHoje: 310, arrobaTravada: 330, custoDiaCab: 12 });
    expect(s.pesoFuturo).toBe(507);
    expect(s.retornoCab).toBeCloseTo(507 * 0.5 / 15 * 330 - 480 * 0.5 / 15 * 310 - 360, 6);
  });
});
