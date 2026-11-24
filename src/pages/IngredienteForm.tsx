import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db, excluirIngrediente } from '../db';
import { AvisoNutricao, CampoEscolha, CampoNumero, CampoTexto, num, Topo, useAviso } from '../components/ui';
import { BotaoFoto } from '../components/Foto';
import { useVeDinheiro } from '../nuvem/useNuvem';
import { TIPOS, valorExtra, type CategoriaIngrediente, type TipoFormula } from '../nutricao';
import type { LeituraRotulo } from '../../supabase/functions/_shared/foto';

const CAMPOS = [
  ['ms', 'Matéria seca (MS)', '%'], ['pb', 'Proteína bruta (PB)', '%'], ['ndt', 'NDT (energia)', '%'],
  ['ca', 'Cálcio (Ca)', '%'], ['p', 'Fósforo (P)', '%'], ['fb', 'Fibra bruta (FB)', '%'],
  ['cobre', 'Cobre (Cu)', 'mg/kg'], ['manganes', 'Manganês (Mn)', 'mg/kg'], ['preco', 'Preço', 'R$/kg'],
] as const;

export const CATEGORIAS: { valor: CategoriaIngrediente; rotulo: string; pronto?: TipoFormula }[] = [
  { valor: 'ingrediente', rotulo: 'Ingrediente (milho, farelo, ureia…)' },
  { valor: 'nucleo', rotulo: 'Núcleo (para misturar na fazenda)' },
  { valor: 'sal_mineral', rotulo: 'Sal mineral pronto', pronto: 'sal_mineral' },
  { valor: 'sal_adensado', rotulo: 'Sal adensado pronto', pronto: 'sal_mineral' },
  { valor: 'proteinado', rotulo: 'Proteinado pronto para uso', pronto: 'proteinado' },
  { valor: 'proteico_energetico', rotulo: 'Proteico energético pronto para uso', pronto: 'proteico_energetico' },
  { valor: 'racao', rotulo: 'Ração pronta (RIP, TIP, creep…)', pronto: 'rip' },
];
const prontoDe = (c: CategoriaIngrediente) => CATEGORIAS.find((x) => x.valor === c)?.pronto;

export function IngredienteForm() {
  const { id } = useParams();
  const editando = id != null && id !== 'novo';
  const veDinheiro = useVeDinheiro();
  const nav = useNavigate();
  const aviso = useAviso();
  const [nome, setNome] = useState('');
  const [v, setV] = useState<Record<string, string>>({ ms: '90', pb: '', ndt: '', ca: '', p: '', fb: '', cobre: '', manganes: '', preco: '', diasAlerta: '7', ureiaTeor: '', consumoPct: '' });
  const [ureia, setUreia] = useState(false);
  const [categoria, setCategoria] = useState<CategoriaIngrediente>('ingrediente');
  const [consumo, setConsumo] = useState('');
  const [criarFormula, setCriarFormula] = useState(true);
  const [lida, setLida] = useState<string | null>(null);
  const br = (x: number | null | undefined) => (x == null ? '' : String(x).replace('.', ','));
  const pronto = prontoDe(categoria);

  const leu = (r: LeituraRotulo) => {
    if (!r.legivel) return aviso('Não deu para ler a tabela. Tente uma foto mais perto, reta e com luz.', true);
    if (r.nome && !nome.trim()) setNome(r.nome);
    if (r.categoria) setCategoria(r.categoria);
    setV((s) => ({
      ...s,
      ...Object.fromEntries((['ms', 'pb', 'ndt', 'ca', 'p', 'fb', 'cobre', 'manganes'] as const).flatMap((k) => (r[k] != null ? [[k, br(r[k])]] : []))),
      ureiaTeor: r.ureiaTeor != null ? br(r.ureiaTeor) : s.ureiaTeor,
      consumoPct: r.consumoPctPV != null ? br(+(r.consumoPctPV * 100).toFixed(3)) : s.consumoPct,
    }));
    setUreia(r.ureia);
    if (r.consumo) setConsumo(r.consumo);
    const tipo = CATEGORIAS.find((c) => c.valor === r.categoria)?.rotulo;
    setLida(['Lido da foto' + (tipo ? `: ${tipo.toLowerCase()}` : '') + '.', r.observacao].filter(Boolean).join(' '));
  };

  useEffect(() => {
    if (!editando) return;
    db.ingredientes.get(Number(id)).then((i) => {
      if (!i) return;
      setNome(i.nome); setUreia(!!i.ureia); setCategoria(i.categoria ?? 'ingrediente'); setConsumo(i.consumo ?? '');
      setV({ ms: br(i.ms), pb: br(i.pb), ndt: br(i.ndt), ca: br(i.ca), p: br(i.p), fb: br(valorExtra(i, 'fb')), cobre: br(valorExtra(i, 'cobre')), manganes: br(valorExtra(i, 'manganes')), preco: br(i.preco), diasAlerta: br(i.diasAlerta ?? 7), ureiaTeor: br(i.ureiaTeor), consumoPct: '' });
    });
  }, [editando, id]);

  const salvar = async () => {
    const eIngrediente = categoria === 'ingrediente';
    const teor = num(v.ureiaTeor);
    const dados = {
      nome: nome.trim(), ms: num(v.ms) ?? 0, pb: num(v.pb) ?? 0, ndt: num(v.ndt) ?? 0, ca: num(v.ca) ?? 0, p: num(v.p) ?? 0,
      fb: num(v.fb) ?? undefined, cobre: num(v.cobre) ?? undefined, manganes: num(v.manganes) ?? undefined,
      preco: num(v.preco) ?? 0, ureia: eIngrediente && ureia, ureiaTeor: !eIngrediente && teor ? teor : undefined,
      categoria, consumo: pronto ? consumo.trim() || undefined : undefined,
      diasAlerta: Math.round(num(v.diasAlerta) ?? 7), ativo: true,
    };
    if (!dados.nome) return aviso('Dê um nome ao produto.', true);
    if (dados.ms <= 0) return aviso('Informe a matéria seca (MS). Grãos e sal ficam perto de 88% a 95%.', true);
    if (teor != null && (teor < 0 || teor > 100)) return aviso('A ureia contida vai de 0% a 100%.', true);
    const pct = num(v.consumoPct);
    if (pct != null && (pct <= 0 || pct > 5)) return aviso('O consumo fica entre 0,01% e 5% do peso vivo.', true);
    try {
      if (editando) await db.ingredientes.update(Number(id), dados);
      else await db.transaction('rw', db.ingredientes, db.formulas, async () => {
        const novo = (await db.ingredientes.add({ ...dados, criadoEm: Date.now() })) as number;
        if (pronto && criarFormula) {
          await db.formulas.add({
            nome: dados.nome, tipo: pronto, unidade: 'pct', modo: 'direto',
            consumoPctPV: pct != null ? pct / 100 : TIPOS[pronto].consumoPctPV,
            itens: [{ ingredienteId: novo, qtd: 100 }], obs: dados.consumo ? `Consumo do rótulo: ${dados.consumo}` : undefined, criadoEm: Date.now(),
          });
        }
      });
      aviso(!editando && pronto && criarFormula ? 'Produto salvo e já pronto para usar no trato.' : 'Ingrediente salvo.');
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
        <AvisoNutricao />
        <BotaoFoto<LeituraRotulo> tipo="rotulo" rotulo="📷 Tirar foto da tabela nutricional" sempre aoLer={leu} aoErro={(m) => aviso(m, true)} />
        <p className="mudo" style={{ fontSize: 14, marginTop: 6 }}>Serve para núcleo e para produto pronto (sal mineral, sal adensado, proteinado, proteico energético, ração).</p>
        {lida && <div className="alerta atencao" data-testid="lidoFoto"><span className="ic">📷</span><div><b>{lida}</b>Confira cada número com o rótulo antes de salvar.</div></div>}

        <CampoEscolha rotulo="Tipo do produto" nome="ingCategoria" valor={categoria} aoMudar={(v) => setCategoria(v as CategoriaIngrediente)}>
          {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
        </CampoEscolha>
        <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} nome="ingNome" />
        <div className="dica">Valores na matéria natural (como no rótulo do saco). Cobre e manganês em mg/kg (= ppm). Deixe vazio o que o rótulo não traz.</div>
        <div className="grade">
          {CAMPOS.filter(([k]) => veDinheiro || k !== 'preco').map(([k, r, u]) => <CampoNumero key={k} rotulo={r} valor={v[k]} aoMudar={(x) => setV((s) => ({ ...s, [k]: x }))} unidade={u === 'R$/kg' ? 'R$' : u} nome={`ing_${k}`} />)}
        </div>
        {categoria === 'ingrediente' ? (
          <label className="campo" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="checkbox" checked={ureia} onChange={(e) => setUreia(e.target.checked)} style={{ width: 28, minHeight: 28 }} />
            <span style={{ margin: 0 }}>É ureia (o app controla o limite seguro)</span>
          </label>
        ) : (
          <CampoNumero rotulo="Ureia contida no produto" valor={v.ureiaTeor} aoMudar={(x) => setV((s) => ({ ...s, ureiaTeor: x }))} unidade="%" nome="ing_ureiaTeor"
            dica="Pelo “equivalente proteico de NNP” do rótulo ÷ 2,81. Deixe vazio se não tiver ureia." />
        )}
        {pronto && (
          <>
            <CampoTexto rotulo="Consumo indicado no rótulo" valor={consumo} aoMudar={setConsumo} nome="ingConsumo" dica="Ex.: 1 g por kg de peso vivo, ou 100 a 200 g/cab/dia" />
            {!editando && (
              <>
                <label className="campo" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="checkbox" checked={criarFormula} onChange={(e) => setCriarFormula(e.target.checked)} style={{ width: 28, minHeight: 28 }} />
                  <span style={{ margin: 0 }}>Já deixar pronto para usar no trato (cria a fórmula com 100% deste produto)</span>
                </label>
                {criarFormula && <CampoNumero rotulo="Consumo por cabeça" valor={v.consumoPct} aoMudar={(x) => setV((s) => ({ ...s, consumoPct: x }))} unidade="% PV" nome="ing_consumoPct"
                  dica={`Vazio = ${String(TIPOS[pronto].consumoPctPV * 100).replace('.', ',')}% do peso vivo. 1 g por kg de PV = 0,1%.`} />}
              </>
            )}
          </>
        )}
        <CampoNumero rotulo="Avisar quando o estoque der para menos de" valor={v.diasAlerta} aoMudar={(x) => setV((s) => ({ ...s, diasAlerta: x }))} unidade="dias" />
        <button className="btn largo" onClick={salvar}>Salvar ingrediente</button>
        {editando && <div className="botoes"><button className="btn perigo pequeno" onClick={apagar}>Apagar ingrediente</button></div>}
      </main>
    </>
  );
}
