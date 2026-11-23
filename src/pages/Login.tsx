import { useEffect, useState, type ReactNode } from 'react';
import { Entrar } from '../components/Entrar';
import { sair, type Conta } from '../nuvem/cliente';
import { donoDoCelular, marcarDono, useSessao } from '../nuvem/sessao';
import { apagarDadosDoCelular, fazendaLigada, temDadosLocais } from '../nuvem/sinc';
import { useAviso } from '../components/ui';

/**
 * Porta do app: sem entrar com o e-mail, só aparece a tela de entrada.
 * Depois da primeira entrada, a sessão fica guardada e o app abre direto, inclusive sem internet.
 * (Isto protege a tela. Os dados da nuvem são protegidos pelo servidor, que confere a sessão.)
 */
export function Porta({ children }: { children: ReactNode }) {
  const { exigeEntrada, conta } = useSessao();
  const [dono, setDono] = useState(donoDoCelular);
  const outra = !!conta && !!dono && dono.id !== conta.id;
  useEffect(() => {
    if (conta && !outra && (dono?.id !== conta.id || dono.email !== conta.email)) { marcarDono(conta); setDono(conta); }
  }, [conta, dono, outra]);
  if (!exigeEntrada) return <>{children}</>;
  if (!conta) return <TelaEntrada />;
  if (outra) return <OutraConta antes={dono!} agora={conta} aoResolver={() => setDono(donoDoCelular())} />;
  return <>{children}</>;
}

function Cabecalho() {
  return <header className="topo"><h1>BoiForte</h1></header>;
}

function TelaEntrada() {
  return (
    <>
      <Cabecalho />
      <main className="entrada">
        <div className="vazio">
          <div className="grande">🐂</div>
          <h2>Bem-vindo ao BoiForte</h2>
          <p className="mudo">Entre com seu e-mail para usar o app. Depois da primeira vez ele abre direto, mesmo sem internet.</p>
        </div>
        <Entrar />
        <p className="mudo" style={{ textAlign: 'center' }}>Primeira vez? É só digitar seu e-mail: a conta é criada na hora.</p>
      </main>
    </>
  );
}

/** Outra pessoa entrou num celular que tem dados de quem usava antes. */
function OutraConta({ antes, agora, aoResolver }: { antes: Conta; agora: Conta; aoResolver: () => void }) {
  const aviso = useAviso();
  const [temDados, setTemDados] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    Promise.all([temDadosLocais(), fazendaLigada()]).then(([d, f]) => {
      if (!d && !f) { marcarDono(agora); aoResolver(); } // celular vazio: não há o que esconder
      else setTemDados(true);
    }).catch(() => setTemDados(true));
  }, [agora, aoResolver]);
  if (!temDados) return <Cabecalho />;
  const apagar = async () => {
    if (!window.confirm(`Apagar do celular os dados de ${antes.email}? Os que já estão na nuvem continuam guardados lá.`)) return;
    setOcupado(true);
    try { await apagarDadosDoCelular(); marcarDono(agora); aviso('Pronto. O celular está limpo para você.'); aoResolver(); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  return (
    <>
      <Cabecalho />
      <main className="entrada">
        <div className="alerta atencao" data-testid="outraConta"><span className="ic">👤</span><div>
          <b>Este celular tem dados de outra conta.</b> Quem usava antes era <b>{antes.email || 'outra pessoa'}</b>. Você entrou como <b>{agora.email}</b>.
        </div></div>
        <p className="mudo">Para você usar o app aqui, os dados da outra conta saem deste celular. Se ela usa a nuvem, os dados dela continuam guardados lá.</p>
        <button className="btn perigo largo" disabled={ocupado} onClick={apagar}>Apagar os dados do celular e continuar</button>
        <button className="btn sec largo" style={{ marginTop: 12 }} disabled={ocupado} onClick={() => sair().catch(() => {})}>Voltar e entrar com {antes.email || 'a outra conta'}</button>
      </main>
    </>
  );
}
