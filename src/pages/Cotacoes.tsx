// Cotações do mercado (boi gordo, bezerro, milho, soja), atualizadas uma vez por dia no servidor.
// Guarda a última lista no celular para mostrar mesmo sem sinal.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, lerConfig } from '../db';
import { nuvemConfigurada, ultimasCotacoes, usuarioAtual, type Cotacao } from '../nuvem/cliente';
import { usePapel } from '../nuvem/useNuvem';
import { Topo, useAviso, useOnline } from '../components/ui';
import { rs } from './Nutricao';

const NOMES: Record<string, string> = {
  boi_gordo: 'Boi gordo', vaca_gorda: 'Vaca gorda', novilha: 'Novilha', bezerro: 'Bezerro',
  milho: 'Milho', soja: 'Soja', farelo_soja: 'Farelo de soja',
};
const GUARDA = 'boiforte-cotacoes';
const lerGuardadas = (): Cotacao[] => { try { return JSON.parse(localStorage.getItem(GUARDA) ?? '[]'); } catch { return []; } };
const dataBr = (d: string) => d.split('-').reverse().join('/');

/** A mais recente de cada produto/praça, com a anterior para mostrar a variação. */
export function resumirCotacoes(lista: Cotacao[]) {
  const grupos = new Map<string, Cotacao[]>();
  for (const c of lista) {
    const k = `${c.produto}|${c.praca}`;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  return [...grupos.values()].map((g) => {
    const [ult, ant] = [...g].sort((a, b) => b.data.localeCompare(a.data));
    return { ...ult, variacao: ant ? (ult.valor - ant.valor) / ant.valor : null };
  }).sort((a, b) => Object.keys(NOMES).indexOf(a.produto) - Object.keys(NOMES).indexOf(b.produto));
}

export function Cotacoes() {
  const aviso = useAviso();
  const online = useOnline();
  const papel = usePapel();
  const cfg = useLiveQuery(() => lerConfig());
  const [lista, setLista] = useState<Cotacao[]>(lerGuardadas);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'sem-login' | 'erro'>('carregando');

  useEffect(() => {
    (async () => {
      if (!nuvemConfigurada() || !(await usuarioAtual())) return setEstado('sem-login');
      if (!online) return setEstado('erro');
      try {
        const l = await ultimasCotacoes();
        setLista(l); setEstado('ok');
        try { localStorage.setItem(GUARDA, JSON.stringify(l)); } catch { /* sem espaço: tudo bem */ }
      } catch { setEstado('erro'); }
    })();
  }, [online]);

  const podeUsar = papel == null || papel === 'dono' || papel === 'gerente';
  const usar = async (c: Cotacao) => {
    await db.config.put({ chave: 'precoArroba', valor: Math.round(c.valor * 100) / 100 });
    aviso(`Preço da @ agora é ${rs(c.valor)}.`);
  };
  const itens = resumirCotacoes(lista);

  return (
    <>
      <Topo titulo="Cotações" voltar />
      <main>
        {estado === 'sem-login' && (
          <div className="alerta atencao"><span className="ic">☁️</span><div><b>Entre na nuvem para receber as cotações</b>
            Elas chegam todo dia sozinhas. <Link to="/nuvem">Entrar</Link></div></div>
        )}
        {estado === 'erro' && <div className="alerta atencao"><span className="ic">📶</span><div><b>Sem atualizar agora</b>Mostrando as últimas que o celular guardou.</div></div>}
        {estado === 'carregando' && !itens.length && <p className="mudo">Buscando…</p>}
        {estado !== 'carregando' && !itens.length && estado !== 'sem-login' && <p className="mudo">Ainda não há cotações.</p>}
        {itens.map((c) => (
          <div className="cartao" key={`${c.produto}|${c.praca}`} data-testid="cotacao">
            <div className="linha-lote">
              <div><b>{NOMES[c.produto] ?? c.produto}</b><div className="mudo" style={{ fontSize: 14 }}>{c.praca} · {dataBr(c.data)}</div></div>
              <div style={{ textAlign: 'right' }}>
                <b style={{ fontSize: 22 }}>{rs(c.valor)}</b><div className="mudo" style={{ fontSize: 14 }}>{c.unidade.replace('R$', '').replace('/', 'por ').replace('sc60', 'saca 60 kg').replace('cab', 'cabeça')}</div>
                {c.variacao != null && <div style={{ fontSize: 14, color: c.variacao >= 0 ? 'var(--ok)' : 'var(--alerta)' }}>{c.variacao >= 0 ? '▲' : '▼'} {Math.abs(c.variacao * 100).toFixed(1).replace('.', ',')}%</div>}
              </div>
            </div>
            {c.unidade === 'R$/@' && podeUsar && cfg && (
              Math.abs(cfg.precoArroba - c.valor) < 0.01
                ? <p className="mudo" style={{ margin: '8px 0 0' }}>É o preço da @ usado no app.</p>
                : <button className="btn sec pequeno" style={{ marginTop: 8 }} onClick={() => usar(c)}>Usar como preço da @ (hoje: {rs(cfg.precoArroba, 0)})</button>
            )}
            <div className="mudo" style={{ fontSize: 13, marginTop: 6 }}>Fonte: {c.fonte}</div>
          </div>
        ))}
        <p className="mudo" style={{ fontSize: 14 }}>Cotações de referência. O preço da sua região pode ser diferente.</p>
      </main>
    </>
  );
}
