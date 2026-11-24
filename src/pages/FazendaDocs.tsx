// Documentos e localização da fazenda: sede no GPS, contorno da divisa (para a União Europeia), CAR, ITR, CCIR,
// código do estabelecimento. Tudo funciona sem internet (o GPS não precisa de sinal de celular).
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Propriedade, type SituacaoCar } from '../db';
import {
  areaHa, centro, distanciaM, ErroGeo, EUDR_DATA_CORTE, fmtCoord, geojsonEudr, lerContornoArquivo, MAX_PONTOS_CONTORNO, pareceBrasil,
  perimetroM, posicaoAtual, semFechamento, type Ponto,
} from '../geo';
import { carValido, cibValido, limparCar, SITUACOES_CAR, anoItrEsperado } from '../rastreabilidade';
import { compartilharArquivo } from '../exportar';
import { fmtData, fmtNum, hojeISO } from '../calc';
import { CampoEscolha, CampoNumero, CampoTexto, num, Topo, useAviso } from '../components/ui';
import { usePapel } from '../nuvem/useNuvem';

export function FazendaDocs() {
  const { id } = useParams();
  const prop = useLiveQuery(() => db.propriedades.get(Number(id)), [id]);
  if (prop === undefined) return <Topo titulo="Documentos e localização" />;
  if (!prop) return (<><Topo titulo="Documentos e localização" /><main><p>Fazenda não encontrada.</p><Link to="/fazenda" className="btn sec largo">Ver as fazendas</Link></main></>);
  return (
    <>
      <Topo titulo="Documentos e localização" />
      <main>
        <h2 style={{ marginTop: 0 }}>{prop.nome}</h2>
        <Localizacao p={prop} />
        <Documentos p={prop} />
        <Link to={`/rastreabilidade?fazenda=${prop.id}`} className="btn sec largo">Ver a rastreabilidade da fazenda</Link>
      </main>
    </>
  );
}

const fmtM = (m: number) => (m >= 1000 ? `${fmtNum(m / 1000, 2)} km` : `${Math.round(m)} m`);

function Localizacao({ p }: { p: Propriedade }) {
  const aviso = useAviso();
  const papel = usePapel();
  const podeMudar = papel !== 'vaqueiro' && papel !== 'consultor';
  const arquivo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<'' | 'sede' | 'ponto'>('');
  const [lat, setLat] = useState<string | null>(null);
  const [lon, setLon] = useState<string | null>(null);
  const contorno = semFechamento(p.contorno ?? []);
  const area = contorno.length >= 3 ? areaHa(contorno) : 0;
  const vLat = lat ?? (p.lat != null ? String(p.lat).replace('.', ',') : '');
  const vLon = lon ?? (p.lon != null ? String(p.lon).replace('.', ',') : '');

  const salvar = (mud: Partial<Propriedade>) => db.propriedades.update(p.id!, mud);

  const gpsSede = async () => {
    setOcupado('sede');
    try {
      const { ponto, precisaoM } = await posicaoAtual();
      await salvar({ lat: ponto.lat, lon: ponto.lon });
      setLat(null); setLon(null);
      aviso(`Sede marcada (precisão de ${precisaoM} m).`);
    } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(''); }
  };
  const salvarDigitado = async () => {
    const la = num(vLat), lo0 = num(vLon);
    if (la == null || lo0 == null || Math.abs(la) > 90 || Math.abs(lo0) > 180) return aviso('Confira a latitude (−90 a 90) e a longitude (−180 a 180).', true);
    const lo = lo0 > 0 ? -lo0 : lo0; // no Brasil a longitude é sempre oeste (negativa)
    const ponto = { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
    await salvar(ponto);
    setLat(null); setLon(null);
    aviso(pareceBrasil(ponto) ? 'Localização salva.' : 'Salvo, mas o ponto ficou fora do Brasil. No sul do Equador a latitude é negativa (ex.: −20,45).', !pareceBrasil(ponto));
  };
  const marcarPonto = async () => {
    if (contorno.length >= MAX_PONTOS_CONTORNO) return aviso('Chegou no limite de pontos.', true);
    setOcupado('ponto');
    try {
      const { ponto, precisaoM } = await posicaoAtual();
      const ultimo = contorno[contorno.length - 1];
      if (ultimo && distanciaM(ultimo, ponto) < 3) return aviso('Você ainda está no mesmo lugar do último ponto. Ande pela divisa e marque de novo.', true);
      await salvar({ contorno: [...contorno, ponto] });
      aviso(`Ponto ${contorno.length + 1} marcado (precisão de ${precisaoM} m).`);
    } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(''); }
  };
  const desfazer = async () => { if (contorno.length) await salvar({ contorno: contorno.slice(0, -1) }); };
  const apagar = async () => { if (window.confirm('Apagar o contorno da fazenda?')) await salvar({ contorno: [] }); };
  const importar = async (f: File) => {
    try {
      const ps = lerContornoArquivo(await f.text());
      if (contorno.length && !window.confirm(`Trocar o contorno atual por este do arquivo (${ps.length} pontos, ${fmtNum(areaHa(ps), 1)} ha)?`)) return;
      const mud: Partial<Propriedade> = { contorno: ps };
      if (p.lat == null) { const c = centro(ps); if (c) { mud.lat = c.lat; mud.lon = c.lon; } }
      await salvar(mud);
      aviso(`Contorno trazido: ${ps.length} pontos, ${fmtNum(areaHa(ps), 1)} ha.`);
    } catch (e) { aviso(e instanceof ErroGeo ? e.message : 'Não consegui ler este arquivo.', true); }
  };
  const exportar = async () => {
    try {
      const sede = p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null;
      const texto = geojsonEudr({ nome: p.nome, produtor: p.produtor, municipio: p.municipio, uf: p.uf, car: p.car ? limparCar(p.car) : undefined, sede, contorno, areaHa: p.areaHa });
      const nome = `${p.nome}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').toLowerCase();
      const r = await compartilharArquivo(new TextEncoder().encode(texto), `eudr-${nome}.geojson`, 'application/geo+json', `Geolocalização · ${p.nome}`);
      if (r === 'baixado') aviso('Arquivo salvo em Downloads. Mande para o comprador ou o frigorífico.');
    } catch (e) { aviso(e instanceof ErroGeo ? e.message : 'Não consegui gerar o arquivo.', true); }
  };

  return (
    <div className="cartao" data-testid="localizacao">
      <h3>Localização (exportação para a União Europeia)</h3>
      <p className="mudo">A União Europeia só compra carne de fazendas com a localização marcada e sem desmatamento depois de {fmtData(EUDR_DATA_CORTE)} (regra EUDR). O GPS funciona sem sinal de celular.</p>
      <MapaContorno contorno={contorno} sede={p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null} />

      <h4>Sede</h4>
      {p.lat != null && p.lon != null
        ? <p data-testid="sede">{fmtCoord(p.lat, 'lat')}, {fmtCoord(p.lon, 'lon')}</p>
        : <p className="mudo">Ainda não marcada.</p>}
      {podeMudar && <>
        <button className="btn largo" onClick={gpsSede} disabled={!!ocupado}>{ocupado === 'sede' ? 'Pegando o GPS…' : '📍 Estou na sede: marcar aqui'}</button>
        <details style={{ marginTop: 8 }}>
          <summary>Digitar as coordenadas</summary>
          <div className="grade" style={{ marginTop: 8 }}>
            <CampoNumero rotulo="Latitude" valor={vLat} aoMudar={setLat} nome="lat" dica="Ex.: −20,469711" />
            <CampoNumero rotulo="Longitude" valor={vLon} aoMudar={setLon} nome="lon" dica="Ex.: −54,620121" />
          </div>
          <button className="btn sec pequeno" onClick={salvarDigitado}>Salvar coordenadas</button>
        </details>
      </>}

      <h4>Contorno da divisa</h4>
      {contorno.length >= 3
        ? <p data-testid="contorno"><b>{fmtNum(area, 1)} ha</b> · {contorno.length} pontos · perímetro {fmtM(perimetroM(contorno))}{p.areaHa ? <span className="mudo"> (cadastro: {fmtNum(p.areaHa, 1)} ha)</span> : null}</p>
        : <p className="mudo">{contorno.length ? `${contorno.length} ponto(s) marcado(s). São precisos pelo menos 3.` : 'Traga o arquivo do CAR (KML) ou ande pela divisa marcando um ponto em cada canto.'}</p>}
      {p.areaHa && contorno.length >= 3 && Math.abs(area - p.areaHa) / p.areaHa > 0.15 && (
        <div className="alerta atencao"><span className="ic">⚠️</span><div><b>Área diferente do cadastro</b>O contorno dá {fmtNum(area, 1)} ha e o cadastro diz {fmtNum(p.areaHa, 1)} ha. Confira os pontos.</div></div>
      )}
      {podeMudar && <>
        <div className="botoes">
          <button className="btn sec" onClick={() => arquivo.current?.click()}>Trazer arquivo (KML ou GeoJSON)</button>
          <button className="btn sec" onClick={marcarPonto} disabled={!!ocupado}>{ocupado === 'ponto' ? 'Pegando o GPS…' : '+ Marcar ponto aqui'}</button>
        </div>
        {contorno.length > 0 && (
          <div className="botoes">
            <button className="btn sec pequeno" onClick={desfazer}>Desfazer último ponto</button>
            <button className="btn perigo pequeno" onClick={apagar}>Apagar contorno</button>
          </div>
        )}
        <input ref={arquivo} type="file" accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json,application/json" hidden data-testid="arquivoContorno"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ''; }} />
        <small className="mudo">No site do CAR (car.gov.br) baixe o “demonstrativo” ou abra o shapefile no Google Earth e salve como KML.</small>
      </>}
      <button className="btn largo" style={{ marginTop: 12 }} onClick={exportar} disabled={contorno.length < 3 && p.lat == null}>Baixar arquivo para a União Europeia (GeoJSON)</button>
    </div>
  );
}

/** Desenho do contorno e da sede (sem mapa de fundo: funciona sem internet). */
function MapaContorno({ contorno, sede }: { contorno: Ponto[]; sede: Ponto | null }) {
  const pts = [...contorno, ...(sede ? [sede] : [])];
  if (!pts.length) return null;
  const minLat = Math.min(...pts.map((p) => p.lat)), maxLat = Math.max(...pts.map((p) => p.lat));
  const minLon = Math.min(...pts.map((p) => p.lon)), maxLon = Math.max(...pts.map((p) => p.lon));
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const w = Math.max((maxLon - minLon) * k, 1e-6), h = Math.max(maxLat - minLat, 1e-6);
  const L = 300, esc = (L - 20) / Math.max(w, h);
  const xy = (p: Ponto) => [10 + (p.lon - minLon) * k * esc, 10 + (maxLat - p.lat) * esc];
  const alt = Math.max(60, h * esc + 20);
  return (
    <svg viewBox={`0 0 ${L} ${alt}`} role="img" aria-label="Desenho do contorno da fazenda" style={{ width: '100%', maxHeight: 260, background: "var(--fundo)", border: "1px solid var(--borda)", borderRadius: 8, margin: '8px 0' }}>
      {contorno.length >= 2 && (
        <polygon points={contorno.map((p) => xy(p).join(',')).join(' ')} fill="var(--verde-claro)" fillOpacity={0.8} stroke="var(--verde-2)" strokeWidth={2} strokeLinejoin="round" />
      )}
      {contorno.length <= 60 && contorno.map((p, i) => { const [x, y] = xy(p); return <circle key={i} cx={x} cy={y} r={3} fill="var(--verde-2)" />; })}
      {sede && (() => { const [x, y] = xy(sede); return <g><circle cx={x} cy={y} r={6} fill="var(--alerta)" /><text x={x + 8} y={y + 4} fontSize={12} fill="currentColor">Sede</text></g>; })()}
    </svg>
  );
}

function Documentos({ p }: { p: Propriedade }) {
  const aviso = useAviso();
  const papel = usePapel();
  const podeMudar = papel !== 'vaqueiro' && papel !== 'consultor';
  const [f, setF] = useState(() => ({
    produtor: p.produtor ?? '', car: p.car ?? '', carSituacao: p.carSituacao ?? '', cib: p.cib ?? '', itrAno: p.itrAno ? String(p.itrAno) : '',
    ccir: p.ccir ?? '', ccirAno: p.ccirAno ? String(p.ccirAno) : '', codEstab: p.codEstab ?? '', ie: p.ie ?? '', semDesmate: !!p.semDesmate,
  }));
  const m = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const ano = (v: string) => { const n = num(v); return n != null && Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null; };
  const esperado = anoItrEsperado(hojeISO());

  const salvar = async () => {
    if (f.itrAno && ano(f.itrAno) == null) return aviso('O ano do ITR deve ser como 2025.', true);
    if (f.ccirAno && ano(f.ccirAno) == null) return aviso('O ano do CCIR deve ser como 2025.', true);
    await db.propriedades.update(p.id!, {
      produtor: f.produtor.trim() || undefined, car: f.car.trim() ? limparCar(f.car) : undefined, carSituacao: (f.carSituacao || undefined) as SituacaoCar | undefined,
      cib: f.cib.replace(/[\s.-]/g, '') || undefined, itrAno: ano(f.itrAno), ccir: f.ccir.trim() || undefined, ccirAno: ano(f.ccirAno),
      codEstab: f.codEstab.trim() || undefined, ie: f.ie.trim() || undefined, semDesmate: f.semDesmate,
    });
    const avisos = [f.car && !carValido(f.car) ? 'o número do CAR' : '', f.cib && !cibValido(f.cib) ? 'o CIB (8 números)' : ''].filter(Boolean);
    aviso(avisos.length ? `Salvo. Confira ${avisos.join(' e ')}.` : 'Documentos salvos.', avisos.length > 0);
  };

  return (
    <div className="cartao" data-testid="documentos">
      <h3>Documentos da fazenda</h3>
      <p className="mudo">Com tudo em dia, o frigorífico e o comprador confiam mais no seu gado. Os números ficam só no app; os documentos originais continuam com você.</p>
      <CampoTexto rotulo="Nome do produtor (como no CAR)" valor={f.produtor} aoMudar={m('produtor')} nome="produtor" />
      <CampoTexto rotulo="Recibo do CAR" valor={f.car} aoMudar={m('car')} nome="car" formato="codigo" dica={f.car && !carValido(f.car) ? 'Formato: UF-1234567-seguido de 32 letras e números.' : 'Cadastro Ambiental Rural (car.gov.br).'} />
      <CampoEscolha rotulo="Situação do CAR" valor={f.carSituacao} aoMudar={m('carSituacao')} nome="carSituacao">
        <option value="">Não sei</option>
        {Object.entries(SITUACOES_CAR).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </CampoEscolha>
      <div className="grade">
        <CampoTexto rotulo="CIB / NIRF (ITR)" valor={f.cib} aoMudar={m('cib')} nome="cib" formato="digitos" dica="Número do imóvel na Receita." />
        <CampoNumero rotulo="ITR entregue em" valor={f.itrAno} aoMudar={m('itrAno')} nome="itrAno" dica={`Ano da última declaração. Hoje deveria ser ${esperado}.`} />
      </div>
      <div className="grade">
        <CampoTexto rotulo="CCIR (INCRA)" valor={f.ccir} aoMudar={m('ccir')} nome="ccir" formato="digitos" />
        <CampoNumero rotulo="CCIR pago em" valor={f.ccirAno} aoMudar={m('ccirAno')} nome="ccirAno" />
      </div>
      <CampoTexto rotulo="Código do estabelecimento (defesa do estado)" valor={f.codEstab} aoMudar={m('codEstab')} nome="codEstab" formato="codigo" dica="O número da fazenda que sai na GTA. Usado no PNIB." />
      <CampoTexto rotulo="Inscrição estadual de produtor" valor={f.ie} aoMudar={m('ie')} nome="ie" formato="codigo" />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '12px 0' }}>
        <input type="checkbox" checked={f.semDesmate} onChange={(e) => setF((x) => ({ ...x, semDesmate: e.target.checked }))} style={{ width: 28, minHeight: 28, flex: 'none' }} disabled={!podeMudar} />
        <span>Declaro que a área de criação <b>não foi desmatada depois de {fmtData(EUDR_DATA_CORTE)}</b> (exigência da União Europeia).</span>
      </label>
      {podeMudar ? <button className="btn largo" onClick={salvar}>Salvar documentos</button> : <p className="mudo">Só o dono e o gerente mudam os documentos.</p>}
    </div>
  );
}
