import { useState } from 'react';
import { confirmarCodigo, entrarComSenha, mandarLinkNovaSenha, mandarLinkPrimeiroAcesso, ultimoEmail } from '../nuvem/cliente';
import { CampoSenha, CampoTexto, useAviso } from './ui';

type Modo = 'senha' | 'primeiro' | 'esqueci';

/**
 * Entrada no app.
 * - Normal: e-mail e senha.
 * - Primeiro acesso: digita o e-mail, chega um link de confirmação; ao abrir, o app pede para cadastrar a senha.
 * - Esqueci a senha: chega um link; ao abrir, o app pede a senha nova.
 */
export function Entrar({ aoEntrar }: { aoEntrar?: () => void }) {
  const aviso = useAviso();
  const [modo, setModo] = useState<Modo>('senha');
  const [email, setEmail] = useState(ultimoEmail);
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const trocarModo = (m: Modo) => { setModo(m); setEnviado(false); setCodigo(''); setSenha(''); };
  const rodar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const entrar = () => rodar(async () => { await entrarComSenha(email, senha); setSenha(''); aoEntrar?.(); });
  const mandarLink = () => rodar(async () => {
    if (modo === 'esqueci') await mandarLinkNovaSenha(email); else await mandarLinkPrimeiroAcesso(email);
    setEnviado(true);
    aviso('E-mail enviado. Olhe sua caixa de entrada.');
  });
  const confirmar = () => rodar(async () => { await confirmarCodigo(email, codigo, modo === 'esqueci' ? 'recovery' : 'email'); aoEntrar?.(); });

  const campoEmail = <CampoTexto rotulo="Seu e-mail" nome="email" tipo="email" inputMode="email" autoComplete="email" valor={email} aoMudar={setEmail}
    aoEnter={modo === 'senha' ? undefined : mandarLink} />;

  if (modo === 'senha') {
    return (
      <div className="cartao" data-testid="entrarSenha">
        <h3>Entrar</h3>
        {campoEmail}
        <CampoSenha rotulo="Sua senha" valor={senha} aoMudar={setSenha} aoEnter={entrar} />
        <button className="btn largo" disabled={ocupado || !email.trim() || !senha} onClick={entrar}>Entrar</button>
        <div className="entrar-links">
          <button className="link-simples" onClick={() => trocarModo('primeiro')}>Primeiro acesso? Criar minha senha</button>
          <button className="link-simples" onClick={() => trocarModo('esqueci')}>Esqueci minha senha</button>
        </div>
      </div>
    );
  }

  const primeiro = modo === 'primeiro';
  return (
    <div className="cartao" data-testid={primeiro ? 'primeiroAcesso' : 'esqueciSenha'}>
      <h3>{primeiro ? 'Primeiro acesso' : 'Esqueci minha senha'}</h3>
      {!enviado ? (
        <>
          <ol className="passos-entrada">
            <li>Digite seu e-mail aqui embaixo.</li>
            <li>Vamos mandar um e-mail com um link{primeiro ? ' de confirmação' : ''}.</li>
            <li>Abra o e-mail <b>neste celular</b> e toque no link.</li>
            <li>{primeiro ? 'O app abre e pede para você criar sua senha.' : 'O app abre e pede a senha nova.'}</li>
          </ol>
          {campoEmail}
          <button className="btn largo" disabled={ocupado || !email.trim()} onClick={mandarLink}>{primeiro ? 'Mandar link de confirmação' : 'Mandar link para nova senha'}</button>
        </>
      ) : (
        <>
          <p data-testid="emailEnviado">Mandamos um e-mail para <b>{email.trim().toLowerCase()}</b>.</p>
          <p className="mudo">Abra o e-mail <b>neste celular</b> e toque no link. Não achou? Olhe também no lixo eletrônico (spam). O link vale por 1 hora.</p>
          <CampoTexto rotulo="Veio um código de 6 números no e-mail? Digite aqui" nome="codigo" formato="digitos" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
            valor={codigo} aoMudar={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 8))} aoEnter={confirmar} />
          <div className="botoes">
            <button className="btn" disabled={ocupado || codigo.length < 6} onClick={confirmar}>Confirmar código</button>
            <button className="btn sec" disabled={ocupado} onClick={mandarLink}>Mandar de novo</button>
          </div>
        </>
      )}
      <div className="entrar-links">
        <button className="link-simples" onClick={() => trocarModo('senha')}>Já tenho senha: entrar</button>
      </div>
    </div>
  );
}
