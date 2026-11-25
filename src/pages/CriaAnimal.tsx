// Cria: ficha do animal (identificação, mãe e pai, filhos, curva até a desmama, histórico de crias, saúde e saída).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db, type Animal } from '../db';
import {
  alertaPermanencia, calcularIpm, CATEGORIAS_CRIA, historicoMatriz, idadeDias, idadeTexto, pontosAnimal, projecaoDesmama, rotuloAnimal, saidaPrevista, TIPOS_REPRODUCAO,
} from '../cria';
import { darSaida } from '../criaDb';
import { fmtData, fmtGmd, fmtKg, fmtNum, hojeISO } from '../calc';
import { GraficoCrescimento } from '../components/Grafico';
import { CampoData, CampoEscolha, CampoTexto, Indicador, Topo, useAviso } from '../components/ui';
import { FotoTelaCheia, Miniatura } from './Anotacoes';
import { SanidadeDe } from './Sanidade';
import { useCria } from './Cria';
import { usePapel } from '../nuvem/useNuvem';

export function AnimalCria() {
  const { id } = useParams();
  const aid = Number(id);
  const nav = useNavigate();
  const aviso = useAviso();
  const papel = usePapel();
  const d = useCria();
  const [foto, setFoto] = useState<string | null>(null);
  const [saida, setSaida] = useState(false);
  if (!d) return <Topo titulo="Animal" />;
  const a = d.animais.find((x) => x.id === aid);
  if (!a) return (<><Topo titulo="Animal" /><main><p>Animal não encontrado.</p></main></>);
  const hoje = hojeISO();
  const porId = new Map(d.animais.map((x) => [x.id!, x]));
  const mae = a.maeId ? porId.get(a.maeId) : undefined;
  const pai = a.paiId ? porId.get(a.paiId) : undefined;
  const grupo = d.grupos.find((g) => g.id === a.grupoId);
  const filhos = d.animais.filter((x) => x.maeId === a.id || x.paiId === a.id);
  const pesos = d.pesos.filter((p) => p.animalId === a.id).sort((x, y) => (x.data < y.data ? 1 : -1));
  const pontos = pontosAnimal(a, d.pesos);
  const proj = a.categoria === 'bezerro' ? projecaoDesmama(a, d.pesos, hoje) : null;
  const femea = a.categoria === 'matriz' || a.categoria === 'novilha';
  const hist = femea ? historicoMatriz(a, d.eventos, d.animais, d.desmamas, d.estacoes, hoje) : null;
  const ipm = a.categoria === 'matriz' ? calcularIpm(d.animais.filter((x) => x.categoria === 'matriz' && x.ativo && !x.saida && x.grupoId), d.eventos, d.animais, d.desmamas, d.estacoes, hoje).find((l) => l.matriz.id === a.id) : undefined;
  const eventos = d.eventos.filter((e) => e.matrizId === a.id || e.touroId === a.id).sort((x, y) => (x.data < y.data ? 1 : -1));
  const perm = alertaPermanencia(a, hoje);
  const s = saidaPrevista(a);
  const pode = papel !== 'consultor';
  const ativo = a.ativo && !a.saida;
  const desmama = d.desmamas.find((x) => x.itens.some((i) => i.animalId === a.id));
  const marcarDescarte = async () => {
    const motivo = a.descarte ? undefined : window.prompt('Motivo do descarte (opcional):', ipm?.motivos[0] ?? '') ?? undefined;
    await db.animais.update(a.id!, { descarte: !a.descarte, motivoDescarte: a.descarte ? undefined : motivo || undefined });
    aviso(a.descarte ? 'Tirada da lista de descarte.' : 'Marcada para descarte.');
  };
  return (
    <>
      <Topo titulo={rotuloAnimal(a)} />
      <main>
        {foto && <FotoTelaCheia url={foto} fechar={() => setFoto(null)} />}
        <div className="linha-lote" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div>
            <span className="etiqueta">{CATEGORIAS_CRIA[a.categoria ?? 'matriz']}</span>
            {a.descarte && <span className="etiqueta ruim">Descarte</span>}
            {!ativo && <span className="etiqueta atencao">Saiu {a.saida ? fmtData(a.saida) : ''}{a.motivoSaida ? ` (${a.motivoSaida})` : ''}</span>}
            {a.loteId && <span className="etiqueta bom">No lote</span>}
            <p className="mudo" style={{ margin: '6px 0' }}>
              {a.sexo === 'macho' ? 'Macho' : a.sexo === 'femea' ? 'Fêmea' : ''}{a.raca ? ` · ${a.raca}` : ''}{a.nascimento ? ` · nasceu ${fmtData(a.nascimento)} (${idadeTexto(idadeDias(a, hoje))})` : ''}
              {grupo ? ` · grupo ${grupo.nome}` : ''}{(a.qtd ?? 1) > 1 ? ` · ${a.qtd} touros` : ''}
            </p>
            <p className="mudo" style={{ margin: 0, fontSize: 14 }}>
              Brinco {a.brinco}{a.chip ? ` · chip ${a.chip}` : ''}{a.sisbov ? ` · SISBOV ${a.sisbov}` : ''}
            </p>
          </div>
          {a.foto && <Miniatura id={a.foto} aoAbrir={setFoto} />}
        </div>
        {a.loteId && <Link to={`/lotes/${a.loteId}`} className="btn sec largo" style={{ margin: '10px 0' }}>Ver o lote em que está (Recria/RIP)</Link>}
        {perm && <div className={`alerta ${perm.nivel}`}><span className="ic">⏳</span><div><b>{perm.titulo}</b>{perm.texto}</div></div>}

        <h2>Família</h2>
        <div className="cartao">
          <p style={{ margin: 0 }}>Mãe: {mae ? <Link to={`/cria/animal/${mae.id}`}>{rotuloAnimal(mae)}</Link> : '—'}</p>
          <p style={{ margin: '6px 0 0' }}>Pai: {pai ? <Link to={`/cria/animal/${pai.id}`}>{rotuloAnimal(pai)}</Link> : a.paiTexto || '—'}</p>
          {filhos.length > 0 && <p style={{ margin: '6px 0 0' }}>Filhos: {filhos.map((f, i) => <span key={f.id}>{i ? ', ' : ''}<Link to={`/cria/animal/${f.id}`}>{f.brinco}</Link></span>)}</p>}
        </div>

        {a.categoria === 'bezerro' && (
          <>
            <h2>Até a desmama</h2>
            <div className="grade">
              <Indicador rotulo="Peso ao nascer" valor={fmtKg(a.pesoNascer)} />
              <Indicador rotulo="Última pesagem" valor={fmtKg(pesos[0]?.peso)} sub={pesos[0] ? fmtData(pesos[0].data) : undefined} />
              <Indicador rotulo="Desmama prevista" valor={proj ? fmtData(proj.data) : '—'} sub={proj ? (proj.diasFaltando > 0 ? `faltam ${proj.diasFaltando} dias` : 'já na idade') : 'falta o nascimento'} />
              <Indicador rotulo="Peso previsto" valor={proj ? fmtKg(proj.peso, 0) : '—'} sub={proj ? `GMD ${fmtGmd(proj.gmd)}${proj.origem === 'padrao' ? ' (padrão)' : ''}` : undefined} />
            </div>
            <p className="mudo">Creep feed: {a.creep ? 'sim' : 'não'}.</p>
          </>
        )}
        {desmama && <div className="dica">Desmamado em {fmtData(desmama.data)} com {fmtKg(desmama.itens.find((i) => i.animalId === a.id)!.peso)} (pacote {desmama.ano} · versão {desmama.versao}).</div>}

        {(pontos.length > 0 || a.categoria === 'bezerro') && (
          <>
            <h2>Curva de crescimento</h2>
            <div className="cartao">
              <GraficoCrescimento pontos={pontos} pesoAlvo={proj?.peso ?? null}
                projecao={proj && pontos.length && proj.diasFaltando > 0 ? { gmdUsado: proj.gmd, origemGmd: 'total', diasFaltando: proj.diasFaltando, dataPrevista: proj.data, jaAtingiu: false } : null} />
            </div>
          </>
        )}
        {pesos.length > 0 && (
          <div className="cartao rolagem">
            <table className="tab">
              <thead><tr><th>Data</th><th className="n">Peso</th><th /></tr></thead>
              <tbody>
                {pesos.map((p) => (
                  <tr key={p.id}><td>{fmtData(p.data)}{p.obs ? <div className="mudo" style={{ fontSize: 13 }}>{p.obs}</div> : null}</td><td className="n">{fmtKg(p.peso)}</td>
                    <td>{pode && <button className="remover" aria-label="Apagar pesagem" onClick={async () => { if (window.confirm('Apagar esta pesagem?')) await db.pesosCria.delete(p.id!); }}>×</button>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hist && (
          <>
            <h2>Crias e reprodução</h2>
            <div className="grade">
              <Indicador rotulo="Crias" valor={hist.nCrias} sub={hist.nCrias ? `${hist.machos} machos · ${hist.femeas} fêmeas` : undefined} />
              <Indicador rotulo="Intervalo entre partos" valor={hist.iepMedio ? `${fmtNum(hist.iepMedio / 30.44, 1)} meses` : '—'} />
              <Indicador rotulo="Situação" valor={hist.prenhe === true ? 'Prenhe' : hist.prenhe === false ? 'Vazia' : '—'} sub={hist.partoPrevisto ? `parto ${fmtData(hist.partoPrevisto)}` : undefined} />
              <Indicador rotulo="IPM" valor={ipm?.ipm != null ? `${fmtNum(ipm.ipm, 0)} kg/ano` : '—'} sub={ipm?.relativo != null ? `${ipm.relativo}% da média` : undefined} />
            </div>
            {hist.idadePrimeiroParto != null && <p className="mudo">Primeiro parto com {idadeTexto(hist.idadePrimeiroParto)}.{hist.partosForaEpoca ? ` Pariu fora da estação ${hist.partosForaEpoca} vez(es).` : ''}</p>}
            {ipm && ipm.motivos.length > 0 && <div className="alerta atencao"><span className="ic">🔻</span><div><b>Possível descarte</b>{ipm.motivos.join('; ')}.</div></div>}
            {pode && ativo && (
              <div className="grade" style={{ marginBottom: 12 }}>
                <Link to={`/cria/evento/cobertura?vaca=${a.id}`} className="btn sec">Monta ou IA</Link>
                <Link to={`/cria/evento/diagnostico?vaca=${a.id}`} className="btn sec">Diagnóstico</Link>
                <Link to={`/cria/evento/parto?vaca=${a.id}`} className="btn sec">Parto</Link>
                {papel !== 'vaqueiro' && <button className="btn sec" onClick={marcarDescarte}>{a.descarte ? 'Tirar do descarte' : 'Marcar descarte'}</button>}
              </div>
            )}
            {hist.crias.length > 0 && (
              <div className="cartao rolagem">
                <table className="tab">
                  <thead><tr><th>Parto</th><th>Cria</th><th className="n">Desmama</th></tr></thead>
                  <tbody>
                    {hist.crias.map((c, i) => (
                      <tr key={i}>
                        <td>{fmtData(c.data)}{c.foraEpoca ? <div className="mudo" style={{ fontSize: 12 }}>fora da estação</div> : null}</td>
                        <td>{c.natimorto ? 'nasceu morto' : c.bezerroId ? <Link to={`/cria/animal/${c.bezerroId}`}>{porId.get(c.bezerroId)?.brinco ?? '?'}</Link> : '—'}{c.sexo ? ` (${c.sexo === 'macho' ? 'M' : 'F'})` : ''}</td>
                        <td className="n">{c.pesoDesmama ? fmtKg(c.pesoDesmama, 0) : '—'}{c.p205 ? <div className="mudo" style={{ fontSize: 12 }}>P205 {fmtKg(c.p205, 0)}</div> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {eventos.length > 0 && (
          <>
            <h2>Eventos</h2>
            {eventos.slice(0, 30).map((e) => (
              <div key={e.id} className="cartao linha-lote" style={{ padding: '8px 12px' }}>
                <span>{fmtData(e.data)} · {TIPOS_REPRODUCAO[e.tipo]}{e.resultado ? `: ${e.resultado}` : ''}{e.touroId === a.id ? ` (vaca ${porId.get(e.matrizId)?.brinco ?? '?'})` : ''}
                  {e.semen ? <div className="mudo" style={{ fontSize: 13 }}>Sêmen {e.semen}</div> : null}</span>
                {pode && <button className="remover" aria-label="Apagar evento" onClick={async () => { if (window.confirm('Apagar este evento?')) await db.reproducao.delete(e.id!); }}>×</button>}
              </div>
            ))}
          </>
        )}

        {a.categoria !== 'bezerro' && <p className="mudo">Permanência: {a.permanenciaMeses ? `${a.permanenciaMeses} meses (saída prevista ${fmtData(s)})` : 'não informada'}.</p>}

        <h2>Saúde</h2>
        <SanidadeDe alvo={{ animalId: a.id! }} qtd={a.qtd ?? 1} />

        {pode && (
          <div className="botoes" style={{ marginTop: 14 }}>
            <button className="btn sec" onClick={() => nav(`/cria/animal/${a.id}/editar`)}>Editar</button>
            {ativo && papel !== 'vaqueiro' && <button className="btn sec" onClick={() => setSaida(true)}>Dar saída</button>}
          </div>
        )}
        {saida && <FormSaida a={a} fechar={() => setSaida(false)} />}
      </main>
    </>
  );
}

function FormSaida({ a, fechar }: { a: Animal; fechar: () => void }) {
  const aviso = useAviso();
  const [data, setData] = useState(hojeISO());
  const [motivo, setMotivo] = useState<NonNullable<Animal['motivoSaida']>>(a.descarte ? 'descarte' : 'venda');
  const [obs, setObs] = useState('');
  const salvar = async () => {
    try { await darSaida(a.id!, data, motivo, obs.trim() || undefined); aviso('Saída registrada. O animal fica no histórico.'); fechar(); }
    catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <h3>Saída do rebanho</h3>
      <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="saidaData" />
      <CampoEscolha rotulo="Motivo" nome="saidaMotivo" valor={motivo} aoMudar={(v) => setMotivo(v as typeof motivo)}>
        <option value="venda">Venda</option><option value="descarte">Descarte</option><option value="morte">Morte</option><option value="outro">Outro</option>
      </CampoEscolha>
      <CampoTexto rotulo="Observação" valor={obs} aoMudar={setObs} nome="saidaObs" multilinha />
      <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={fechar}>Cancelar</button></div>
    </div>
  );
}
