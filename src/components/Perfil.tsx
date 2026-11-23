import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sair } from '../nuvem/cliente';
import { PAPEIS } from '../nuvem/esquema';
import { nomeParaMostrar, useSessao } from '../nuvem/sessao';
import { useEstadoNuvem } from '../nuvem/useNuvem';

/** Botão redondo do perfil (canto de cima, à direita) e o quadro que abre ao tocar. */
export function Perfil() {
  const { conta } = useSessao();
  const est = useEstadoNuvem();
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto]);
  if (!conta) return null;
  const nome = nomeParaMostrar(conta);
  const inicial = nome.trim().charAt(0).toUpperCase() || '?';
  const f = est?.fazenda;
  const sairDaConta = async () => {
    const aviso = est?.pendentes
      ? `Ainda há ${est.pendentes} alteração(ões) esperando internet. Elas ficam guardadas no celular e sobem quando você entrar de novo. Sair da conta?`
      : 'Sair da conta? Os dados continuam guardados neste celular. Para usar o app de novo, é preciso entrar com o e-mail.';
    if (!window.confirm(aviso)) return;
    setAberto(false);
    await sair().catch(() => {});
  };
  return (
    <>
      <button className="avatar" aria-label={`Perfil de ${nome}`} aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>{inicial}</button>
      {aberto && (
        <div className="perfil-fundo" onClick={() => setAberto(false)}>
          <div className="perfil" role="dialog" aria-label="Seu perfil" onClick={(e) => e.stopPropagation()}>
            <div className="perfil-cab">
              <span className="avatar grande" aria-hidden="true">{inicial}</span>
              <div style={{ minWidth: 0 }}>
                <b className="perfil-nome">{nome}</b>
                <div className="mudo perfil-email">{conta.email}</div>
              </div>
            </div>
            <div className="perfil-linha">
              {f ? (
                <><span>🏡 <b>{f.nome}</b> · {PAPEIS[f.papel].nome}</span>
                  <span className="mudo">{est?.rodando ? 'Sincronizando…' : est?.pendentes ? `${est.pendentes} alteração(ões) esperando internet` : est?.erros.length ? 'Há registros recusados' : 'Tudo salvo na nuvem'}</span></>
              ) : <span className="mudo">Os dados estão só neste celular. Ligue à nuvem para guardar fora dele e trabalhar com a equipe.</span>}
            </div>
            <Link to="/nuvem" className="btn largo" onClick={() => setAberto(false)}>{f ? 'Nuvem e equipe' : 'Ligar à nuvem'}</Link>
            <button className="btn sec largo" style={{ marginTop: 10 }} onClick={sairDaConta}>Sair da conta</button>
          </div>
        </div>
      )}
    </>
  );
}
