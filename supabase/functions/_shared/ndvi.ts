// NDVI do Sentinel-2 pela Statistical API do Copernicus Data Space (gratuita, com conta).
// Sem dependências: roda no Deno da função "ndvi" e nos testes do app.
// Nunca confiamos na resposta: cada número passa por limites antes de ir para o banco (gravar_ndvi confere de novo).

export const CDSE_TOKEN = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
export const CDSE_ESTATISTICA = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';
/** Primeira busca de um piquete: 120 dias para trás (base de comparação). Depois, desde a última leitura menos 10 dias. */
export const DIAS_HISTORICO = 120;

/**
 * NDVI = (B08 - B04) / (B08 + B04). Pixels de nuvem, sombra de nuvem, cirro e neve (classes SCL 3, 8, 9, 10, 11)
 * ficam de fora; a fração que ficou de fora vira "nuvemPct".
 */
export const EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
           output: [{ id: "ndvi", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1 }] };
}
function evaluatePixel(s) {
  var nuvem = [3, 8, 9, 10, 11].indexOf(s.SCL) >= 0;
  var soma = s.B08 + s.B04;
  var v = soma > 0 ? (s.B08 - s.B04) / soma : 0;
  return { ndvi: [v], dataMask: [s.dataMask === 1 && !nuvem && soma > 0 ? 1 : 0] };
}`;

export interface Ponto { lat: number; lon: number }
export interface Leitura { data: string; ndvi: number; min?: number; max?: number; nuvemPct: number }

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function somaDias(data: string, dias: number): string {
  return new Date(Date.parse(data + 'T00:00:00Z') + dias * 86400000).toISOString().slice(0, 10);
}

/** Contorno vindo do banco → anel GeoJSON fechado (lon, lat). Recusa contorno torto. */
export function anel(contorno: unknown): number[][] | null {
  if (!Array.isArray(contorno) || contorno.length < 3 || contorno.length > 500) return null;
  const pts: number[][] = [];
  for (const p of contorno as Ponto[]) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
    pts.push([p.lon, p.lat]);
  }
  pts.push(pts[0]);
  return pts;
}

/** Corpo do pedido à Statistical API para um piquete. */
export function pedidoEstatistica(contorno: unknown, ultima: string | null, hoje: string) {
  const a = anel(contorno);
  if (!a) return null;
  const de = ultima && RE_DATA.test(ultima) ? somaDias(ultima, -10) : somaDias(hoje, -DIAS_HISTORICO);
  return {
    input: {
      bounds: { geometry: { type: 'Polygon', coordinates: [a] }, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC', maxCloudCoverage: 80 } }],
    },
    aggregation: {
      timeRange: { from: `${de}T00:00:00Z`, to: `${hoje}T23:59:59Z` },
      aggregationInterval: { of: 'P5D' },
      resx: 0.0001, resy: 0.0001, // ~10 m, a resolução das bandas B04/B08
      evalscript: EVALSCRIPT,
    },
    calculations: { default: {} },
  };
}

const n3 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1 ? Math.round(v * 1000) / 1000 : undefined);

/** Resposta da Statistical API → leituras. Intervalo sem pixel bom (tudo nuvem) fica de fora. */
export function lerResposta(r: unknown): Leitura[] {
  const dados = (r as { data?: unknown[] })?.data;
  if (!Array.isArray(dados)) return [];
  const out: Leitura[] = [];
  for (const item of dados) {
    const it = item as { interval?: { from?: string }; outputs?: { ndvi?: { bands?: { B0?: { stats?: Record<string, unknown> } } } }; error?: unknown };
    if (it.error) continue;
    const data = String(it.interval?.from ?? '').slice(0, 10);
    const st = it.outputs?.ndvi?.bands?.B0?.stats;
    if (!RE_DATA.test(data) || !st) continue;
    const media = n3(st.mean);
    const total = Number(st.sampleCount), sem = Number(st.noDataCount);
    if (media === undefined || !(total > 0) || !(sem >= 0) || sem >= total) continue;
    out.push({ data, ndvi: media, min: n3(st.min), max: n3(st.max), nuvemPct: Math.round((sem / total) * 1000) / 10 });
  }
  return out;
}
