// Rastreabilidade: o que está em dia (CAR, ITR, CCIR, GTA, PNIB, geolocalização), as GTAs e a ficha do lote para o comprador.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type FinalidadeGta, type Gta } from '../db';
import { fmtData, hojeISO } from '../calc';
import { cabecasGta, conferirRastreabilidade, fichaLote, FINALIDADES_GTA, notaRastreabilidade, type AnimalId, type ItemRastro } from '../rastreabilidade';
import { compartilharArquivo, gerarPdf, linkWhatsApp } from '../exportar';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';
import { sigla } from './Fazenda';
import { usePapel } from '../nuvem/useNuvem';

const ICONE = { bom: '✅', atencao: '⚠️', ruim: '⛔' } as const;

export function Rastreabilidade() {
  const [busca, setBusca] = useSearchParams();
  const papel = usePapel();
  const podeMudar = papel !== 'vaqueiro' && papel !== 'consultor';
  const dados = useLiveQuery(async () => {
    const [props, lotes, animais, gtas, vendas, lancamentos, sanidade] = await Promise.all([
      db.propriedades.toArray(), db.lotes.toArray(), db.animais.toArray(), db.gtas.toArray(), db.vendas.toArray(), db.lancamentos.toArray(), db.sanidade.toArray(),
    ]);
    return { props, lotes, animais: animais as AnimalId[], gtas, vendas, lancamentos, sanidade };
  });
  if (!dados) return <Topo titulo="Rastreabilidade" />;
  if (!dados.props.length) return (<><Topo titulo="Rastreabilidade" /><main><p>Cadastre a fazenda primeiro.</p><Link to="/fazenda" className="btn largo">Cadastrar fazenda</Link></main></>);
  const idBusca = Number(busca.get('fazenda'));
  const prop = dados.props.find((p) => p.id === idBusca) ?? dados.props[0];
  const hoje = hojeISO();
  const itens = conferirRastreabilidade({ ...dados, prop, propsTotal: dados.props.length, hoje });
  const nota = notaRastreabilidade(itens);
  const gtas = dados.gtas.filter((g) => g.propriedadeId === prop.id).sort((a, b) => b.emissao.localeCompare(a.emissao));
  const lotes = dados.lotes.filter((l) => l.propriedadeId === prop.id);
  const nomeLote = (id?: number | null) => lotes.find((l) => l.id === id)?.nome;

  return (
    <>
      <Topo titulo="Rastreabilidade" />
      <main>
        {dados.props.length > 1 && (
          <CampoEscolha rotulo="Fazenda" valor={prop.id!} aoMudar={(v) => setBusca({ fazenda: v }, { replace: true })} nome="fazendaRastro">
            {dados.props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </CampoEscolha>
        )}
        <div className={`alerta ${nota >= 80 ? 'bom' : nota >= 50 ? 'atencao' : 'ruim'}`} data-testid="notaRastro">
          <span className="ic">🏷️</span>
          <div><b>Rastreabilidade: {nota} de 100</b>Gado rastreado vende para mais frigoríficos, para a Cota Hilton e para a União Europeia, e costuma ter prêmio no preço da @.</div>
        </div>

        <h2>O que está em dia</h2>
        <div className="cartao" style={{ padding: 0 }}>
          {itens.map((i) => <LinhaItem key={i.chave} i={i} propId={prop.id!} />)}
        </div>

        <h2>GTAs</h2>
        <p className="mudo">Lance a GTA de toda entrada (compra) e saída (venda) de animais. Ela prova de onde o gado veio e para onde foi.</p>
        {podeMudar && <Link to={`/rastreabilidade/gta/nova?fazenda=${prop.id}`} className="btn largo" style={{ marginBottom: 12 }}>+ Lançar GTA</Link>}
        {gtas.length === 0 && <p className="mudo">Nenhuma GTA lançada.</p>}
        {gtas.map((g) => (
          <Link key={g.id} to={`/rastreabilidade/gta/${g.id}`} className="cartao" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="linha-lote"><b>GTA {g.uf ? `${g.uf} ` : ''}{g.serie ? `${g.serie}-` : ''}{g.numero}</b><span className={`etiqueta ${g.sentido === 'entrada' ? '' : 'atencao'}`}>{g.sentido === 'entrada' ? 'Entrada' : 'Saída'}</span></div>
            <p className="mudo" style={{ margin: 0 }}>{fmtData(g.emissao)} · {cabecasGta(g)} cab.{g.finalidade ? ` · ${FINALIDADES_GTA[g.finalidade]}` : ''}{nomeLote(g.loteId) ? ` · ${nomeLote(g.loteId)}` : ''}{g.outroNome ? ` · ${g.sentido === 'entrada' ? 'de' : 'para'} ${g.outroNome}` : ''}</p>
          </Link>
        ))}

        <FichaDoLote propId={prop.id!} />
      </main>
    </>
  );
}

function LinhaItem({ i, propId }: { i: ItemRastro; propId: number }) {
  const destino = i.onde === 'documentos' ? `/fazenda/${propId}/documentos` : i.onde === 'gta' ? `/rastreabilidade/gta/nova?fazenda=${propId}` : i.onde === 'sanidade' ? '/sanidade' : '/lotes';
  return (
    <Link to={destino} style={{ display: 'flex', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--borda)', textDecoration: 'none', color: 'inherit' }} data-testid={`rastro-${i.chave}`} data-nivel={i.nivel}>
      <span aria-hidden style={{ fontSize: 20 }}>{ICONE[i.nivel]}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><b style={{ display: "block" }}>{i.titulo}</b><span className="mudo">{i.texto}</span></span>
    </Link>
  );
}

function FichaDoLote({ propId }: { propId: number }) {
  const aviso = useAviso();
  const lotes = useLiveQuery(() => db.lotes.where('propriedadeId').equals(propId).toArray(), [propId]);
  const [loteId, setLoteId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (!lotes?.length) return null;
  const montar = async () => {
    const lote = lotes.find((l) => String(l.id) === loteId);
    const prop = await db.propriedades.get(propId);
    if (!lote || !prop) return null;
    const [animais, gtas, pesagens, sanidade] = await Promise.all([
      db.animais.where('loteId').equals(lote.id!).toArray(), db.gtas.where('loteId').equals(lote.id!).toArray(),
      db.pesagens.where('loteId').equals(lote.id!).toArray(), db.sanidade.where('loteId').equals(lote.id!).toArray(),
    ]);
    return fichaLote({ prop, lote, animais: animais as AnimalId[], gtas, pesagens, sanidade, hoje: hojeISO() });
  };
  const pdf = async () => {
    setOcupado(true);
    try {
      const f = await montar();
      if (!f) return aviso('Escolha o lote.', true);
      const r = await compartilharArquivo(gerarPdf(f.titulo, f.subtitulo, f.blocos), `${f.nomeArquivo}.pdf`, 'application/pdf', f.titulo);
      if (r === 'baixado') aviso('Arquivo salvo em Downloads. Para mandar no WhatsApp, anexe pelo clipe 📎.');
    } finally { setOcupado(false); }
  };
  const whats = async () => {
    const f = await montar();
    if (!f) return aviso('Escolha o lote.', true);
    window.open(linkWhatsApp(f.resumo), '_blank', 'noopener');
  };
  return (
    <div className="cartao">
      <h3>Ficha do lote para o comprador</h3>
      <p className="mudo">Junta a origem (CAR, localização, documentos), as GTAs, as vacinas, as pesagens e os brincos do lote num PDF para mandar ao frigorífico.</p>
      <CampoEscolha rotulo="Lote" valor={loteId} aoMudar={setLoteId} nome="loteFicha">
        <option value="">Escolha o lote</option>
        {lotes.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.encerrado ? ' (encerrado)' : ''}</option>)}
      </CampoEscolha>
      <div className="botoes">
        <button className="btn" onClick={pdf} disabled={!loteId || ocupado}>PDF da ficha</button>
        <button className="btn sec" onClick={whats} disabled={!loteId}>Resumo no WhatsApp</button>
      </div>
    </div>
  );
}

// ---------- GTA ----------

export function GtaForm() {
  const { id } = useParams();
  const [busca] = useSearchParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const papel = usePapel();
  const podeMudar = papel !== 'vaqueiro' && papel !== 'consultor';
  const nova = !id || id === 'nova';
  const dados = useLiveQuery(async () => {
    const gta = nova ? null : await db.gtas.get(Number(id));
    const props = await db.propriedades.toArray();
    const lotes = await db.lotes.toArray();
    return { gta, props, lotes };
  }, [id]);
  if (!dados) return <Topo titulo="GTA" />;
  if (!nova && !dados.gta) return (<><Topo titulo="GTA" /><main><p>GTA não encontrada.</p><Link to="/rastreabilidade" className="btn sec largo">Voltar</Link></main></>);
  const propInicial = dados.gta?.propriedadeId ?? (Number(busca.get('fazenda')) || dados.props[0]?.id);
  return <FormGta key={id ?? 'nova'} gta={dados.gta ?? null} propInicial={propInicial} props={dados.props} lotes={dados.lotes} podeMudar={podeMudar}
    aoSair={() => nav(`/rastreabilidade?fazenda=${propInicial ?? ''}`, { replace: true })} aviso={aviso} />;
}

function FormGta({ gta, propInicial, props, lotes, podeMudar, aoSair, aviso }: {
  gta: Gta | null; propInicial?: number; props: { id?: number; nome: string; uf?: string }[]; lotes: { id?: number; nome: string; propriedadeId: number; encerrado?: boolean }[];
  podeMudar: boolean; aoSair: () => void; aviso: (m: string, erro?: boolean) => void;
}) {
  const [propId, setPropId] = useState(String(gta?.propriedadeId ?? propInicial ?? ''));
  const ufFazenda = props.find((p) => String(p.id) === propId)?.uf ?? '';
  const [f, setF] = useState(() => ({
    sentido: (gta?.sentido ?? 'entrada') as Gta['sentido'], numero: gta?.numero ?? '', serie: gta?.serie ?? '', uf: gta?.uf ?? ufFazenda,
    emissao: gta?.emissao ?? hojeISO(), finalidade: (gta?.finalidade ?? '') as FinalidadeGta | '', machos: gta ? String(gta.machos) : '', femeas: gta ? String(gta.femeas) : '',
    loteId: gta?.loteId ? String(gta.loteId) : '', outroNome: gta?.outroNome ?? '', outroMunicipio: gta?.outroMunicipio ?? '', outroUf: gta?.outroUf ?? '',
    outroCodigo: gta?.outroCodigo ?? '', obs: gta?.obs ?? '',
  }));
  const m = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const lotesFaz = lotes.filter((l) => String(l.propriedadeId) === propId && (!l.encerrado || String(l.id) === f.loteId));

  const salvar = async () => {
    if (!propId) return aviso('Escolha a fazenda.', true);
    if (!f.numero.trim()) return aviso('Informe o número da GTA.', true);
    const ma = num(f.machos) ?? 0, fe = num(f.femeas) ?? 0;
    if (!Number.isInteger(ma) || !Number.isInteger(fe) || ma < 0 || fe < 0) return aviso('Quantidade de animais deve ser número inteiro.', true);
    if (ma + fe <= 0) return aviso('Informe quantos machos e fêmeas a GTA leva.', true);
    const reg = {
      propriedadeId: Number(propId), loteId: f.loteId ? Number(f.loteId) : null, sentido: f.sentido, numero: f.numero.trim(), serie: f.serie.trim() || undefined,
      uf: f.uf ? sigla(f.uf) : undefined, emissao: f.emissao, finalidade: (f.finalidade || undefined) as FinalidadeGta | undefined, machos: ma, femeas: fe,
      outroNome: f.outroNome.trim() || undefined, outroMunicipio: f.outroMunicipio.trim() || undefined, outroUf: f.outroUf ? sigla(f.outroUf) : undefined,
      outroCodigo: f.outroCodigo.trim() || undefined, obs: f.obs.trim() || undefined,
    };
    if (gta) await db.gtas.update(gta.id!, reg);
    else await db.gtas.add({ ...reg, criadoEm: Date.now() });
    aviso('GTA salva.');
    aoSair();
  };
  const apagar = async () => {
    if (!gta || !window.confirm('Apagar esta GTA do app? (o documento original continua valendo)')) return;
    await db.gtas.delete(gta.id!);
    aviso('GTA apagada.');
    aoSair();
  };

  return (
    <>
      <Topo titulo={gta ? `GTA ${gta.numero}` : 'Lançar GTA'} />
      <main>
        <div className="cartao">
          <Opcoes valor={f.sentido} aoMudar={(v) => setF((x) => ({ ...x, sentido: v }))} opcoes={[{ valor: 'entrada', rotulo: 'Entrada', dica: 'comprei / chegou' }, { valor: 'saida', rotulo: 'Saída', dica: 'vendi / saiu' }]} />
          {props.length > 1 && (
            <CampoEscolha rotulo="Fazenda" valor={propId} aoMudar={setPropId} nome="gtaFazenda">
              {props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </CampoEscolha>
          )}
          <div className="grade">
            <CampoTexto rotulo="Número da GTA" valor={f.numero} aoMudar={m('numero')} nome="gtaNumero" formato="digitos" />
            <CampoTexto rotulo="Série" valor={f.serie} aoMudar={m('serie')} nome="gtaSerie" formato="codigo" maxLength={5} />
          </div>
          <div className="grade">
            <CampoData rotulo="Emissão" valor={f.emissao} aoMudar={m('emissao')} nome="gtaEmissao" />
            <CampoTexto rotulo="UF da GTA" valor={f.uf} aoMudar={(v) => m('uf')(sigla(v))} nome="gtaUf" />
          </div>
          <div className="grade">
            <CampoNumero rotulo="Machos" valor={f.machos} aoMudar={m('machos')} nome="gtaMachos" unidade="cab" />
            <CampoNumero rotulo="Fêmeas" valor={f.femeas} aoMudar={m('femeas')} nome="gtaFemeas" unidade="cab" />
          </div>
          <CampoEscolha rotulo="Finalidade" valor={f.finalidade} aoMudar={m('finalidade')} nome="gtaFinalidade">
            <option value="">—</option>
            {Object.entries(FINALIDADES_GTA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </CampoEscolha>
          <CampoEscolha rotulo="Lote" valor={f.loteId} aoMudar={m('loteId')} nome="gtaLote" dica="O lote que entrou ou saiu com esta GTA.">
            <option value="">Sem lote</option>
            {lotesFaz.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </CampoEscolha>
          <h4>{f.sentido === 'entrada' ? 'De onde veio' : 'Para onde foi'}</h4>
          <CampoTexto rotulo={f.sentido === 'entrada' ? 'Vendedor / fazenda de origem' : 'Comprador / frigorífico'} valor={f.outroNome} aoMudar={m('outroNome')} nome="gtaOutroNome" />
          <div className="grade">
            <CampoTexto rotulo="Município" valor={f.outroMunicipio} aoMudar={m('outroMunicipio')} nome="gtaOutroMunicipio" />
            <CampoTexto rotulo="UF" valor={f.outroUf} aoMudar={(v) => m('outroUf')(sigla(v))} nome="gtaOutroUf" />
          </div>
          <CampoTexto rotulo="Código do estabelecimento" valor={f.outroCodigo} aoMudar={m('outroCodigo')} nome="gtaOutroCodigo" formato="codigo" />
          <CampoTexto rotulo="Observação" valor={f.obs} aoMudar={m('obs')} nome="gtaObs" multilinha />
          {podeMudar ? (
            <div className="botoes">
              <button className="btn" onClick={salvar}>Salvar GTA</button>
              <button className="btn sec" onClick={aoSair}>Cancelar</button>
              {gta && <button className="btn perigo pequeno" onClick={apagar}>Apagar</button>}
            </div>
          ) : <p className="mudo">Só o dono e o gerente lançam GTA.</p>}
        </div>
      </main>
    </>
  );
}
