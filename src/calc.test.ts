import { describe, it, expect } from 'vitest';
import { gmd, resumo, projetar, arrobas, desvioMeta, periodos, somaDias, diasEntre, fmtGmd, fmtData } from './calc';

const pts = [
  { data: '2026-09-28', peso: 200 },
  { data: '2026-10-28', peso: 222 },
  { data: '2026-11-27', peso: 246 },
];

describe('GMD e resumo', () => {
  it('calcula GMD entre duas pesagens', () => {
    expect(gmd(pts[0], pts[1])).toBeCloseTo(22 / 30, 6);
  });
  it('retorna null quando a data não avança', () => {
    expect(gmd(pts[1], pts[0])).toBeNull();
    expect(gmd(pts[0], pts[0])).toBeNull();
  });
  it('ordena as pesagens e resume', () => {
    const r = resumo([pts[2], pts[0], pts[1]]);
    expect(r.pesoInicial).toBe(200);
    expect(r.pesoAtual).toBe(246);
    expect(r.gmdTotal).toBeCloseTo(46 / 60, 6);
    expect(r.gmdUltimo).toBeCloseTo(24 / 30, 6);
    expect(r.diasAcompanhados).toBe(60);
  });
  it('lida com lote sem pesagem', () => {
    expect(resumo([]).pesoAtual).toBeNull();
  });
  it('lista os períodos', () => {
    const p = periodos(pts);
    expect(p).toHaveLength(2);
    expect(p[1].ganho).toBe(24);
  });
});

describe('Projeção', () => {
  it('usa o GMD do último período', () => {
    const p = projetar(pts, 360, 0.75)!;
    expect(p.origemGmd).toBe('ultimo');
    expect(p.diasFaltando).toBe(Math.ceil((360 - 246) / 0.8));
    expect(p.dataPrevista).toBe(somaDias('2026-11-27', p.diasFaltando));
  });
  it('usa a meta quando só tem a pesagem de entrada', () => {
    const p = projetar([pts[0]], 360, 0.75)!;
    expect(p.origemGmd).toBe('meta');
    expect(p.diasFaltando).toBe(214); // (360-200)/0.75 = 213,3
  });
  it('usa o GMD total quando o último período foi negativo', () => {
    const p = projetar([...pts, { data: '2026-12-07', peso: 244 }], 360)!;
    expect(p.origemGmd).toBe('total');
  });
  it('avisa que já atingiu o peso', () => {
    expect(projetar(pts, 240)!.jaAtingiu).toBe(true);
  });
  it('sem GMD nenhum não projeta', () => {
    expect(projetar([pts[0]], 360)).toBeNull();
  });
});

describe('Arrobas e meta (mesmas fórmulas da planilha)', () => {
  it('arroba de carcaça = PV × rendimento ÷ 15', () => {
    expect(arrobas(360)).toBe(12);
    expect(arrobas(200, 0.52)).toBeCloseTo(6.9333, 3);
  });
  it('desvio da meta', () => {
    expect(desvioMeta(0.668, 0.75)).toBeCloseTo(-0.1093, 3);
    expect(desvioMeta(0.8, null)).toBeNull();
  });
});

describe('Datas e formatação', () => {
  it('conta dias atravessando mês e ano', () => {
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
    expect(somaDias('2026-09-30', 108)).toBe('2027-01-16');
  });
  it('formata em pt-BR', () => {
    expect(fmtGmd(0.75)).toBe('0,750 kg/dia');
    expect(fmtData('2026-09-28')).toBe('28/09/2026');
  });
});

import { pesoEstimado } from './calc';
describe('peso estimado para o trato', () => {
  it('soma o GMD do último período aos dias desde a pesagem', () => {
    expect(pesoEstimado(pts, '2026-12-07')).toBeCloseTo(246 + 0.8 * 10, 6);
    expect(pesoEstimado(pts, '2026-11-01')).toBe(246);
    expect(pesoEstimado([pts[0]], '2026-10-08', 0.75)).toBeCloseTo(207.5, 6);
    expect(pesoEstimado([], '2026-10-08', 0.75)).toBeNull();
  });
});
