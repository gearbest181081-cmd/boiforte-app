import { describe, it, expect } from 'vitest';
import { anel, lerResposta, pedidoEstatistica } from '../../supabase/functions/_shared/ndvi';

describe('NDVI (função do satélite)', () => {
  const c = [{ lat: -20.1, lon: -54.1 }, { lat: -20.1, lon: -54.11 }, { lat: -20.11, lon: -54.11 }];
  it('monta o pedido com o contorno fechado e o período certo', () => {
    const p = pedidoEstatistica(c, null, '2026-11-24')!;
    expect(p.input.bounds.geometry.coordinates[0]).toEqual([[-54.1, -20.1], [-54.11, -20.1], [-54.11, -20.11], [-54.1, -20.1]]);
    expect(p.aggregation.timeRange.from).toBe('2026-07-27T00:00:00Z');
    expect(pedidoEstatistica(c, '2026-11-10', '2026-11-24')!.aggregation.timeRange.from).toBe('2026-10-31T00:00:00Z');
    expect(anel([{ lat: 99, lon: 0 }, ...c])).toBeNull();
    expect(pedidoEstatistica([c[0]], null, '2026-11-24')).toBeNull();
  });
  it('lê a resposta, calcula a nuvem e descarta o que não presta', () => {
    const r = {
      data: [
        { interval: { from: '2026-11-01T00:00:00Z' }, outputs: { ndvi: { bands: { B0: { stats: { mean: 0.71234, min: 0.2, max: 0.9, sampleCount: 1000, noDataCount: 100 } } } } } },
        { interval: { from: '2026-11-06T00:00:00Z' }, outputs: { ndvi: { bands: { B0: { stats: { mean: 'NaN', sampleCount: 1000, noDataCount: 1000 } } } } } },
        { interval: { from: '2026-11-11T00:00:00Z' }, error: { type: 'EXECUTION_ERROR' } },
        { interval: { from: 'lixo' }, outputs: { ndvi: { bands: { B0: { stats: { mean: 0.5, sampleCount: 10, noDataCount: 0 } } } } } },
        { interval: { from: '2026-11-16T00:00:00Z' }, outputs: { ndvi: { bands: { B0: { stats: { mean: 5, sampleCount: 10, noDataCount: 0 } } } } } },
      ],
    };
    expect(lerResposta(r)).toEqual([{ data: '2026-11-01', ndvi: 0.712, min: 0.2, max: 0.9, nuvemPct: 10 }]);
    expect(lerResposta(null)).toEqual([]);
  });
});
