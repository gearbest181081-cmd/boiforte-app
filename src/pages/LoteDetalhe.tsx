import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, excluirLote, FASES, lerConfig, pontosDoAnimal, pontosDoLote, SEXOS } from '../db';
import { montarInfo } from '../hooks';
import { arrobas, fmtData, fmtGmd, fmtKg, fmtNum, fmtPct, desvioMeta, hojeISO, periodos, pesoEstimado, resumo } from '../calc';
import { calcularFormula, custoArrobaNutricao, kgCabDia } from '../nutricao';
import { rs } from './Nutricao';
import { GraficoCrescimento } from '../components/Grafico';
import { Indicador, Opcoes, Topo, useAviso } from '../components/ui';

export function LoteDetalhe() {
  const { id } = useParams();
  const loteId = Number(id);
  const nav = useNavigate();
  const aviso = useAviso();
  const [aba, setAba] = useState<'resumo' | 'pesagens' | 'animais'>('resumo');
  const dados = useLiveQuery(async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) return null;
    const pesagens = await db.pesagens.where('loteId').equals(loteId).toArray();
    const animais = await db.animais.where('loteId').equals(loteId).toArray();
    const prop = await db.propriedades.get(lote.propriedadeId);
    let local = '';
    if (lote.piqueteId) {
      const pq = await db.piquetes.get(lote.piqueteId);
      const md = pq ? await db.modulos.get(pq.moduloId) : undefined;
      if (pq) local = `${md ? md.nome + ' › ' : ''}${pq.nome}`;
    }
    const fornecimentos = await db.fornecimentos.where('loteId').equals(loteId).toArray();
    const formula = lote.formulaId ? await db.formulas.get(lote.formulaId) : undefined;
    const ingredientes = formula ? await db.ingredientes.bulkGet(formula.itens.map((i) => i.ingredienteId)) : [];
    const config = await lerConfig();
    return { info: montarInfo(lote, pesagens), animais, prop, local, fornecimentos, formula, ingredientes: ingredientes.filter((x) => !!x) as any[], config };
  }, [loteId]);

  if (dados === undefined) return <Topo titulo="Lote" voltar />;
  if (dados === null) return (<><Topo titulo="Lote" voltar /><main><p>Lote não encontrado.</p></main></>);

  const { info, animais, prop, local, fornecimentos, formula, ingredientes, config } = dados;
  const { lote, resumo: r, projecao: p, alertas, pesagens } = info;
  const pontos = pontosDoLote(pesagens);
  const per = periodos(pontos).reverse();
  const gmdRef = r.gmdUltimo ?? r.gmdTotal;
  const desvio = desvioMeta(gmdRef, lote.gmdMeta);

  const apagarPesagem = async (pid: number) => {
    if (!window.confirm('Apagar esta pesagem?')) return;
    await db.pesagens.delete(pid);
    aviso('Pesagem apagada.');
  };
  const encerrar = async () => {
    await db.lotes.update(loteId, { encerrado: !lote.encerrado });
    aviso(lote.encerrado ? 'Lote reaberto.' : 'Lote encerrado. Ele continua no histórico.');
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar o lote "${lote.nome}" e todas as pesagens? Não dá para desfazer.`)) return;
    await excluirLote(loteId);
    aviso('Lote apagado.');
    nav('/lotes', { replace: true });
  };

  return (
    <>
      <Topo titulo={lote.nome} voltar />
      <main>
        <p className="mudo">
          {FASES[lote.fase]} · {SEXOS[lote.sexo]} · {lote.qtdCabecas} cab · entrada {fmtData(lote.dataEntrada)}
          {prop ? ` · ${prop.nome}` : ''}{local ? ` · ${local}` : ''}
        </p>

        <Link to={`/pesar/${lote.id}`} className="btn largo" style={{ marginBottom: 14 }}>Nova pesagem</Link>

        <Opcoes tres={lote.controle === 'individual'} valor={aba} aoMudar={setAba} opcoes={[
          { valor: 'resumo', rotulo: 'Resumo' },
          { valor: 'pesagens', rotulo: `Pesagens (${pesagens.length})` },
          ...(lote.controle === 'individual' ? [{ valor: 'animais' as const, rotulo: `Animais (${animais.length})` }] : []),
        ]} />
        <div style={{ height: 14 }} />

        {aba === 'resumo' && (
          <>
            {alertas.map((a, i) => (
              <div key={i} className={`alerta ${a.nivel}`}>
                <span className="ic">{a.nivel === 'ruim' ? '⚠️' : a.nivel === 'atencao' ? '🔔' : '✅'}</span>
                <div><b>{a.titulo}</b>{a.texto}</div>
              </div>
            ))}
            <div className="grade">
              <Indicador rotulo="Peso atual (médio)" valor={fmtKg(r.pesoAtual)} sub={r.dataUltima ? `em ${fmtData(r.dataUltima)}` : undefined} />
              <Indicador rotulo="GMD último período" valor={fmtGmd(r.gmdUltimo)} sub={desvio != null ? `${fmtPct(desvio)} da meta` : undefined} />
              <Indicador rotulo="GMD desde a entrada" valor={fmtGmd(r.gmdTotal)} sub={r.diasAcompanhados ? `${r.diasAcompanhados} dias` : undefined} />
              <Indicador rotulo="Ganho total" valor={fmtKg(r.ganhoTotal)} sub="por cabeça" />
              <Indicador rotulo="Arrobas por cabeça" valor={r.pesoAtual ? `${fmtNum(arrobas(r.pesoAtual), 1)} @` : '—'} sub="carcaça, rendimento 50%" />
              <Indicador rotulo={`Previsão ${lote.pesoAlvo ?? '—'} kg`} valor={p == null ? '—' : p.jaAtingiu ? 'Atingiu' : fmtData(p.dataPrevista)}
                sub={p && !p.jaAtingiu ? `faltam ${p.diasFaltando} dias (GMD ${p.origemGmd === 'meta' ? 'da meta' : p.origemGmd === 'ultimo' ? 'do último período' : 'médio'})` : undefined} />
            </div>
            <CartaoNutricao lote={lote} pontos={pontos} gmdRef={gmdRef} fornecimentos={fornecimentos} formula={formula} ingredientes={ingredientes} config={config} />
            <h2>Curva de crescimento</h2>
            <div className="cartao">
              <GraficoCrescimento pontos={pontos} gmdMeta={lote.gmdMeta} pesoAlvo={lote.pesoAlvo} projecao={p} />
            </div>
            {lote.obs && <div className="cartao"><b>Observações</b><p>{lote.obs}</p></div>}
            <div className="botoes">
              <Link to={`/lotes/${lote.id}/editar`} className="btn sec pequeno">Editar lote</Link>
              <button className="btn sec pequeno" onClick={encerrar}>{lote.encerrado ? 'Reabrir lote' : 'Encerrar lote'}</button>
              <button className="btn perigo pequeno" onClick={apagar}>Apagar</button>
            </div>
          </>
        )}

        {aba === 'pesagens' && (
          <div className="cartao rolagem">
            {pesagens.length === 0 ? <p className="mudo">Nenhuma pesagem.</p> : (
              <table className="tab">
                <thead><tr><th>Data</th><th className="n">Peso médio</th><th className="n">GMD</th><th className="n">Cab.</th><th></th></tr></thead>
                <tbody>
                  {[...pesagens].sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm - a.criadoEm).map((pe) => {
                    const periodo = per.find((x) => x.ate.data === pe.data);
                    return (
                      <tr key={pe.id}>
                        <td>{fmtData(pe.data)}{pe.obs ? <div className="mudo" style={{ fontSize: 13 }}>{pe.obs}</div> : null}{pe.tipo === 'individual' ? <div className="mudo" style={{ fontSize: 13 }}>individual</div> : null}</td>
                        <td className="n">{fmtKg(pe.pesoMedio)}</td>
                        <td className="n">{periodo ? fmtGmd(periodo.gmd).replace(' kg/dia', '') : '—'}</td>
                        <td className="n">{pe.qtdPesada}</td>
                        <td><button className="remover" aria-label="Apagar pesagem" onClick={() => apagarPesagem(pe.id!)}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="mudo" style={{ marginTop: 10 }}>GMD em kg/dia, calculado entre cada pesagem e a anterior.</p>
          </div>
        )}

        {aba === 'animais' && <ListaAnimais animais={animais} pesagens={pesagens} gmdMeta={lote.gmdMeta} />}
      </main>
    </>
  );
}

function ListaAnimais({ animais, pesagens, gmdMeta }: { animais: { id?: number; brinco: string }[]; pesagens: any[]; gmdMeta?: number | null }) {
  const linhas = animais.map((a) => ({ a, r: resumo(pontosDoAnimal(pesagens, a.id!)) }))
    .sort((x, y) => (y.r.gmdTotal ?? -99) - (x.r.gmdTotal ?? -99));
  if (!linhas.length) return <p className="mudo">Nenhum animal pesado ainda.</p>;
  return (
    <div className="cartao rolagem">
      <table className="tab">
        <thead><tr><th>Brinco</th><th className="n">Peso</th><th className="n">GMD</th><th className="n">Ganho</th></tr></thead>
        <tbody>
          {linhas.map(({ a, r }) => {
            const d = desvioMeta(r.gmdTotal, gmdMeta);
            return (
              <tr key={a.id}>
                <td><b>{a.brinco}</b></td>
                <td className="n">{fmtKg(r.pesoAtual, 0)}</td>
                <td className="n" style={{ color: d != null && d <= -0.1 ? 'var(--alerta)' : undefined }}>{r.gmdTotal == null ? '—' : fmtGmd(r.gmdTotal).replace(' kg/dia', '')}</td>
                <td className="n">{fmtKg(r.ganhoTotal, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mudo" style={{ marginTop: 10 }}>Ordenado do maior para o menor GMD. Em vermelho, animais 10% ou mais abaixo da meta.</p>
    </div>
  );
}

function CartaoNutricao({ lote, pontos, gmdRef, fornecimentos, formula, ingredientes, config }: any) {
  const custoTotal = fornecimentos.reduce((s: number, f: any) => s + f.custo, 0);
  const kgTotal = fornecimentos.reduce((s: number, f: any) => s + f.kgFornecido, 0);
  const cabDias = fornecimentos.reduce((s: number, f: any) => s + f.cabecas, 0);
  const diariaReal = cabDias ? custoTotal / cabDias : null;
  const r = formula ? calcularFormula(formula.itens, ingredientes) : null;
  const peso = pesoEstimado(pontos, hojeISO(), lote.gmdMeta);
  const consumo = lote.consumoPctPV || formula?.consumoPctPV || 0;
  const kgCab = peso ? kgCabDia(peso, consumo) : 0;
  const custoKg = formula?.modo === 'batida' ? formula.custoEstoque ?? r?.custoKg ?? 0 : r?.custoKg ?? 0;
  const diariaPrev = kgCab * custoKg;
  const diaria = diariaReal ?? (formula ? diariaPrev : null);
  const custoArroba = diaria != null ? custoArrobaNutricao(diaria, gmdRef, config.rendimento) : null;
  if (!formula && !fornecimentos.length) {
    return <div className="cartao" style={{ marginTop: 12 }}><b>Nutrição</b><p className="mudo">Sem dieta definida. <Link to={`/lotes/${lote.id}/editar`}>Definir dieta</Link></p></div>;
  }
  return (
    <>
      <h2>Nutrição</h2>
      <div className="cartao">
        <p>{formula ? <><b>{formula.nome}</b> · {fmtNum(consumo * 100, 2)}% PV · {fmtNum(kgCab, 2)} kg/cab/dia hoje</> : 'Dieta removida'}</p>
        <div className="grade">
          <div><div className="mudo">Diária por cabeça</div><b>{rs(diaria)}</b><div className="mudo" style={{ fontSize: 13 }}>{diariaReal != null ? `média de ${fornecimentos.length} trato(s)` : 'prevista'}</div></div>
          <div><div className="mudo">Custo da @ (nutrição)</div><b style={{ color: custoArroba != null && custoArroba > config.precoArroba ? 'var(--alerta)' : undefined }}>{rs(custoArroba)}</b><div className="mudo" style={{ fontSize: 13 }}>@ a {rs(config.precoArroba, 0)}</div></div>
          <div><div className="mudo">Gasto com trato</div><b>{rs(custoTotal)}</b><div className="mudo" style={{ fontSize: 13 }}>{fmtNum(kgTotal, 0)} kg fornecidos</div></div>
          <div><div className="mudo">Por cabeça</div><b>{rs(lote.qtdCabecas ? custoTotal / lote.qtdCabecas : null)}</b></div>
        </div>
        {custoArroba != null && custoArroba > config.precoArroba && (
          <div className="alerta ruim" style={{ marginTop: 10 }}><span className="ic">⚠️</span><div><b>Nutrição mais cara que a arroba</b>Cada @ produzida custa {rs(custoArroba)} só de trato, acima do preço de {rs(config.precoArroba, 0)}. Reveja a fórmula ou o GMD.</div></div>
        )}
      </div>
    </>
  );
}
