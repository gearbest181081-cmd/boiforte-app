import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ajustarEstoque, comprarInsumo, db, desfazerBatida, garantirIngredientesPadrao, registrarBatida } from '../db';
import { useEstoque, type ItemEstoque } from '../hooks';
import { fmtData, fmtNum, hojeISO } from '../calc';
import { CampoNumero, num, Opcoes, Topo, useAviso } from '../components/ui';
import { rs } from './Nutricao';

export function Estoque() {
  const itens = useEstoque();
  const [acao, setAcao] = useState<'compra' | 'batida' | null>(null);
  const batidas = useLiveQuery(async () => {
    const bs = await db.batidas.orderBy('data').reverse().limit(10).toArray();
    const fs = await db.formulas.bulkGet([...new Set(bs.map((b) => b.formulaId))]);
    return bs.map((b) => ({ ...b, nome: fs.find((f) => f?.id === b.formulaId)?.nome ?? '?' }));
  });
  const aviso = useAviso();
  return (
    <>
      <Topo titulo="Estoque" voltar />
      <main>
        <div className="botoes">
          <button className="btn" onClick={() => { garantirIngredientesPadrao(); setAcao(acao === 'compra' ? null : 'compra'); }}>Entrada (compra)</button>
          <button className="btn sec" onClick={() => setAcao(acao === 'batida' ? null : 'batida')}>Bater ração</button>
        </div>
        {acao === 'compra' && <FormCompra aoTerminar={() => setAcao(null)} />}
        {acao === 'batida' && <FormBatida aoTerminar={() => setAcao(null)} />}

        {itens?.length === 0 && <div className="dica">Lance as compras de insumos aqui. Quando o trato for marcado ou a ração for batida, o estoque baixa sozinho e o app avisa quando estiver acabando.</div>}
        {itens?.map((i) => <CartaoEstoque key={`${i.tipo}-${i.id}`} item={i} />)}

        {batidas && batidas.length > 0 && (
          <>
            <h2>Últimas batidas</h2>
            <div className="cartao rolagem">
              <table className="tab">
                <thead><tr><th>Data</th><th>Mistura</th><th className="n">kg</th><th className="n">R$/kg</th><th /></tr></thead>
                <tbody>
                  {batidas.map((b) => (
                    <tr key={b.id}>
                      <td>{fmtData(b.data)}</td><td>{b.nome}</td><td className="n">{fmtNum(b.kg, 0)}</td><td className="n">{fmtNum(b.custoTotal / b.kg, 3)}</td>
                      <td><button className="remover" aria-label="Desfazer batida" onClick={async () => { if (window.confirm('Desfazer esta batida? Os ingredientes voltam para o estoque.')) { await desfazerBatida(b.id!); aviso('Batida desfeita.'); } }}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function CartaoEstoque({ item }: { item: ItemEstoque }) {
  const aviso = useAviso();
  const [contando, setContando] = useState(false);
  const [kg, setKg] = useState('');
  const s = item.situacao;
  const salvarContagem = async () => {
    const v = num(kg);
    if (v == null || v < 0) return aviso('Informe quantos kg tem no depósito.', true);
    await ajustarEstoque(item.tipo === 'insumo' ? { ingredienteId: item.id } : { formulaId: item.id }, hojeISO(), v);
    aviso('Estoque ajustado pela contagem.');
    setContando(false); setKg('');
  };
  return (
    <div className="cartao">
      <div className="linha-lote">
        <h3>{item.nome}</h3>
        <b style={{ color: s.saldoKg < 0 ? 'var(--alerta)' : undefined }}>{fmtNum(s.saldoKg, 0)} kg</b>
      </div>
      <div style={{ marginBottom: 6 }}>
        <span className="etiqueta">{item.tipo === 'mistura' ? 'Mistura batida' : 'Insumo'}</span>
        <span className={`etiqueta ${s.nivel === 'ruim' ? 'ruim' : s.nivel === 'atencao' ? 'atencao' : ''}`}>{s.texto}</span>
      </div>
      <p className="mudo">
        {s.consumoDia > 0 ? `Consumo ${fmtNum(s.consumoDia, 1)} kg/dia` : 'Sem consumo'}
        {s.acabaEm && s.nivel !== 'ruim' ? ` · acaba por volta de ${fmtData(s.acabaEm)}` : ''} · {rs(item.precoKg, 3)}/kg · valor {rs(Math.max(0, s.saldoKg) * item.precoKg)}
      </p>
      {s.saldoKg < 0 && <p style={{ color: 'var(--alerta)', fontSize: 15 }}>Saldo negativo: falta lançar uma compra ou batida.</p>}
      {contando ? (
        <div className="com-mic">
          <input inputMode="decimal" placeholder="kg contados" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.,]/g, ''))} aria-label={`Contagem de ${item.nome}`} />
          <button className="btn pequeno" onClick={salvarContagem}>Salvar</button>
        </div>
      ) : (
        <button className="btn sec pequeno" onClick={() => setContando(true)}>Contei o estoque</button>
      )}
      {item.tipo === 'mistura' && <Link to={`/nutricao/formula/${item.id}`} className="mudo" style={{ marginLeft: 12 }}>ver fórmula</Link>}
    </div>
  );
}

function FormCompra({ aoTerminar }: { aoTerminar: () => void }) {
  const aviso = useAviso();
  const ings = useLiveQuery(() => db.ingredientes.toArray());
  const [id, setId] = useState(0);
  const [data, setData] = useState(hojeISO());
  const [kg, setKg] = useState('');
  const [modoValor, setModoValor] = useState<'total' | 'kg'>('total');
  const [valor, setValor] = useState('');
  const k = num(kg) ?? 0, v = num(valor) ?? 0;
  const total = modoValor === 'total' ? v : v * k;
  const salvar = async () => {
    if (!id) return aviso('Escolha o insumo.', true);
    try {
      await comprarInsumo(id, data, k, total);
      aviso('Compra lançada no estoque.');
      aoTerminar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <h3>Entrada de insumo</h3>
      <label className="campo"><span>Insumo</span>
        <select value={id} onChange={(e) => setId(Number(e.target.value))} name="insumo">
          <option value={0}>Escolha…</option>
          {ings?.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
        </select>
        <small>Não está na lista? Cadastre em <Link to="/nutricao/ingrediente/novo">Nutrição › Ingredientes</Link>.</small>
      </label>
      <label className="campo"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
      <CampoNumero rotulo="Quantidade" valor={kg} aoMudar={setKg} unidade="kg" nome="compraKg" dica="Ex.: 10 sacos de 30 kg = 300 kg" />
      <div className="campo"><Opcoes valor={modoValor} aoMudar={setModoValor} opcoes={[{ valor: 'total', rotulo: 'Valor total' }, { valor: 'kg', rotulo: 'Preço por kg' }]} /></div>
      <CampoNumero rotulo={modoValor === 'total' ? 'Valor pago (total)' : 'Preço por kg'} valor={valor} aoMudar={setValor} unidade="R$" nome="compraValor" />
      {k > 0 && total > 0 && <p className="mudo">{rs(total)} no total · {rs(total / k, 3)} por kg</p>}
      <div className="botoes"><button className="btn" onClick={salvar}>Lançar compra</button><button className="btn sec" onClick={aoTerminar}>Cancelar</button></div>
    </div>
  );
}

function FormBatida({ aoTerminar }: { aoTerminar: () => void }) {
  const aviso = useAviso();
  const formulas = useLiveQuery(() => db.formulas.filter((f) => f.modo === 'batida').toArray());
  const [id, setId] = useState(0);
  const [data, setData] = useState(hojeISO());
  const [kg, setKg] = useState('1000');
  const salvar = async () => {
    if (!id) return aviso('Escolha a mistura.', true);
    try {
      await registrarBatida(id, data, num(kg) ?? 0);
      aviso('Batida lançada: ingredientes saíram e a mistura entrou no estoque.');
      aoTerminar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  if (formulas && formulas.length === 0) {
    return <div className="cartao"><p>Nenhuma fórmula marcada como “Bato antes”. Crie ou edite em <Link to="/nutricao">Nutrição</Link>.</p></div>;
  }
  return (
    <div className="cartao">
      <h3>Bater ração</h3>
      <label className="campo"><span>Mistura</span>
        <select value={id} onChange={(e) => setId(Number(e.target.value))} name="mistura">
          <option value={0}>Escolha…</option>
          {formulas?.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </label>
      <label className="campo"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
      <CampoNumero rotulo="Quantos kg foram batidos" valor={kg} aoMudar={setKg} unidade="kg" nome="batidaKg" />
      <div className="botoes"><button className="btn" onClick={salvar}>Lançar batida</button><button className="btn sec" onClick={aoTerminar}>Cancelar</button></div>
    </div>
  );
}
