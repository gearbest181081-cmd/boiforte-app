import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLotesInfo } from '../hooks';
import { Opcoes, Topo } from '../components/ui';
import { CartaoLote } from './Inicio';

export function Lotes() {
  const [filtro, setFiltro] = useState<'ativos' | 'todos'>('ativos');
  const infos = useLotesInfo(filtro === 'todos');
  return (
    <>
      <Topo titulo="Lotes" />
      <main>
        <Link to="/lotes/novo" className="btn largo" style={{ marginBottom: 14 }}>+ Novo lote</Link>
        <Opcoes valor={filtro} aoMudar={setFiltro} opcoes={[{ valor: 'ativos', rotulo: 'Ativos' }, { valor: 'todos', rotulo: 'Todos (com encerrados)' }]} />
        <div style={{ height: 14 }} />
        {infos?.length === 0 && <p className="mudo">Nenhum lote cadastrado.</p>}
        {infos?.map((i) => <CartaoLote key={i.lote.id} info={i} />)}
      </main>
    </>
  );
}
