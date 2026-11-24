import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, excluirPiquetes, excluirPropriedade, type Modulo, type Propriedade } from '../db';
import { lotacaoModulo, ocupantesAtuais } from '../pasto';
import { fmtNum } from '../calc';
import { CampoNumero, CampoTexto, Entrada, num, Opcoes, Topo, useAviso } from '../components/ui';

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
  const [nomeMod, setNomeMod] = useState('');
  const addMod = async () => {
    if (!nomeMod.trim()) return aviso('Dê um nome ao módulo. Ex.: "Retiro de cima".', true);
    await db.modulos.add({ propriedadeId: p.id!, nome: nomeMod.trim(), criadoEm: Date.now() });
    setNomeMod('');
  };
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
      <div className="com-mic">
        <Entrada placeholder="Novo módulo / retiro" valor={nomeMod} aoMudar={setNomeMod} aria-label="Nome do novo módulo" rotuloVoz="nome do módulo" className="cresce" />
        <button className="btn pequeno" onClick={addMod}>+ Módulo</button>
      </div>
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
  const [ajustes, setAjustes] = useState(false);
  const add = async () => {
    if (!nome.trim()) return aviso('Dê um nome ao piquete.', true);
    await db.piquetes.add({ moduloId: m.id!, nome: nome.trim(), areaHa: num(area) ?? undefined, capim: capim.trim() || undefined, criadoEm: Date.now() });
    setNome(''); setArea(''); setCapim(''); setAberto(false);
  };
  const apagarMod = async () => {
    if (!window.confirm(`Apagar o módulo "${m.nome}" e seus piquetes (com o histórico de entradas, saídas e satélite)?`)) return;
    await excluirPiquetes((piquetes ?? []).map((p) => p.id!));
    await db.modulos.delete(m.id!);
  };
  const lot = lotacaoModulo(piquetes ?? [], ocupantes ?? []);
  return (
    <div style={{ borderLeft: '4px solid var(--verde-claro)', paddingLeft: 12, margin: '12px 0' }}>
      <div className="linha-lote"><b>{m.nome}</b><button className="remover" aria-label="Apagar módulo" onClick={apagarMod}>×</button></div>
      <p className="mudo" style={{ margin: '2px 0 6px' }}>
        {m.sistema === 'continuo' ? 'Contínuo' : 'Rotacionado'}
        {m.diasOcupacao ? ` · ${m.diasOcupacao} dias ocupado` : ''}{m.diasDescanso ? ` · ${m.diasDescanso} de descanso` : ''}
        {lot.uaHa != null ? ` · ${fmtNum(lot.uaHa, 2)} UA/ha` : ''}{m.capacidadeUA ? ` (aguenta ${fmtNum(m.capacidadeUA, 2)})` : ''}
      </p>
      {piquetes?.length === 0 && <p className="mudo">Sem piquetes.</p>}
      {piquetes?.map((p) => {
        const quem = ocupantes?.find((o) => o.piqueteId === p.id);
        return (
          <Link key={p.id} to={`/pasto/piquete/${p.id}`} className="linha-lote" style={{ padding: '6px 0', borderBottom: '1px solid var(--borda)', textDecoration: 'none', color: 'inherit' }}>
            <span>{p.nome}<span className="mudo">{p.capim ? ` · ${p.capim}` : ''}{p.areaHa ? ` · ${p.areaHa} ha` : ''}</span></span>
            <span className="mudo">{quem ? `${quem.nome} · ${quem.cabecas} cab` : 'vazio'}</span>
          </Link>
        );
      })}
      {ajustes ? <AjustesModulo m={m} fechar={() => setAjustes(false)} /> : aberto ? (
        <div style={{ marginTop: 10 }}>
          <CampoTexto rotulo="Nome do piquete" valor={nome} aoMudar={setNome} />
          <div className="grade">
            <CampoNumero rotulo="Área" valor={area} aoMudar={setArea} unidade="ha" />
            <CampoTexto rotulo="Capim" valor={capim} aoMudar={setCapim} />
          </div>
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

/** Como o módulo é manejado: rotacionado ou contínuo, dias de ocupação e descanso, capacidade de suporte. */
function AjustesModulo({ m, fechar }: { m: Modulo; fechar: () => void }) {
  const aviso = useAviso();
  const t = (v?: number) => (v == null ? '' : String(v).replace('.', ','));
  const [sistema, setSistema] = useState<'rotacionado' | 'continuo'>(m.sistema ?? 'rotacionado');
  const [ocup, setOcup] = useState(t(m.diasOcupacao));
  const [desc, setDesc] = useState(t(m.diasDescanso));
  const [cap, setCap] = useState(t(m.capacidadeUA));
  const salvar = async () => {
    try {
      const o = num(ocup), d = num(desc);
      await db.modulos.update(m.id!, {
        sistema, diasOcupacao: o ? Math.round(o) : undefined, diasDescanso: d != null ? Math.round(d) : undefined, capacidadeUA: num(cap) ?? undefined,
      });
      aviso('Módulo salvo.');
      fechar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div style={{ marginTop: 10 }}>
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
