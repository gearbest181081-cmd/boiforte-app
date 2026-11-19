import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, excluirPropriedade, type Modulo, type Propriedade } from '../db';
import { CampoNumero, CampoTexto, num, Topo, useAviso } from '../components/ui';

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
        {novo || props?.length === 0 ? <FormPropriedade aoSalvar={() => setNovo(false)} /> : (
          <button className="btn sec largo" onClick={() => setNovo(true)}>+ Outra fazenda</button>
        )}
      </main>
    </>
  );
}

function FormPropriedade({ aoSalvar }: { aoSalvar: () => void }) {
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
        <CampoTexto rotulo="Município" valor={municipio} aoMudar={setMunicipio} voz={false} />
        <CampoTexto rotulo="UF" valor={uf} aoMudar={(v) => setUf(v.slice(0, 2))} voz={false} />
      </div>
      <CampoNumero rotulo="Área total" valor={area} aoMudar={setArea} unidade="ha" />
      <button className="btn largo" onClick={salvar}>Salvar fazenda</button>
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
        <input placeholder="Novo módulo / retiro" value={nomeMod} onChange={(e) => setNomeMod(e.target.value)} aria-label="Nome do novo módulo" />
        <button className="btn pequeno" onClick={addMod}>+ Módulo</button>
      </div>
      <div className="botoes"><button className="btn perigo pequeno" onClick={apagar}>Apagar fazenda</button></div>
    </div>
  );
}

function BlocoModulo({ m }: { m: Modulo }) {
  const aviso = useAviso();
  const piquetes = useLiveQuery(() => db.piquetes.where('moduloId').equals(m.id!).toArray(), [m.id]);
  const lotesPorPiquete = useLiveQuery(async () => {
    const ids = (piquetes ?? []).map((p) => p.id!);
    const ls = await db.lotes.filter((l) => !l.encerrado && l.piqueteId != null && ids.includes(l.piqueteId)).toArray();
    const mapa: Record<number, number> = {};
    ls.forEach((l) => { mapa[l.piqueteId!] = (mapa[l.piqueteId!] ?? 0) + l.qtdCabecas; });
    return mapa;
  }, [piquetes]);
  const [nome, setNome] = useState('');
  const [area, setArea] = useState('');
  const [capim, setCapim] = useState('');
  const [aberto, setAberto] = useState(false);
  const add = async () => {
    if (!nome.trim()) return aviso('Dê um nome ao piquete.', true);
    await db.piquetes.add({ moduloId: m.id!, nome: nome.trim(), areaHa: num(area) ?? undefined, capim: capim.trim() || undefined, criadoEm: Date.now() });
    setNome(''); setArea(''); setCapim(''); setAberto(false);
  };
  const apagarMod = async () => {
    if (!window.confirm(`Apagar o módulo "${m.nome}" e seus piquetes?`)) return;
    const ids = (piquetes ?? []).map((p) => p.id!);
    await db.transaction('rw', db.piquetes, db.modulos, db.lotes, async () => {
      await db.lotes.filter((l) => l.piqueteId != null && ids.includes(l.piqueteId)).modify({ piqueteId: null });
      await db.piquetes.bulkDelete(ids);
      await db.modulos.delete(m.id!);
    });
  };
  return (
    <div style={{ borderLeft: '4px solid var(--verde-claro)', paddingLeft: 12, margin: '12px 0' }}>
      <div className="linha-lote"><b>{m.nome}</b><button className="remover" aria-label="Apagar módulo" onClick={apagarMod}>×</button></div>
      {piquetes?.length === 0 && <p className="mudo">Sem piquetes.</p>}
      {piquetes?.map((p) => {
        const cab = lotesPorPiquete?.[p.id!] ?? 0;
        return (
          <div key={p.id} className="linha-lote" style={{ padding: '6px 0', borderBottom: '1px solid var(--borda)' }}>
            <span>{p.nome}<span className="mudo">{p.capim ? ` · ${p.capim}` : ''}{p.areaHa ? ` · ${p.areaHa} ha` : ''}</span></span>
            <span className="mudo">{cab} cab{p.areaHa && cab ? ` · ${(cab / p.areaHa).toFixed(1).replace('.', ',')} cab/ha` : ''}</span>
          </div>
        );
      })}
      {aberto ? (
        <div style={{ marginTop: 10 }}>
          <CampoTexto rotulo="Nome do piquete" valor={nome} aoMudar={setNome} />
          <div className="grade">
            <CampoNumero rotulo="Área" valor={area} aoMudar={setArea} unidade="ha" />
            <CampoTexto rotulo="Capim" valor={capim} aoMudar={setCapim} voz={false} />
          </div>
          <div className="botoes"><button className="btn pequeno" onClick={add}>Salvar piquete</button><button className="btn sec pequeno" onClick={() => setAberto(false)}>Cancelar</button></div>
        </div>
      ) : (
        <button className="btn sec pequeno" style={{ marginTop: 8 }} onClick={() => setAberto(true)}>+ Piquete</button>
      )}
    </div>
  );
}
