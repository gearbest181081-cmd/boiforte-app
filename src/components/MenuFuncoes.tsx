// Menu com todas as funções (tela Menu) e os atalhos do Início. A lista fica em src/menu.ts.
import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ajusteDoMenu, atalhosDoInicio, itensVisiveis, procurarNoMenu, SECOES, type ItemMenu } from '../menu';
import { usePapel } from '../nuvem/useNuvem';
import { useSessao } from '../nuvem/sessao';
import { fazendaLigada } from '../nuvem/sinc';
import { carregarExemplo } from '../exemplo';
import { abrirPerfil } from './Perfil';
import { Entrada, useAviso } from './ui';

/** Lista de todas as funções, por assunto, com a busca no alto (escrevendo ou falando). */
export function MenuFuncoes() {
  const papel = usePapel();
  const { conta } = useSessao();
  const [busca, setBusca] = useState('');
  const id = useId();
  if (papel === undefined) return null; // ainda lendo o papel: não mostra o que a pessoa talvez não possa usar
  const itens = itensVisiveis(papel, !!conta);
  const achados = busca.trim() ? procurarNoMenu(busca, itens).slice(0, 8) : null;
  return (
    <section aria-label="Todas as funções do app">
      <div className="campo menu-busca">
        <label htmlFor={id}>O que você quer fazer?</label>
        <Entrada id={id} name="buscaMenu" type="search" enterKeyHint="search" valor={busca} aoMudar={setBusca} rotuloVoz="o que você quer fazer"
          placeholder="Ex.: vacina, vender, salário" />
        <small>Escreva ou toque no microfone e fale.</small>
      </div>
      {achados && achados.length > 0 && (
        <>
          <h2>Achei {achados.length === 1 ? 'isto' : 'estas funções'}</h2>
          <ListaMenu itens={achados} />
          <button type="button" className="btn sec largo" onClick={() => setBusca('')}>Mostrar o menu todo</button>
        </>
      )}
      {achados && achados.length === 0 && (
        <div className="dica" data-testid="menuNadaAchado">Não achei nada com “{busca.trim()}”. Tente outra palavra, como <b>vacina</b>, <b>vender</b>, <b>salário</b> ou <b>estoque</b>. Ou procure nas listas abaixo.</div>
      )}
      {(!achados || achados.length === 0) && SECOES.map((s) => {
        const daSecao = itens.filter((i) => i.secao === s.id);
        if (!daSecao.length) return null;
        return (
          <div key={s.id}>
            <h2>{s.titulo}</h2>
            <ListaMenu itens={daSecao} />
          </div>
        );
      })}
    </section>
  );
}

function ListaMenu({ itens }: { itens: ItemMenu[] }) {
  return <div className="menu-lista">{itens.map((i) => <LinhaMenu key={i.id} item={i} />)}</div>;
}

function LinhaMenu({ item }: { item: ItemMenu }) {
  const { pathname } = useLocation();
  const corpo = (
    <>
      <span className="menu-ic" aria-hidden="true">{item.icone}</span>
      <span className="menu-txt"><b>{item.titulo}</b><small>{item.descricao}</small></span>
      <span className="menu-seta" aria-hidden="true">›</span>
    </>
  );
  const props = { className: 'menu-item', 'data-testid': `menu-${item.id}` };
  if (item.acao === 'perfil') return <button type="button" {...props} onClick={abrirPerfil}>{corpo}</button>;
  const ajuste = ajusteDoMenu(item.para);
  if (ajuste && pathname === '/mais') return <button type="button" {...props} onClick={() => rolarPara(ajuste)}>{corpo}</button>;
  return <Link to={item.para} {...props}>{corpo}</Link>;
}

/** Rola a tela até o ajuste (id "aj-…") e pisca a borda para a pessoa ver onde é. */
export function rolarPara(ajuste: string, tentativas = 20) {
  const el = document.getElementById(`aj-${ajuste}`);
  if (!el) {
    // o cartão pode estar esperando os dados do celular para aparecer
    if (tentativas > 0) window.setTimeout(() => rolarPara(ajuste, tentativas - 1), 100);
    return;
  }
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('destaque');
  void el.offsetWidth; // reinicia a animação se tocar de novo
  el.classList.add('destaque');
  window.setTimeout(() => el.classList.remove('destaque'), 2400);
}

/** Abriu o Menu por um link de outra tela (ex.: /mais?ver=mercado): vai direto ao ajuste. */
export function useRolarAoAbrir() {
  const [params] = useSearchParams();
  const ver = params.get('ver');
  useEffect(() => { if (ver) rolarPara(ver); }, [ver]);
}

/** Botões grandes do Início com o que mais se faz no dia a dia (muda conforme o papel na equipe). */
export function Atalhos() {
  const papel = usePapel();
  if (papel === undefined) return null;
  const itens = atalhosDoInicio(papel);
  return (
    <section aria-label="Atalhos" className="atalhos-bloco">
      <div className="atalhos">
        {itens.map((i, n) => (
          <Link key={i.id} to={i.para} className={`atalho${n === 0 ? ' principal' : ''}`} data-testid={`atalho-${i.id}`}>
            <span className="ic" aria-hidden="true">{i.icone}</span>
            <span>{i.curto ?? i.titulo}</span>
          </Link>
        ))}
      </div>
      <Link to="/mais" className="ver-tudo" data-testid="verTudo">Ver todas as funções ›</Link>
    </section>
  );
}

/** Carrega a fazenda de exemplo (só fora da nuvem, para não misturar com a fazenda de verdade). */
export function BotaoExemplo({ className = 'btn sec largo', children = 'Carregar exemplo' }: { className?: string; children?: string }) {
  const aviso = useAviso();
  const nav = useNavigate();
  const carregar = async () => {
    if (await fazendaLigada()) return aviso('O exemplo é só para conhecer o app. Desligue da nuvem antes, para ele não ir para a fazenda.', true);
    await carregarExemplo();
    aviso('Exemplo carregado.');
    nav('/');
  };
  return <button type="button" className={className} onClick={carregar}>{children}</button>;
}
