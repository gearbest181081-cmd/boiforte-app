// Menu "Anotações e tarefas": o funcionário anota na ronda o que precisa ser corrigido, com foto,
// módulo e piquete. Funciona sem sinal; com a nuvem ligada, a equipe toda vê e marca como feito.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Anotacao, type CategoriaAnotacao, type Modulo, type Piquete } from '../db';
import {
  caminhoFoto, CATEGORIAS, comprimirFoto, excluirAnotacao, lerFoto, marcarFeita, MAX_FOTOS_ANOTACAO, novaFotoId, salvarAnotacao, type FotoNova,
} from '../anotacoes';
import { fmtData } from '../calc';
import { CampoEscolha, CampoTexto, Opcoes, Topo, useAviso, useOnline } from '../components/ui';
import { armazemNuvem, nuvemConfigurada } from '../nuvem/cliente';
import { useEstadoNuvem, usePapel } from '../nuvem/useNuvem';
import { nomeParaMostrar, useSessao } from '../nuvem/sessao';

type Lugares = { modulos: Modulo[]; piquetes: Piquete[] };
function useLugares(): Lugares | undefined {
  return useLiveQuery(async () => ({
    modulos: (await db.modulos.toArray()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
    piquetes: (await db.piquetes.toArray()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
  }));
}
function lugar(a: Anotacao, l: Lugares | undefined): string {
  const m = l?.modulos.find((x) => x.id === a.moduloId)?.nome;
  const p = l?.piquetes.find((x) => x.id === a.piqueteId)?.nome;
  return [m, p].filter(Boolean).join(' · ');
}

/** Quem pode o quê. O servidor confere de novo; aqui só some o botão que não ia funcionar. */
function usePermissoes() {
  const papel = usePapel();
  const { conta } = useSessao();
  const est = useEstadoNuvem();
  const naNuvem = !!est?.fazenda;
  return {
    grava: papel !== 'consultor',
    podeApagar: (a: Anotacao) => papel !== 'consultor' && (papel !== 'vaqueiro' || !naNuvem || !a.autorId || a.autorId === conta?.id),
    eu: conta ? { nome: nomeParaMostrar(conta), id: conta.id } : undefined,
  };
}

// ---------- foto (do celular ou da nuvem) ----------

/** Endereço para mostrar a foto: lê do celular; se não tiver e houver sinal, baixa da nuvem. */
function useFotoUrl(id: string): { url?: string; falta?: boolean } {
  const est = useEstadoNuvem();
  const online = useOnline();
  const fazenda = est?.fazenda?.id;
  const [r, setR] = useState<{ url?: string; falta?: boolean }>({});
  useEffect(() => {
    let url: string | undefined;
    let fim = false;
    const baixar = fazenda && online && nuvemConfigurada() ? (f: string) => armazemNuvem.baixar(caminhoFoto(fazenda, f)) : undefined;
    lerFoto(id, baixar).then((d) => {
      if (fim) return;
      if (!d) return setR({ falta: true });
      url = URL.createObjectURL(new Blob([d], { type: 'image/jpeg' }));
      setR({ url });
    }).catch(() => { if (!fim) setR({ falta: true }); });
    return () => { fim = true; if (url) URL.revokeObjectURL(url); };
  }, [id, fazenda, online]);
  return r;
}

function Miniatura({ id, aoAbrir, grande }: { id: string; aoAbrir?: (url: string) => void; grande?: boolean }) {
  const { url, falta } = useFotoUrl(id);
  if (!url) return <div className={`foto-mini vazia ${grande ? 'grande' : ''}`} aria-label="Foto">{falta ? '📷' : '…'}</div>;
  return (
    <button type="button" className={`foto-mini ${grande ? 'grande' : ''}`} onClick={() => aoAbrir?.(url)} aria-label="Ver foto">
      <img src={url} alt="Foto da anotação" />
    </button>
  );
}

function FotoTelaCheia({ url, fechar }: { url: string; fechar: () => void }) {
  return (
    <div className="foto-cheia" role="dialog" aria-label="Foto" onClick={fechar}>
      <img src={url} alt="Foto da anotação" />
      <button className="btn sec pequeno" onClick={fechar}>Fechar</button>
    </div>
  );
}

// ---------- lista ----------

export function Anotacoes() {
  const [ver, setVer] = useState<'abertas' | 'feitas'>('abertas');
  const [modulo, setModulo] = useState('');
  const lista = useLiveQuery(() => db.anotacoes.toArray());
  const lugares = useLugares();
  const { grava, eu } = usePermissoes();
  const aviso = useAviso();
  if (!lista) return <Topo titulo="Anotações" voltar />;
  const abertas = lista.filter((a) => !a.feita);
  const doModulo = (a: Anotacao) => !modulo || String(a.moduloId ?? '') === modulo;
  const mostrar = (ver === 'abertas' ? abertas : lista.filter((a) => a.feita))
    .filter(doModulo)
    .sort((a, b) => (ver === 'abertas' ? Number(!!b.urgente) - Number(!!a.urgente) : 0)
      || (ver === 'abertas' ? b.data.localeCompare(a.data) : (b.feitaEm ?? b.data).localeCompare(a.feitaEm ?? a.data))
      || b.criadoEm - a.criadoEm);
  return (
    <>
      <Topo titulo="Anotações" voltar />
      <main>
        {grava && <Link to="/anotacoes/nova" className="btn largo" style={{ marginBottom: 14 }}>+ Anotar o que precisa corrigir</Link>}
        <Opcoes valor={ver} aoMudar={setVer} opcoes={[
          { valor: 'abertas', rotulo: `A fazer (${abertas.length})` },
          { valor: 'feitas', rotulo: `Feitas (${lista.length - abertas.length})` },
        ]} />
        {!!lugares?.modulos.length && (
          <div style={{ marginTop: 12 }}>
            <CampoEscolha rotulo="Módulo" nome="filtroModulo" valor={modulo} aoMudar={setModulo}>
              <option value="">Todos</option>
              {lugares.modulos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </CampoEscolha>
          </div>
        )}
        <div style={{ height: 8 }} />
        {mostrar.length === 0 && (
          <div className="vazio">
            <div className="grande">{ver === 'abertas' ? '✅' : '📝'}</div>
            <p className="mudo">{ver === 'abertas' ? 'Nada para corrigir. Na ronda, anote aqui o que encontrar: cerca, água, cocho, pasto, animal...' : 'Nenhuma tarefa feita ainda.'}</p>
          </div>
        )}
        {mostrar.map((a) => (
          <div key={a.id} className={`cartao anotacao ${a.urgente && !a.feita ? 'urgente' : ''}`} data-testid="anotacao">
            <Link to={`/anotacoes/${a.id}`} className="anotacao-corpo">
              <span className="anotacao-ic" aria-hidden="true">{CATEGORIAS[a.categoria ?? 'outro'].icone}</span>
              <span className="anotacao-texto">
                {a.urgente && !a.feita && <span className="etiqueta ruim">urgente</span>}
                <b>{a.texto}</b>
                <span className="mudo">{[lugar(a, lugares), fmtData(a.data), a.autor && `por ${a.autor}`].filter(Boolean).join(' · ')}</span>
                {a.feita && <span className="mudo">Feita {a.feitaEm ? `em ${fmtData(a.feitaEm)}` : ''}{a.feitaPor ? ` por ${a.feitaPor}` : ''}</span>}
              </span>
              {!!a.fotos?.length && <Miniatura id={a.fotos[0].foto} />}
            </Link>
            {grava && !a.feita && (
              <button className="btn sec pequeno largo" style={{ marginTop: 10 }} onClick={async () => { await marcarFeita(a.id!, true, eu?.nome); aviso('Marcada como feita.'); }}>✓ Feito</button>
            )}
          </div>
        ))}
      </main>
    </>
  );
}

// ---------- detalhe ----------

export function AnotacaoDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const a = useLiveQuery(async () => (await db.anotacoes.get(Number(id))) ?? null, [id]);
  const lugares = useLugares();
  const { grava, podeApagar, eu } = usePermissoes();
  const [cheia, setCheia] = useState<string | null>(null);
  if (a === undefined) return <Topo titulo="Anotação" voltar />;
  if (a === null) {
    return (<><Topo titulo="Anotação" voltar /><main><p className="mudo">Esta anotação foi apagada.</p><Link to="/anotacoes" className="btn sec largo">Ver anotações</Link></main></>);
  }
  const cat = CATEGORIAS[a.categoria ?? 'outro'];
  const apagar = async () => {
    if (!window.confirm('Apagar esta anotação e as fotos dela?')) return;
    await excluirAnotacao(a.id!);
    aviso('Anotação apagada.');
    nav('/anotacoes', { replace: true });
  };
  return (
    <>
      <Topo titulo="Anotação" voltar />
      <main>
        <div className="cartao">
          <p style={{ margin: '0 0 6px' }}>
            <span className="etiqueta">{cat.icone} {cat.nome}</span>
            {a.urgente && !a.feita && <span className="etiqueta ruim">urgente</span>}
            {a.feita && <span className="etiqueta">feita</span>}
          </p>
          <h2 style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{a.texto}</h2>
          <p className="mudo">📍 {lugar(a, lugares) || 'Lugar não marcado'}</p>
          <p className="mudo">Anotada em {fmtData(a.data)}{a.autor ? ` por ${a.autor}` : ''}</p>
          {a.feita && <p className="mudo">Feita {a.feitaEm ? `em ${fmtData(a.feitaEm)}` : ''}{a.feitaPor ? ` por ${a.feitaPor}` : ''}</p>}
        </div>
        {!!a.fotos?.length && (
          <div className="fotos-grade">
            {a.fotos.map((f) => <Miniatura key={f.foto} id={f.foto} grande aoAbrir={setCheia} />)}
          </div>
        )}
        {grava && (
          <div className="botoes">
            {a.feita
              ? <button className="btn sec" onClick={() => marcarFeita(a.id!, false)}>Voltar para "a fazer"</button>
              : <button className="btn" onClick={async () => { await marcarFeita(a.id!, true, eu?.nome); aviso('Marcada como feita.'); }}>✓ Marcar como feita</button>}
            <Link to={`/anotacoes/${a.id}/editar`} className="btn sec">Editar</Link>
          </div>
        )}
        {podeApagar(a) && <button className="btn perigo pequeno" onClick={apagar}>Apagar anotação</button>}
        {cheia && <FotoTelaCheia url={cheia} fechar={() => setCheia(null)} />}
      </main>
    </>
  );
}

// ---------- nova / editar ----------

export function AnotacaoForm() {
  const { id } = useParams();
  const editando = id ? Number(id) : undefined;
  const nav = useNavigate();
  const aviso = useAviso();
  const lugares = useLugares();
  const { eu } = usePermissoes();
  const original = useLiveQuery(async () => (editando ? (await db.anotacoes.get(editando)) ?? null : null), [editando]);
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState<CategoriaAnotacao | ''>('');
  const [moduloId, setModuloId] = useState('');
  const [piqueteId, setPiqueteId] = useState('');
  const [urgente, setUrgente] = useState<'nao' | 'sim'>('nao');
  const [fotos, setFotos] = useState<string[]>([]);
  const [novas, setNovas] = useState<(FotoNova & { url: string })[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [carregado, setCarregado] = useState(!editando);
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editando || carregado || !original) return;
    setTexto(original.texto);
    setCategoria(original.categoria ?? '');
    setModuloId(original.moduloId ? String(original.moduloId) : '');
    setPiqueteId(original.piqueteId ? String(original.piqueteId) : '');
    setUrgente(original.urgente ? 'sim' : 'nao');
    setFotos((original.fotos ?? []).map((f) => f.foto));
    setCarregado(true);
  }, [editando, carregado, original]);
  // libera a memória das fotos novas ao sair
  const novasRef = useRef(novas);
  novasRef.current = novas;
  useEffect(() => () => novasRef.current.forEach((n) => URL.revokeObjectURL(n.url)), []);

  if (editando && original === null) return (<><Topo titulo="Editar anotação" voltar /><main><p className="mudo">Esta anotação foi apagada.</p></main></>);

  const piquetes = (lugares?.piquetes ?? []).filter((p) => !moduloId || String(p.moduloId) === moduloId);
  const nomeModulo = (mid: number) => lugares?.modulos.find((m) => m.id === mid)?.nome ?? '';

  const adicionar = async (arqs: FileList | null | undefined) => {
    if (!arqs?.length) return;
    const vagas = MAX_FOTOS_ANOTACAO - fotos.length;
    if (vagas <= 0) return aviso(`No máximo ${MAX_FOTOS_ANOTACAO} fotos por anotação.`, true);
    setPreparando(true);
    try {
      const lista = [...arqs].slice(0, vagas);
      const prontas: (FotoNova & { url: string })[] = [];
      for (const arq of lista) {
        const dados = await comprimirFoto(arq);
        prontas.push({ id: novaFotoId(), dados, url: URL.createObjectURL(new Blob([dados], { type: 'image/jpeg' })) });
      }
      setNovas((n) => [...n, ...prontas]);
      setFotos((f) => [...f, ...prontas.map((p) => p.id)]);
      if (arqs.length > vagas) aviso(`Só cabem ${MAX_FOTOS_ANOTACAO} fotos. As outras ficaram de fora.`, true);
    } catch (e) {
      aviso((e as Error).name === 'ErroValidacao' ? (e as Error).message : 'Não consegui abrir esta foto. Tente de novo.', true);
    } finally {
      setPreparando(false);
      if (camera.current) camera.current.value = '';
      if (galeria.current) galeria.current.value = '';
    }
  };
  const tirar = (fid: string) => {
    setFotos((f) => f.filter((x) => x !== fid));
    setNovas((n) => { const sai = n.find((x) => x.id === fid); if (sai) URL.revokeObjectURL(sai.url); return n.filter((x) => x.id !== fid); });
  };

  const salvar = async () => {
    if (!texto.trim()) return aviso('Escreva ou fale o que precisa ser feito.', true);
    setSalvando(true);
    try {
      const aid = await salvarAnotacao(
        { texto, categoria: categoria || undefined, moduloId: moduloId ? Number(moduloId) : null, piqueteId: piqueteId ? Number(piqueteId) : null, urgente: urgente === 'sim' },
        fotos, novas.map(({ id: fid, dados }) => ({ id: fid, dados })), editando, eu,
      );
      aviso(editando ? 'Anotação salva.' : 'Anotado! A equipe vai ver quando o celular pegar sinal.');
      nav(editando ? `/anotacoes/${aid}` : '/anotacoes', { replace: true });
    } catch (e) {
      aviso((e as Error).message, true);
      setSalvando(false);
    }
  };

  return (
    <>
      <Topo titulo={editando ? 'Editar anotação' : 'Nova anotação'} voltar />
      <main>
        <CampoTexto rotulo="O que precisa ser corrigido?" valor={texto} aoMudar={setTexto} nome="anotTexto" multilinha maxLength={1000}
          placeholder="Ex.: cerca caída perto da porteira, bebedouro vazando..."
          dica="Toque no microfone e fale. Pode falar mais de uma vez: o texto vai sendo juntado." />

        <div className="campo">
          <span className="rotulo-campo">Fotos ({fotos.length} de {MAX_FOTOS_ANOTACAO})</span>
          {fotos.length > 0 && (
            <div className="fotos-grade">
              {fotos.map((fid) => {
                const nova = novas.find((n) => n.id === fid);
                return (
                  <div key={fid} className="foto-com-x">
                    {nova ? <div className="foto-mini grande"><img src={nova.url} alt="Foto nova" /></div> : <Miniatura id={fid} grande />}
                    <button type="button" className="foto-x" aria-label="Tirar esta foto" onClick={() => tirar(fid)}>×</button>
                  </div>
                );
              })}
            </div>
          )}
          {fotos.length < MAX_FOTOS_ANOTACAO && (
            <div className="botoes" style={{ marginTop: 8 }}>
              <button type="button" className="btn sec" disabled={preparando} onClick={() => camera.current?.click()}>{preparando ? 'Preparando…' : '📷 Tirar foto'}</button>
              <button type="button" className="btn sec" disabled={preparando} onClick={() => galeria.current?.click()}>🖼️ Da galeria</button>
            </div>
          )}
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="fotoCamera" onChange={(e) => adicionar(e.target.files)} />
          <input ref={galeria} type="file" accept="image/*" multiple hidden data-testid="fotoGaleria" onChange={(e) => adicionar(e.target.files)} />
        </div>

        <div className="campo">
          <span className="rotulo-campo">Onde?</span>
          {lugares && lugares.modulos.length === 0 ? (
            <div className="dica" style={{ margin: 0 }}>Para marcar módulo e piquete, cadastre-os em <Link to="/fazenda">Fazenda</Link>. Dá para anotar sem isso.</div>
          ) : (
            <div className="grade">
              <CampoEscolha rotulo="Módulo" nome="anotModulo" valor={moduloId} aoMudar={(v) => { setModuloId(v); setPiqueteId(''); }}>
                <option value="">Não sei / geral</option>
                {lugares?.modulos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </CampoEscolha>
              <CampoEscolha rotulo="Piquete" nome="anotPiquete" valor={piqueteId} aoMudar={(v) => {
                setPiqueteId(v);
                const p = lugares?.piquetes.find((x) => String(x.id) === v);
                if (p) setModuloId(String(p.moduloId));
              }}>
                <option value="">Nenhum</option>
                {piquetes.map((p) => <option key={p.id} value={p.id}>{moduloId ? p.nome : `${p.nome} (${nomeModulo(p.moduloId)})`}</option>)}
              </CampoEscolha>
            </div>
          )}
        </div>

        <div className="campo">
          <span className="rotulo-campo">Tipo (opcional)</span>
          <div className="opcoes tres" role="radiogroup">
            {(Object.entries(CATEGORIAS) as [CategoriaAnotacao, { nome: string; icone: string }][]).map(([k, c]) => (
              <button type="button" key={k} role="radio" aria-checked={categoria === k} className={`opcao ${categoria === k ? 'sel' : ''}`}
                onClick={() => setCategoria(categoria === k ? '' : k)}>
                <span aria-hidden="true">{c.icone}</span> {c.nome}
              </button>
            ))}
          </div>
        </div>

        <div className="campo">
          <span className="rotulo-campo">É urgente?</span>
          <Opcoes valor={urgente} aoMudar={setUrgente} opcoes={[{ valor: 'nao', rotulo: 'Pode esperar' }, { valor: 'sim', rotulo: '⚠️ Urgente' }]} />
        </div>

        <div className="botoes">
          <button className="btn" disabled={salvando || preparando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar anotação'}</button>
          <button className="btn sec" onClick={() => nav(editando ? `/anotacoes/${editando}` : '/anotacoes', { replace: true })}>Cancelar</button>
        </div>
        {!editando && !nuvemConfigurada() && <p className="mudo" style={{ marginTop: 10 }}>Fica guardada neste celular.</p>}
      </main>
    </>
  );
}
