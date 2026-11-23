import { useMemo, useState } from 'react';
import { analisarLotes, useTudo, type AnaliseLote } from '../hooks';
import { seMudarGmd, seSegurar, simularCompra } from '../simulacao';
import { fmtData, fmtNum, hojeISO, somaDias } from '../calc';
import { CampoEscolha, CampoNumero, num, Opcoes, Topo } from '../components/ui';
import { rs } from './Nutricao';
import { SimComparar } from './Comparar';

const txt = (v: number | null | undefined, casas = 3) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(casas)).replace('.', ','));

/** Custo diário por cabeça do lote (tudo menos a compra, dividido pelos dias e cabeças). */
export function custoDiaCabeca(a: AnaliseLote): number | null {
  const d = a.dre;
  const cab = (d.cabecasEntrada + d.cabecasAtuais) / 2; // média do período, igual à tela Dinheiro do lote
  if (!d.dias || !cab) return null;
  return (d.custoTotal - (d.custos.compra_animais ?? 0)) / d.dias / cab;
}

export function Simular() {
  const tudo = useTudo();
  const [aba, setAba] = useState<'gmd' | 'segurar' | 'compra' | 'comparar'>('gmd');
  const analise = useMemo(() => (tudo ? analisarLotes(tudo).filter((a) => !a.info.lote.encerrado) : []), [tudo]);
  const [loteId, setLoteId] = useState<string>('');
  if (!tudo) return <Topo titulo="Simulação" voltar />;
  const sel = analise.find((a) => String(a.info.lote.id) === loteId) ?? null;
  return (
    <>
      <Topo titulo="Simulação" voltar />
      <main>
        <p className="mudo">Faça a conta antes de decidir. Nada aqui é salvo nem muda seus lotes.</p>
        <Opcoes valor={aba} aoMudar={setAba} opcoes={[
          { valor: 'gmd', rotulo: 'Mudar GMD' },
          { valor: 'segurar', rotulo: 'Segurar lote' },
          { valor: 'compra', rotulo: 'Comprar gado' },
          { valor: 'comparar', rotulo: 'Comparar produtos' },
        ]} />
        <div style={{ height: 14 }} />
        {(aba === 'gmd' || aba === 'segurar') && analise.length > 0 && (
          <CampoEscolha rotulo="Usar dados do lote" nome="simLote" valor={loteId} aoMudar={setLoteId}>
            <option value="">Digitar os números</option>
            {analise.map((a) => <option key={a.info.lote.id} value={a.info.lote.id}>{a.info.lote.nome}</option>)}
          </CampoEscolha>
        )}
        {aba === 'gmd' && <SimGmd key={`g${loteId}`} a={sel} />}
        {aba === 'segurar' && <SimSegurar key={`s${loteId}`} a={sel} precoArroba={tudo.precoArroba} rendimento={tudo.rendimento} />}
        {aba === 'comparar' && <SimComparar />}
        {aba === 'compra' && <SimCompra precoArroba={tudo.precoArroba} rendimento={tudo.rendimento} oportunidade={tudo.oportunidadeMes} />}
      </main>
    </>
  );
}

function SimGmd({ a }: { a: AnaliseLote | null }) {
  const gmdLote = a ? a.info.resumo.gmdUltimo ?? a.info.resumo.gmdTotal : null;
  const [peso, setPeso] = useState(txt(a?.dre.pesoAtual, 0));
  const [alvo, setAlvo] = useState(txt(a?.info.lote.pesoAlvo, 0));
  const [g1, setG1] = useState(txt(gmdLote) || '0,600');
  const [g2, setG2] = useState('0,800');
  const [custo, setCusto] = useState(txt(a ? custoDiaCabeca(a) : null, 2));
  const r = seMudarGmd(num(peso) ?? 0, num(alvo) ?? 0, num(g1) ?? 0, num(g2) ?? 0, num(custo) ?? 0);
  const hoje = hojeISO();
  return (
    <>
      <div className="cartao">
        <h3>Se eu mudar o GMD, quanto tempo ganho?</h3>
        <div className="grade">
          <CampoNumero rotulo="Peso de hoje" valor={peso} aoMudar={setPeso} unidade="kg" nome="simPeso" />
          <CampoNumero rotulo="Peso de saída" valor={alvo} aoMudar={setAlvo} unidade="kg" nome="simAlvo" />
          <CampoNumero rotulo="GMD de agora" valor={g1} aoMudar={setG1} unidade="kg/dia" nome="simGmd1" />
          <CampoNumero rotulo="GMD novo" valor={g2} aoMudar={setG2} unidade="kg/dia" nome="simGmd2" />
        </div>
        <CampoNumero rotulo="Custo por cabeça por dia" valor={custo} aoMudar={setCusto} unidade="R$" nome="simCustoDia" dica="Trato, mão de obra, pasto. Vazio = não calcula economia." />
      </div>
      {r ? (
        <div className={`alerta ${r.antecipa >= 0 ? 'bom' : 'ruim'}`} data-testid="resultadoGmd">
          <span className="ic">{r.antecipa >= 0 ? '⏩' : '⏪'}</span>
          <div>
            <b>{r.antecipa >= 0 ? `Antecipa a saída em ${r.antecipa} dias` : `Atrasa a saída em ${-r.antecipa} dias`}</b>
            Hoje: {r.diasAtual} dias (saída em {fmtData(somaDias(hoje, r.diasAtual))}). Com o GMD novo: {r.diasNovo} dias (saída em {fmtData(somaDias(hoje, r.diasNovo))}).
            {num(custo) ? ` ${r.economiaCab >= 0 ? 'Economia' : 'Gasto a mais'} de ${rs(Math.abs(r.economiaCab))} por cabeça${a ? `, ${rs(Math.abs(r.economiaCab) * a.dre.cabecasAtuais)} no lote` : ''}.` : ''}
          </div>
        </div>
      ) : <p className="mudo">Preencha os pesos (saída maior que hoje) e os dois GMD.</p>}
    </>
  );
}

function SimSegurar({ a, precoArroba, rendimento }: { a: AnaliseLote | null; precoArroba: number; rendimento: number }) {
  const gmdLote = a ? a.info.resumo.gmdUltimo ?? a.info.resumo.gmdTotal : null;
  const [peso, setPeso] = useState(txt(a?.dre.pesoAtual, 0));
  const [gmd, setGmd] = useState(txt(gmdLote) || '0,600');
  const [dias, setDias] = useState('30');
  const [hojeP, setHojeP] = useState(txt(precoArroba, 2));
  const [trav, setTrav] = useState(txt(precoArroba, 2));
  const [custo, setCusto] = useState(txt(a ? custoDiaCabeca(a) : null, 2));
  const p = { pesoHoje: num(peso) ?? 0, gmd: num(gmd) ?? 0, dias: Math.round(num(dias) ?? 0), rendimento, arrobaHoje: num(hojeP) ?? 0, arrobaTravada: num(trav) ?? 0, custoDiaCab: num(custo) ?? 0 };
  const ok = p.pesoHoje > 0 && p.dias > 0 && p.arrobaHoje > 0 && p.arrobaTravada > 0;
  const r = ok ? seSegurar(p) : null;
  return (
    <>
      <div className="cartao">
        <h3>Se eu segurar o lote mais uns dias com a @ travada?</h3>
        <div className="grade">
          <CampoNumero rotulo="Peso de hoje" valor={peso} aoMudar={setPeso} unidade="kg" nome="segPeso" />
          <CampoNumero rotulo="GMD esperado" valor={gmd} aoMudar={setGmd} unidade="kg/dia" nome="segGmd" />
          <CampoNumero rotulo="Segurar por" valor={dias} aoMudar={setDias} unidade="dias" nome="segDias" />
          <CampoNumero rotulo="Custo por cabeça por dia" valor={custo} aoMudar={setCusto} unidade="R$" nome="segCusto" />
          <CampoNumero rotulo="@ se vender hoje" valor={hojeP} aoMudar={setHojeP} unidade="R$" nome="segArrobaHoje" />
          <CampoNumero rotulo="@ travada" valor={trav} aoMudar={setTrav} unidade="R$" nome="segArrobaTravada" />
        </div>
        <p className="mudo">Rendimento de carcaça: {fmtNum(rendimento * 100, 1)}% (muda em Mais › Mercado).</p>
      </div>
      {r ? (
        <div className={`alerta ${r.retornoCab >= 0 ? 'bom' : 'ruim'}`} data-testid="resultadoSegurar">
          <span className="ic">{r.retornoCab >= 0 ? '💰' : '⚠️'}</span>
          <div>
            <b>{r.retornoCab >= 0 ? `Ganha ${rs(r.retornoCab)} a mais por cabeça` : `Perde ${rs(-r.retornoCab)} por cabeça`}</b>
            Vendendo hoje: {rs(r.receitaHoje)}/cab. Daqui a {p.dias} dias, com {fmtNum(r.pesoFuturo, 0)} kg: {rs(r.receitaFutura)}/cab, menos {rs(r.custo)} de custo.
            {a ? ` No lote todo (${a.dre.cabecasAtuais} cab): ${rs(r.retornoCab * a.dre.cabecasAtuais)}.` : ''}
          </div>
        </div>
      ) : <p className="mudo">Preencha peso, dias e os preços da @.</p>}
    </>
  );
}

function SimCompra({ precoArroba, rendimento, oportunidade }: { precoArroba: number; rendimento: number; oportunidade: number }) {
  const [v, setV] = useState({
    peso: '200', preco: '3260', dias: '108', arroba: txt(precoArroba, 2), sup: '1,70', consumo: '0,3', gmd: '0,750',
    rend: txt(rendimento * 100, 1), mao: '20', outros: '20', op: txt(oportunidade * 100, 2), cab: '1',
  });
  const set = (k: keyof typeof v) => (x: string) => setV((o) => ({ ...o, [k]: x }));
  const e = {
    pesoEntrada: num(v.peso) ?? 0, precoCompra: num(v.preco) ?? 0, dias: Math.round(num(v.dias) ?? 0), precoArroba: num(v.arroba) ?? 0,
    custoKgSuplemento: num(v.sup) ?? 0, consumoPctPV: (num(v.consumo) ?? 0) / 100, gmd: num(v.gmd) ?? 0, rendimento: (num(v.rend) ?? 0) / 100,
    maoObraMes: num(v.mao) ?? 0, outrosCab: num(v.outros) ?? 0, oportunidadeMes: (num(v.op) ?? 0) / 100,
  };
  const cab = Math.max(1, Math.round(num(v.cab) ?? 1));
  const ok = e.pesoEntrada > 0 && e.precoCompra > 0 && e.dias > 0 && e.precoArroba > 0 && e.rendimento > 0;
  const r = ok ? simularCompra(e) : null;
  return (
    <>
      <div className="cartao">
        <h3>Vale a pena comprar este gado?</h3>
        <div className="grade">
          <CampoNumero rotulo="Peso de compra" valor={v.peso} aoMudar={set('peso')} unidade="kg" nome="cpPeso" />
          <CampoNumero rotulo="Preço por cabeça" valor={v.preco} aoMudar={set('preco')} unidade="R$" nome="cpPreco" />
          <CampoNumero rotulo="Dias até vender" valor={v.dias} aoMudar={set('dias')} unidade="dias" nome="cpDias" />
          <CampoNumero rotulo="GMD esperado" valor={v.gmd} aoMudar={set('gmd')} unidade="kg/dia" nome="cpGmd" />
          <CampoNumero rotulo="@ de venda" valor={v.arroba} aoMudar={set('arroba')} unidade="R$" nome="cpArroba" />
          <CampoNumero rotulo="Rendimento" valor={v.rend} aoMudar={set('rend')} unidade="%" nome="cpRend" />
          <CampoNumero rotulo="Suplemento" valor={v.sup} aoMudar={set('sup')} unidade="R$/kg" nome="cpSup" />
          <CampoNumero rotulo="Consumo" valor={v.consumo} aoMudar={set('consumo')} unidade="% do PV" nome="cpConsumo" />
          <CampoNumero rotulo="Mão de obra" valor={v.mao} aoMudar={set('mao')} unidade="R$/cab/mês" nome="cpMao" />
          <CampoNumero rotulo="Outros no período" valor={v.outros} aoMudar={set('outros')} unidade="R$/cab" nome="cpOutros" />
          <CampoNumero rotulo="Custo do dinheiro" valor={v.op} aoMudar={set('op')} unidade="% ao mês" nome="cpOp" />
          <CampoNumero rotulo="Cabeças" valor={v.cab} aoMudar={set('cab')} nome="cpCab" />
        </div>
      </div>
      {r && (
        <>
          <div className={`alerta ${r.lucro >= 0 ? 'bom' : 'ruim'}`} data-testid="resultadoCompra">
            <span className="ic">{r.lucro >= 0 ? '💰' : '⚠️'}</span>
            <div>
              <b>{r.lucro >= 0 ? `Lucro de ${rs(r.lucro)} por cabeça` : `Prejuízo de ${rs(-r.lucro)} por cabeça`}</b>
              {cab > 1 ? `${rs(r.lucro * cab)} nas ${cab} cabeças. ` : ''}Margem de {fmtNum(r.margemCusto * 100, 1)}% sobre o custo ({fmtNum(r.margemMes * 100, 2)}% ao mês).
            </div>
          </div>
          <div className="cartao rolagem">
            <table className="tab">
              <tbody>
                <tr><td>Peso de saída</td><td className="n">{fmtNum(r.pesoFinal, 0)} kg</td></tr>
                <tr><td>Venda por cabeça</td><td className="n">{rs(r.valorVenda)}</td></tr>
                <tr><td>Suplemento</td><td className="n">{rs(r.custoSuplemento)}</td></tr>
                <tr><td>Mão de obra</td><td className="n">{rs(r.custoMaoObra)}</td></tr>
                <tr><td>Custo do dinheiro</td><td className="n">{rs(r.custoOportunidade)}</td></tr>
                <tr><td><b>Custo total por cabeça</b></td><td className="n"><b>{rs(r.custoTotal)}</b></td></tr>
                <tr><td>@ produzidas por cabeça</td><td className="n">{fmtNum(r.arrobasProduzidas, 2)}</td></tr>
                <tr><td>Custo da @ produzida</td><td className="n">{rs(r.custoArrobaProduzida)}</td></tr>
                <tr><td>Ágio da compra</td><td className="n">{r.agioPct == null ? '—' : `${fmtNum(r.agioPct * 100, 1)}% (${rs(r.agioPorArroba)}/@)`}</td></tr>
                <tr><td>Preço mínimo da @ para empatar</td><td className="n">{rs(r.breakEvenVenda)}</td></tr>
                <tr><td><b>Pagar no máximo por cabeça</b></td><td className="n"><b>{rs(r.breakEvenCompra)}</b></td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
