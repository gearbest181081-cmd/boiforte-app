import { useEffect, useState, type ReactNode } from 'react';
import { Entrar } from '../components/Entrar';
import { definirSenha, problemaNaSenha, sair, SENHA_MINIMA, type Conta } from '../nuvem/cliente';
import { donoDoCelular, marcarDono, useSessao } from '../nuvem/sessao';
import { apagarDadosDoCelular, fazendaLigada, temDadosLocais } from '../nuvem/sinc';
import { CampoSenha, useAviso } from '../components/ui';

/**
 * Porta do app: sem entrar com o e-mail, só aparece a tela de entrada.
 * Depois da primeira entrada, a sessão fica guardada e o app abre direto, inclusive sem internet.
 * (Isto protege a tela. Os dados da nuvem são protegidos pelo servidor, que confere a sessão.)
 */
export function Porta({ children }: { children: ReactNode }) {
  const { exigeEntrada, conta, precisaSenha } = useSessao();
  const [dono, setDono] = useState(donoDoCelular);
  const outra = !!conta && !!dono && dono.id !== conta.id;
  useEffect(() => {
    if (conta && !outra && (dono?.id !== conta.id || dono.email !== conta.email)) { marcarDono(conta); setDono(conta); }
  }, [conta, dono, outra]);
  if (!exigeEntrada) return <>{children}</>;
  if (!conta) return <TelaEntrada />;
  if (precisaSenha) return <CriarSenha conta={conta} trocar={precisaSenha === 'trocar'} />;
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
          <p className="mudo">Entre com seu e-mail e sua senha. Depois de entrar, o app abre direto, mesmo sem internet.</p>
        </div>
        <Entrar />
        <p className="mudo" style={{ textAlign: 'center' }}>Primeira vez? Toque em <b>Primeiro acesso</b>: chega um link no seu e-mail e você cria sua senha.</p>
      </main>
    </>
  );
}

/** Depois do link do e-mail: cadastrar a senha (primeiro acesso) ou trocar (esqueci a senha). */
function CriarSenha({ conta, trocar }: { conta: Conta; trocar: boolean }) {
  const aviso = useAviso();
  const { senhaCadastrada } = useSessao();
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const problema = senha ? problemaNaSenha(senha) : null;
  const diferentes = !!repetir && repetir !== senha;
  const salvar = async () => {
    const p = problemaNaSenha(senha);
    if (p) { aviso(p, true); return; }
    if (senha !== repetir) { aviso('As duas senhas não estão iguais. Digite de novo.', true); return; }
    setOcupado(true);
    try {
      await definirSenha(senha);
      senhaCadastrada();
      aviso('Senha salva! Da próxima vez, entre com seu e-mail e esta senha.');
    } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  return (
    <>
      <Cabecalho />
      <main className="entrada">
        <div className="vazio">
          <div className="grande">🔑</div>
          <h2>{trocar ? 'Crie sua senha nova' : 'Crie sua senha'}</h2>
          <p className="mudo">{trocar ? 'Seu e-mail foi conferido.' : 'Pronto, seu e-mail foi confirmado!'} Agora escolha a senha que você vai usar para entrar no BoiForte com <b>{conta.email}</b>.</p>
        </div>
        <div className="cartao" data-testid="criarSenha">
          <CampoSenha rotulo={trocar ? 'Senha nova' : 'Sua senha'} nome="nova-senha" nova valor={senha} aoMudar={setSenha}
            dica={problema ?? `Pelo menos ${SENHA_MINIMA} letras ou números, misturando os dois. Exemplo: boi2026forte`} />
          <CampoSenha rotulo="Digite a senha de novo" nome="repetir-senha" nova valor={repetir} aoMudar={setRepetir} aoEnter={salvar}
            dica={diferentes ? 'As duas senhas não estão iguais.' : undefined} />
          <button className="btn largo" disabled={ocupado || !senha || !repetir} onClick={salvar}>Salvar senha</button>
        </div>
        <p className="mudo">Guarde a senha num lugar seguro. Não conte para ninguém: cada funcionário cria a própria senha com o e-mail dele.</p>
        <button className="btn sec largo" disabled={ocupado} onClick={() => sair().catch(() => {})}>Sair</button>
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
