import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLotesInfo } from '../hooks';
import { Opcoes, Topo } from '../components/ui';
import { CartaoLote } from './Inicio';
import { ESCOLHER_LOTE, escolhaValida, podeVer } from '../menu';
import { usePapel } from '../nuvem/useNuvem';

export function Lotes() {
  const [filtro, setFiltro] = useState<'ativos' | 'todos'>('ativos');
  // ?escolher=saude|venda|compra|relatorio|fase: veio do Início ou do Menu e só falta dizer qual lote
  const [params] = useSearchParams();
  const escolha = escolhaValida(params.get('escolher'));
  const papel = usePapel();
  // quem não pode fazer a ação (ex.: vaqueiro em "venda") vê a lista normal
  const acao = escolha && (papel === undefined || podeVer(ESCOLHER_LOTE[escolha].acesso, papel)) ? ESCOLHER_LOTE[escolha] : null;
  const infos = useLotesInfo(!acao && filtro === 'todos');
  const podeCriar = papel !== undefined && podeVer('gerencia', papel); // vaqueiro e consultor não cadastram lote
  if (acao) {
    return (
      <>
        <Topo titulo={acao.titulo} />
        <main>
          <div className="dica" data-testid="escolherLote"><b>Escolha o lote.</b> {acao.texto}</div>
          {infos?.length === 0 && <p className="mudo">Nenhum lote ativo.</p>}
          {infos?.map((i) => <CartaoLote key={i.lote.id} info={i} para={acao.para(i.lote.id!)} />)}
          {podeCriar && (escolha === 'compra' || infos?.length === 0) && <Link to="/lotes/novo" className="btn sec largo">+ Cadastrar lote novo</Link>}
        </main>
      </>
    );
  }
  return (
    <>
      <Topo titulo="Lotes" />
      <main>
        {podeCriar && <Link to="/lotes/novo" className="btn largo" style={{ marginBottom: 14 }}>+ Novo lote</Link>}
        <Opcoes valor={filtro} aoMudar={setFiltro} opcoes={[{ valor: 'ativos', rotulo: 'Ativos' }, { valor: 'todos', rotulo: 'Todos (com encerrados)' }]} />
        <div style={{ height: 14 }} />
        {infos?.length === 0 && <p className="mudo">Nenhum lote cadastrado.</p>}
        {infos?.map((i) => <CartaoLote key={i.lote.id} info={i} />)}
      </main>
    </>
  );
}
