import { describe, it, expect } from 'vitest';
import { alertasDoLote, ordenarAlertas } from './alertas';

const lote = { nome: 'Lote 5', pesoAlvo: 360, gmdMeta: 0.75 };

describe('alertas', () => {
  it('avisa GMD 11% abaixo da meta', () => {
    const a = alertasDoLote(lote, [{ data: '2026-10-01', peso: 250 }, { data: '2026-10-31', peso: 270 }], '2026-11-05');
    expect(a[0].nivel).toBe('ruim');
    expect(a[0].titulo).toBe('Lote 5 está 11% abaixo do GMD projetado');
  });
  it('avisa perda de peso', () => {
    const a = alertasDoLote(lote, [{ data: '2026-10-01', peso: 250 }, { data: '2026-10-31', peso: 245 }], '2026-11-05');
    expect(a[0].titulo).toContain('perdeu peso');
  });
  it('avisa muitos dias sem pesar', () => {
    const a = alertasDoLote(lote, [{ data: '2026-09-01', peso: 250 }], '2026-11-05');
    expect(a.some((x) => x.titulo.includes('dias sem pesar'))).toBe(true);
  });
  it('avisa peso alvo atingido e perto', () => {
    expect(alertasDoLote(lote, [{ data: '2026-10-01', peso: 340 }, { data: '2026-10-31', peso: 362 }], '2026-11-05').some((x) => x.titulo.includes('atingiu'))).toBe(true);
    expect(alertasDoLote(lote, [{ data: '2026-10-01', peso: 320 }, { data: '2026-10-31', peso: 345 }], '2026-11-01').some((x) => x.titulo.includes('perto'))).toBe(true);
  });
  it('lote sem pesagem e lote encerrado', () => {
    expect(alertasDoLote(lote, [], '2026-11-05')[0].titulo).toContain('sem pesagem');
    expect(alertasDoLote({ ...lote, encerrado: true }, [], '2026-11-05')).toEqual([]);
  });
  it('ordena do pior para o melhor', () => {
    const o = ordenarAlertas([{ nivel: 'bom', titulo: '', texto: '' }, { nivel: 'ruim', titulo: '', texto: '' }]);
    expect(o[0].nivel).toBe('ruim');
  });
});
