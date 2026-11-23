import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useTudo } from '../hooks';
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, drePeriodo, fluxoCaixa, folhaComoFixos, mesNome, NOMES_CATEGORIA, type Categoria } from '../financeiro';
import { fmtData, hojeISO } from '../calc';
import { CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';
import { rs } from './Nutricao';

export type Periodo = 'mes' | 'ano' | 'safra' | 'tudo';
export function periodoDatas(p: Periodo, hoje = hojeISO()): [string, string] {
  const a = Number(hoje.slice(0, 4)), m = Number(hoje.slice(5, 7));
  if (p === 'mes') return [hoje.slice(0, 8) + '01', hoje];
  if (p === 'ano') return [`${a}-01-01`, hoje];
  if (p === 'safra') return m >= 7 ? [`${a}-07-01`, hoje] : [`${a - 1}-07-01`, hoje];
  return ['1990-01-01', hoje];
}

export function Financeiro() {
  const [aba, setAba] = useState<'resumo' | 'lancamentos' | 'fixos'>('resumo');
  return (
    <>
      <Topo titulo="Financeiro" voltar />
      <main>
        <Opcoes tres valor={aba} aoMudar={setAba} opcoes={[{ valor: 'resumo', rotulo: 'Resumo' }, { valor: 'lancamentos', rotulo: 'Lançamentos' }, { valor: 'fixos', rotulo: 'Custos fixos' }]} />
        <div style={{ height: 14 }} />
        {aba === 'resumo' && <Resumo />}
        {aba === 'lancamentos' && <Lancamentos />}
        {aba === 'fixos' && <Fixos />}
      </main>
    </>
  );
}

function Resumo() {
  const t = useTudo();
  const [p, setP] = useState<Periodo>('ano');
  const [de, ate] = periodoDatas(p);
  const calc = useMemo(() => {
    if (!t) return null;
    const ini = p === 'tudo' ? [...t.lotes.map((l) => l.dataEntrada), ...t.lancamentos.map((l) => l.data)].sort()[0] ?? ate : de;
    const compras = t.movimentos.filter((m) => m.origem === 'compra' && m.valor).map((m) => ({ data: m.data, valor: m.valor! }));
    return { dre: drePeriodo(ini, ate, t.lancamentos, t.vendas, t.fornecimentos, t.custosFixos, folhaComoFixos(t.funcionarios)), fluxo: fluxoCaixa(ini, ate, t.lancamentos, t.vendas, compras, t.custosFixos, folhaComoFixos(t.funcionarios)) };
  }, [t, p, de, ate]);
  if (!calc) return null;
  const { dre, fluxo } = calc;
  const max = Math.max(1, ...fluxo.map((m) => Math.max(m.entradas, m.saidas)));
  return (
    <>
      <Opcoes valor={p} aoMudar={setP} opcoes={[{ valor: 'mes', rotulo: 'Este mês' }, { valor: 'ano', rotulo: 'Este ano' }, { valor: 'safra', rotulo: 'Safra (jul–jun)' }, { valor: 'tudo', rotulo: 'Tudo' }]} />
      <h2>DRE do período</h2>
      <div className="cartao rolagem">
        <table className="tab">
          <tbody>
            <tr><th colSpan={2}>Receitas</th></tr>
            {Object.entries(dre.receitas).map(([k, v]) => <tr key={k}><td>{NOMES_CATEGORIA[k] ?? k}</td><td className="n">{rs(v)}</td></tr>)}
            <tr><td><b>Total de receitas</b></td><td className="n"><b>{rs(dre.totalReceitas)}</b></td></tr>
            <tr><th colSpan={2}>Despesas</th></tr>
            {Object.entries(dre.despesas).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{NOMES_CATEGORIA[k] ?? k}</td><td className="n">{rs(v)}</td></tr>)}
            <tr><td><b>Total de despesas</b></td><td className="n"><b>{rs(dre.totalDespesas)}</b></td></tr>
            <tr><td><b>Resultado</b></td><td className="n"><b style={{ color: dre.resultado < 0 ? 'var(--alerta)' : 'var(--ok)' }} data-testid="resultadoPeriodo">{rs(dre.resultado)}</b></td></tr>
          </tbody>
        </table>
        <p className="mudo" style={{ marginTop: 8 }}>Nutrição conta pelo que foi fornecido; a compra de animais entra quando é lançada. Gado ainda no pasto não entra aqui (veja o resultado de cada lote).</p>
      </div>

      <h2>Fluxo de caixa</h2>
      <div className="cartao rolagem">
        {fluxo.length === 0 ? <p className="mudo">Sem movimento.</p> : (
          <table className="tab">
            <thead><tr><th>Mês</th><th className="n">Entrou</th><th className="n">Saiu</th><th className="n">Saldo</th><th className="n">Acumulado</th></tr></thead>
            <tbody>
              {fluxo.map((m) => (
                <tr key={m.mes}>
                  <td>{mesNome(m.mes)}
                    <div style={{ display: 'flex', gap: 2, marginTop: 4 }} aria-hidden="true">
                      <span style={{ height: 6, width: `${(m.entradas / max) * 60}px`, background: 'var(--ok)', borderRadius: 3 }} />
                      <span style={{ height: 6, width: `${(m.saidas / max) * 60}px`, background: 'var(--alerta)', borderRadius: 3 }} />
                    </div>
                  </td>
                  <td className="n">{rs(m.entradas, 0)}</td><td className="n">{rs(m.saidas, 0)}</td>
                  <td className="n" style={{ color: m.saldo < 0 ? 'var(--alerta)' : undefined }}>{rs(m.saldo, 0)}</td>
                  <td className="n" style={{ color: m.acumulado < 0 ? 'var(--alerta)' : undefined }}>{rs(m.acumulado, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mudo" style={{ marginTop: 8 }}>Dinheiro que entrou e saiu: vendas, lançamentos, compras de insumos e custos fixos do mês.</p>
      </div>
    </>
  );
}

function Lancamentos() {
  const aviso = useAviso();
  const lancs = useLiveQuery(() => db.lancamentos.orderBy('data').reverse().limit(200).toArray());
  const lotes = useLiveQuery(() => db.lotes.toArray());
  const [novo, setNovo] = useState(false);
  const [tipo, setTipo] = useState<'despesa' | 'receita'>('despesa');
  const [categoria, setCategoria] = useState<Categoria>('outros');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO());
  const [desc, setDesc] = useState('');
  const [loteId, setLoteId] = useState(0);
  const nomeLote = (id?: number | null) => (id ? lotes?.find((l) => l.id === id)?.nome ?? '?' : 'Rateado entre os lotes');
  const cats = tipo === 'despesa' ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA;
  const salvar = async () => {
    const v = num(valor);
    if (!v || v <= 0) return aviso('Informe o valor.', true);
    try {
      await db.lancamentos.add({ data, tipo, categoria, valor: v, descricao: desc.trim() || undefined, loteId: loteId || null, origem: 'manual', criadoEm: Date.now() });
      aviso('Lançamento salvo.');
      setValor(''); setDesc(''); setNovo(false);
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <>
      {novo ? (
        <div className="cartao">
          <Opcoes valor={tipo} aoMudar={(t) => { setTipo(t); setCategoria(t === 'despesa' ? 'outros' : 'outras_receitas'); }} opcoes={[{ valor: 'despesa', rotulo: 'Despesa' }, { valor: 'receita', rotulo: 'Receita' }]} />
          <div style={{ height: 12 }} />
          <label className="campo"><span>Categoria</span>
            <select name="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value as Categoria)}>
              {Object.entries(cats).filter(([k]) => k !== 'compra_animais' && k !== 'venda_animais').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <small>Compra e venda de gado se lançam dentro do lote. Insumos se lançam no Estoque.</small>
          </label>
          <CampoNumero rotulo="Valor" valor={valor} aoMudar={setValor} unidade="R$" nome="lancValor" />
          <label className="campo"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <CampoTexto rotulo="Descrição" valor={desc} aoMudar={setDesc} nome="lancDesc" />
          <label className="campo"><span>De qual lote?</span>
            <select name="lancLote" value={loteId} onChange={(e) => setLoteId(Number(e.target.value))}>
              <option value={0}>Geral da fazenda (ratear por cabeça)</option>
              {lotes?.filter((l) => !l.encerrado).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </label>
          <div className="botoes"><button className="btn" onClick={salvar}>Salvar lançamento</button><button className="btn sec" onClick={() => setNovo(false)}>Cancelar</button></div>
        </div>
      ) : <button className="btn largo" onClick={() => setNovo(true)} style={{ marginBottom: 14 }}>+ Novo lançamento</button>}
      <div className="cartao rolagem">
        {lancs?.length === 0 ? <p className="mudo">Nenhum lançamento.</p> : (
          <table className="tab">
            <thead><tr><th>Data</th><th>Descrição</th><th className="n">Valor</th><th /></tr></thead>
            <tbody>
              {lancs?.map((l) => (
                <tr key={l.id}>
                  <td>{fmtData(l.data)}</td>
                  <td>{NOMES_CATEGORIA[l.categoria]}{l.descricao ? ` · ${l.descricao}` : ''}<div className="mudo" style={{ fontSize: 13 }}>{nomeLote(l.loteId)}</div></td>
                  <td className="n" style={{ color: l.tipo === 'receita' ? 'var(--ok)' : undefined }}>{l.tipo === 'receita' ? '+' : '−'}{rs(l.valor)}</td>
                  <td>{l.origem === 'manual' || !l.origem ? <button className="remover" aria-label="Apagar lançamento" onClick={async () => { if (window.confirm('Apagar este lançamento?')) await db.lancamentos.delete(l.id!); }}>×</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Fixos() {
  const aviso = useAviso();
  const fixos = useLiveQuery(() => db.custosFixos.toArray());
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [desde, setDesde] = useState(hojeISO().slice(0, 8) + '01');
  const salvar = async () => {
    const v = num(valor);
    if (!nome.trim()) return aviso('Dê um nome. Ex.: "Arrendamento do pasto".', true);
    if (!v || v <= 0) return aviso('Informe o valor por mês.', true);
    await db.custosFixos.add({ nome: nome.trim(), valorMensal: v, desde, criadoEm: Date.now() });
    setNome(''); setValor('');
    aviso('Custo fixo salvo. Ele é rateado todo dia entre os lotes, por cabeça.');
  };
  const total = (fixos ?? []).filter((f) => !f.ate || f.ate >= hojeISO()).reduce((t, f) => t + f.valorMensal, 0);
  return (
    <>
      <div className="dica">Custos que existem todo mês, como arrendamento ou energia. O app divide pelo número de cabeças de cada lote, dia a dia, como a planilha fazia com o vaqueiro. Salários: cadastre em <Link to="/funcionarios">Funcionários</Link> (não lance aqui de novo).</div>
      {fixos?.map((f) => (
        <div key={f.id} className="cartao linha-lote">
          <div><b>{f.nome}</b><div className="mudo">desde {fmtData(f.desde)}{f.ate ? ` até ${fmtData(f.ate)}` : ''}</div></div>
          <div style={{ textAlign: 'right' }}><b>{rs(f.valorMensal)}/mês</b><br />
            {!f.ate ? <button className="btn sec pequeno" style={{ marginTop: 6 }} onClick={() => db.custosFixos.update(f.id!, { ate: hojeISO() })}>Encerrar</button>
              : <button className="remover" aria-label="Apagar" onClick={() => db.custosFixos.delete(f.id!)}>×</button>}
          </div>
        </div>
      ))}
      {total > 0 && <p><b>Total ativo: {rs(total)}/mês</b></p>}
      <div className="cartao">
        <h3>Novo custo fixo</h3>
        <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} nome="fixoNome" />
        <CampoNumero rotulo="Valor por mês" valor={valor} aoMudar={setValor} unidade="R$" nome="fixoValor" />
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <button className="btn largo" onClick={salvar}>Salvar custo fixo</button>
      </div>
    </>
  );
}
