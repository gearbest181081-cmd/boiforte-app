// Cria: formulários (grupo de manejo, animal, monta/IA, diagnóstico, parto, aborto, pesagem e desmama).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, novoGid, type Animal, type CategoriaCria, type TipoGrupo } from '../db';
import {
  ativoCria, cabecasGrupo, CATEGORIAS_CRIA, estacaoAtualOuProxima, idadeDias, IDADE_DESMAMA_DIAS, PERMANENCIA_PADRAO, resumoPacote, rotuloAnimal,
  TIPOS_GRUPO, uaGrupo, ultimosPesos, type ItemDesmama,
} from '../cria';
import { coberturaEmMassa, desmamar, excluirGrupo, pesarCria, registrarParto, salvarAnimalCria, salvarEvento, salvarGrupo } from '../criaDb';
import { fmtKg, fmtNum, hojeISO } from '../calc';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, Entrada, Indicador, num, Opcoes, Topo, useAviso } from '../components/ui';
import { BotaoFoto } from '../components/Foto';
import { BotaoBalanca } from '../components/Balanca';
import { comprimirFoto } from '../anotacoes';
import { Miniatura } from './Anotacoes';
import { SanidadeDe } from './Sanidade';
import { LinhaAnimal, useCria } from './Cria';
import { usePapel } from '../nuvem/useNuvem';

const erro = (e: unknown) => (e as Error).message;

/** Escolher um animal por brinco: lista + busca falada + leitura do brinco pela foto. */
function EscolheAnimal({ rotulo, valor, aoMudar, animais, nome }: { rotulo: string; valor: number; aoMudar: (id: number) => void; animais: Animal[]; nome: string }) {
  const aviso = useAviso();
  const achar = (b: string) => {
    const t = b.trim().toLowerCase();
    const a = animais.find((x) => x.brinco.toLowerCase() === t || x.chip?.toLowerCase() === t);
    if (a) aoMudar(a.id!); else aviso(`Não achei o brinco ${b} nesta lista.`, true);
  };
  return (
    <>
      <CampoEscolha rotulo={rotulo} nome={nome} valor={valor || ''} aoMudar={(v) => aoMudar(Number(v))}>
        <option value="">Escolha…</option>
        {animais.map((a) => <option key={a.id} value={a.id}>{rotuloAnimal(a)}</option>)}
      </CampoEscolha>
      <BotaoFoto<{ legivel: boolean; brinco: string | null }> tipo="brinco" rotulo="Ler o brinco pela foto" aoErro={(m) => aviso(m, true)}
        aoLer={(r) => (r.legivel && r.brinco ? achar(r.brinco) : aviso('Não consegui ler o brinco. Escolha na lista.', true))} />
    </>
  );
}

// ---------- Grupo de manejo ----------

export function GrupoCria() {
  const { id } = useParams();
  const novo = id === 'novo';
  const gid = novo ? 0 : Number(id);
  const nav = useNavigate();
  const aviso = useAviso();
  const papel = usePapel();
  const d = useCria();
  const props = useLiveQuery(() => db.propriedades.toArray());
  const piquetes = useLiveQuery(() => db.piquetes.toArray());
  const grupo = d?.grupos.find((g) => g.id === gid);
  const [editar, setEditar] = useState(novo);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<TipoGrupo>('matrizes');
  const [piq, setPiq] = useState('');
  const [obs, setObs] = useState('');
  useEffect(() => { if (grupo) { setNome(grupo.nome); setTipo(grupo.tipo); setPiq(grupo.piqueteId ? String(grupo.piqueteId) : ''); setObs(grupo.obs ?? ''); } }, [grupo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !props || !piquetes) return <Topo titulo="Grupo de manejo" />;
  if (!novo && !grupo) return (<><Topo titulo="Grupo de manejo" /><main><p>Grupo não encontrado.</p></main></>);
  const pode = papel !== 'vaqueiro' && papel !== 'consultor';
  const salvar = async () => {
    if (!props.length) return aviso('Cadastre a fazenda primeiro.', true);
    try {
      const r = await salvarGrupo({ propriedadeId: grupo?.propriedadeId ?? props[0].id!, nome: nome.trim(), tipo, piqueteId: piq ? Number(piq) : null, obs: obs.trim() || undefined, encerrado: grupo?.encerrado }, grupo?.id);
      aviso('Grupo salvo.');
      if (novo) nav(`/cria/grupo/${r}`, { replace: true }); else setEditar(false);
    } catch (e) { aviso(erro(e), true); }
  };
  const form = (
    <div className="cartao">
      <CampoTexto rotulo="Nome do grupo" valor={nome} aoMudar={setNome} nome="grupoNome" dica="Ex.: Vacas do retiro, Paridas, Touros, Novilhas 2025" />
      <CampoEscolha rotulo="Tipo" nome="grupoTipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoGrupo)}>
        {Object.entries(TIPOS_GRUPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </CampoEscolha>
      <CampoEscolha rotulo="Piquete onde está" nome="grupoPiquete" valor={piq} aoMudar={setPiq} dica="Um piquete recebe um lote ou grupo de cada vez.">
        <option value="">Nenhum</option>
        {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </CampoEscolha>
      <CampoTexto rotulo="Observação" valor={obs} aoMudar={setObs} nome="grupoObs" multilinha />
      <div className="botoes">
        <button className="btn" onClick={salvar}>Salvar</button>
        <button className="btn sec" onClick={() => (novo ? nav(-1) : setEditar(false))}>Cancelar</button>
      </div>
    </div>
  );
  if (novo) return (<><Topo titulo="Novo grupo de manejo" /><main>{form}</main></>);
  const g = grupo!;
  const animais = d.animais.filter((a) => a.grupoId === g.id && ativoCria(a));
  const ult = ultimosPesos(d.pesos);
  const p = piquetes.find((x) => x.id === g.piqueteId);
  const ua = uaGrupo(g.id!, d.animais, d.pesos);
  const hoje = hojeISO();
  return (
    <>
      <Topo titulo={g.nome} />
      <main>
        <p className="mudo">{TIPOS_GRUPO[g.tipo]}{p ? ` · piquete ${p.nome}` : ''}{g.encerrado ? ' · encerrado' : ''}</p>
        <div className="grade tres">
          <Indicador rotulo="Cabeças" valor={cabecasGrupo(g.id!, d.animais)} />
          <Indicador rotulo="UA" valor={fmtNum(ua, 1)} sub="450 kg = 1 UA" />
          <Indicador rotulo="UA/ha" valor={p?.areaHa ? fmtNum(ua / p.areaHa, 2) : '—'} sub={p?.areaHa ? `${fmtNum(p.areaHa, 1)} ha` : 'sem área do piquete'} />
        </div>
        {editar ? form : pode && (
          <div className="botoes">
            <button className="btn sec" onClick={() => setEditar(true)}>Editar grupo</button>
            <button className="btn sec" onClick={async () => { await db.grupos.update(g.id!, { encerrado: !g.encerrado }); aviso(g.encerrado ? 'Grupo reaberto.' : 'Grupo encerrado.'); }}>{g.encerrado ? 'Reabrir' : 'Encerrar'}</button>
          </div>
        )}
        <Link to={`/cria/animal/novo?grupo=${g.id}`} className="btn largo" style={{ marginBottom: 8 }}>+ Animal neste grupo</Link>
        <Link to={`/cria/pesar?grupo=${g.id}`} className="btn sec largo" style={{ marginBottom: 14 }}>Pesar este grupo</Link>
        <h2>Animais ({animais.length})</h2>
        {animais.map((a) => <LinhaAnimal key={a.id} a={a} hoje={hoje} peso={ult.get(a.id!)?.peso} />)}
        <h2>Saúde do grupo</h2>
        <SanidadeDe alvo={{ grupoId: g.id! }} qtd={cabecasGrupo(g.id!, d.animais)} />
        {pode && !animais.length && (
          <button className="btn perigo pequeno" style={{ marginTop: 14 }} onClick={async () => {
            if (!window.confirm(`Apagar o grupo ${g.nome}?`)) return;
            try { await excluirGrupo(g.id!); nav('/cria', { replace: true }); } catch (e) { aviso(erro(e), true); }
          }}>Apagar grupo</button>
        )}
      </main>
    </>
  );
}

// ---------- Animal ----------

export function AnimalCriaForm() {
  const { id } = useParams();
  const [q] = useSearchParams();
  const editarId = id ? Number(id) : undefined;
  const nav = useNavigate();
  const aviso = useAviso();
  const d = useCria();
  const formulas = useLiveQuery(() => db.formulas.toArray());
  const animal = editarId ? d?.animais.find((a) => a.id === editarId) : undefined;
  const [f, setF] = useState({
    categoria: (q.get('categoria') as CategoriaCria) || 'matriz', grupoId: q.get('grupo') ?? '', brinco: '', chip: '', sisbov: '', nome: '', sexo: 'femea' as 'macho' | 'femea',
    raca: '', nascimento: '', entrada: hojeISO(), permanencia: String(PERMANENCIA_PADRAO.matriz ?? ''), porLote: false, qtd: '2', maeId: 0, paiId: 0, paiTexto: '',
    pesoNascer: '', creep: false, formulaCreepId: '', obs: '', foto: '' as string,
  });
  const [fotoNova, setFotoNova] = useState<{ id: string; dados: ArrayBuffer } | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!animal) return;
    setF({
      categoria: animal.categoria ?? 'matriz', grupoId: String(animal.grupoId ?? ''), brinco: animal.brinco, chip: animal.chip ?? '', sisbov: animal.sisbov ?? '', nome: animal.nome ?? '',
      sexo: animal.sexo === 'macho' ? 'macho' : 'femea', raca: animal.raca ?? '', nascimento: animal.nascimento ?? '', entrada: animal.entrada ?? '',
      permanencia: animal.permanenciaMeses ? String(animal.permanenciaMeses) : '', porLote: (animal.qtd ?? 1) > 1, qtd: String(animal.qtd ?? 2),
      maeId: animal.maeId ?? 0, paiId: animal.paiId ?? 0, paiTexto: animal.paiTexto ?? '', pesoNascer: animal.pesoNascer ? String(animal.pesoNascer).replace('.', ',') : '',
      creep: !!animal.creep, formulaCreepId: animal.formulaCreepId ? String(animal.formulaCreepId) : '', obs: animal.obs ?? '', foto: animal.foto ?? '',
    });
  }, [animal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !formulas) return <Topo titulo="Animal da Cria" />;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const mudarCategoria = (c: CategoriaCria) => setF((x) => ({
    ...x, categoria: c, sexo: c === 'touro' ? 'macho' : c === 'bezerro' ? x.sexo : 'femea', porLote: c === 'touro' ? x.porLote : false,
    permanencia: animal ? x.permanencia : String(PERMANENCIA_PADRAO[c] ?? ''),
  }));
  const grupos = d.grupos.filter((g) => !g.encerrado || g.id === animal?.grupoId);
  const femeas = d.animais.filter((a) => a.sexo === 'femea' && (a.categoria === 'matriz' || a.categoria === 'novilha') && a.id !== editarId);
  const touros = d.animais.filter((a) => a.categoria === 'touro' && (a.qtd ?? 1) === 1 && a.id !== editarId);
  const tirarFoto = async (arq?: File) => {
    if (!arq) return;
    try { const dados = await comprimirFoto(arq); const fid = novoGid(); setFotoNova({ id: fid, dados }); set('foto', fid); }
    catch { aviso('Não consegui usar esta foto.', true); }
  };
  const salvar = async () => {
    const qtd = f.porLote ? Math.round(num(f.qtd) ?? 0) : 1;
    if (f.porLote && qtd < 2) return aviso('Informe quantos touros tem o lote.', true);
    try {
      const dados: Omit<Animal, 'id' | 'criadoEm'> = {
        grupoId: Number(f.grupoId) || null, categoria: f.categoria, brinco: f.brinco, chip: f.chip.trim() || undefined, sisbov: f.sisbov.replace(/\D/g, '') || undefined,
        nome: f.nome.trim() || undefined, sexo: f.sexo, raca: f.raca.trim() || undefined, nascimento: f.nascimento || null, entrada: f.entrada || null,
        permanenciaMeses: f.categoria === 'bezerro' ? null : Math.round(num(f.permanencia) ?? 0) || null, qtd: qtd > 1 ? qtd : null,
        maeId: f.maeId || null, paiId: f.paiId || null, paiTexto: f.paiTexto.trim() || undefined, pesoNascer: num(f.pesoNascer) || null,
        creep: f.categoria === 'bezerro' ? f.creep : undefined, formulaCreepId: f.creep && f.formulaCreepId ? Number(f.formulaCreepId) : null,
        foto: f.foto || undefined, obs: f.obs.trim() || undefined, ativo: animal?.ativo ?? true,
        ...(animal ? { saida: animal.saida, motivoSaida: animal.motivoSaida, descarte: animal.descarte, motivoDescarte: animal.motivoDescarte } : {}),
      };
      const salvo = await db.transaction('rw', db.animais, db.fotosAnotacao, async () => {
        const r = await salvarAnimalCria(dados, editarId);
        if (fotoNova && f.foto === fotoNova.id) await db.fotosAnotacao.put({ id: fotoNova.id, dados: fotoNova.dados, estado: 'enviar', em: Date.now() });
        if (animal?.foto && animal.foto !== f.foto) {
          const l = await db.fotosAnotacao.get(animal.foto);
          if (l?.estado === 'enviar') await db.fotosAnotacao.delete(animal.foto); else await db.fotosAnotacao.put({ id: animal.foto, estado: 'apagar', em: Date.now() });
        }
        return r;
      });
      aviso('Animal salvo.');
      nav(`/cria/animal/${salvo}`, { replace: true });
    } catch (e) { aviso(erro(e), true); }
  };
  const bezerro = f.categoria === 'bezerro';
  return (
    <>
      <Topo titulo={animal ? `Editar ${rotuloAnimal(animal)}` : 'Novo animal da Cria'} />
      <main>
        <div className="cartao">
          <CampoEscolha rotulo="É" nome="criaCategoria" valor={f.categoria} aoMudar={(v) => mudarCategoria(v as CategoriaCria)}>
            {Object.entries(CATEGORIAS_CRIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </CampoEscolha>
          {grupos.length === 0 && <div className="alerta atencao"><span className="ic">🔔</span><div><b>Crie um grupo de manejo antes</b><Link to="/cria/grupo/novo">Criar grupo</Link></div></div>}
          <CampoEscolha rotulo="Grupo de manejo" nome="criaGrupo" valor={f.grupoId} aoMudar={(v) => set('grupoId', v)}>
            <option value="">Escolha…</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </CampoEscolha>
          {f.categoria === 'touro' && (
            <Opcoes valor={f.porLote ? 'lote' : 'um'} aoMudar={(v) => set('porLote', v === 'lote')} opcoes={[{ valor: 'um', rotulo: 'Um touro (com brinco)' }, { valor: 'lote', rotulo: 'Lote de touros' }]} />
          )}
          {f.porLote ? (
            <div className="grade">
              <CampoTexto rotulo="Nome do lote de touros" valor={f.brinco} aoMudar={(v) => set('brinco', v)} nome="criaBrinco" />
              <CampoNumero rotulo="Quantos touros" valor={f.qtd} aoMudar={(v) => set('qtd', v)} nome="criaQtd" />
            </div>
          ) : (
            <>
              <CampoTexto rotulo="Brinco / identificação" valor={f.brinco} aoMudar={(v) => set('brinco', v)} nome="criaBrinco" formato="codigo" />
              <BotaoFoto<{ legivel: boolean; brinco: string | null }> tipo="brinco" rotulo="Ler o brinco pela foto" aoErro={(m) => aviso(m, true)}
                aoLer={(r) => (r.legivel && r.brinco ? set('brinco', r.brinco) : aviso('Não consegui ler o brinco. Digite ou fale.', true))} />
              <div className="grade">
                <CampoTexto rotulo="Chip (RFID)" valor={f.chip} aoMudar={(v) => set('chip', v)} nome="criaChip" formato="codigo" />
                <CampoTexto rotulo="Nome" valor={f.nome} aoMudar={(v) => set('nome', v)} nome="criaNome" />
              </div>
              <CampoTexto rotulo="Código SISBOV (15 números)" valor={f.sisbov} aoMudar={(v) => set('sisbov', v)} nome="criaSisbov" formato="digitos" dica="Opcional. Para rastreabilidade oficial (PNIB/SISBOV)." />
            </>
          )}
          {bezerro && (
            <Opcoes valor={f.sexo} aoMudar={(v) => set('sexo', v)} opcoes={[{ valor: 'macho', rotulo: 'Macho' }, { valor: 'femea', rotulo: 'Fêmea' }]} />
          )}
          <div className="grade">
            <CampoTexto rotulo="Raça" valor={f.raca} aoMudar={(v) => set('raca', v)} nome="criaRaca" />
            <CampoData rotulo="Nascimento" valor={f.nascimento} aoMudar={(v) => set('nascimento', v)} nome="criaNascimento" />
          </div>
          {!bezerro && (
            <div className="grade">
              <CampoData rotulo="Entrou no rebanho" valor={f.entrada} aoMudar={(v) => set('entrada', v)} nome="criaEntrada" />
              <CampoNumero rotulo="Permanência" valor={f.permanencia} aoMudar={(v) => set('permanencia', v)} unidade="meses" nome="criaPermanencia"
                dica="Tempo que fica no rebanho. O app avisa quando chegar ao fim." />
            </div>
          )}
          {!f.porLote && (
            <>
              <EscolheAnimal rotulo="Mãe" nome="criaMae" valor={f.maeId} aoMudar={(v) => set('maeId', v)} animais={femeas} />
              <CampoEscolha rotulo="Pai (touro da fazenda)" nome="criaPai" valor={f.paiId || ''} aoMudar={(v) => set('paiId', Number(v))}>
                <option value="">Não sei / de fora</option>
                {touros.map((t) => <option key={t.id} value={t.id}>{rotuloAnimal(t)}</option>)}
              </CampoEscolha>
              {!f.paiId && <CampoTexto rotulo="Pai de fora ou sêmen" valor={f.paiTexto} aoMudar={(v) => set('paiTexto', v)} nome="criaPaiTexto" dica="Ex.: nome do touro da central e a partida do sêmen." />}
            </>
          )}
          {bezerro && (
            <>
              <CampoNumero rotulo="Peso ao nascer" valor={f.pesoNascer} aoMudar={(v) => set('pesoNascer', v)} unidade="kg" nome="criaPesoNascer" />
              <label className="marcar"><input type="checkbox" checked={f.creep} onChange={(e) => set('creep', e.target.checked)} /> Vai receber creep feed (ração no cocho privativo)</label>
              {f.creep && (
                <CampoEscolha rotulo="Ração do creep" nome="criaCreep" valor={f.formulaCreepId} aoMudar={(v) => set('formulaCreepId', v)}>
                  <option value="">Escolha…</option>
                  {formulas.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.tipo === 'creep' ? ' (creep)' : ''}</option>)}
                </CampoEscolha>
              )}
            </>
          )}
          <h3>Foto</h3>
          {f.foto && !fotoNova && <Miniatura id={f.foto} grande />}
          {fotoNova && <img className="foto-mini grande" alt="Foto do animal" src={URL.createObjectURL(new Blob([fotoNova.dados], { type: 'image/jpeg' }))} />}
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => tirarFoto(e.target.files?.[0])} />
          <div className="botoes">
            <button type="button" className="btn sec" onClick={() => camera.current?.click()}>{f.foto ? 'Trocar foto' : 'Tirar foto'}</button>
            {f.foto && <button type="button" className="btn sec" onClick={() => { set('foto', ''); setFotoNova(null); }}>Tirar a foto</button>}
          </div>
          <CampoTexto rotulo="Observação" valor={f.obs} aoMudar={(v) => set('obs', v)} nome="criaObs" multilinha />
          <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={() => nav(-1)}>Cancelar</button></div>
        </div>
      </main>
    </>
  );
}

// ---------- Eventos reprodutivos ----------

const TITULOS = { cobertura: 'Monta ou inseminação', diagnostico: 'Diagnóstico de gestação', parto: 'Parto', aborto: 'Aborto' } as const;

export function EventoCria() {
  const { tipo: t } = useParams();
  const tipo = (t && t in TITULOS ? t : 'parto') as keyof typeof TITULOS;
  const [q] = useSearchParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const d = useCria();
  const [vaca, setVaca] = useState(Number(q.get('vaca')) || 0);
  const [marcadas, setMarcadas] = useState<number[]>(vaca ? [vaca] : []);
  const [data, setData] = useState(hojeISO());
  const [metodo, setMetodo] = useState<'monta' | 'ia'>('monta');
  const [touro, setTouro] = useState(0);
  const [semen, setSemen] = useState('');
  const [resultado, setResultado] = useState<'prenhe' | 'vazia'>('prenhe');
  const [diasGest, setDiasGest] = useState('');
  const [partoTipo, setPartoTipo] = useState<'normal' | 'assistido' | 'natimorto'>('normal');
  const [bz, setBz] = useState({ brinco: '', sexo: 'macho' as 'macho' | 'femea', peso: '', creep: false, paiId: 0, paiTexto: '' });
  const [obs, setObs] = useState('');
  const [filtro, setFiltro] = useState('');
  if (!d) return <Topo titulo={TITULOS[tipo]} />;
  const femeas = d.animais.filter((a) => ativoCria(a) && (a.categoria === 'matriz' || a.categoria === 'novilha'));
  const touros = d.animais.filter((a) => ativoCria(a) && a.categoria === 'touro');
  const est = estacaoAtualOuProxima(d.estacoes, data);
  const estacaoId = est && data >= est.inicio && data <= est.fim ? est.id : null;
  // no parto, o pai sugerido é o touro (ou sêmen) da última cobertura da vaca
  const ultimaCob = vaca ? d.eventos.filter((e) => e.matrizId === vaca && (e.tipo === 'monta' || e.tipo === 'ia')).sort((a, b) => (a.data < b.data ? 1 : -1))[0] : undefined;
  const salvar = async () => {
    try {
      if (tipo === 'cobertura') {
        await coberturaEmMassa(marcadas, { data, tipo: metodo, touroId: metodo === 'monta' ? touro || null : null, semen: metodo === 'ia' ? semen.trim() || undefined : undefined, estacaoId, obs: obs.trim() || undefined });
        aviso(`${metodo === 'ia' ? 'Inseminação' : 'Monta'} lançada para ${marcadas.length} vaca(s).`);
      } else if (tipo === 'diagnostico') {
        if (!vaca) return aviso('Escolha a vaca.', true);
        await salvarEvento({ matrizId: vaca, data, tipo: 'diagnostico', resultado, diasGestacao: resultado === 'prenhe' ? Math.round(num(diasGest) ?? 0) || null : null, estacaoId, obs: obs.trim() || undefined });
        aviso(`Diagnóstico salvo: ${resultado}.`);
        setVaca(0); setDiasGest(''); setObs('');
        return; // continua na tela para lançar a próxima vaca
      } else if (tipo === 'aborto') {
        if (!vaca) return aviso('Escolha a vaca.', true);
        await salvarEvento({ matrizId: vaca, data, tipo: 'aborto', obs: obs.trim() || undefined });
        aviso('Aborto registrado.');
      } else {
        if (!vaca) return aviso('Escolha a vaca que pariu.', true);
        const paiId = bz.paiId || (ultimaCob?.touroId && touros.find((x) => x.id === ultimaCob.touroId && (x.qtd ?? 1) === 1) ? ultimaCob.touroId : null);
        const r = await registrarParto({
          matrizId: vaca, data, partoTipo, obs: obs.trim() || undefined,
          bezerro: partoTipo === 'natimorto' ? undefined : { brinco: bz.brinco, sexo: bz.sexo, pesoNascer: num(bz.peso), creep: bz.creep, paiId, paiTexto: bz.paiTexto.trim() || (ultimaCob?.semen ? `Sêmen ${ultimaCob.semen}` : undefined) },
        });
        aviso(partoTipo === 'natimorto' ? 'Parto registrado.' : 'Parto e bezerro registrados.');
        if (r.bezerroId) return nav(`/cria/animal/${r.bezerroId}`, { replace: true });
      }
      nav(-1);
    } catch (e) { aviso(erro(e), true); }
  };
  const lista = femeas.filter((a) => !filtro.trim() || a.brinco.toLowerCase().includes(filtro.trim().toLowerCase()));
  return (
    <>
      <Topo titulo={TITULOS[tipo]} />
      <main>
        <div className="cartao">
          <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="evData" dica={estacaoId ? `Dentro da ${est!.nome}.` : undefined} />
          {tipo === 'cobertura' ? (
            <>
              <Opcoes valor={metodo} aoMudar={setMetodo} opcoes={[{ valor: 'monta', rotulo: 'Monta (touro)' }, { valor: 'ia', rotulo: 'Inseminação' }]} />
              <div style={{ height: 10 }} />
              {metodo === 'monta' ? (
                <CampoEscolha rotulo="Touro" nome="evTouro" valor={touro || ''} aoMudar={(v) => setTouro(Number(v))}>
                  <option value="">Não sei qual</option>
                  {touros.map((x) => <option key={x.id} value={x.id}>{rotuloAnimal(x)}</option>)}
                </CampoEscolha>
              ) : <CampoTexto rotulo="Sêmen (touro e partida)" valor={semen} aoMudar={setSemen} nome="evSemen" />}
              <h3>Vacas ({marcadas.length} marcadas)</h3>
              <div className="campo"><label htmlFor="evFiltro">Procurar brinco</label><Entrada id="evFiltro" valor={filtro} aoMudar={setFiltro} voz="codigo" rotuloVoz="brinco" /></div>
              <button type="button" className="btn sec pequeno" onClick={() => setMarcadas(lista.map((a) => a.id!))}>Marcar todas ({lista.length})</button>
              <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}>
                {lista.map((a) => (
                  <label key={a.id} className="marcar" style={{ display: 'block' }}>
                    <input type="checkbox" checked={marcadas.includes(a.id!)} onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, a.id!] : m.filter((x) => x !== a.id)))} /> {rotuloAnimal(a)}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <EscolheAnimal rotulo="Vaca" nome="evVaca" valor={vaca} aoMudar={setVaca} animais={femeas} />
          )}
          {tipo === 'diagnostico' && (
            <>
              <Opcoes valor={resultado} aoMudar={setResultado} opcoes={[{ valor: 'prenhe', rotulo: 'Prenhe' }, { valor: 'vazia', rotulo: 'Vazia' }]} />
              {resultado === 'prenhe' && <CampoNumero rotulo="Dias de gestação (se o veterinário disse)" valor={diasGest} aoMudar={setDiasGest} unidade="dias" nome="evDiasGest" dica="Com isso o app calcula a data do parto." />}
            </>
          )}
          {tipo === 'parto' && (
            <>
              <CampoEscolha rotulo="Como foi" nome="evPartoTipo" valor={partoTipo} aoMudar={(v) => setPartoTipo(v as typeof partoTipo)}>
                <option value="normal">Normal</option><option value="assistido">Precisou de ajuda</option><option value="natimorto">Bezerro nasceu morto</option>
              </CampoEscolha>
              {partoTipo !== 'natimorto' && (
                <>
                  <h3>Bezerro</h3>
                  <CampoTexto rotulo="Brinco do bezerro" valor={bz.brinco} aoMudar={(v) => setBz({ ...bz, brinco: v })} nome="evBzBrinco" formato="codigo" />
                  <Opcoes valor={bz.sexo} aoMudar={(v) => setBz({ ...bz, sexo: v })} opcoes={[{ valor: 'macho', rotulo: 'Macho' }, { valor: 'femea', rotulo: 'Fêmea' }]} />
                  <CampoNumero rotulo="Peso ao nascer" valor={bz.peso} aoMudar={(v) => setBz({ ...bz, peso: v })} unidade="kg" nome="evBzPeso" />
                  {ultimaCob && <p className="mudo">Pai: {ultimaCob.touroId ? rotuloAnimal(touros.find((x) => x.id === ultimaCob.touroId) ?? { brinco: '?' } as Animal) : ultimaCob.semen ? `sêmen ${ultimaCob.semen}` : 'não informado'} (última cobertura).</p>}
                  <label className="marcar"><input type="checkbox" checked={bz.creep} onChange={(e) => setBz({ ...bz, creep: e.target.checked })} /> Vai receber creep feed</label>
                </>
              )}
            </>
          )}
          <CampoTexto rotulo="Observação" valor={obs} aoMudar={setObs} nome="evObs" multilinha />
          <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={() => nav(-1)}>Cancelar</button></div>
        </div>
      </main>
    </>
  );
}

// ---------- Pesagem ----------

export function PesagemCria() {
  const [q] = useSearchParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const d = useCria();
  const [grupo, setGrupo] = useState(q.get('grupo') ?? '');
  const [data, setData] = useState(hojeISO());
  const [pesos, setPesos] = useState<Record<number, string>>({});
  const [atual, setAtual] = useState<number | null>(null);
  if (!d) return <Topo titulo="Pesar na Cria" />;
  const animais = d.animais.filter((a) => ativoCria(a) && (a.qtd ?? 1) === 1 && (!grupo || a.grupoId === Number(grupo)))
    .sort((a, b) => (a.categoria === 'bezerro' ? 0 : 1) - (b.categoria === 'bezerro' ? 0 : 1) || a.brinco.localeCompare(b.brinco, 'pt', { numeric: true }));
  const ult = ultimosPesos(d.pesos);
  const proximo = (de: number | null) => { const i = animais.findIndex((a) => a.id === de); return animais[i + 1]?.id ?? null; };
  const salvar = async () => {
    try {
      await pesarCria(data, Object.entries(pesos).map(([k, v]) => ({ animalId: Number(k), peso: num(v) ?? 0 })));
      aviso('Pesagem salva.');
      nav(-1);
    } catch (e) { aviso(erro(e), true); }
  };
  const lancados = Object.values(pesos).filter((v) => (num(v) ?? 0) > 0).length;
  return (
    <>
      <Topo titulo="Pesar na Cria" />
      <main>
        <div className="cartao">
          <CampoEscolha rotulo="Grupo" nome="pesGrupo" valor={grupo} aoMudar={setGrupo}>
            <option value="">Todos</option>
            {d.grupos.filter((g) => !g.encerrado).map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </CampoEscolha>
          <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="pesData" />
          {atual != null && (
            <div className="alerta bom"><span className="ic">⚖️</span><div><b>Na balança: {rotuloAnimal(animais.find((a) => a.id === atual)!)}</b>O peso parado da balança entra nesta linha.
              <div style={{ marginTop: 8 }}><BotaoBalanca aoErro={(m) => aviso(m, true)} aoPesar={(kg) => { setPesos((p) => ({ ...p, [atual]: String(kg).replace('.', ',') })); setAtual(proximo(atual)); }} /></div>
            </div></div>
          )}
          {atual == null && animais.length > 0 && <button className="btn sec largo" onClick={() => setAtual(animais[0].id!)}>Usar a balança Bluetooth</button>}
        </div>
        <p className="mudo">{lancados} de {animais.length} pesados. Peso em kg (pode falar “quinze arrobas”).</p>
        {animais.map((a) => (
          <div key={a.id} className="cartao linha-lote" style={{ padding: '8px 12px', outline: atual === a.id ? '2px solid var(--verde)' : undefined }}>
            <span style={{ flex: 1 }} onClick={() => setAtual(a.id!)}>
              <b>{rotuloAnimal(a)}</b>
              <div className="mudo" style={{ fontSize: 13 }}>{CATEGORIAS_CRIA[a.categoria ?? 'matriz']}{ult.get(a.id!) ? ` · antes ${fmtKg(ult.get(a.id!)!.peso, 0)}` : ''}</div>
            </span>
            <div style={{ width: 150 }}>
              <Entrada valor={pesos[a.id!] ?? ''} aoMudar={(v) => setPesos((p) => ({ ...p, [a.id!]: v }))} voz="numero" pesoVivo unidade="kg" rotuloVoz={`peso ${a.brinco}`} aria-label={`Peso de ${a.brinco}`} />
            </div>
          </div>
        ))}
        <div className="botoes"><button className="btn" onClick={salvar} disabled={!lancados}>Salvar pesagem</button><button className="btn sec" onClick={() => nav(-1)}>Cancelar</button></div>
      </main>
    </>
  );
}

// ---------- Desmama ----------

export function DesmamaCria() {
  const nav = useNavigate();
  const aviso = useAviso();
  const d = useCria();
  const props = useLiveQuery(() => db.propriedades.toArray());
  const piquetes = useLiveQuery(() => db.piquetes.toArray());
  const hoje = hojeISO();
  const [data, setData] = useState(hoje);
  const [grupo, setGrupo] = useState('');
  const [sel, setSel] = useState<Record<number, { peso: string; destino: 'lote' | 'reposicao' }>>({});
  const [fase, setFase] = useState<'recria' | 'rip'>('recria');
  const [separar, setSeparar] = useState(false);
  const [nome, setNome] = useState(`Desmama ${hoje.slice(0, 4)}`);
  const [grupoRep, setGrupoRep] = useState('');
  const [piq, setPiq] = useState('');
  const ult = useMemo(() => ultimosPesos(d?.pesos ?? []), [d?.pesos]);
  if (!d || !props || !piquetes) return <Topo titulo="Desmama" />;
  const bezerros = d.animais.filter((a) => ativoCria(a) && a.categoria === 'bezerro' && (!grupo || a.grupoId === Number(grupo)))
    .sort((a, b) => (idadeDias(b, data) ?? 0) - (idadeDias(a, data) ?? 0));
  const itens: ItemDesmama[] = Object.entries(sel).map(([k, v]) => {
    const a = d.animais.find((x) => x.id === Number(k))!;
    return { animalId: a.id!, peso: num(v.peso) ?? 0, sexo: a.sexo === 'macho' ? 'macho' : 'femea', idadeDias: Math.min(730, idadeDias(a, data) ?? 0), destino: v.destino };
  });
  const r = resumoPacote(itens.filter((i) => i.peso > 0));
  const marcarProntos = () => {
    const n: typeof sel = {};
    for (const a of bezerros) if ((idadeDias(a, data) ?? 0) >= IDADE_DESMAMA_DIAS - 15) n[a.id!] = { peso: ult.get(a.id!)?.data === data ? String(ult.get(a.id!)!.peso).replace('.', ',') : '', destino: 'lote' };
    setSel(n);
  };
  const salvar = async () => {
    if (!props.length) return aviso('Cadastre a fazenda primeiro.', true);
    if (!window.confirm(`Desmamar ${itens.length} bezerro(s)? Vai criar o lote de ${fase === 'rip' ? 'RIP' : 'Recria'}.`)) return;
    try {
      const res = await desmamar({
        data, grupoId: grupo ? Number(grupo) : null, fase, propriedadeId: props[0].id!, itens, separarSexos: separar, nomeLote: nome.trim() || `Desmama ${data.slice(0, 4)}`,
        grupoReposicaoId: grupoRep ? Number(grupoRep) : null, piqueteId: piq ? Number(piq) : null,
      });
      aviso('Desmama feita. O pacote ficou guardado e o lote foi criado.');
      nav(res.lotes[0] ? `/lotes/${res.lotes[0]}` : '/cria', { replace: true });
    } catch (e) { aviso(erro(e), true); }
  };
  const grupos = d.grupos.filter((g) => !g.encerrado);
  return (
    <>
      <Topo titulo="Desmama" />
      <main>
        <div className="dica">A desmama guarda um <b>pacote</b> com o peso, sexo e idade de cada bezerro (numerado no ano: versão 1, 2…) e cria o lote de Recria ou RIP com o <b>peso médio ponderado</b>. Cada bezerro continua com o brinco, a mãe e o pai.</div>
        <div className="cartao">
          <CampoData rotulo="Data da desmama" valor={data} aoMudar={setData} nome="desData" />
          <CampoEscolha rotulo="Bezerros do grupo" nome="desGrupo" valor={grupo} aoMudar={setGrupo}>
            <option value="">Todos</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </CampoEscolha>
          <button className="btn sec pequeno" onClick={marcarProntos}>Marcar os que têm 7 meses ou mais</button>
        </div>
        {bezerros.length === 0 && <p className="mudo">Nenhum bezerro na Cria.</p>}
        {bezerros.map((a) => {
          const s = sel[a.id!];
          return (
            <div key={a.id} className="cartao" style={{ padding: '8px 12px' }}>
              <label className="marcar" style={{ display: 'block' }}>
                <input type="checkbox" checked={!!s} onChange={(e) => setSel((x) => { const n = { ...x }; if (e.target.checked) n[a.id!] = { peso: '', destino: 'lote' }; else delete n[a.id!]; return n; })} />
                {' '}<b>{rotuloAnimal(a)}</b> · {a.sexo === 'macho' ? 'macho' : 'fêmea'} · {Math.round((idadeDias(a, data) ?? 0) / 30.44)} meses{ult.get(a.id!) ? ` · última ${fmtKg(ult.get(a.id!)!.peso, 0)}` : ''}
              </label>
              {s && (
                <div className="grade" style={{ marginTop: 6 }}>
                  <Entrada valor={s.peso} aoMudar={(v) => setSel((x) => ({ ...x, [a.id!]: { ...s, peso: v } }))} voz="numero" pesoVivo unidade="kg" rotuloVoz={`peso ${a.brinco}`} aria-label={`Peso de desmama de ${a.brinco}`} />
                  {a.sexo !== 'macho' ? (
                    <Opcoes valor={s.destino} aoMudar={(v) => setSel((x) => ({ ...x, [a.id!]: { ...s, destino: v } }))} opcoes={[{ valor: 'lote', rotulo: 'Lote' }, { valor: 'reposicao', rotulo: 'Reposição' }]} />
                  ) : <span />}
                </div>
              )}
            </div>
          );
        })}
        {itens.length > 0 && (
          <div className="cartao">
            <h3>Pacote</h3>
            <div className="grade tres">
              <Indicador rotulo="Bezerros" valor={itens.length} sub={`${r.machos} M · ${r.femeas} F`} />
              <Indicador rotulo="Peso médio" valor={fmtKg(r.pesoMedio, 1)} sub="ponderado" />
              <Indicador rotulo="P205 médio" valor={fmtKg(r.p205Medio, 1)} />
            </div>
            <CampoEscolha rotulo="Vai para" nome="desFase" valor={fase} aoMudar={(v) => setFase(v as 'recria' | 'rip')}>
              <option value="recria">Recria</option><option value="rip">RIP (recria intensiva a pasto)</option>
            </CampoEscolha>
            <CampoTexto rotulo="Nome do lote" valor={nome} aoMudar={setNome} nome="desNome" />
            <label className="marcar"><input type="checkbox" checked={separar} onChange={(e) => setSeparar(e.target.checked)} /> Separar machos e fêmeas em dois lotes</label>
            <CampoEscolha rotulo="Piquete do lote" nome="desPiquete" valor={piq} aoMudar={setPiq}>
              <option value="">Nenhum</option>
              {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </CampoEscolha>
            {itens.some((i) => i.destino === 'reposicao') && (
              <CampoEscolha rotulo="Grupo das novilhas de reposição" nome="desRep" valor={grupoRep} aoMudar={setGrupoRep}>
                <option value="">Escolha…</option>
                {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </CampoEscolha>
            )}
            <div className="botoes"><button className="btn" onClick={salvar}>Fazer a desmama</button><button className="btn sec" onClick={() => nav(-1)}>Cancelar</button></div>
          </div>
        )}
        {itens.length === 0 && <button className="btn sec largo" onClick={() => nav(-1)}>Cancelar</button>}
      </main>
    </>
  );
}
