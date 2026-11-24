// Contorno do piquete (lista de pontos {lat, lon}, 6 casas): área em hectares, leitura de KML/GeoJSON
// e o contorno gravado andando em volta do piquete com o GPS do celular. É o contorno que o satélite usa (NDVI).
// Mesmo formato do contorno da fazenda (rastreabilidade): quem juntar com src/geo.ts pode trocar uma pela outra.

export interface Ponto { lat: number; lon: number }

export const MAX_PONTOS = 500;
const R = 6_378_137; // raio da Terra (m), o mesmo do WGS84
const rad = (g: number) => (g * Math.PI) / 180;
const seis = (v: number) => Math.round(v * 1e6) / 1e6;

export function pontoValido(p: unknown): p is Ponto {
  const x = p as Ponto;
  return !!x && Number.isFinite(x.lat) && Number.isFinite(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180;
}

/** Área do polígono em hectares (fórmula esférica, a mesma usada por mapas; erro < 0,5% em piquetes). */
export function areaHa(pontos: Ponto[]): number {
  if (pontos.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pontos.length; i++) {
    const a = pontos[i], b = pontos[(i + 1) % pontos.length];
    s += rad(b.lon - a.lon) * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
  }
  return Math.abs((s * R * R) / 2) / 10_000;
}

/** Distância em metros entre dois pontos. */
export function distancia(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Arruma o contorno: 6 casas, sem pontos repetidos, sem fechar no primeiro ponto e no máximo MAX_PONTOS (tira pontos de forma uniforme). */
export function limparContorno(pontos: Ponto[]): Ponto[] {
  let out: Ponto[] = [];
  for (const p of pontos) {
    if (!pontoValido(p)) continue;
    const q = { lat: seis(p.lat), lon: seis(p.lon) };
    const ult = out[out.length - 1];
    if (!ult || ult.lat !== q.lat || ult.lon !== q.lon) out.push(q);
  }
  if (out.length > 1 && out[0].lat === out[out.length - 1].lat && out[0].lon === out[out.length - 1].lon) out.pop();
  if (out.length > MAX_PONTOS) {
    const passo = out.length / MAX_PONTOS;
    out = Array.from({ length: MAX_PONTOS }, (_, i) => out[Math.floor(i * passo)]);
  }
  return out;
}

/** Lê o primeiro polígono de um arquivo KML (Google Earth, CAR) ou GeoJSON. Devolve null se não achar. */
export function lerContorno(texto: string): Ponto[] | null {
  const t = texto.trim();
  if (t.startsWith('{')) {
    try { return doGeoJson(JSON.parse(t)); } catch { return null; }
  }
  const m = /<coordinates>([\s\S]*?)<\/coordinates>/i.exec(t);
  if (!m) return null;
  const pts = m[1].trim().split(/\s+/).map((par) => {
    const [lon, lat] = par.split(',').map(Number);
    return { lat, lon };
  });
  const c = limparContorno(pts);
  return c.length >= 3 ? c : null;
}

function doGeoJson(g: unknown): Ponto[] | null {
  const o = g as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown };
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'FeatureCollection') {
    for (const f of o.features ?? []) { const c = doGeoJson(f); if (c) return c; }
    return null;
  }
  if (o.type === 'Feature') return doGeoJson(o.geometry);
  let anel: unknown;
  if (o.type === 'Polygon') anel = (o.coordinates as unknown[])?.[0];
  else if (o.type === 'MultiPolygon') anel = (o.coordinates as unknown[][])?.[0]?.[0];
  if (!Array.isArray(anel)) return null;
  const c = limparContorno(anel.map((p) => ({ lon: Number((p as number[])[0]), lat: Number((p as number[])[1]) })));
  return c.length >= 3 ? c : null;
}

/** GeoJSON do piquete (para o satélite e para exportar). */
export function paraGeoJson(pontos: Ponto[]) {
  const anel = pontos.map((p) => [p.lon, p.lat]);
  if (anel.length) anel.push(anel[0]);
  return { type: 'Polygon' as const, coordinates: [anel] };
}

/**
 * Gravação do contorno andando em volta do piquete. Só aceita leitura com precisão de até 25 m
 * e pontos a pelo menos 5 m do anterior (o GPS parado "anda" sozinho).
 */
export const PRECISAO_MAX_M = 25;
export const PASSO_MIN_M = 5;
export function aceitarPonto(trilha: Ponto[], p: Ponto, precisaoM: number): boolean {
  if (!pontoValido(p) || !(precisaoM <= PRECISAO_MAX_M)) return false;
  const ult = trilha[trilha.length - 1];
  return !ult || distancia(ult, p) >= PASSO_MIN_M;
}
