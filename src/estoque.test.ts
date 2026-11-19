import { describe, it, expect } from 'vitest';
import { consumoMedioDia, precoMedioAposCompra, saldo, situacao } from './estoque';

describe('estoque', () => {
  const movs = [
    { data: '2026-11-01', tipo: 'entrada' as const, kg: 1000 },
    { data: '2026-11-10', tipo: 'saida' as const, kg: 100 },
    { data: '2026-11-11', tipo: 'saida' as const, kg: 100 },
    { data: '2026-11-12', tipo: 'ajuste' as const, kg: -50 },
  ];
  it('saldo com entrada, saída e ajuste', () => expect(saldo(movs)).toBe(750));
  it('preço médio ponderado', () => {
    expect(precoMedioAposCompra(500, 1.0, 500, 1.4)).toBeCloseTo(1.2, 9);
    expect(precoMedioAposCompra(-20, 1.0, 100, 1.4)).toBeCloseTo(1.4, 9);
  });
  it('consumo médio desde a primeira saída da janela', () => {
    expect(consumoMedioDia(movs, '2026-11-11')).toBeCloseTo(100, 9);
    expect(consumoMedioDia(movs, '2026-11-14')).toBeCloseTo(40, 9);
  });
  it('avisa quando vai acabar', () => {
    const s = situacao([{ data: '2026-11-01', tipo: 'entrada', kg: 500 }], '2026-11-14', 7, 100);
    expect(s.nivel).toBe('atencao');
    expect(s.acabaEm).toBe('2026-11-19');
    expect(situacao([{ data: '2026-11-01', tipo: 'entrada', kg: 200 }], '2026-11-14', 7, 100).nivel).toBe('ruim');
    expect(situacao([{ data: '2026-11-01', tipo: 'entrada', kg: 5000 }], '2026-11-14', 7, 100).nivel).toBe('bom');
    expect(situacao([], '2026-11-14', 7, 100).texto).toContain('Acabou');
  });
});
