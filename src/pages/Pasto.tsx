// Telas do Pasto: os módulos com a lotação (UA/ha), a situação de cada piquete (ocupado, descansando, pronto),
// o NDVI do satélite e os avisos; a ficha do piquete; e "Mudar o gado de piquete" com foto e áudio do capim.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, pontosDoLote, type Ndvi, type Ocupacao, type Piquete } from '../db';
import { diasEntre, fmtData, fmtNum, hojeISO, pesoEstimado } from '../calc';
import {
  alvosPiquete, analisarNdvi, CAPINS, entrarNoPiquete, excluirOcupacao, ocupantesAtuais, pressaoPastejo, resumoPasto, sairDoPiquete,
  type EstadoPiquete, type MidiaNova, type ResumoModulo, type TipoOcupante,
} from '../pasto';
import { aceitarPonto, areaHa, lerContorno, limparContorno, type Ponto } from '../pastoGeo';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, Indicador, num, Topo, useAviso, useOnline } from '../components/ui';
import { CapturaMidias, VerMidias } from '../components/Midias';
import { atualizarNdvi, nuvemConfigurada } from '../nuvem/cliente';
import { sincronizarAgora, useEstadoNuvem, usePapel } from '../nuvem/useNuvem';

const SITUACAO: Record<EstadoPiquete['situacao'], { nome: string; classe: string }> = {
  ocupado: { nome: 'Com gado', classe: 'atencao' },
  descansando: { nome: 'Descansando', classe: '' },
  pronto: { nome: 'Pronto para entrar', classe: 'bom' },
  sem_uso: { nome: 'Sem registro', classe: '' },
};
const SETA = { subindo: '↗', estavel: '→', caindo: '↘' } as const;
const corLotacao = (n: string) => (n === 'alta' ? 'ruim' : n === 'atencao' ? 'atencao' : n === 'ok' ? 'bom' : '');

function Avisos({ lista }: { lista: { nivel: string; titulo: string; texto: string }[] }) {
  return (
    <>
      {lista.map((a, i) => (
        <div key={i} className={`alerta ${a.nivel}`}>
          <span className="ic">{a.nivel === 'ruim' ? '⚠️' : a.nivel === 'atencao' ? '🔔' : '✅'}</span>
          <div><b>{a.titulo}</b>{a.texto}</div>
        </div>
      ))}
    </>
  );
}

/** O que dizer depois de consultar o satélite. */
export function mensagemSatelite(r: { piquetes: number; leituras: number; falhas?: number; motivo?: string }): string {
  const s = (n: number) => (n === 1 ? '' : 's');
  if (!r.piquetes && r.falhas) return `O satélite não respondeu para ${r.falhas} piquete${s(r.falhas)}${r.motivo ? ` (${r.motivo})` : ''}. Tente de novo mais tarde.`;
  if (!r.piquetes) return 'Nenhum piquete com contorno na nuvem ainda. Espere o celular sincronizar e tente de novo.';
  if (!r.leituras) return `Satélite consultado (${r.piquetes} piquete${s(r.piquetes)}), mas não há imagem nova sem nuvem. O satélite passa a cada ~5 dias.`;
  return `Satélite consultado: ${r.leituras} leitura${s(r.leituras)} nova${s(r.leituras)}. Abra o piquete para ver o gráfico do NDVI.`;
}

// ---------------------------------------------------------------- lista do pasto

export function Pasto() {
  const resumo = useLiveQuery(() => resumoPasto(), []);
  const papel = usePapel();
  const est = useEstadoNuvem();
  const online = useOnline();
  const aviso = useAviso();
  const [buscando, setBuscando] = useState(false);
  const podeSatelite = !!est?.fazenda && (papel === 'dono' || papel === 'gerente') && nuvemConfigurada();
  const semContorno = useLiveQuery(() => db.piquetes.filter((p) => !p.contorno || p.contorno.length < 3).count(), []);

  const satelite = async () => {
    if (!est?.fazenda) return;
    setBuscando(true);
    try {
      const r = await atualizarNdvi(est.fazenda.id);
      aviso(mensagemSatelite(r), !r.piquetes && !!r.falhas);
      if (r.leituras) sincronizarAgora().catch(() => {});
    } catch (e) { aviso((e as Error).message, true); } finally { setBuscando(false); }
  };

  return (
    <>
      <Topo titulo="Pasto" />
      <main>
        {resumo?.length === 0 && (
          <div className="dica">Cadastre os módulos e os piquetes em <Link to="/fazenda">Fazenda</Link>. Depois, mude o gado de piquete por aqui.</div>
        )}
        {resumo && resumo.length > 0 && <Link to="/pasto/mover" className="btn largo" data-testid="moverGado">🐂 Mudar o gado de piquete</Link>}
        {resumo?.map((r) => <CartaoModulo key={r.modulo.id} r={r} />)}
        <h2>Satélite (NDVI)</h2>
        <p className="mudo">
          O NDVI mede o verde do capim pela foto do satélite Sentinel-2 (a cada ~5 dias, sem nuvem). O app compara cada piquete com ele mesmo e com os
          vizinhos e avisa quando o verde cai antes de dar para ver a olho.
        </p>
        {!!semContorno && <div className="dica">{semContorno} piquete(s) sem contorno. Abra o piquete e grave o contorno andando em volta com o GPS ou importe o arquivo (KML do Google Earth).</div>}
        {podeSatelite && (
          <button className="btn sec largo" disabled={buscando || !online} onClick={satelite}>{buscando ? 'Consultando o satélite…' : '🛰️ Atualizar o satélite agora'}</button>
        )}
      </main>
    </>
  );
}

function CartaoModulo({ r }: { r: ResumoModulo }) {
  const { modulo: m, lotacao: l } = r;
  const rot = m.sistema !== 'continuo';
  return (
    <div className="cartao" data-testid="moduloPasto">
      <div className="linha-lote"><h3>{m.nome}</h3><span className="mudo">{rot ? 'Rotacionado' : 'Contínuo'}</span></div>
      <div className="grade">
        <Indicador rotulo="Lotação" valor={<>{fmtNum(l.uaHa, 2)} <small>UA/ha</small></>} sub={l.capacidade ? `Aguenta ${fmtNum(l.capacidade, 2)} UA/ha` : 'Sem capacidade gravada'} />
        <Indicador rotulo="Piquetes" valor={r.estados.length} sub={`${r.estados.filter((e) => e.situacao === 'ocupado').length} com gado`} />
      </div>
      {l.nivel !== 'sem_dados' && <p><span className={`etiqueta ${corLotacao(l.nivel)}`}>{l.nivel === 'alta' ? 'Lotação alta' : l.nivel === 'atencao' ? 'Perto do limite' : 'Lotação boa'}</span>{l.motivo}</p>}
      {rot && r.ideal && <p className="mudo">Com {r.estados.length} piquetes e {m.diasDescanso} dias de descanso, cada piquete deve ficar ocupado no máximo <b>{r.ideal} dias</b>.</p>}
      {rot && r.proximo && (
        <p>Próximo piquete: <b>{r.proximo.piquete.nome}</b>
          {r.proximo.diasDescanso != null ? ` (descansou ${r.proximo.diasDescanso} dias${r.proximo.situacao === 'descansando' && m.diasDescanso ? `; faltam ${m.diasDescanso - r.proximo.diasDescanso} para o descanso planejado` : ''})` : ''}
        </p>
      )}
      <Avisos lista={r.alertas} />
      {r.estados.map((e) => {
        const nd = r.ndvi.get(e.piquete.id!);
        return (
          <Link key={e.piquete.id} to={`/pasto/piquete/${e.piquete.id}`} className="linha-lote" style={{ padding: '10px 0', borderBottom: '1px solid var(--borda)', textDecoration: 'none', color: 'inherit' }}>
            <span>
              <b>{e.piquete.nome}</b> <span className={`etiqueta ${SITUACAO[e.situacao].classe}`}>{SITUACAO[e.situacao].nome}</span>
              <br />
              <span className="mudo">
                {e.situacao === 'ocupado' && `${e.ocupante?.nome ?? ''}${e.diasOcupado != null ? ` · ${e.diasOcupado} dias` : ''}${e.uaHa != null ? ` · ${fmtNum(e.uaHa, 1)} UA/ha` : ''}`}
                {(e.situacao === 'descansando' || e.situacao === 'pronto') && `${e.diasDescanso} dias de descanso${m.diasDescanso ? ` de ${m.diasDescanso}` : ''}`}
                {e.piquete.areaHa ? ` · ${fmtNum(e.piquete.areaHa, 1)} ha` : ''}
              </span>
            </span>
            <span className="mudo" title="NDVI do satélite">{nd?.atual ? `🛰️ ${fmtNum(nd.atual.ndvi, 2)} ${nd.tendencia ? SETA[nd.tendencia] : ''}` : ''}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- ficha do piquete

export function PiqueteDetalhe() {
  const { id } = useParams();
  const pid = Number(id);
  const aviso = useAviso();
  const papel = usePapel();
  const podeEditar = papel !== 'vaqueiro' && papel !== 'consultor';
  const dados = useLiveQuery(async () => {
    const p = await db.piquetes.get(pid);
    if (!p) return null;
    const modulo = await db.modulos.get(p.moduloId);
    const irmaos = await db.piquetes.where('moduloId').equals(p.moduloId).toArray();
    const ocs = (await db.ocupacoes.where('piqueteId').equals(pid).toArray()).sort((a, b) => (a.entrada < b.entrada ? 1 : -1));
    const ndvi = await db.ndvi.where('piqueteId').anyOf(irmaos.map((x) => x.id!)).toArray();
    const lotes = await db.lotes.toArray();
    const grupos = db.tables.some((t) => t.name === 'grupos') ? ((await db.table('grupos').toArray()) as { id: number; nome: string }[]) : [];
    const ocupante = (await ocupantesAtuais()).find((o) => o.piqueteId === pid);
    return { p, modulo, irmaos, ocs, ndvi, lotes, grupos, ocupante };
  }, [pid]);
  const [editar, setEditar] = useState(false);

  if (dados === undefined) return <Topo titulo="Piquete" />;
  if (dados === null) return (<><Topo titulo="Piquete" /><main><p>Piquete não encontrado.</p></main></>);
  const { p, modulo, irmaos, ocs, ndvi, lotes, grupos, ocupante } = dados;
  const nomeDe = (o: Pick<Ocupacao, 'tipo' | 'ocupanteId'>) => (o.tipo === 'lote' ? lotes.find((l) => l.id === o.ocupanteId)?.nome : grupos.find((g) => g.id === o.ocupanteId)?.nome) ?? '—';
  const hoje = hojeISO();
  const aberta = ocs.find((o) => !o.saida);
  const ultimaSaida = ocs.find((o) => o.saida);
  const alvos = alvosPiquete(p);
  const serie = (pq: number) => ndvi.filter((n) => n.piqueteId === pq);
  const estado = { situacao: (ocupante ? 'ocupado' : 'descansando') as EstadoPiquete['situacao'], diasDescanso: ultimaSaida?.saida ? diasEntre(ultimaSaida.saida, hoje) : undefined };
  const an = analisarNdvi(p.nome, serie(pid), irmaos.filter((x) => x.id !== pid).map((x) => serie(x.id!)), estado);
  const dias = aberta ? diasEntre(aberta.entrada, hoje) : null;
  const pp = aberta && aberta.massaEntrada && p.areaHa && aberta.pesoMedio
    ? pressaoPastejo({ cabecas: aberta.cabecas, pesoMedio: aberta.pesoMedio, massaKgMsHa: aberta.massaEntrada, areaHa: p.areaHa, dias: modulo?.diasOcupacao ?? Math.max(1, dias ?? 1) })
    : null;

  const apagarOcupacao = async (o: Ocupacao) => {
    if (!window.confirm(`Apagar o registro de ${nomeDe(o)} de ${fmtData(o.entrada)}? Os animais não mudam de lugar.`)) return;
    await excluirOcupacao(o.id!);
    aviso('Registro apagado.');
  };

  return (
    <>
      <Topo titulo={p.nome} />
      <main>
        <p className="mudo">{modulo?.nome}{p.capim ? ` · ${p.capim}` : ''}{p.areaHa ? ` · ${fmtNum(p.areaHa, 2)} ha` : ' · sem área'}</p>
        <div className="grade">
          <Indicador rotulo="Agora" valor={ocupante ? ocupante.nome ?? 'Com gado' : 'Vazio'} sub={ocupante ? `${ocupante.cabecas} cab${dias != null ? ` · ${dias} dias` : ''}` : ultimaSaida?.saida ? `Descansando há ${diasEntre(ultimaSaida.saida, hoje)} dias` : undefined} />
          <Indicador rotulo="Lotação" valor={<>{ocupante && p.areaHa ? fmtNum(((ocupante.pesoMedio ?? 0) * ocupante.cabecas) / 450 / p.areaHa, 2) : '0'} <small>UA/ha</small></>} />
          <Indicador rotulo="Altura para entrar / sair" valor={<>{alvos.entrada ?? '—'} / {alvos.saida ?? '—'} <small>cm</small></>} sub={alvos.deReferencia ? 'Referência do capim' : undefined} />
          <Indicador rotulo="Satélite (NDVI)" valor={an.atual ? <>{fmtNum(an.atual.ndvi, 2)} {an.tendencia ? SETA[an.tendencia] : ''}</> : '—'} sub={an.atual ? fmtData(an.atual.data) : 'Sem leitura'} />
        </div>
        {pp && (
          <p>
            Na entrada: pressão de pastejo de <b>{fmtNum(pp.pressao, 2)} kg de animal por kg de capim</b>
            {pp.oferta != null && <> e oferta de <b>{fmtNum(pp.oferta, 1)} kg de capim por 100 kg de animal por dia</b> <span className={`etiqueta ${pp.nivel === 'sobra' ? 'atencao' : pp.nivel ?? ''}`}>{pp.nivel === 'ruim' ? 'Pouco capim' : pp.nivel === 'atencao' ? 'Apertado' : pp.nivel === 'sobra' ? 'Sobra capim: cabe mais animal' : 'Bom'}</span></>}
            <span className="mudo"> (estimativa pela altura do capim)</span>
          </p>
        )}
        <Avisos lista={an.alertas} />
        <div className="botoes">
          {ocupante
            ? <Link className="btn" to={`/pasto/mover?de=${ocupante.tipo}:${ocupante.id}`}>Tirar ou mudar o gado</Link>
            : <Link className="btn" to={`/pasto/mover?para=${pid}`}>Colocar gado aqui</Link>}
        </div>

        <h2>Satélite</h2>
        <GraficoNdvi serie={serie(pid)} />
        {podeEditar && <Contorno p={p} />}
        {!podeEditar && !p.contorno?.length && <p className="mudo">Sem contorno: peça ao dono ou ao gerente para gravar.</p>}

        <h2>Entradas e saídas</h2>
        {ocs.length === 0 && <p className="mudo">Nenhum registro ainda.</p>}
        {ocs.map((o) => (
          <div key={o.id} className="cartao">
            <div className="linha-lote"><b>{nomeDe(o)}</b><span className="mudo">{o.cabecas} cab{o.pesoMedio ? ` · ${fmtNum(o.pesoMedio, 0)} kg` : ''}</span></div>
            <p><b>Entrou</b> em {fmtData(o.entrada)}{o.alturaEntrada ? ` com capim de ${o.alturaEntrada} cm` : ''}{o.massaEntrada ? ` (~${fmtNum(o.massaEntrada, 0)} kg MS/ha)` : ''}.</p>
            {o.notaEntrada && <p className="mudo">{o.notaEntrada}</p>}
            <VerMidias midias={o.midiasEntrada} />
            {o.saida ? (
              <>
                <p><b>Saiu</b> em {fmtData(o.saida)} ({diasEntre(o.entrada, o.saida)} dias){o.alturaSaida ? ` com capim de ${o.alturaSaida} cm` : ''}.
                  {o.alturaSaida != null && alvos.saida != null && o.alturaSaida < alvos.saida * 0.8 && <span className="etiqueta ruim">Saiu rapado</span>}
                </p>
                {o.notaSaida && <p className="mudo">{o.notaSaida}</p>}
                <VerMidias midias={o.midiasSaida} />
              </>
            ) : <p><span className="etiqueta atencao">Ainda no piquete</span></p>}
            {podeEditar && <button className="btn perigo pequeno" onClick={() => apagarOcupacao(o)}>Apagar registro</button>}
          </div>
        ))}

        {podeEditar && (editar ? <EditarPiquete p={p} fechar={() => setEditar(false)} /> : <button className="btn sec largo" onClick={() => setEditar(true)}>Editar piquete</button>)}
      </main>
    </>
  );
}

function GraficoNdvi({ serie }: { serie: Ndvi[] }) {
  const pts = [...serie].filter((x) => (x.nuvemPct ?? 0) <= 40).sort((a, b) => (a.data < b.data ? -1 : 1)).slice(-36);
  if (pts.length < 2) return <p className="mudo">{pts.length ? `Uma leitura: ${fmtNum(pts[0].ndvi, 2)} em ${fmtData(pts[0].data)}.` : 'Sem leituras do satélite ainda.'}</p>;
  const W = 340, H = 140, m = { e: 32, d: 8, t: 8, b: 22 };
  const x0 = Date.parse(pts[0].data), x1 = Date.parse(pts[pts.length - 1].data);
  const sx = (d: string) => m.e + ((Date.parse(d) - x0) / Math.max(1, x1 - x0)) * (W - m.e - m.d);
  const sy = (v: number) => H - m.b - (Math.max(0, Math.min(1, v)) / 1) * (H - m.t - m.b);
  const linha = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.data).toFixed(1)},${sy(p.ndvi).toFixed(1)}`).join(' ');
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="NDVI do piquete ao longo do tempo">
      {[0.2, 0.4, 0.6, 0.8].map((v) => (
        <g key={v}>
          <line x1={m.e} x2={W - m.d} y1={sy(v)} y2={sy(v)} stroke="var(--borda)" />
          <text x={m.e - 4} y={sy(v) + 4} fontSize="11" textAnchor="end" fill="var(--texto-2)">{fmtNum(v, 1)}</text>
        </g>
      ))}
      <rect x={m.e} y={sy(0.35)} width={W - m.e - m.d} height={sy(0) - sy(0.35)} fill="var(--alerta-claro)" opacity={0.5} />
      <path d={linha} fill="none" stroke="var(--verde)" strokeWidth={2.5} />
      {pts.map((p) => <circle key={p.data} cx={sx(p.data)} cy={sy(p.ndvi)} r={3} fill="var(--verde)" />)}
      <text x={m.e} y={H - 6} fontSize="11" fill="var(--texto-2)">{fmtData(pts[0].data).slice(0, 5)}</text>
      <text x={W - m.d} y={H - 6} fontSize="11" textAnchor="end" fill="var(--texto-2)">{fmtData(pts[pts.length - 1].data).slice(0, 5)}</text>
    </svg>
  );
}

/** Contorno do piquete: andando em volta com o GPS ou importando o arquivo (KML/GeoJSON). */
function Contorno({ p }: { p: Piquete }) {
  const aviso = useAviso();
  const arquivo = useRef<HTMLInputElement>(null);
  const [trilha, setTrilha] = useState<Ponto[] | null>(null);
  const [precisao, setPrecisao] = useState<number | null>(null);
  const vigia = useRef<number | null>(null);
  useEffect(() => () => { if (vigia.current != null) navigator.geolocation?.clearWatch(vigia.current); }, []);

  const salvar = async (pts: Ponto[]) => {
    const c = limparContorno(pts);
    if (c.length < 3) return aviso('O contorno precisa de pelo menos 3 pontos.', true);
    const ha = areaHa(c);
    const mudarArea = !p.areaHa || window.confirm(`O contorno dá ${fmtNum(ha, 2)} ha. Trocar a área do piquete (${fmtNum(p.areaHa, 2)} ha) por esta?`);
    await db.piquetes.update(p.id!, { contorno: c, ...(mudarArea ? { areaHa: Math.round(ha * 100) / 100 } : {}) });
    aviso(`Contorno salvo: ${c.length} pontos, ${fmtNum(ha, 2)} ha.`);
  };
  const comecar = () => {
    if (!navigator.geolocation) return aviso('Este celular não tem GPS disponível para o app.', true);
    setTrilha([]);
    vigia.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPrecisao(pos.coords.accuracy);
        const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setTrilha((t) => (t && aceitarPonto(t, pt, pos.coords.accuracy) ? [...t, pt] : t));
      },
      () => aviso('Não deu para ler o GPS. Libere a localização para o app.', true),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  };
  const terminar = async () => {
    if (vigia.current != null) navigator.geolocation.clearWatch(vigia.current);
    vigia.current = null;
    const t = trilha ?? [];
    setTrilha(null);
    await salvar(t);
  };
  const importar = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return aviso('Arquivo grande demais.', true);
    const c = lerContorno(await f.text());
    if (arquivo.current) arquivo.current.value = '';
    if (!c) return aviso('Não achei um polígono neste arquivo. Use KML (Google Earth) ou GeoJSON.', true);
    await salvar(c);
  };

  return (
    <div className="cartao">
      <b>Contorno para o satélite</b>
      <p className="mudo">{p.contorno?.length ? `${p.contorno.length} pontos, ${fmtNum(areaHa(p.contorno), 2)} ha.` : 'Ainda sem contorno: o satélite não sabe onde fica este piquete.'}</p>
      {trilha ? (
        <>
          <div className="dica">Ande pela cerca em volta do piquete com o celular na mão. {trilha.length} pontos{precisao != null ? `, GPS com ${Math.round(precisao)} m de precisão` : ''}. Quando voltar ao começo, toque em "Terminar".</div>
          <div className="botoes">
            <button className="btn" onClick={terminar} disabled={trilha.length < 3}>Terminar</button>
            <button className="btn sec" onClick={() => { if (vigia.current != null) navigator.geolocation.clearWatch(vigia.current); vigia.current = null; setTrilha(null); }}>Cancelar</button>
          </div>
        </>
      ) : (
        <div className="botoes">
          <button className="btn sec" onClick={comecar}>📍 Andar em volta (GPS)</button>
          <button className="btn sec" onClick={() => arquivo.current?.click()}>📄 Importar KML</button>
        </div>
      )}
      <input ref={arquivo} type="file" accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json,application/json" hidden onChange={(e) => importar(e.target.files?.[0])} />
    </div>
  );
}

function EditarPiquete({ p, fechar }: { p: Piquete; fechar: () => void }) {
  const aviso = useAviso();
  const nav = useNavigate();
  const ref = (v?: number) => (v == null ? '' : String(v).replace('.', ','));
  const [f, setF] = useState({ nome: p.nome, area: ref(p.areaHa), capim: p.capim ?? '', entrada: ref(p.alturaEntrada), saida: ref(p.alturaSaida), kg: ref(p.kgMsCm) });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const alvos = alvosPiquete({ capim: f.capim });
  const salvar = async () => {
    if (!f.nome.trim()) return aviso('Dê um nome ao piquete.', true);
    try {
      await db.piquetes.update(p.id!, {
        nome: f.nome.trim(), areaHa: num(f.area) ?? undefined, capim: f.capim.trim() || undefined,
        alturaEntrada: num(f.entrada) ?? undefined, alturaSaida: num(f.saida) ?? undefined, kgMsCm: num(f.kg) ?? undefined,
      });
      aviso('Piquete salvo.');
      fechar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar o piquete "${p.nome}" com o histórico de entradas, saídas e satélite?`)) return;
    const { excluirPiquetes } = await import('../db');
    await excluirPiquetes([p.id!]);
    aviso('Piquete apagado.');
    nav('/pasto', { replace: true });
  };
  return (
    <div className="cartao">
      <h3>Editar piquete</h3>
      <CampoTexto rotulo="Nome" valor={f.nome} aoMudar={set('nome')} nome="pqNome" />
      <div className="grade">
        <CampoNumero rotulo="Área" valor={f.area} aoMudar={set('area')} unidade="ha" nome="pqArea" />
        <CampoTexto rotulo="Capim" valor={f.capim} aoMudar={set('capim')} nome="pqCapim" dica={CAPINS.slice(0, 4).map((c) => c.nome.split(' ')[0]).join(', ') + '...'} />
      </div>
      <div className="grade">
        <CampoNumero rotulo="Altura para entrar" valor={f.entrada} aoMudar={set('entrada')} unidade="cm" nome="pqEntrada" dica={alvos.entrada ? `Referência: ${alvos.entrada} cm` : undefined} />
        <CampoNumero rotulo="Altura para sair" valor={f.saida} aoMudar={set('saida')} unidade="cm" nome="pqSaida" dica={alvos.saida ? `Referência: ${alvos.saida} cm` : undefined} />
      </div>
      <CampoNumero rotulo="Capim por cm de altura" valor={f.kg} aoMudar={set('kg')} unidade="kg MS/ha" nome="pqKg" dica={`Usado para estimar a massa de capim pela altura. Referência: ${alvos.kgMsCm}.`} />
      <div className="botoes">
        <button className="btn" onClick={salvar}>Salvar</button>
        <button className="btn sec" onClick={fechar}>Cancelar</button>
        <button className="btn perigo pequeno" onClick={apagar}>Apagar piquete</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mudar o gado de piquete

export function MoverGado() {
  const [busca] = useSearchParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const dados = useLiveQuery(async () => {
    const [lotes, pes, piquetes, modulos, ocupantes] = await Promise.all([db.lotes.toArray(), db.pesagens.toArray(), db.piquetes.toArray(), db.modulos.toArray(), ocupantesAtuais()]);
    const grupos = db.tables.some((t) => t.name === 'grupos')
      ? ((await db.table('grupos').toArray()) as { id: number; nome: string; encerrado?: boolean; piqueteId?: number | null }[]).filter((g) => !g.encerrado)
      : [];
    return { lotes: lotes.filter((l) => !l.encerrado), pes, piquetes, modulos, ocupantes, grupos };
  }, []);
  const [quem, setQuem] = useState(busca.get('de') ?? '');
  const [para, setPara] = useState(busca.get('para') ?? '');
  const [data, setData] = useState(hojeISO());
  const [cab, setCab] = useState('');
  const [peso, setPeso] = useState('');
  const [altE, setAltE] = useState('');
  const [notaE, setNotaE] = useState('');
  const [midE, setMidE] = useState<MidiaNova[]>([]);
  const [altS, setAltS] = useState('');
  const [notaS, setNotaS] = useState('');
  const [midS, setMidS] = useState<MidiaNova[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [tipo, idStr] = quem.split(':') as [TipoOcupante | '', string];
  const oid = Number(idStr);
  const lote = tipo === 'lote' ? dados?.lotes.find((l) => l.id === oid) : undefined;
  const grupo = tipo === 'grupo' ? dados?.grupos.find((g) => g.id === oid) : undefined;
  const ondeEsta = lote?.piqueteId ?? grupo?.piqueteId ?? null;
  const pqAtual = dados?.piquetes.find((p) => p.id === ondeEsta);
  const pqDestino = dados?.piquetes.find((p) => String(p.id) === para);
  const nomePq = (p: Piquete) => `${dados?.modulos.find((m) => m.id === p.moduloId)?.nome ?? ''} › ${p.nome}`;
  const livres = useMemo(() => (dados?.piquetes ?? []).filter((p) => !dados?.ocupantes.some((o) => o.piqueteId === p.id) || p.id === ondeEsta), [dados, ondeEsta]);

  // preenche cabeças e peso estimado de hoje ao escolher o lote
  useEffect(() => {
    if (lote && dados) {
      setCab(String(lote.qtdCabecas));
      const pe = pesoEstimado(pontosDoLote(dados.pes.filter((x) => x.loteId === lote.id)), data, lote.gmdMeta);
      setPeso(pe ? String(Math.round(pe)) : '');
    } else if (grupo && dados) {
      const o = dados.ocupantes.find((x) => x.tipo === 'grupo' && x.id === grupo.id);
      setCab(o?.cabecas ? String(o.cabecas) : '');
      setPeso(o?.pesoMedio ? String(Math.round(o.pesoMedio)) : '');
    }
  }, [quem, dados?.lotes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dados) return <Topo titulo="Mudar de piquete" />;
  const destinoAlvos = pqDestino ? alvosPiquete(pqDestino) : null;
  const origemAlvos = pqAtual ? alvosPiquete(pqAtual) : null;

  const salvar = async () => {
    if (!tipo || !oid) return aviso('Escolha o lote ou o grupo.', true);
    if (!para && !pqAtual) return aviso('Escolha para qual piquete vão os animais.', true);
    setSalvando(true);
    try {
      if (pqAtual) {
        await sairDoPiquete(tipo, oid, { data, altura: num(altS), nota: notaS, midias: midS });
      }
      if (para && pqDestino) {
        const n = num(cab);
        if (n == null || n < 0) throw new Error('Informe quantas cabeças entraram.');
        await entrarNoPiquete({ tipo, ocupanteId: oid, piqueteId: pqDestino.id!, data, cabecas: n, pesoMedio: num(peso), altura: num(altE), nota: notaE, midias: midE });
      }
      aviso(para ? `Animais no ${pqDestino?.nome}.` : `Animais fora do ${pqAtual?.nome}.`);
      nav(para ? `/pasto/piquete/${para}` : '/pasto', { replace: true });
    } catch (e) {
      aviso((e as Error).message, true);
      setSalvando(false);
    }
  };

  return (
    <>
      <Topo titulo="Mudar de piquete" />
      <main>
        <CampoEscolha rotulo="Quais animais?" nome="moverQuem" valor={quem} aoMudar={setQuem}>
          <option value="">Escolha</option>
          {dados.lotes.map((l) => <option key={'l' + l.id} value={`lote:${l.id}`}>Lote {l.nome}</option>)}
          {dados.grupos.map((g) => <option key={'g' + g.id} value={`grupo:${g.id}`}>Grupo {g.nome}</option>)}
        </CampoEscolha>
        <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="moverData" />

        {pqAtual && (
          <div className="cartao">
            <h3>Saída do {pqAtual.nome}</h3>
            <CampoNumero rotulo="Altura do capim na saída" valor={altS} aoMudar={setAltS} unidade="cm" nome="alturaSaida"
              dica={origemAlvos?.saida ? `Ideal: sair com ${origemAlvos.saida} cm ou mais.` : 'Meça em alguns pontos e use a média.'} />
            {num(altS) != null && origemAlvos?.saida != null && num(altS)! < origemAlvos.saida * 0.8 && (
              <div className="alerta atencao"><span className="ic">🔔</span><div><b>Pasto rapado</b>Saindo abaixo de {origemAlvos.saida} cm o capim demora mais a rebrotar. Se acontecer sempre, a lotação está alta.</div></div>
            )}
            <CampoTexto rotulo="Como ficou o pasto?" valor={notaS} aoMudar={setNotaS} nome="notaSaida" multilinha maxLength={1000} placeholder="Ex.: bem rapado perto do cocho, muita sobra na baixada" />
            <CapturaMidias rotulo="Fotos e áudio da saída" aoMudar={setMidS} />
          </div>
        )}

        <CampoEscolha rotulo={pqAtual ? 'Para onde vão?' : 'Para qual piquete?'} nome="moverPara" valor={para} aoMudar={setPara}
          dica="Só aparecem os piquetes vazios: um piquete recebe um lote ou grupo por vez.">
          <option value="">{pqAtual ? 'Só tirar do piquete (sem destino)' : 'Escolha'}</option>
          {livres.filter((p) => p.id !== ondeEsta).map((p) => <option key={p.id} value={p.id}>{nomePq(p)}</option>)}
        </CampoEscolha>

        {pqDestino && (
          <div className="cartao">
            <h3>Entrada no {pqDestino.nome}</h3>
            <div className="grade">
              <CampoNumero rotulo="Cabeças" valor={cab} aoMudar={setCab} nome="moverCab" />
              <CampoNumero rotulo="Peso médio" valor={peso} aoMudar={setPeso} unidade="kg" pesoVivo nome="moverPeso" dica={lote ? 'Estimado pelo GMD.' : undefined} />
            </div>
            <CampoNumero rotulo="Altura do capim na entrada" valor={altE} aoMudar={setAltE} unidade="cm" nome="alturaEntrada"
              dica={destinoAlvos?.entrada ? `Ideal: entrar com ${destinoAlvos.entrada} cm.` : 'Meça em alguns pontos e use a média.'} />
            <CampoTexto rotulo="Como está o pasto?" valor={notaE} aoMudar={setNotaE} nome="notaEntrada" multilinha maxLength={1000} placeholder="Ex.: capim bonito, com sementes, água boa" />
            <CapturaMidias rotulo="Fotos e áudio da entrada" aoMudar={setMidE} />
          </div>
        )}

        <div className="botoes">
          <button className="btn largo" onClick={salvar} disabled={salvando} data-testid="salvarMover">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </main>
    </>
  );
}
