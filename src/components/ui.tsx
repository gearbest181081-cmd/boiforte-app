import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { melhorNumero, ouvir, vozDisponivel } from '../voz';
import { Perfil } from './Perfil';

// ---------- Ícones (desenhados aqui para funcionar sem internet) ----------
const caminhos: Record<string, ReactNode> = {
  casa: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  lotes: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><rect x="3" y="11" width="18" height="5" rx="1.5" /><path d="M3 20h18" /></>,
  balanca: <><path d="M12 3v3M5 8h14l-2.5 11a2 2 0 0 1-2 1.5h-5a2 2 0 0 1-2-1.5z" /><path d="M12 12l2.5-2.5" /><circle cx="12" cy="13.5" r="1.5" /></>,
  fazenda: <><path d="M3 21V10l5-4 5 4v11" /><path d="M13 21h8V13l-4-3-4 3" /><path d="M7 21v-5h2v5" /></>,
  mais: <><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></>,
  cocho: <><path d="M3 10h18l-2 8H5z" /><path d="M6 10V7M18 10V7M9 14h6" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  mais_sinal: <path d="M12 5v14M5 12h14" />,
};
export function Icone({ nome }: { nome: keyof typeof caminhos | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {caminhos[nome]}
    </svg>
  );
}

// ---------- Avisos rápidos (toast) ----------
type Aviso = { texto: string; erro?: boolean } | null;
const AvisoCtx = createContext<(texto: string, erro?: boolean) => void>(() => {});
export function AvisoProvider({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<Aviso>(null);
  const t = useRef<number>();
  const mostrar = useCallback((texto: string, erro?: boolean) => {
    setAviso({ texto, erro });
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setAviso(null), erro ? 5000 : 2800);
  }, []);
  return (
    <AvisoCtx.Provider value={mostrar}>
      {children}
      {aviso && <div className={`toast ${aviso.erro ? 'erro' : ''}`} role="status" onClick={() => setAviso(null)}>{aviso.texto}</div>}
    </AvisoCtx.Provider>
  );
}
export const useAviso = () => useContext(AvisoCtx);

// ---------- Topo ----------
export function Topo({ titulo, voltar }: { titulo: string; voltar?: boolean }) {
  const nav = useNavigate();
  const online = useOnline();
  return (
    <header className="topo">
      {voltar && <button className="voltar" aria-label="Voltar" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/', { replace: true }))}>‹</button>}
      <h1>{titulo}</h1>
      {!online && <span className="offline" title="Tudo continua sendo salvo no celular">Sem internet</span>}
      <Perfil />
    </header>
  );
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

// ---------- Botão de microfone ----------
export function BotaoMic({ aoOuvir, rotulo = 'Falar' }: { aoOuvir: (texto: string) => void; rotulo?: string }) {
  const [ouvindo, setOuvindo] = useState(false);
  const aviso = useAviso();
  const parar = useRef<() => void>();
  if (!vozDisponivel()) return null;
  const clicar = async () => {
    if (ouvindo) { parar.current?.(); return; }
    setOuvindo(true);
    const o = ouvir();
    parar.current = o.parar;
    try { aoOuvir(await o.promessa); }
    catch (e) { aviso((e as Error).message, true); }
    finally { setOuvindo(false); }
  };
  return (
    <button type="button" className={`mic ${ouvindo ? 'ouvindo' : ''}`} onClick={clicar} aria-label={ouvindo ? 'Parar de ouvir' : rotulo} title={rotulo}>
      <Icone nome="mic" />
    </button>
  );
}

// ---------- Campo numérico com voz ----------
export function CampoNumero({ rotulo, valor, aoMudar, unidade, dica, nome, min, passo }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; unidade?: string; dica?: string; nome?: string; min?: number; passo?: string;
}) {
  const aviso = useAviso();
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="com-mic">
        <input
          id={id}
          name={nome}
          inputMode="decimal"
          type="text"
          autoComplete="off"
          value={valor}
          min={min}
          step={passo}
          onChange={(e) => aoMudar(e.target.value.replace(/[^\d.,-]/g, ''))}
        />
        {unidade && <span className="unidade">{unidade}</span>}
        <BotaoMic
          rotulo={`Falar ${rotulo.toLowerCase()}`}
          aoOuvir={(t) => {
            const n = melhorNumero(t);
            if (n == null) aviso(`Não entendi um número em "${t.split('|')[0]}". Tente de novo.`, true);
            else aoMudar(String(n).replace('.', ','));
          }}
        />
      </div>
      {dica && <small>{dica}</small>}
    </div>
  );
}

/** Converte o texto do campo ("320,5") em número. */
export function num(v: string): number | null {
  if (v == null || v.trim() === '') return null;
  const s = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function CampoTexto({ rotulo, valor, aoMudar, dica, nome, tipo = 'text', voz = true }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; dica?: string; nome?: string; tipo?: string; voz?: boolean;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="com-mic">
        <input id={id} name={nome} type={tipo} value={valor} onChange={(e) => aoMudar(e.target.value)} />
        {voz && tipo === 'text' && <BotaoMic rotulo={`Falar ${rotulo.toLowerCase()}`} aoOuvir={(t) => aoMudar(t.split('|')[0])} />}
      </div>
      {dica && <small>{dica}</small>}
    </div>
  );
}

export function Opcoes<T extends string>({ valor, aoMudar, opcoes, tres }: {
  valor: T; aoMudar: (v: T) => void; opcoes: { valor: T; rotulo: string; dica?: string }[]; tres?: boolean;
}) {
  return (
    <div className={`opcoes ${tres ? 'tres' : ''}`} role="radiogroup">
      {opcoes.map((o) => (
        <button type="button" key={o.valor} role="radio" aria-checked={valor === o.valor} className={`opcao ${valor === o.valor ? 'sel' : ''}`} onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
          {o.dica && <small>{o.dica}</small>}
        </button>
      ))}
    </div>
  );
}

export function Indicador({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: string }) {
  return (
    <div className="indicador">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {sub && <div className="mudo" style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  );
}
