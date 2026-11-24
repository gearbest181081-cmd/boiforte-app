import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, desfazerSaida, registrarCompraLote, registrarSaida, type Lote } from '../db';
import { analisarLotes, useTudo } from '../hooks';
import { calcularVenda, NOMES_CATEGORIA } from '../financeiro';
import { fmtData, fmtNum, fmtPct, hojeISO } from '../calc';
import { CampoData, CampoNumero, CampoTexto, num, Opcoes, useAviso } from '../components/ui';
import { rs } from './Nutricao';

export function LoteFinanceiro({ lote }: { lote: Lote }) {
  const t = useTudo();
  const [form, setForm] = useState<'compra' | 'saida' | null>(null);
  const analise = useMemo(() => (t ? analisarLotes(t).find((a) => a.info.lote.id === lote.id) : undefined), [t, lote.id]);
  const vendas = useLiveQuery(() => db.vendas.where('loteId').equals(lote.id!).toArray(), [lote.id]);
  const compra = useLiveQuery(() => db.lancamentos.where('[origem+refId]').equals(['compra_lote', lote.id!]).first(), [lote.id]);
  const aviso = useAviso();
  if (!analise || !t) return null;
  const d = analise.dre;
  const linhas = Object.entries(d.custos).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {!compra && <div className="alerta atencao"><span className="ic">💲</span><div><b>Falta lançar a compra do lote</b>Sem ela o resultado e a margem ficam errados.</div></div>}
      <div className="botoes">
        <button className="btn" onClick={() => setForm(form === 'compra' ? null : 'compra')}>{compra ? 'Refazer compra' : 'Lançar compra'}</button>
        {!lote.encerrado && <button className="btn sec" onClick={() => setForm(form === 'saida' ? null : 'saida')}>Venda / baixa</button>}
      </div>
      {form === 'compra' && <FormCompra lote={lote} aoTerminar={() => setForm(null)} />}
      {form === 'saida' && <FormSaida lote={lote} precoArroba={t.precoArroba} rendimento={t.rendimento} comissao={t.comissaoVenda} pesoSugerido={analise.info.resumo.pesoAtual} aoTerminar={() => setForm(null)} />}

      <h2>Resultado do lote {lote.encerrado ? '' : '(até hoje)'}</h2>
      <div className="grade">
        <div className="indicador"><div className="rotulo">Resultado</div><div className="valor" data-testid="resultadoLote" style={{ color: d.resultado < 0 ? 'var(--alerta)' : 'var(--ok)' }}>{rs(d.resultado, 0)}</div><div className="mudo" style={{ fontSize: 13 }}>margem {fmtPct(d.margemCusto)} sobre o custo</div></div>
        <div className="indicador"><div className="rotulo">Custo da @ produzida</div><div className="valor">{rs(d.custoArrobaProduzida)}</div><div className="mudo" style={{ fontSize: 13 }}>{fmtNum(d.arrobasProduzidas, 1)} @ produzidas · @ a {rs(t.precoArroba, 0)}</div></div>
        <div className="indicador"><div className="rotulo">Custo por cabeça</div><div className="valor">{rs(d.custoCabeca, 0)}</div><div className="mudo" style={{ fontSize: 13 }}>{d.cabecasEntrada} cab · {d.dias} dias</div></div>
        <div className="indicador"><div className="rotulo">Diária por cabeça</div><div className="valor">{rs(d.dias && d.cabecasEntrada ? (d.custoTotal - (d.custos.compra_animais ?? 0)) / d.dias / Math.max(1, (d.cabecasEntrada + d.cabecasAtuais) / 2) : null)}</div><div className="mudo" style={{ fontSize: 13 }}>tudo menos a compra</div></div>
      </div>

      <h2>DRE do lote</h2>
      <div className="cartao rolagem">
        <table className="tab">
          <tbody>
            <tr><td>Vendas (líquido)</td><td className="n">{rs(d.receitas)}</td></tr>
            {d.valorRebanho > 0 && <tr><td>Valor do gado no pasto<div className="mudo" style={{ fontSize: 13 }}>{d.cabecasAtuais} cab × {fmtNum(d.pesoAtual, 0)} kg estimados × @ {rs(t.precoArroba, 0)}</div></td><td className="n">{rs(d.valorRebanho)}</td></tr>}
            {linhas.map(([k, v]) => <tr key={k}><td>− {NOMES_CATEGORIA[k] ?? k}</td><td className="n">{rs(v)}</td></tr>)}
            <tr><td>− Custo de oportunidade<div className="mudo" style={{ fontSize: 13 }}>{fmtNum(t.oportunidadeMes * 100, 2)}% ao mês sobre o capital médio</div></td><td className="n">{rs(d.oportunidade)}</td></tr>
            <tr><td><b>Resultado</b></td><td className="n"><b style={{ color: d.resultado < 0 ? 'var(--alerta)' : 'var(--ok)' }}>{rs(d.resultado)}</b></td></tr>
          </tbody>
        </table>
        <p className="mudo" style={{ marginTop: 8 }}>“Custos fixos rateados” inclui o que foi lançado como geral da fazenda, dividido por cabeça-dia.</p>
      </div>

      {vendas && vendas.length > 0 && (
        <>
          <h2>Saídas</h2>
          <div className="cartao rolagem">
            <table className="tab">
              <thead><tr><th>Data</th><th className="n">Cab.</th><th className="n">Peso</th><th className="n">Líquido</th><th /></tr></thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtData(v.data)}<div className="mudo" style={{ fontSize: 13 }}>{v.tipo === 'morte' ? 'Morte' : `Venda${v.comprador ? ' · ' + v.comprador : ''}`}</div></td>
                    <td className="n">{v.cabecas}</td><td className="n">{v.pesoMedio ? fmtNum(v.pesoMedio, 0) : '—'}</td><td className="n">{rs(v.valorLiquido, 0)}</td>
                    <td><button className="remover" aria-label="Desfazer saída" onClick={async () => { if (window.confirm('Desfazer esta saída? As cabeças voltam para o lote.')) { await desfazerSaida(v.id!); aviso('Saída desfeita.'); } }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function FormCompra({ lote, aoTerminar }: { lote: Lote; aoTerminar: () => void }) {
  const aviso = useAviso();
  const [preco, setPreco] = useState('');
  const [com, setCom] = useState('2');
  const [frete, setFrete] = useState('0');
  const [nf, setNf] = useState('0');
  const [data, setData] = useState(lote.dataEntrada);
  const p = num(preco) ?? 0, c = (num(com) ?? 0) / 100, f = num(frete) ?? 0, n = num(nf) ?? 0;
  const salvar = async () => {
    try { await registrarCompraLote(lote.id!, { data, precoCab: p, comissaoPct: c, frete: f, nfGta: n }); aviso('Compra lançada.'); aoTerminar(); }
    catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <h3>Compra do lote</h3>
      <CampoNumero rotulo="Preço por cabeça" valor={preco} aoMudar={setPreco} unidade="R$" nome="compraPreco" />
      <CampoNumero rotulo="Comissão" valor={com} aoMudar={setCom} unidade="%" nome="compraComissao" />
      <CampoNumero rotulo="Frete do lote" valor={frete} aoMudar={setFrete} unidade="R$" nome="compraFrete" />
      <CampoNumero rotulo="NF + GTA" valor={nf} aoMudar={setNf} unidade="R$" nome="compraNf" />
      <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="compraData" />
      {p > 0 && <p><b>Total: {rs(lote.qtdCabecas * p * (1 + c) + f + n)}</b> <span className="mudo">({rs((lote.qtdCabecas * p * (1 + c) + f + n) / Math.max(1, lote.qtdCabecas))} por cabeça)</span></p>}
      <div className="botoes"><button className="btn" onClick={salvar}>Salvar compra</button><button className="btn sec" onClick={aoTerminar}>Cancelar</button></div>
    </div>
  );
}

function FormSaida({ lote, precoArroba, rendimento, comissao, pesoSugerido, aoTerminar }: { lote: Lote; precoArroba: number; rendimento: number; comissao: number; pesoSugerido: number | null; aoTerminar: () => void }) {
  const aviso = useAviso();
  const [tipo, setTipo] = useState<'venda' | 'morte'>('venda');
  const [modo, setModo] = useState<'arroba' | 'cabeca'>('arroba');
  const [cab, setCab] = useState(String(lote.qtdCabecas));
  const [peso, setPeso] = useState(pesoSugerido ? String(Math.round(pesoSugerido)) : '');
  const [preco, setPreco] = useState(String(precoArroba).replace('.', ','));
  const [rend, setRend] = useState(String(+(rendimento * 100).toFixed(2)).replace('.', ','));
  const [com, setCom] = useState(String(+(comissao * 100).toFixed(2)).replace('.', ','));
  const [frete, setFrete] = useState('0');
  const [comprador, setComprador] = useState('');
  const [data, setData] = useState(hojeISO());
  const dados = { cabecas: Math.round(num(cab) ?? 0), pesoMedio: num(peso) ?? 0, rendimento: (num(rend) ?? 50) / 100, modo, preco: num(preco) ?? 0, comissaoPct: (num(com) ?? 0) / 100, frete: num(frete) ?? 0 };
  const v = tipo === 'venda' ? calcularVenda(dados) : null;
  const salvar = async () => {
    try {
      await registrarSaida(lote.id!, tipo === 'venda' ? { data, tipo, ...dados, comprador: comprador.trim() || undefined } : { data, tipo, cabecas: dados.cabecas, pesoMedio: dados.pesoMedio || undefined });
      aviso(tipo === 'venda' ? 'Venda lançada.' : 'Baixa por morte lançada.');
      aoTerminar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <Opcoes valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'venda', rotulo: 'Venda' }, { valor: 'morte', rotulo: 'Morte' }]} />
      <div style={{ height: 12 }} />
      <CampoNumero rotulo="Cabeças" valor={cab} aoMudar={setCab} unidade="cab" nome="saidaCab" dica={`O lote tem ${lote.qtdCabecas}.`} />
      <CampoData rotulo="Data" valor={data} aoMudar={setData} nome="saidaData" />
      <CampoNumero rotulo="Peso médio de saída" valor={peso} aoMudar={setPeso} unidade="kg" pesoVivo nome="saidaPeso" />
      {tipo === 'venda' && (
        <>
          <div className="campo"><Opcoes valor={modo} aoMudar={(m) => { setModo(m); setPreco(m === 'arroba' ? String(precoArroba).replace('.', ',') : ''); }} opcoes={[{ valor: 'arroba', rotulo: 'Por arroba' }, { valor: 'cabeca', rotulo: 'Por cabeça' }]} /></div>
          <CampoNumero rotulo={modo === 'arroba' ? 'Preço da @' : 'Preço por cabeça'} valor={preco} aoMudar={setPreco} unidade="R$" nome="saidaPreco" />
          {modo === 'arroba' && <CampoNumero rotulo="Rendimento de carcaça" valor={rend} aoMudar={setRend} unidade="%" nome="saidaRend" />}
          <CampoNumero rotulo="Comissão" valor={com} aoMudar={setCom} unidade="%" nome="saidaComissao" />
          <CampoNumero rotulo="Frete" valor={frete} aoMudar={setFrete} unidade="R$" nome="saidaFrete" />
          <CampoTexto rotulo="Comprador (opcional)" valor={comprador} aoMudar={setComprador} nome="saidaComprador" />
          {v && v.bruto > 0 && <p><b>Líquido: {rs(v.liquido)}</b> <span className="mudo">({rs(v.liquidoCab)} por cabeça{modo === 'arroba' ? `, ${fmtNum(v.arrobasCab, 2)} @/cab` : ''})</span></p>}
        </>
      )}
      <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={aoTerminar}>Cancelar</button></div>
    </div>
  );
}
