import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, excluirIngrediente } from '../db';
import { CampoNumero, CampoTexto, num, Topo, useAviso } from '../components/ui';
import { BotaoFoto } from '../components/Foto';
import type { LeituraRotulo } from '../../supabase/functions/_shared/foto';

const CAMPOS = [
  ['ms', 'Matéria seca (MS)', '%'], ['pb', 'Proteína bruta (PB)', '%'], ['ndt', 'NDT (energia)', '%'],
  ['ca', 'Cálcio (Ca)', '%'], ['p', 'Fósforo (P)', '%'], ['preco', 'Preço', 'R$/kg'],
] as const;

export function IngredienteForm() {
  const { id } = useParams();
  const editando = id != null && id !== 'novo';
  const nav = useNavigate();
  const aviso = useAviso();
  const [nome, setNome] = useState('');
  const [v, setV] = useState<Record<string, string>>({ ms: '90', pb: '', ndt: '', ca: '', p: '', preco: '', diasAlerta: '7' });
  const [ureia, setUreia] = useState(false);
  const [lida, setLida] = useState<string | null>(null);
  const leu = (r: LeituraRotulo) => {
    if (!r.legivel) return aviso('Não deu para ler o rótulo. Tente uma foto mais perto e com luz.', true);
    const br = (x: number | null) => (x == null ? undefined : String(x).replace('.', ','));
    if (r.nome && !nome.trim()) setNome(r.nome);
    setV((s) => ({ ...s, ...Object.fromEntries((['ms', 'pb', 'ndt', 'ca', 'p'] as const).flatMap((k) => (br(r[k]) ? [[k, br(r[k])!]] : []))) }));
    if (r.ureia) setUreia(true);
    setLida(r.observacao ? `Lido da foto. ${r.observacao}` : 'Lido da foto.');
  };

  useEffect(() => {
    if (!editando) return;
    db.ingredientes.get(Number(id)).then((i) => {
      if (!i) return;
      setNome(i.nome); setUreia(!!i.ureia);
      const br = (x: number | undefined) => (x == null ? '' : String(x).replace('.', ','));
      setV({ ms: br(i.ms), pb: br(i.pb), ndt: br(i.ndt), ca: br(i.ca), p: br(i.p), preco: br(i.preco), diasAlerta: br(i.diasAlerta ?? 7) });
    });
  }, [editando, id]);

  const salvar = async () => {
    const dados = {
      nome: nome.trim(), ms: num(v.ms) ?? 0, pb: num(v.pb) ?? 0, ndt: num(v.ndt) ?? 0, ca: num(v.ca) ?? 0, p: num(v.p) ?? 0,
      preco: num(v.preco) ?? 0, ureia, diasAlerta: Math.round(num(v.diasAlerta) ?? 7), ativo: true,
    };
    if (!dados.nome) return aviso('Dê um nome ao ingrediente.', true);
    if (dados.ms <= 0) return aviso('Informe a matéria seca (MS). Grãos ficam perto de 88%.', true);
    try {
      if (editando) await db.ingredientes.update(Number(id), dados);
      else await db.ingredientes.add({ ...dados, criadoEm: Date.now() });
      aviso('Ingrediente salvo.');
      nav(-1);
    } catch (e) { aviso((e as Error).message, true); }
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar "${nome}"?`)) return;
    try { await excluirIngrediente(Number(id)); aviso('Ingrediente apagado.'); nav(-1); } catch (e) { aviso((e as Error).message, true); }
  };

  return (
    <>
      <Topo titulo={editando ? 'Ingrediente' : 'Novo ingrediente'} voltar />
      <main>
        <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} nome="ingNome" />
        <BotaoFoto<LeituraRotulo> tipo="rotulo" rotulo="Ler o rótulo pela foto" aoLer={leu} aoErro={(m) => aviso(m, true)} />
        {lida && <div className="alerta atencao" data-testid="lidoFoto"><span className="ic">📷</span><div><b>{lida}</b>Confira cada número com o rótulo antes de salvar.</div></div>}
        <div className="dica">Valores na matéria natural (como no rótulo do saco).</div>
        <div className="grade">
          {CAMPOS.map(([k, r, u]) => <CampoNumero key={k} rotulo={r} valor={v[k]} aoMudar={(x) => setV((s) => ({ ...s, [k]: x }))} unidade={u === 'R$/kg' ? 'R$' : u} nome={`ing_${k}`} />)}
        </div>
        <label className="campo" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={ureia} onChange={(e) => setUreia(e.target.checked)} style={{ width: 28, minHeight: 28 }} />
          <span style={{ margin: 0 }}>É ureia (o app controla o limite seguro)</span>
        </label>
        <CampoNumero rotulo="Avisar quando o estoque der para menos de" valor={v.diasAlerta} aoMudar={(x) => setV((s) => ({ ...s, diasAlerta: x }))} unidade="dias" />
        <button className="btn largo" onClick={salvar}>Salvar ingrediente</button>
        {editando && <div className="botoes"><button className="btn perigo pequeno" onClick={apagar}>Apagar ingrediente</button></div>}
      </main>
    </>
  );
}
