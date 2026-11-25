// Cria: tela principal (rebanho por grupo de manejo, reprodução, desmama, índices e decisões).
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Animal, type CategoriaCria } from '../db';
import {
  ativoCria, cabecas, cabecasGrupo, calcularIpm, CATEGORIAS_CRIA, custoBezerro, decisoesCria, estacaoAtualOuProxima, historicoMatriz, idadeDias, idadeTexto,
  METODOS_MONTA, projecaoDesmama, rotuloAnimal, saidaPrevista, sugestoesDescarte, TIPOS_GRUPO, uaGrupo, ultimosPesos,
} from '../cria';
import { desfazerDesmama, lotacaoDaCria } from '../criaDb';
import { fmtData, fmtKg, fmtNum, hojeISO } from '../calc';
import { CampoData, CampoEscolha, CampoTexto, Entrada, Indicador, Opcoes, Topo, useAviso } from '../components/ui';
import { BotaoFoto } from '../components/Foto';
import { carregarTudo, custoCriaPeriodo } from '../hooks';
import { usePapel, useVeDinheiro } from '../nuvem/useNuvem';
import { rs } from './Nutricao';

/** Tudo da Cria de uma vez (as telas fazem as contas a partir daqui). */
export async function carregarCria() {
  const [animais, grupos, eventos, pesos, desmamas, estacoes, piquetes] = await Promise.all([
    db.animais.toArray(), db.grupos.toArray(), db.reproducao.toArray(), db.pesosCria.toArray(), db.desmamas.toArray(), db.estacoes.toArray(), db.piquetes.toArray(),
  ]);
  return { animais, grupos, eventos, pesos, desmamas, estacoes, piquetes };
}
export const useCria = () => useLiveQuery(carregarCria);
export type DadosTelaCria = Awaited<ReturnType<typeof carregarCria>>;

type Aba = 'rebanho' | 'reproducao' | 'desmama' | 'indices' | 'decisoes';

export function Cria() {
  const d = useCria();
  const [aba, setAba] = useState<Aba>(() => (sessionStorage.getItem('cria-aba') as Aba) || 'rebanho');
  const mudar = (a: Aba) => { setAba(a); try { sessionStorage.setItem('cria-aba', a); } catch { /* sem armazenamento */ } };
  if (!d) return <Topo titulo="Cria" />;
  const hoje = hojeISO();
  const ativos = d.animais.filter(ativoCria);
  const conta = (c: CategoriaCria) => ativos.filter((a) => a.categoria === c).reduce((s, a) => s + cabecas(a), 0);
  return (
    <>
      <Topo titulo="Cria" />
      <main>
        <p className="mudo">Vacas, touros e bezerros até a desmama. Aqui se trabalha com <b>grupo de manejo</b>; os lotes ficam para Recria, RIP, TIP e Confinamento.</p>
        <div className="grade" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Indicador rotulo="Matrizes" valor={conta('matriz')} />
          <Indicador rotulo="Novilhas" valor={conta('novilha')} />
          <Indicador rotulo="Touros" valor={conta('touro')} />
          <Indicador rotulo="Bezerros" valor={conta('bezerro')} />
        </div>
        <div className="botoes">
          <Link to="/cria/evento/parto" className="btn">Lançar parto</Link>
          <Link to="/cria/pesar" className="btn sec">Pesar</Link>
        </div>
        <div className="abas-rolagem">
          <Opcoes valor={aba} aoMudar={mudar} opcoes={[
            { valor: 'rebanho', rotulo: 'Rebanho' }, { valor: 'reproducao', rotulo: 'Reprodução' }, { valor: 'desmama', rotulo: 'Desmama' },
            { valor: 'indices', rotulo: 'IPM' }, { valor: 'decisoes', rotulo: 'Decisões' },
          ]} />
        </div>
        <div style={{ height: 14 }} />
        {aba === 'rebanho' && <Rebanho d={d} hoje={hoje} />}
        {aba === 'reproducao' && <Reproducao d={d} hoje={hoje} />}
        {aba === 'desmama' && <AbaDesmama d={d} hoje={hoje} />}
        {aba === 'indices' && <Indices d={d} hoje={hoje} />}
        {aba === 'decisoes' && <Decisoes d={d} hoje={hoje} />}
      </main>
    </>
  );
}

// ---------- Rebanho ----------

function Rebanho({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const nav = useNavigate();
  const aviso = useAviso();
  const papel = usePapel();
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState<'' | CategoriaCria>('');
  const pq = new Map(d.piquetes.map((p) => [p.id!, p]));
  const ult = ultimosPesos(d.pesos);
  const termo = busca.trim().toLowerCase();
  const lista = d.animais.filter(ativoCria).filter((a) => (!cat || a.categoria === cat)
    && (!termo || [a.brinco, a.chip, a.nome, a.sisbov].some((x) => x?.toLowerCase().includes(termo))));
  const grupos = d.grupos.filter((g) => !g.encerrado);
  const podeGrupo = papel !== 'vaqueiro' && papel !== 'consultor';
  return (
    <>
      <h2>Grupos de manejo</h2>
      {grupos.length === 0 && <div className="dica">Comece criando um grupo (ex.: “Vacas do retiro”, “Touros”, “Novilhas de reposição”). Depois lance os animais nele.</div>}
      {grupos.map((g) => {
        const p = g.piqueteId ? pq.get(g.piqueteId) : undefined;
        const ua = uaGrupo(g.id!, d.animais, d.pesos);
        return (
          <Link key={g.id} to={`/cria/grupo/${g.id}`} className="cartao">
            <div className="linha-lote"><h3>{g.nome}</h3><span className="num">{cabecasGrupo(g.id!, d.animais)} cab</span></div>
            <span className="etiqueta">{TIPOS_GRUPO[g.tipo]}</span>
            <p className="mudo" style={{ margin: '6px 0 0' }}>{p ? `Piquete ${p.nome}` : 'Sem piquete'} · {fmtNum(ua, 1)} UA{p?.areaHa ? ` · ${fmtNum(ua / p.areaHa, 2)} UA/ha` : ''}</p>
          </Link>
        );
      })}
      <div className="botoes">
        {podeGrupo && <Link to="/cria/grupo/novo" className="btn sec">+ Grupo de manejo</Link>}
        <Link to="/cria/animal/novo" className="btn sec">+ Animal</Link>
      </div>

      <h2>Animais</h2>
      <div className="campo">
        <label htmlFor="buscaCria">Procurar por brinco, chip ou nome</label>
        <Entrada id="buscaCria" valor={busca} aoMudar={setBusca} voz="codigo" rotuloVoz="brinco" />
      </div>
      <BotaoFoto<{ legivel: boolean; brinco: string | null }> tipo="brinco" rotulo="Ler o brinco pela foto" aoErro={(m) => aviso(m, true)}
        aoLer={(r) => { if (!r.legivel || !r.brinco) return aviso('Não consegui ler o brinco. Tente com mais luz ou digite.', true); setBusca(r.brinco); }} />
      <CampoEscolha rotulo="Mostrar" nome="criaCat" valor={cat} aoMudar={(v) => setCat(v as '' | CategoriaCria)}>
        <option value="">Todos</option>
        {Object.entries(CATEGORIAS_CRIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </CampoEscolha>
      {lista.length === 0 && <p className="mudo">Nenhum animal{termo ? ` com “${busca}”` : ''}.</p>}
      {lista.length === 1 && termo && <button className="btn largo" onClick={() => nav(`/cria/animal/${lista[0].id}`)}>Abrir {rotuloAnimal(lista[0])}</button>}
      {lista.slice(0, 200).map((a) => <LinhaAnimal key={a.id} a={a} hoje={hoje} peso={ult.get(a.id!)?.peso} />)}
      {lista.length > 200 && <p className="mudo">Mostrando 200 de {lista.length}. Procure pelo brinco.</p>}
    </>
  );
}

export function LinhaAnimal({ a, hoje, peso, extra }: { a: Animal; hoje: string; peso?: number; extra?: string }) {
  const s = saidaPrevista(a);
  const vencido = s && s < hoje;
  return (
    <Link to={`/cria/animal/${a.id}`} className="cartao linha-lote" style={{ padding: '10px 14px' }}>
      <span>
        <b>{rotuloAnimal(a)}</b>
        <div className="mudo" style={{ fontSize: 14 }}>
          {CATEGORIAS_CRIA[a.categoria ?? 'matriz']}{a.sexo && a.categoria === 'bezerro' ? (a.sexo === 'macho' ? ' macho' : ' fêmea') : ''}
          {a.nascimento ? ` · ${idadeTexto(idadeDias(a, hoje))}` : ''}{peso ? ` · ${fmtKg(peso, 0)}` : ''}{extra ? ` · ${extra}` : ''}
        </div>
      </span>
      {a.descarte ? <span className="etiqueta ruim">Descarte</span> : vencido ? <span className="etiqueta atencao">Permanência</span> : null}
    </Link>
  );
}

// ---------- Reprodução ----------

function Reproducao({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const aviso = useAviso();
  const papel = usePapel();
  const [nova, setNova] = useState(false);
  const est = estacaoAtualOuProxima(d.estacoes, hoje);
  const femeas = d.animais.filter((a) => ativoCria(a) && (a.categoria === 'matriz' || a.categoria === 'novilha'));
  const hist = femeas.map((m) => ({ m, h: historicoMatriz(m, d.eventos, d.animais, d.desmamas, d.estacoes, hoje) }));
  const prenhes = hist.filter((x) => x.h.prenhe === true);
  const vazias = hist.filter((x) => x.h.prenhe === false);
  const diagnosticadas = prenhes.length + vazias.length;
  const proximos = hist.filter((x) => x.h.partoPrevisto).sort((a, b) => (a.h.partoPrevisto! < b.h.partoPrevisto! ? -1 : 1));
  const cobertas = est ? femeas.filter((m) => d.eventos.some((e) => e.matrizId === m.id && (e.tipo === 'monta' || e.tipo === 'ia') && e.data >= est.inicio && e.data <= est.fim)).length : 0;
  const pode = papel !== 'vaqueiro' && papel !== 'consultor';
  return (
    <>
      <div className="grade tres">
        <Indicador rotulo="Prenhes" valor={prenhes.length} sub={diagnosticadas ? `${Math.round((prenhes.length / diagnosticadas) * 100)}% das diagnosticadas` : undefined} />
        <Indicador rotulo="Vazias" valor={vazias.length} />
        <Indicador rotulo="Cobertas na estação" valor={cobertas} sub={est ? est.nome : 'sem estação'} />
      </div>
      <div className="grade" style={{ marginBottom: 12 }}>
        <Link to="/cria/evento/cobertura" className="btn sec">Monta ou IA</Link>
        <Link to="/cria/evento/diagnostico" className="btn sec">Diagnóstico</Link>
        <Link to="/cria/evento/parto" className="btn sec">Parto</Link>
        <Link to="/cria/evento/aborto" className="btn sec">Aborto</Link>
      </div>

      <h2>Estação de monta</h2>
      {d.estacoes.length === 0 && <p className="mudo">Nenhuma estação cadastrada. Com ela o app sabe se a vaca pariu na época certa.</p>}
      {[...d.estacoes].sort((a, b) => (a.inicio < b.inicio ? 1 : -1)).map((e) => (
        <div key={e.id} className="cartao linha-lote">
          <span><b>{e.nome}</b><div className="mudo">{fmtData(e.inicio)} a {fmtData(e.fim)} · {METODOS_MONTA[e.metodo]}</div></span>
          {pode && <button className="remover" aria-label="Apagar estação" onClick={async () => { if (window.confirm(`Apagar a ${e.nome}?`)) await db.estacoes.delete(e.id!); }}>×</button>}
        </div>
      ))}
      {pode && (nova ? <FormEstacao fechar={() => setNova(false)} aviso={aviso} /> : <button className="btn sec largo" onClick={() => setNova(true)}>+ Estação de monta</button>)}

      <h2>Partos previstos</h2>
      {proximos.length === 0 && <p className="mudo">Nenhum parto previsto. Lance o diagnóstico de gestação.</p>}
      {proximos.slice(0, 50).map(({ m, h }) => <LinhaAnimal key={m.id} a={m} hoje={hoje} extra={`parto ${fmtData(h.partoPrevisto)}`} />)}
    </>
  );
}

function FormEstacao({ fechar, aviso }: { fechar: () => void; aviso: (m: string, e?: boolean) => void }) {
  const ano = Number(hojeISO().slice(0, 4));
  const [nome, setNome] = useState(`Estação ${ano}/${String(ano + 1).slice(2)}`);
  const [inicio, setInicio] = useState(`${ano}-11-01`);
  const [fim, setFim] = useState(`${ano + 1}-01-31`);
  const [metodo, setMetodo] = useState<keyof typeof METODOS_MONTA>('monta');
  const salvar = async () => {
    if (fim <= inicio) return aviso('O fim precisa ser depois do início.', true);
    try { await db.estacoes.add({ nome: nome.trim(), inicio, fim, metodo, criadoEm: Date.now() }); aviso('Estação salva.'); fechar(); }
    catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} nome="estNome" />
      <div className="grade">
        <CampoData rotulo="Início" valor={inicio} aoMudar={setInicio} nome="estInicio" />
        <CampoData rotulo="Fim" valor={fim} aoMudar={setFim} nome="estFim" />
      </div>
      <CampoEscolha rotulo="Como vai ser" nome="estMetodo" valor={metodo} aoMudar={(v) => setMetodo(v as typeof metodo)}>
        {Object.entries(METODOS_MONTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </CampoEscolha>
      <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={fechar}>Cancelar</button></div>
    </div>
  );
}

// ---------- Desmama ----------

function AbaDesmama({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const aviso = useAviso();
  const papel = usePapel();
  const bezerros = d.animais.filter((a) => ativoCria(a) && a.categoria === 'bezerro')
    .map((a) => ({ a, p: projecaoDesmama(a, d.pesos, hoje) })).sort((x, y) => (x.p?.data ?? '9') < (y.p?.data ?? '9') ? -1 : 1);
  const pode = papel !== 'vaqueiro' && papel !== 'consultor';
  const desfazer = async (id: number) => {
    if (!window.confirm('Desfazer esta desmama? Os bezerros voltam para a Cria e o lote criado é apagado.')) return;
    try { await desfazerDesmama(id); aviso('Desmama desfeita.'); } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <>
      {pode && <Link to="/cria/desmama" className="btn largo" style={{ marginBottom: 14 }}>Fazer desmama</Link>}
      <h2>Bezerros ao pé da vaca</h2>
      {bezerros.length === 0 && <p className="mudo">Nenhum bezerro na Cria. Lance pelo parto.</p>}
      {bezerros.map(({ a, p }) => (
        <LinhaAnimal key={a.id} a={a} hoje={hoje}
          extra={p ? `desmama ${fmtData(p.data)} com ~${fmtNum(p.peso, 0)} kg${a.creep ? ' (creep)' : ''}${p.diasFaltando <= 0 ? ' · já na idade' : ''}` : 'sem data de nascimento'} />
      ))}
      <h2>Pacotes de desmama</h2>
      {d.desmamas.length === 0 && <p className="mudo">Nenhuma desmama feita.</p>}
      {[...d.desmamas].sort((a, b) => (a.data < b.data ? 1 : -1)).map((x) => (
        <div key={x.id} className="cartao">
          <div className="linha-lote"><h3>Desmama {x.ano} · versão {x.versao}</h3><span className="num">{x.cabecas} cab</span></div>
          <p className="mudo" style={{ margin: '4px 0' }}>
            {fmtData(x.data)} · {fmtNum(x.kgTotal, 0)} kg · média ponderada {fmtKg(x.pesoMedio)}{x.p205Medio ? ` · P205 ${fmtKg(x.p205Medio)}` : ''}
            {' · '}{x.itens.filter((i) => i.sexo === 'macho').length} machos e {x.itens.filter((i) => i.sexo === 'femea').length} fêmeas
            {x.itens.some((i) => i.destino === 'reposicao') ? ` · ${x.itens.filter((i) => i.destino === 'reposicao').length} ficaram para reposição` : ''}
          </p>
          <div className="botoes" style={{ margin: 0 }}>
            {x.loteId && <Link to={`/lotes/${x.loteId}`} className="btn pequeno">Ver lote de {x.fase === 'rip' ? 'RIP' : 'Recria'}</Link>}
            {x.loteFemeasId && <Link to={`/lotes/${x.loteFemeasId}`} className="btn pequeno sec">Lote das fêmeas</Link>}
            {pode && <button className="btn perigo pequeno" onClick={() => desfazer(x.id!)}>Desfazer</button>}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------- IPM e custo ----------

function Indices({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const veDinheiro = useVeDinheiro();
  const matrizes = d.animais.filter((a) => ativoCria(a) && a.categoria === 'matriz');
  const linhas = useMemo(() => calcularIpm(matrizes, d.eventos, d.animais, d.desmamas, d.estacoes, hoje), [d, hoje]); // eslint-disable-line react-hooks/exhaustive-deps
  const descarte = sugestoesDescarte(linhas);
  const comCrias = linhas.filter((l) => l.hist.nCrias);
  const tot = comCrias.reduce((s, l) => ({ m: s.m + l.hist.machos, f: s.f + l.hist.femeas }), { m: 0, f: 0 });
  const ieps = linhas.flatMap((l) => l.hist.ieps);
  return (
    <>
      <div className="dica"><b>IPM</b> (índice de produtividade da matriz) = kg de bezerro desmamado por ano que a vaca está no rebanho, com o peso ajustado para 205 dias. Junta quantos bezerros ela dá e quanto eles pesam. 100% é a média do rebanho.</div>
      <div className="grade tres">
        <Indicador rotulo="Intervalo entre partos" valor={ieps.length ? `${fmtNum(ieps.reduce((a, b) => a + b, 0) / ieps.length / 30.44, 1)} m` : '—'} sub="média do rebanho" />
        <Indicador rotulo="Crias machos" valor={tot.m + tot.f ? `${Math.round((tot.m / (tot.m + tot.f)) * 100)}%` : '—'} />
        <Indicador rotulo="Crias fêmeas" valor={tot.m + tot.f ? `${Math.round((tot.f / (tot.m + tot.f)) * 100)}%` : '—'} />
      </div>
      {veDinheiro && <CustoBezerro d={d} hoje={hoje} />}
      <h2>Possíveis descartes</h2>
      {descarte.length === 0 && <p className="mudo">Nenhuma vaca com motivo para descarte agora.</p>}
      {descarte.map((l) => (
        <Link key={l.matriz.id} to={`/cria/animal/${l.matriz.id}`} className="alerta atencao" style={{ textDecoration: 'none' }}>
          <span className="ic">🔻</span><div><b>{rotuloAnimal(l.matriz)}{l.relativo != null ? ` · IPM ${l.relativo}%` : ''}</b>{l.motivos.join('; ')}.</div>
        </Link>
      ))}
      <h2>Ranking das matrizes</h2>
      {linhas.length === 0 ? <p className="mudo">Nenhuma matriz.</p> : (
        <div className="cartao rolagem">
          <table className="tab">
            <thead><tr><th>#</th><th>Vaca</th><th className="n">Crias</th><th className="n">IEP</th><th className="n">IPM</th></tr></thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={l.matriz.id}>
                  <td>{i + 1}</td>
                  <td><Link to={`/cria/animal/${l.matriz.id}`}>{rotuloAnimal(l.matriz)}</Link>{l.motivos.length ? <div className="mudo" style={{ fontSize: 13 }}>{l.motivos[0]}</div> : null}</td>
                  <td className="n">{l.hist.nCrias}{l.hist.nCrias ? <div className="mudo" style={{ fontSize: 12 }}>{l.hist.machos}M {l.hist.femeas}F</div> : null}</td>
                  <td className="n">{l.hist.iepMedio ? `${fmtNum(l.hist.iepMedio / 30.44, 1)} m` : '—'}</td>
                  <td className="n">{l.ipm != null ? `${fmtNum(l.ipm, 0)} kg/ano` : '—'}{l.relativo != null ? <div className="mudo" style={{ fontSize: 12 }}>{l.relativo}%</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CustoBezerro({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const tudo = useLiveQuery(carregarTudo);
  const anos = [...new Set([Number(hoje.slice(0, 4)), ...d.desmamas.map((x) => x.ano)])].sort((a, b) => b - a);
  const [ano, setAno] = useState(String(anos.find((a) => d.desmamas.some((x) => x.ano === a)) ?? anos[0]));
  if (!tudo) return null;
  // safra: os 12 meses que terminam na desmama do ano (custo de manter vacas, touros e bezerros nesse tempo)
  const desm = d.desmamas.filter((x) => x.ano === Number(ano));
  const ate = desm.length ? desm.map((x) => x.data).sort().pop()! : `${ano}-12-31`;
  const de = `${Number(ate.slice(0, 4)) - 1}${ate.slice(4)}`;
  const custo = custoCriaPeriodo(tudo, de, ate);
  const c = custoBezerro(custo.total, desm);
  return (
    <div className="cartao">
      <h3>Custo do bezerro desmamado</h3>
      <CampoEscolha rotulo="Desmama de" nome="custoAno" valor={ano} aoMudar={setAno}>
        {anos.map((a) => <option key={a} value={a}>{a}</option>)}
      </CampoEscolha>
      <div className="grade tres">
        <Indicador rotulo="Por cabeça" valor={c.porCabeca == null ? '—' : rs(c.porCabeca)} />
        <Indicador rotulo="Por kg" valor={c.porKg == null ? '—' : rs(c.porKg)} />
        <Indicador rotulo="Por arroba" valor={c.porArroba == null ? '—' : rs(c.porArroba)} sub="@ de 30 kg vivo" />
      </div>
      <p className="mudo" style={{ fontSize: 14, marginBottom: 0 }}>
        Custo da Cria de {fmtData(de)} a {fmtData(ate)}: {rs(custo.total)} (lançado nos grupos {rs(custo.diretos)}, parte dos custos gerais {rs(custo.rateio)}, folha {rs(custo.folha)})
        dividido por {c.bezerros} bezerro(s) e {fmtNum(c.kg, 0)} kg desmamados.
        {c.bezerros === 0 ? ' Faça a desmama para ver o custo.' : ''}
      </p>
    </div>
  );
}

// ---------- Decisões ----------

function Decisoes({ d, hoje }: { d: DadosTelaCria; hoje: string }) {
  const veDinheiro = useVeDinheiro();
  const lotacao = useLiveQuery(() => lotacaoDaCria(hoje), [hoje]);
  const lista = decisoesCria({ ...d, hoje, lotacao });
  return (
    <>
      {lista.length === 0 && <p className="mudo">Lance as matrizes, os touros e a estação de monta para receber sugestões.</p>}
      {lista.map((x, i) => (
        <div key={i} className={`alerta ${x.nivel}`}>
          <span className="ic">{x.nivel === 'ruim' ? '⚠️' : x.nivel === 'atencao' ? '🔔' : '✅'}</span>
          <div><b>{x.titulo}</b>{x.texto}</div>
        </div>
      ))}
      <div className="dica">A lotação acima vem do <Link to="/pasto">Pasto</Link> (UA/ha do módulo onde estão os grupos). Grave a área dos piquetes e a capacidade do módulo para o aviso funcionar.</div>
      {veDinheiro && <Link to="/cria/simular" className="btn largo">Simulador da Cria</Link>}
      {veDinheiro && <p className="mudo" style={{ marginTop: 8 }}>Vender na desmama ou recriar? Reter as novilhas ou vender? Como fica o rebanho em 5 anos?</p>}
    </>
  );
}
