// Geolocalização da fazenda: ponto da sede, contorno (polígono) e arquivo para a exportação à União Europeia (EUDR).
// Tudo funciona sem internet: o GPS do celular funciona no pasto, e o mapa é desenhado pelo próprio app.

export interface Ponto { lat: number; lon: number }

/** Máximo de pontos do contorno guardados (o arquivo do CAR pode ter milhares: simplificamos). */
export const MAX_PONTOS_CONTORNO = 2000;
/** A EUDR pede o polígono para áreas acima de 4 ha; abaixo disso, basta um ponto. */
export const EUDR_HA_SO_PONTO = 4;
/** Data de corte da EUDR: a área não pode ter sido desmatada depois dela. */
export const EUDR_DATA_CORTE = '2020-12-31';

/** Seis casas decimais (cerca de 10 cm), como pede a EUDR. */
export const arred6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function pontoValido(p: Partial<Ponto> | null | undefined): p is Ponto {
  return !!p && typeof p.lat === 'number' && typeof p.lon === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    && p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
}

/** O Brasil fica entre 34°S e 6°N, 74°W e 28°W: fora disso, provavelmente lat e lon foram trocadas ou falta o sinal de menos. */
export function pareceBrasil(p: Ponto): boolean {
  return p.lat >= -34.5 && p.lat <= 6 && p.lon >= -74.5 && p.lon <= -28;
}

const R = 6_378_137; // raio da Terra (m), o mesmo do WGS84

/** Distância em metros entre dois pontos. */
export function distanciaM(a: Ponto, b: Ponto): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Área do polígono em hectares (fórmula esférica; erro bem menor que 1% para uma fazenda). */
export function areaHa(pontos: Ponto[]): number {
  const ps = semFechamento(pontos);
  if (ps.length < 3) return 0;
  const rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    s += (b.lon - a.lon) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs((s * R * R) / 2) / 10_000;
}

/** Perímetro em metros. */
export function perimetroM(pontos: Ponto[]): number {
  const ps = semFechamento(pontos);
  if (ps.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < ps.length; i++) s += distanciaM(ps[i], ps[(i + 1) % ps.length]);
  return s;
}

/** Tira o último ponto quando ele repete o primeiro (anel fechado do GeoJSON/KML). */
export function semFechamento(pontos: Ponto[]): Ponto[] {
  if (pontos.length > 1) {
    const a = pontos[0], b = pontos[pontos.length - 1];
    if (a.lat === b.lat && a.lon === b.lon) return pontos.slice(0, -1);
  }
  return pontos;
}

/** Centro aproximado (média dos pontos). */
export function centro(pontos: Ponto[]): Ponto | null {
  const ps = semFechamento(pontos);
  if (!ps.length) return null;
  return { lat: arred6(ps.reduce((s, p) => s + p.lat, 0) / ps.length), lon: arred6(ps.reduce((s, p) => s + p.lon, 0) / ps.length) };
}

/** Diminui a quantidade de pontos mantendo o desenho (Douglas-Peucker, em metros), até caber no limite. */
export function simplificar(pontos: Ponto[], max = MAX_PONTOS_CONTORNO): Ponto[] {
  let ps = semFechamento(pontos);
  if (ps.length <= max) return ps;
  const ref = ps[0];
  const m = 111_320, mLon = m * Math.cos((ref.lat * Math.PI) / 180);
  const xy = ps.map((p) => [(p.lon - ref.lon) * mLon, (p.lat - ref.lat) * m]);
  const manter = (tol: number) => {
    const marca = new Uint8Array(xy.length); marca[0] = 1; marca[xy.length - 1] = 1;
    const pilha: [number, number][] = [[0, xy.length - 1]];
    while (pilha.length) {
      const [i, j] = pilha.pop()!;
      const [x1, y1] = xy[i], [x2, y2] = xy[j];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      let maior = -1, k = -1;
      for (let n = i + 1; n < j; n++) {
        const d = Math.abs(dy * xy[n][0] - dx * xy[n][1] + x2 * y1 - y2 * x1) / len;
        if (d > maior) { maior = d; k = n; }
      }
      if (k > 0 && maior > tol) { marca[k] = 1; pilha.push([i, k], [k, j]); }
    }
    return ps.filter((_, i) => marca[i]);
  };
  let tol = 1;
  let r = manter(tol);
  while (r.length > max && tol < 1e6) { tol *= 1.6; r = manter(tol); }
  ps = r;
  return ps;
}

export class ErroGeo extends Error { constructor(m: string) { super(m); this.name = 'ErroGeo'; } }

const MAX_ARQUIVO_GEO = 20 * 1024 * 1024;

/**
 * Lê o contorno de um arquivo GeoJSON ou KML (o CAR e o Google Earth exportam KML).
 * Quando há várias áreas, fica com a maior (a fazenda); buracos (reserva dentro) são ignorados.
 */
export function lerContornoArquivo(texto: string): Ponto[] {
  if (texto.length > MAX_ARQUIVO_GEO) throw new ErroGeo('Arquivo grande demais.');
  const t = texto.trim();
  let aneis: Ponto[][] = [];
  if (t.startsWith('{') || t.startsWith('[')) {
    let j: unknown;
    try { j = JSON.parse(t); } catch { throw new ErroGeo('Não consegui ler este arquivo GeoJSON.'); }
    aneis = aneisGeoJson(j);
  } else if (/<kml|<coordinates/i.test(t)) {
    aneis = aneisKml(t);
  } else {
    throw new ErroGeo('Use um arquivo .kml ou .geojson (o shapefile .zip do CAR não é lido: abra no Google Earth e salve como KML).');
  }
  const validos = aneis.map((a) => semFechamento(a.filter(pontoValido))).filter((a) => a.length >= 3);
  if (!validos.length) throw new ErroGeo('O arquivo não tem nenhuma área (polígono).');
  const maior = validos.reduce((m, a) => (areaHa(a) > areaHa(m) ? a : m));
  return simplificar(maior).map((p) => ({ lat: arred6(p.lat), lon: arred6(p.lon) }));
}

function aneisGeoJson(j: unknown): Ponto[][] {
  const out: Ponto[][] = [];
  const anel = (c: unknown) => (Array.isArray(c) ? c.filter((x) => Array.isArray(x) && x.length >= 2).map((x) => ({ lon: Number(x[0]), lat: Number(x[1]) })) : []);
  const visitar = (g: unknown, prof = 0) => {
    if (!g || typeof g !== 'object' || prof > 6) return;
    const o = g as { type?: string; features?: unknown[]; geometry?: unknown; geometries?: unknown[]; coordinates?: unknown };
    if (o.type === 'FeatureCollection' && Array.isArray(o.features)) o.features.slice(0, 5000).forEach((f) => visitar(f, prof + 1));
    else if (o.type === 'Feature') visitar(o.geometry, prof + 1);
    else if (o.type === 'GeometryCollection' && Array.isArray(o.geometries)) o.geometries.forEach((x) => visitar(x, prof + 1));
    else if (o.type === 'Polygon' && Array.isArray(o.coordinates)) out.push(anel(o.coordinates[0]));
    else if (o.type === 'MultiPolygon' && Array.isArray(o.coordinates)) o.coordinates.forEach((p) => Array.isArray(p) && out.push(anel(p[0])));
  };
  visitar(j);
  return out;
}

function aneisKml(t: string): Ponto[][] {
  const out: Ponto[][] = [];
  // Só o contorno de fora de cada polígono (outerBoundaryIs); se não houver, qualquer <coordinates> com 3+ pontos.
  const externos = [...t.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)].map((m) => m[1]);
  const blocos = externos.length ? externos : [...t.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)].map((m) => m[1]);
  for (const b of blocos) {
    const ps = b.trim().split(/\s+/).map((tr) => tr.split(',')).filter((x) => x.length >= 2).map((x) => ({ lon: Number(x[0]), lat: Number(x[1]) }));
    out.push(ps);
  }
  return out;
}

export interface DadosEudr { nome: string; produtor?: string; municipio?: string; uf?: string; car?: string; sede?: Ponto | null; contorno?: Ponto[] | null; areaHa?: number | null }

/**
 * Arquivo GeoJSON no formato aceito pelo sistema da UE (EUDR): coordenadas WGS84 com 6 casas,
 * polígono fechado (ou ponto, se a área for de até 4 ha), com o nome do lugar, a área e o país.
 */
export function geojsonEudr(d: DadosEudr): string {
  const contorno = d.contorno ? semFechamento(d.contorno) : [];
  const area = contorno.length >= 3 ? areaHa(contorno) : d.areaHa ?? 0;
  let geometry: unknown;
  if (contorno.length >= 3) {
    const anel = contorno.map((p) => [arred6(p.lon), arred6(p.lat)]);
    anel.push(anel[0]);
    geometry = { type: 'Polygon', coordinates: [anel] };
  } else if (d.sede && area > 0 && area <= EUDR_HA_SO_PONTO) {
    geometry = { type: 'Point', coordinates: [arred6(d.sede.lon), arred6(d.sede.lat)] };
  } else {
    throw new ErroGeo(d.sede ? 'Acima de 4 ha a União Europeia pede o contorno da fazenda, não só o ponto da sede.' : 'Marque o contorno da fazenda primeiro.');
  }
  const props: Record<string, unknown> = {
    ProductionPlace: d.nome,
    ProducerCountry: 'BR',
    Area: Math.round(area * 100) / 100,
  };
  if (d.produtor) props.ProducerName = d.produtor;
  if (d.municipio || d.uf) props.Municipality = [d.municipio, d.uf].filter(Boolean).join('/');
  if (d.car) props.CAR = d.car;
  return JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry }] }, null, 1);
}

/** "-20,123456" → "20,123456° S". */
export function fmtCoord(v: number, eixo: 'lat' | 'lon'): string {
  const h = eixo === 'lat' ? (v < 0 ? 'S' : 'N') : v < 0 ? 'O' : 'L';
  return `${Math.abs(v).toFixed(6).replace('.', ',')}° ${h}`;
}

/** Lê uma coordenada digitada: aceita "-20,5", "20.5 S", "54,6 O" / "W". */
export function lerCoord(texto: string, eixo: 'lat' | 'lon'): number | null {
  const t = texto.trim().toUpperCase();
  if (!t) return null;
  const negHemisferio = eixo === 'lat' ? /\bS(UL)?\b/.test(t) : /\b(O|W|OESTE)\b/.test(t);
  const m = t.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let v = Number(m[0]);
  if (negHemisferio && v > 0) v = -v;
  const lim = eixo === 'lat' ? 90 : 180;
  return Number.isFinite(v) && Math.abs(v) <= lim ? arred6(v) : null;
}

/** Pede a posição ao GPS do celular. */
export function posicaoAtual(): Promise<{ ponto: Ponto; precisaoM: number }> {
  return new Promise((ok, erro) => {
    if (!navigator.geolocation) return erro(new ErroGeo('Este celular não informa a localização.'));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ ponto: { lat: arred6(p.coords.latitude), lon: arred6(p.coords.longitude) }, precisaoM: Math.round(p.coords.accuracy) }),
      (e) => erro(new ErroGeo(e.code === 1 ? 'Permita o acesso à localização para o BoiForte nas configurações do celular.' : 'Não consegui pegar a localização. Vá para um lugar aberto e tente de novo.')),
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
  });
}
