// Simulador da Cria: vender na desmama ou recriar, reter novilhas ou vender, projeção do rebanho em 5 anos.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, lerConfigFin } from '../db';
import { ativoCria, cabecas, KG_ARROBA_VIVO, projetarRebanho, reterNovilhas, venderOuRecriar } from '../cria';
import { fmtNum } from '../calc';
import { CampoEscolha, CampoNumero, Indicador, num, Opcoes, Topo } from '../components/ui';
import { rs } from './Nutricao';

type Aba = 'desmama' | 'novilhas' | 'rebanho';

export function CriaSimular() {
  const [aba, setAba] = useState<Aba>('desmama');
  const base = useLiveQuery(async () => {
    const animais = (await db.animais.toArray()).filter(ativoCria);
    const desm = (await db.desmamas.toArray()).sort((a, b) => (a.data < b.data ? 1 : -1))[0];
    const conta = (c: string) => animais.filter((a) => a.categoria === c).reduce((s, a) => s + cabecas(a), 0);
    const cfg = await lerConfigFin();
    const arroba = (await db.config.get('precoArroba'))?.valor ?? 320;
    return { matrizes: conta('matriz'), novilhas: conta('novilha'), touros: conta('touro'), bezerros: conta('bezerro'), pesoDesmama: desm?.pesoMedio, juros: cfg.oportunidadeMes, arroba };
  });
  if (!base) return <Topo titulo="Simulador da Cria" />;
  return (
    <>
      <Topo titulo="Simulador da Cria" />
      <main>
        <Opcoes tres valor={aba} aoMudar={setAba} opcoes={[{ valor: 'desmama', rotulo: 'Vender ou recriar' }, { valor: 'novilhas', rotulo: 'Reter novilhas' }, { valor: 'rebanho', rotulo: 'Rebanho 5 anos' }]} />
        <div style={{ height: 14 }} />
        {aba === 'desmama' && <SimDesmama base={base} />}
        {aba === 'novilhas' && <SimNovilhas base={base} />}
        {aba === 'rebanho' && <SimRebanho base={base} />}
        <p className="mudo" style={{ marginTop: 14 }}>Contas simples para ajudar a decidir. Os valores começam com os dados da fazenda; troque à vontade. Arroba de peso vivo = {KG_ARROBA_VIVO} kg.</p>
      </main>
    </>
  );
}

type Base = { matrizes: number; novilhas: number; touros: number; bezerros: number; pesoDesmama?: number; juros: number; arroba: number };
const br = (n: number | undefined, casas = 2) => (n == null ? '' : String(+n.toFixed(casas)).replace('.', ','));
const pct = (v: string) => (num(v) ?? 0) / 100;

function SimDesmama({ base }: { base: Base }) {
  // @ de carcaça (15 kg) a 50% de rendimento vale o mesmo que a @ de 30 kg vivo: começa com o preço do Mercado
  const [v, setV] = useState({
    cabecas: String(base.bezerros || 100), peso: br(base.pesoDesmama ?? 200, 1), precoKg: '14', dias: '300', gmd: '0,5', custo: '2,8',
    arroba: br(base.arroba, 2), mort: '2', juros: br(base.juros * 100, 2),
  });
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const r = venderOuRecriar({
    cabecas: num(v.cabecas) ?? 0, pesoDesmama: num(v.peso) ?? 0, precoBezerroKg: num(v.precoKg) ?? 0, diasRecria: num(v.dias) ?? 0, gmd: num(v.gmd) ?? 0,
    custoCabDia: num(v.custo) ?? 0, precoArrobaVenda: num(v.arroba) ?? 0, mortalidade: pct(v.mort), jurosMes: pct(v.juros),
  });
  return (
    <>
      <div className="cartao">
        <h3>Vender na desmama</h3>
        <div className="grade">
          <CampoNumero rotulo="Bezerros" valor={v.cabecas} aoMudar={set('cabecas')} nome="sdCab" />
          <CampoNumero rotulo="Peso na desmama" valor={v.peso} aoMudar={set('peso')} unidade="kg" nome="sdPeso" pesoVivo />
          <CampoNumero rotulo="Preço do bezerro" valor={v.precoKg} aoMudar={set('precoKg')} unidade="R$/kg" nome="sdPrecoKg" />
        </div>
        <h3>Recriar e vender depois</h3>
        <div className="grade">
          <CampoNumero rotulo="Dias de recria" valor={v.dias} aoMudar={set('dias')} unidade="dias" nome="sdDias" />
          <CampoNumero rotulo="GMD na recria" valor={v.gmd} aoMudar={set('gmd')} unidade="kg/dia" nome="sdGmd" />
          <CampoNumero rotulo="Custo por cabeça" valor={v.custo} aoMudar={set('custo')} unidade="R$/dia" nome="sdCusto" />
          <CampoNumero rotulo="Preço de venda" valor={v.arroba} aoMudar={set('arroba')} unidade="R$/@ viva" nome="sdArroba" />
          <CampoNumero rotulo="Mortalidade" valor={v.mort} aoMudar={set('mort')} unidade="%" nome="sdMort" />
          <CampoNumero rotulo="Custo do dinheiro" valor={v.juros} aoMudar={set('juros')} unidade="% ao mês" nome="sdJuros" />
        </div>
      </div>
      <div className={`alerta ${r.melhor === 'recriar' ? 'bom' : 'atencao'}`}>
        <span className="ic">{r.melhor === 'recriar' ? '📈' : '💰'}</span>
        <div><b>{r.melhor === 'recriar' ? `Recriar rende ${rs(r.ganhoRecria)} a mais` : `Vender na desmama é melhor por ${rs(-r.ganhoRecria)}`}</b>
          Recriando, a venda empata com a desmama se a @ viva valer {r.precoEmpate ? rs(r.precoEmpate) : '—'}.</div>
      </div>
      <div className="grade">
        <Indicador rotulo="Vendendo agora" valor={rs(r.receitaAgora)} />
        <Indicador rotulo="Venda depois da recria" valor={rs(r.receitaRecria)} sub={`${fmtNum(r.pesoFinal, 0)} kg por cabeça`} />
        <Indicador rotulo="Custo da recria" valor={rs(r.custo)} />
        <Indicador rotulo="Custo do dinheiro parado" valor={rs(r.oportunidade)} />
      </div>
    </>
  );
}

function SimNovilhas({ base }: { base: Base }) {
  const [v, setV] = useState({ novilhas: String(base.novilhas || 20), venda: '2600', custo: '70', meses: '24', prenhez: '80', bezerro: '2800', juros: br(base.juros * 100, 2) });
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const r = reterNovilhas({
    novilhas: num(v.novilhas) ?? 0, valorVendaCab: num(v.venda) ?? 0, custoMes: num(v.custo) ?? 0, mesesAtePrimeiroParto: num(v.meses) ?? 0,
    taxaPrenhez: pct(v.prenhez), valorBezerro: num(v.bezerro) ?? 0, jurosMes: pct(v.juros),
  });
  return (
    <>
      <div className="cartao">
        <div className="grade">
          <CampoNumero rotulo="Novilhas" valor={v.novilhas} aoMudar={set('novilhas')} nome="snNov" />
          <CampoNumero rotulo="Valor se vender hoje" valor={v.venda} aoMudar={set('venda')} unidade="R$/cab" nome="snVenda" />
          <CampoNumero rotulo="Custo para criar" valor={v.custo} aoMudar={set('custo')} unidade="R$/mês" nome="snCusto" />
          <CampoNumero rotulo="Meses até o 1º parto" valor={v.meses} aoMudar={set('meses')} unidade="meses" nome="snMeses" />
          <CampoNumero rotulo="Prenhez" valor={v.prenhez} aoMudar={set('prenhez')} unidade="%" nome="snPrenhez" />
          <CampoNumero rotulo="Valor do bezerro desmamado" valor={v.bezerro} aoMudar={set('bezerro')} unidade="R$" nome="snBezerro" />
          <CampoNumero rotulo="Custo do dinheiro" valor={v.juros} aoMudar={set('juros')} unidade="% ao mês" nome="snJuros" />
        </div>
      </div>
      <div className={`alerta ${r.anosParaPagar != null && r.anosParaPagar <= 4 ? 'bom' : 'atencao'}`}>
        <span className="ic">🐄</span>
        <div><b>{r.anosParaPagar == null ? 'Sem retorno com esses números' : `Cada novilha retida se paga em ${fmtNum(r.anosParaPagar, 1)} anos de bezerros`}</b>
          Reter custa {rs(r.investimentoCab)} por novilha (o que deixou de vender, com juros, mais a criação). Ela devolve uns {rs(r.retornoAnoCab)} por ano em bezerro.
          {r.anosParaPagar != null && r.anosParaPagar > 4 ? ' Pode valer mais vender e comprar matriz pronta.' : ''}</div>
      </div>
      <div className="grade">
        <Indicador rotulo="Investimento total" valor={rs(r.investimentoTotal)} />
        <Indicador rotulo="Bezerros por ano" valor={r.bezerrosAno} sub="depois do 1º parto" />
      </div>
    </>
  );
}

function SimRebanho({ base }: { base: Base }) {
  const [v, setV] = useState({
    matrizes: String(base.matrizes || 100), novilhas: String(base.novilhas || 0), touros: String(base.touros || 4), natalidade: '80', mortBez: '3', mortAd: '2',
    descarte: '15', retencao: '50', idade: '3',
  });
  const set = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  const anos = projetarRebanho({
    matrizes: num(v.matrizes) ?? 0, novilhas: num(v.novilhas) ?? 0, touros: num(v.touros) ?? 0, natalidade: pct(v.natalidade), mortBezerros: pct(v.mortBez),
    mortAdultos: pct(v.mortAd), descarte: pct(v.descarte), retencaoFemeas: pct(v.retencao), idadePrimeiraCria: v.idade === '2' ? 2 : 3,
  });
  return (
    <>
      <div className="cartao">
        <div className="grade">
          <CampoNumero rotulo="Matrizes hoje" valor={v.matrizes} aoMudar={set('matrizes')} nome="srMat" />
          <CampoNumero rotulo="Novilhas hoje" valor={v.novilhas} aoMudar={set('novilhas')} nome="srNov" />
          <CampoNumero rotulo="Natalidade" valor={v.natalidade} aoMudar={set('natalidade')} unidade="%" nome="srNat" />
          <CampoNumero rotulo="Morte de bezerros" valor={v.mortBez} aoMudar={set('mortBez')} unidade="%" nome="srMortB" />
          <CampoNumero rotulo="Morte de adultos" valor={v.mortAd} aoMudar={set('mortAd')} unidade="%" nome="srMortA" />
          <CampoNumero rotulo="Descarte de vacas" valor={v.descarte} aoMudar={set('descarte')} unidade="% ao ano" nome="srDesc" />
          <CampoNumero rotulo="Fêmeas retidas" valor={v.retencao} aoMudar={set('retencao')} unidade="% das bezerras" nome="srRet" />
          <CampoNumero rotulo="Touros" valor={v.touros} aoMudar={set('touros')} nome="srTouros" />
        </div>
        <CampoEscolha rotulo="Idade da novilha no 1º parto" nome="srIdade" valor={v.idade} aoMudar={set('idade')}>
          <option value="2">2 anos (precoce)</option><option value="3">3 anos</option>
        </CampoEscolha>
      </div>
      <div className="cartao rolagem">
        <table className="tab">
          <thead><tr><th>Ano</th><th className="n">Matrizes</th><th className="n">Bezerros</th><th className="n">Vendidos</th><th className="n">Retidas</th><th className="n">Desfrute</th></tr></thead>
          <tbody>
            {anos.map((a) => (
              <tr key={a.ano}>
                <td>{a.ano}</td><td className="n">{a.matrizes}</td><td className="n">{a.bezerros}</td>
                <td className="n">{a.vendidos}<div className="mudo" style={{ fontSize: 12 }}>{a.vendidosMachos}M {a.vendidasFemeas}F {a.descartadas}V</div></td>
                <td className="n">{a.retidas}</td><td className="n">{Math.round(a.desfrute * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mudo">Vendidos: machos (M) e fêmeas não retidas (F) na desmama e vacas de descarte (V). Desfrute = vendidos no ano ÷ rebanho no começo do ano.
        No ano 5 são precisos {anos[anos.length - 1]?.tourosNecessarios ?? 0} touros para as matrizes (1 para 25).</p>
    </>
  );
}
