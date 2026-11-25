import { describe, it, expect } from 'vitest';
import { areaHa, centro, distanciaM, geojsonEudr, lerContornoArquivo, lerCoord, pareceBrasil, perimetroM, simplificar, type Ponto } from './geo';

// Quadrado de ~1 km x ~1 km perto de Campo Grande (0,009° de latitude ≈ 1 km).
const q: Ponto[] = [{ lat: -20.45, lon: -54.62 }, { lat: -20.45, lon: -54.6104 }, { lat: -20.441, lon: -54.6104 }, { lat: -20.441, lon: -54.62 }];

describe('geo', () => {
  it('área e perímetro do contorno', () => {
    expect(areaHa(q)).toBeGreaterThan(98);
    expect(areaHa(q)).toBeLessThan(102);
    expect(areaHa([...q, q[0]])).toBeCloseTo(areaHa(q), 6); // anel fechado dá o mesmo
    expect(perimetroM(q)).toBeGreaterThan(3900);
    expect(perimetroM(q)).toBeLessThan(4100);
    expect(areaHa(q.slice(0, 2))).toBe(0);
    expect(distanciaM(q[0], q[3])).toBeCloseTo(1001.9, -1);
    expect(centro(q)).toEqual({ lat: -20.4455, lon: -54.6152 });
  });

  it('lê GeoJSON (fica com a maior área) e KML do CAR', () => {
    const anel = (ps: Ponto[]) => [...ps, ps[0]].map((p) => [p.lon, p.lat]);
    const pequeno = q.map((p) => ({ lat: p.lat / 1.0001, lon: p.lon })).slice(0, 3);
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [anel(pequeno)] } },
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[anel(q)]] } },
    ] });
    expect(lerContornoArquivo(gj)).toHaveLength(4);
    const kml = `<?xml version="1.0"?><kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
      ${anel(q).map(([lon, lat]) => `${lon},${lat},0`).join(' ')}
      </coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>-54.615,-20.445,0 -54.614,-20.445,0 -54.614,-20.444,0</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark></kml>`;
    const k = lerContornoArquivo(kml);
    expect(k).toHaveLength(4);
    expect(areaHa(k)).toBeCloseTo(areaHa(q), 3);
    expect(() => lerContornoArquivo('PK\u0003\u0004 zip')).toThrow(/kml/);
    expect(() => lerContornoArquivo('{"type":"Point","coordinates":[1,2]}')).toThrow(/polígono/);
  });

  it('simplifica contorno com pontos demais sem perder a área', () => {
    const muitos: Ponto[] = [];
    for (let i = 0; i < 5000; i++) { const a = (i / 5000) * 2 * Math.PI; muitos.push({ lat: -20 + 0.01 * Math.sin(a), lon: -54 + 0.01 * Math.cos(a) }); }
    const s = simplificar(muitos, 300);
    expect(s.length).toBeLessThanOrEqual(300);
    expect(Math.abs(areaHa(s) - areaHa(muitos)) / areaHa(muitos)).toBeLessThan(0.01);
  });

  it('arquivo para a União Europeia (EUDR)', () => {
    const j = JSON.parse(geojsonEudr({ nome: 'Fazenda Canaã', produtor: 'Luiz', municipio: 'Campo Grande', uf: 'MS', contorno: q }));
    const f = j.features[0];
    expect(j.type).toBe('FeatureCollection');
    expect(f.geometry.type).toBe('Polygon');
    expect(f.geometry.coordinates[0]).toHaveLength(5); // fechado
    expect(f.geometry.coordinates[0][0]).toEqual([-54.62, -20.45]); // lon, lat
    expect(f.properties).toMatchObject({ ProductionPlace: 'Fazenda Canaã', ProducerCountry: 'BR', ProducerName: 'Luiz', Municipality: 'Campo Grande/MS' });
    expect(f.properties.Area).toBeGreaterThan(98);
    // até 4 ha basta o ponto; acima disso precisa do contorno
    const p = JSON.parse(geojsonEudr({ nome: 'Sítio', sede: { lat: -20.1234567, lon: -54.1 }, areaHa: 3 }));
    expect(p.features[0].geometry).toEqual({ type: 'Point', coordinates: [-54.1, -20.123457] });
    expect(() => geojsonEudr({ nome: 'Grande', sede: { lat: -20, lon: -54 }, areaHa: 500 })).toThrow(/contorno/);
  });

  it('coordenadas digitadas', () => {
    expect(lerCoord('20,5 S', 'lat')).toBe(-20.5);
    expect(lerCoord('-54.62', 'lon')).toBe(-54.62);
    expect(lerCoord('54,62 W', 'lon')).toBe(-54.62);
    expect(lerCoord('200', 'lon')).toBeNull();
    expect(pareceBrasil({ lat: -20, lon: -54 })).toBe(true);
    expect(pareceBrasil({ lat: 20, lon: 54 })).toBe(false);
  });
});
