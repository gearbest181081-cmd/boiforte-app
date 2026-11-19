import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FASES, garantirLembretesPadrao } from '../db';
import { alertasInteligentes, useEscala, useEstoque, useLotesInfo, useTudo, type LoteInfo } from '../hooks';
import { ordenarAlertas } from '../alertas';
import { fmtData, fmtGmd, fmtKg, fmtNum, hojeISO } from '../calc';
import { Indicador, Topo } from '../components/ui';

export function Inicio() {
  const props = useLiveQuery(() => db.propriedades.toArray());
  const infos = useLotesInfo();
  const escala = useEscala(hojeISO());
  const estoque = useEstoque();
  const tudo = useTudo();
  const [todos, setTodos] = useState(false);
  useEffect(() => { if (props?.length) garantirLembretesPadrao().catch(() => {}); }, [props?.length]);
  if (!props || !infos) return <Topo titulo="BoiForte" />;

  if (props.length === 0) {
    return (
      <>
        <Topo titulo="BoiForte" />
        <main>
          <div className="vazio">
            <div className="grande">🐂</div>
            <h2>Bem-vindo ao BoiForte</h2>
            <p className="mudo">Tudo o que você lançar fica guardado no celular e funciona mesmo sem internet, no meio do pasto.</p>
          </div>
          <Link to="/fazenda" className="btn largo">Começar: cadastrar minha fazenda</Link>
          <div className="dica" style={{ marginTop: 16 }}>
            Quer só conhecer? Em <Link to="/mais">Mais</Link> você pode carregar um exemplo pronto.
          </div>
        </main>
      </>
    );
  }

  const cabecas = infos.reduce((s, i) => s + (i.lote.qtdCabecas || 0), 0);
  const alertasEstoque = (estoque ?? []).filter((e) => e.situacao.nivel === 'ruim' || e.situacao.nivel === 'atencao')
    .map((e) => ({ nivel: e.situacao.nivel as 'ruim' | 'atencao', titulo: `Estoque: ${e.nome}`, texto: `${e.situacao.texto} Saldo de ${fmtNum(e.situacao.saldoKg, 0)} kg.${e.tipo === 'mistura' ? ' Hora de bater nova ração.' : ''}` }));
  const alertas = ordenarAlertas([...infos.flatMap((i) => i.alertas), ...alertasEstoque, ...(tudo ? alertasInteligentes(tudo) : [])]);
  const tratos = (escala ?? []).filter((l) => l.formula);
  const tratosFeitos = tratos.filter((l) => l.fornecimento).length;
  const comPeso = infos.filter((i) => i.resumo.pesoAtual != null);
  const pesoMedio = comPeso.length
    ? comPeso.reduce((s, i) => s + i.resumo.pesoAtual! * i.lote.qtdCabecas, 0) / Math.max(1, comPeso.reduce((s, i) => s + i.lote.qtdCabecas, 0))
    : null;

  return (
    <>
      <Topo titulo={props.length === 1 ? props[0].nome : 'BoiForte'} />
      <main>
        <div className="grade tres">
          <Indicador rotulo="Cabeças" valor={fmtNum(cabecas, 0)} />
          <Indicador rotulo="Lotes ativos" valor={infos.length} />
          <Indicador rotulo="Peso médio" valor={pesoMedio == null ? '—' : <>{fmtNum(pesoMedio, 0)}<small> kg</small></>} />
        </div>

        <div className="botoes">
          <Link to="/pesar" className="btn">Pesar gado</Link>
          <Link to="/lotes/novo" className="btn sec">Novo lote</Link>
        </div>

        {tratos.length > 0 && (
          <Link to="/trato" className={`alerta ${tratosFeitos === tratos.length ? 'bom' : 'atencao'}`} style={{ textDecoration: 'none' }}>
            <span className="ic">{tratosFeitos === tratos.length ? '✅' : '🪣'}</span>
            <div><b>Trato de hoje: {tratosFeitos} de {tratos.length} lotes</b>{tratosFeitos === tratos.length ? 'Tudo fornecido.' : 'Toque para marcar o que já foi dado.'}</div>
          </Link>
        )}

        {alertas.length > 0 && (
          <>
            <h2>Avisos</h2>
            {alertas.slice(0, todos ? alertas.length : 6).map((a, i) => (
              <div key={i} className={`alerta ${a.nivel}`}>
                <span className="ic">{a.nivel === 'ruim' ? '⚠️' : a.nivel === 'atencao' ? '🔔' : '✅'}</span>
                <div><b>{a.titulo}</b>{a.texto}</div>
              </div>
            ))}
            {alertas.length > 6 && !todos && <button className="btn sec largo" onClick={() => setTodos(true)}>Ver todos os {alertas.length} avisos</button>}
          </>
        )}

        <h2>Lotes</h2>
        {infos.length === 0 && <p className="mudo">Nenhum lote ainda. Toque em “Novo lote”.</p>}
        {infos.map((i) => <CartaoLote key={i.lote.id} info={i} />)}
      </main>
    </>
  );
}

export function CartaoLote({ info }: { info: LoteInfo }) {
  const { lote, resumo: r, projecao: p, alertas } = info;
  const pior = alertas.find((a) => a.nivel === 'ruim') ?? alertas.find((a) => a.nivel === 'atencao');
  return (
    <Link to={`/lotes/${lote.id}`} className="cartao">
      <div className="linha-lote">
        <h3>{lote.nome}</h3>
        <span className="num">{lote.qtdCabecas} cab</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <span className="etiqueta">{FASES[lote.fase].split(' (')[0]}</span>
        {lote.encerrado && <span className="etiqueta atencao">Encerrado</span>}
        {pior && <span className={`etiqueta ${pior.nivel}`}>{pior.nivel === 'ruim' ? 'Atenção' : 'Aviso'}</span>}
      </div>
      <div className="grade">
        <div><div className="mudo">Peso atual</div><b>{fmtKg(r.pesoAtual)}</b></div>
        <div><div className="mudo">GMD</div><b>{fmtGmd(r.gmdUltimo ?? r.gmdTotal)}</b></div>
        {lote.pesoAlvo ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="mudo">Chega a {lote.pesoAlvo} kg</div>
            <b>{p == null ? '—' : p.jaAtingiu ? 'Já atingiu' : `${fmtData(p.dataPrevista)} (${p.diasFaltando} dias)`}</b>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
