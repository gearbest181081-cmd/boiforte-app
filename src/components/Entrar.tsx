import { useState } from 'react';
import { confirmarCodigo, pedirCodigo } from '../nuvem/cliente';
import { CampoTexto, useAviso } from './ui';

/** Entrada por e-mail, sem senha: chega um e-mail com um botão (e, quando o servidor mandar, um código). */
export function Entrar({ aoEntrar }: { aoEntrar?: () => void }) {
  const aviso = useAviso();
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const pedir = async () => {
    setOcupado(true);
    try { await pedirCodigo(email); setEnviado(true); aviso('E-mail enviado. Olhe sua caixa de entrada.'); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const confirmar = async () => {
    setOcupado(true);
    try { await confirmarCodigo(email, codigo); aoEntrar?.(); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  return (
    <div className="cartao">
      <h3>Entrar</h3>
      {!enviado ? (
        <>
          <p className="mudo">Sem senha: digite seu e-mail e mandamos uma mensagem para você entrar.</p>
          <CampoTexto rotulo="Seu e-mail" nome="email" tipo="email" inputMode="email" autoComplete="email" valor={email} aoMudar={setEmail} aoEnter={pedir} />
          <button className="btn largo" disabled={ocupado || !email.trim()} onClick={pedir}>Mandar e-mail de entrada</button>
        </>
      ) : (
        <>
          <p data-testid="emailEnviado">Mandamos um e-mail para <b>{email.trim().toLowerCase()}</b>.</p>
          <p className="mudo">Abra o e-mail <b>neste celular</b> e toque no botão para entrar. Se no e-mail vier um código de 6 números, digite aqui embaixo. Não achou? Olhe também no lixo eletrônico (spam).</p>
          <CampoTexto rotulo="Código do e-mail (se tiver)" nome="codigo" formato="digitos" inputMode="numeric" autoComplete="one-time-code" maxLength={8} valor={codigo} aoMudar={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 8))} />
          <div className="botoes">
            <button className="btn" disabled={ocupado || codigo.length < 6} onClick={confirmar}>Entrar</button>
            <button className="btn sec" onClick={() => { setEnviado(false); setCodigo(''); }}>Trocar e-mail</button>
          </div>
          <button className="btn sec largo" disabled={ocupado} onClick={pedir}>Mandar de novo</button>
        </>
      )}
    </div>
  );
}
