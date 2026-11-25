import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { db, excluirPiquetes, excluirPropriedade, type Modulo, type Piquete, type Propriedade } from '../db';
import { atualizarModulo, dicaAreaPiquete, FOLGA_AREA_HA, lotacaoModulo, novoModulo, novoPiquete, ocupantesAtuais, usoDaArea } from '../pasto';
import { fmtNum } from '../calc';
import { CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';
import { AreaDoModulo, PassouDaArea } from '../components/AreaModulo';

const UFS: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE',
  piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
/** "Mato Grosso do Sul" (falado ou escrito) vira "MS"; o resto fica com até 2 letras. */
export function sigla(v: string): string {
  const s = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  return UFS[s] ?? v.replace(/\s/g, '').slice(0, 2).toUpperCase();
}

export function Fazenda() {
  const props = useLiveQuery(() => db.propriedades.toArray());
  const [novo, setNovo] = useState(false);
  return (
    <>
      <Topo titulo="Fazenda" voltar />
      <main>
        {props?.length === 0 && !novo && (
          <div className="dica">Comece cadastrando sua fazenda. Depois, se quiser, separe em módulos e piquetes.</div>
        )}
        {props?.map((p) => <CartaoPropriedade key={p.id} p={p} />)}
        {novo || props?.length === 0 ? <FormPropriedade aoSalvar={() => setNovo(false)} aoCancelar={props?.length ? () => setNovo(false) : undefined} /> : (
          <button className="btn sec largo" onClick={() => setNovo(true)}>+ Outra fazenda</button>
        )}
      </main>
    </>
  );
}

function FormPropriedade({ aoSalvar, aoCancelar }: { aoSalvar: () => void; aoCancelar?: () => void }) {
  const aviso = useAviso();
  const [nome, setNome] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [uf, setUf] = useState('');
  const [area, setArea] = useState('');
  const salvar = async () => {
    if (!nome.trim()) return aviso('Informe o nome da fazenda.', true);
    await db.propriedades.add({ nome: nome.trim(), municipio: municipio.trim() || undefined, uf: uf.trim().toUpperCase() || undefined, areaHa: num(area) ?? undefined, criadoEm: Date.now() });
    aviso('Fazenda cadastrada.');
    aoSalvar();
  };
  return (
    <div className="cartao">
      <h3>Nova fazenda</h3>
      <CampoTexto rotulo="Nome da fazenda" valor={nome} aoMudar={setNome} nome="fazendaNome" />
      <div className="grade">
        <CampoTexto rotulo="Município" valor={municipio} aoMudar={setMunicipio} nome="fazendaMunicipio" />
        <CampoTexto rotulo="UF" valor={uf} aoMudar={(v) => setUf(sigla(v))} nome="fazendaUf" dica="Ex.: MS, MT, GO" />
      </div>
      <CampoNumero rotulo="Área total" valor={area} aoMudar={setArea} unidade="ha" />
      <div className="botoes">
        <button className="btn" onClick={salvar}>Salvar fazenda</button>
        {aoCancelar && <button className="btn sec" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </div>
  );
}

function CartaoPropriedade({ p }: { p: Propriedade }) {
  const aviso = useAviso();
  const modulos = useLiveQuery(() => db.modulos.where('propriedadeId').equals(p.id!).toArray(), [p.id]);
  const nLotes = useLiveQuery(() => db.lotes.where('propriedadeId').equals(p.id!).count(), [p.id]);
  const [novoMod, setNovoMod] = useState(false);
  const apagar = async () => {
    if (!window.confirm(`Apagar a fazenda "${p.nome}" com todos os lotes, pesagens, módulos e piquetes? Não dá para desfazer.`)) return;
    await excluirPropriedade(p.id!);
    aviso('Fazenda apagada.');
  };
  return (
    <div className="cartao">
      <div className="linha-lote"><h3>{p.nome}</h3><span className="mudo">{nLotes ?? 0} lotes</span></div>
      <p className="mudo">{[p.municipio, p.uf].filter(Boolean).join(' / ')}{p.areaHa ? ` · ${p.areaHa} ha` : ''}</p>
      {modulos?.map((m) => <BlocoModulo key={m.id} m={m} />)}
      <hr />
      {novoMod
        ? <FormModulo propriedadeId={p.id!} fechar={() => setNovoMod(false)} />
        : <button className="btn sec pequeno" onClick={() => setNovoMod(true)}>+ Módulo</button>}
      <div className="botoes"><button className="btn perigo pequeno" onClick={apagar}>Apagar fazenda</button></div>
    </div>
  );
}

function BlocoModulo({ m }: { m: Modulo }) {
  const aviso = useAviso();
  const piquetes = useLiveQuery(() => db.piquetes.where('moduloId').equals(m.id!).toArray(), [m.id]);
  const ocupantes = useLiveQuery(() => ocupantesAtuais(), [piquetes]);
  const [nome, setNome] = useState('');
  const [area, setArea] = useState('');
  const [capim, setCapim] = useState('');
  const [aberto, setAberto] = useState(false);
  // Vindo do Pasto por "Informar a área" (/fazenda?modulo=ID): já abre o manejo deste módulo.
  const [busca] = useSearchParams();
  const pedido = Number(busca.get('modulo')) === m.id;
  const [ajustes, setAjustes] = useState(pedido);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pedido) caixa.current?.scrollIntoView({ block: 'start' }); }, [pedido]);
  const uso = usoDaArea(m, piquetes ?? []);
  const add = async () => {
    if (!nome.trim()) return aviso('Dê um nome ao piquete.', true);
    try {
      await novoPiquete({ moduloId: m.id!, nome: nome.trim(), areaHa: num(area) ?? undefined, capim: capim.trim() || undefined });
      setNome(''); setArea(''); setCapim(''); setAberto(false);
    } catch (e) { aviso((e as Error).message, true); }
  };
  const apagarMod = async () => {
    if (!window.confirm(`Apagar o módulo "${m.nome}" e seus piquetes (com o histórico de entradas, saídas e satélite)?`)) return;
    await excluirPiquetes((piquetes ?? []).map((p) => p.id!));
    await db.modulos.delete(m.id!);
  };
  const lot = lotacaoModulo(piquetes ?? [], ocupantes ?? [], m.areaHa);
  return (
    <div ref={caixa} style={{ borderLeft: '4px solid var(--verde-claro)', paddingLeft: 12, margin: '12px 0' }} data-testid="blocoModulo">
      <div className="linha-lote"><b>{m.nome}</b><button className="remover" aria-label="Apagar módulo" onClick={apagarMod}>×</button></div>
      <p className="mudo" style={{ margin: '2px 0 6px' }}>
        {m.sistema === 'continuo' ? 'Contínuo' : 'Rotacionado'}
        {m.diasOcupacao ? ` · ${m.diasOcupacao} dias ocupado` : ''}{m.diasDescanso ? ` · ${m.diasDescanso} de descanso` : ''}
        {lot.uaHa != null ? ` · ${fmtNum(lot.uaHa, 2)} UA/ha` : ''}{m.capacidadeUA ? ` (aguenta ${fmtNum(m.capacidadeUA, 2)})` : ''}
      </p>
      {piquetes && <AreaDoModulo uso={uso} informar={ajustes ? undefined : () => { setAberto(false); setAjustes(true); }} />}
      {piquetes?.length === 0 && <p className="mudo">Sem piquetes.</p>}
      {piquetes?.map((p) => {
        const quem = ocupantes?.find((o) => o.piqueteId === p.id);
        return (
          <Link key={p.id} to={`/pasto/piquete/${p.id}`} className="linha-lote" style={{ padding: '6px 0', borderBottom: '1px solid var(--borda)', textDecoration: 'none', color: 'inherit' }}>
            <span>{p.nome}<span className="mudo">{p.capim ? ` · ${p.capim}` : ''}{p.areaHa ? ` · ${fmtNum(p.areaHa, 2)} ha` : ''}</span></span>
            <span className="mudo">{quem ? `${quem.nome} · ${quem.cabecas} cab` : 'vazio'}</span>
          </Link>
        );
      })}
      {ajustes ? <AjustesModulo m={m} piquetes={piquetes ?? []} fechar={() => setAjustes(false)} /> : aberto ? (
        <div style={{ marginTop: 10 }}>
          <CampoTexto rotulo="Nome do piquete" valor={nome} aoMudar={setNome} />
          <div className="grade">
            <CampoNumero rotulo="Área" valor={area} aoMudar={setArea} unidade="ha" nome="piqueteArea" dica={dicaAreaPiquete(uso)} />
            <CampoTexto rotulo="Capim" valor={capim} aoMudar={setCapim} />
          </div>
          <PassouDaArea uso={uso} area={num(area)} />
          <div className="botoes"><button className="btn pequeno" onClick={add}>Salvar piquete</button><button className="btn sec pequeno" onClick={() => setAberto(false)}>Cancelar</button></div>
        </div>
      ) : (
        <div className="botoes" style={{ marginTop: 8 }}>
          <button className="btn sec pequeno" onClick={() => setAberto(true)}>+ Piquete</button>
          <button className="btn sec pequeno" onClick={() => setAjustes(true)}>Manejo do módulo</button>
        </div>
      )}
    </div>
  );
}

/** Novo módulo: nome e área. A área limita a soma das áreas dos piquetes. */
function FormModulo({ propriedadeId, fechar }: { propriedadeId: number; fechar: () => void }) {
  const aviso = useAviso();
  const [nome, setNome] = useState('');
  const [area, setArea] = useState('');
  const salvar = async () => {
    if (!nome.trim()) return aviso('Dê um nome ao módulo. Ex.: "Retiro de cima".', true);
    const a = num(area);
    if (a == null) return aviso('Informe a área do módulo em hectares.', true);
    try {
      await novoModulo({ propriedadeId, nome, areaHa: a });
      aviso('Módulo salvo. Agora cadastre os piquetes dele.');
      fechar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div data-testid="novoModulo">
      <b>Novo módulo</b>
      <CampoTexto rotulo="Nome do módulo" valor={nome} aoMudar={setNome} nome="moduloNome" placeholder="Ex.: Retiro de cima" />
      <CampoNumero rotulo="Área do módulo" valor={area} aoMudar={setArea} unidade="ha" nome="moduloArea"
        dica="A área total do módulo. A soma das áreas dos piquetes não vai poder passar disso." />
      <div className="botoes"><button className="btn pequeno" onClick={salvar}>Salvar módulo</button><button className="btn sec pequeno" onClick={fechar}>Cancelar</button></div>
    </div>
  );
}

/** Como o módulo é manejado: área, rotacionado ou contínuo, dias de ocupação e descanso, capacidade de suporte. */
function AjustesModulo({ m, piquetes, fechar }: { m: Modulo; piquetes: Piquete[]; fechar: () => void }) {
  const aviso = useAviso();
  const t = (v?: number) => (v == null ? '' : String(v).replace('.', ','));
  const [area, setArea] = useState(t(m.areaHa));
  const [sistema, setSistema] = useState<'rotacionado' | 'continuo'>(m.sistema ?? 'rotacionado');
  const [ocup, setOcup] = useState(t(m.diasOcupacao));
  const [desc, setDesc] = useState(t(m.diasDescanso));
  const [cap, setCap] = useState(t(m.capacidadeUA));
  const usada = usoDaArea(null, piquetes).usada;
  const a = num(area);
  const salvar = async () => {
    if (a == null) return aviso('Informe a área do módulo em hectares.', true);
    try {
      const o = num(ocup), d = num(desc);
      await atualizarModulo(m.id!, {
        areaHa: a, sistema, diasOcupacao: o ? Math.round(o) : undefined, diasDescanso: d != null ? Math.round(d) : undefined, capacidadeUA: num(cap) ?? undefined,
      });
      aviso('Módulo salvo.');
      fechar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <CampoNumero rotulo="Área do módulo" valor={area} aoMudar={setArea} unidade="ha" nome="modArea"
        dica={usada > 0 ? `Os piquetes somam ${fmtNum(usada, 2)} ha: a área do módulo não pode ser menor que isso.` : 'A soma das áreas dos piquetes não vai poder passar disso.'} />
      {a != null && a > 0 && usada > a + FOLGA_AREA_HA && (
        <div className="alerta ruim" role="status" data-testid="moduloMenorQuePiquetes">
          <span className="ic">⚠️</span>
          <div><b>Menor que os piquetes</b>Os piquetes já somam {fmtNum(usada, 2)} ha. Aumente a área do módulo ou diminua a dos piquetes antes.</div>
        </div>
      )}
      <Opcoes valor={sistema} aoMudar={setSistema} opcoes={[{ valor: 'rotacionado', rotulo: 'Rotacionado', dica: 'o gado roda nos piquetes' }, { valor: 'continuo', rotulo: 'Contínuo', dica: 'fica no mesmo pasto' }]} />
      {sistema === 'rotacionado' && (
        <div className="grade">
          <CampoNumero rotulo="Dias ocupado" valor={ocup} aoMudar={setOcup} unidade="dias" nome="modOcup" dica="Quanto tempo o gado fica em cada piquete." />
          <CampoNumero rotulo="Dias de descanso" valor={desc} aoMudar={setDesc} unidade="dias" nome="modDesc" dica="Ex.: 28 a 35 nas águas." />
        </div>
      )}
      <CampoNumero rotulo="Capacidade de suporte" valor={cap} aoMudar={setCap} unidade="UA/ha" nome="modCap"
        dica="Quantas UA (450 kg) por hectare este pasto aguenta. O app avisa quando a lotação passar disso." />
      <div className="botoes"><button className="btn pequeno" onClick={salvar}>Salvar</button><button className="btn sec pequeno" onClick={fechar}>Cancelar</button></div>
    </div>
  );
}
