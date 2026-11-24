import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AVISO_PESO_EM_KG, escolherOpcaoFalada, explicarArroba, KG_POR_ARROBA_VIVA, melhorData, melhorNumero, melhorPeso, ouvir, textoFalado, vozDisponivel, type FormatoTexto } from '../voz';
import { hojeISO } from '../calc';
import { telaDeCima } from '../navegacao';
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
  voltar: <path d="M15 5l-7 7 7 7" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
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
/**
 * Cabeçalho de toda tela. O botão "Voltar" aparece em todas, menos no Início.
 * Volta para a tela anterior; se o app foi aberto direto nesta tela, vai para a tela "de cima".
 */
export function Topo({ titulo, voltar = true, paraOnde }: { titulo: string; voltar?: boolean; paraOnde?: string }) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const online = useOnline();
  const mostrarVoltar = voltar && pathname !== '/';
  const irVoltar = () => {
    if ((window.history.state?.idx ?? 0) > 0) nav(-1);
    else nav(paraOnde ?? telaDeCima(pathname), { replace: true });
  };
  return (
    <header className="topo">
      {mostrarVoltar && <button type="button" className="voltar" onClick={irVoltar}><Icone nome="voltar" /><span>Voltar</span></button>}
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

// ---------- Voz: explicação nos 3 primeiros usos e faixa "pode falar" ----------
/** O que o campo espera ouvir (muda o exemplo da explicação). */
export type TipoVoz = 'numero' | 'peso' | 'texto' | 'data' | 'escolha' | 'pesagem' | 'email' | 'codigo' | 'digitos';

const CHAVE_USOS_MIC = 'boiforte-mic-usos';
export const VEZES_DICA_MIC = 3;
export function usosMic(): number {
  try { return Number(localStorage.getItem(CHAVE_USOS_MIC)) || 0; } catch { return VEZES_DICA_MIC; }
}
function gravarUsosMic(n: number) {
  try { localStorage.setItem(CHAVE_USOS_MIC, String(n)); } catch { /* sem armazenamento: segue sem contar */ }
}
/** Faz a explicação do microfone aparecer de novo nas próximas 3 vezes. */
export function mostrarDicaMicDeNovo() { gravarUsosMic(0); }

const EXEMPLOS: Record<TipoVoz, ReactNode> = {
  numero: <>Fale o número: <b>“trezentos e vinte”</b>. Com vírgula: <b>“trezentos e vinte vírgula cinco”</b> ou <b>“trezentos e vinte e meio”</b>.</>,
  peso: <>Fale o peso em quilos: <b>“trezentos e vinte”</b>. Se falar em arroba (<b>“quinze arrobas”</b>), o app converte para kg: 30 kg por arroba de peso vivo.</>,
  texto: <>Fale normalmente, como numa conversa: <b>“Retiro de cima”</b>. O que você falar vira texto no campo.</>,
  data: <>Fale <b>“hoje”</b>, <b>“ontem”</b> ou a data: <b>“15 de março”</b>.</>,
  escolha: <>Fale o nome da opção que você quer na lista. Ex.: <b>“milho”</b>.</>,
  pesagem: <>Fale o brinco e o peso: <b>“brinco 12 peso 318”</b>. Sem brinco, fale só o peso: <b>“318”</b>. Em arroba (<b>“brinco 12 peso 21 arrobas”</b>) o app converte para kg.</>,
  email: <>Fale o e-mail assim: <b>“joao arroba gmail ponto com”</b>.</>,
  codigo: <>Fale as letras e os números do código, um por um.</>,
  digitos: <>Fale os números um por um: <b>“um, dois, três…”</b>.</>,
};

type PedidoDica = { tipo: TipoVoz; comecar: () => void };
type VozCtxT = { ensinar?: (p: PedidoDica) => void; ouvindo: (parar: (() => void) | null) => void };
const VozCtx = createContext<VozCtxT>({ ouvindo: () => {} });

/** Fica em volta do app: mostra a explicação do microfone e a faixa "pode falar" enquanto ouve. */
export function VozProvider({ children }: { children: ReactNode }) {
  const [dica, setDica] = useState<PedidoDica | null>(null);
  const [parar, setParar] = useState<(() => void) | null>(null);
  const ctx = useMemo<VozCtxT>(() => ({ ensinar: setDica, ouvindo: (p) => setParar(() => p) }), []);
  return (
    <VozCtx.Provider value={ctx}>
      {children}
      {dica && <DicaMic pedido={dica} aoFechar={() => setDica(null)} />}
      {parar && (
        <button type="button" className="faixa-ouvindo" onClick={parar}>
          <span className="ponto" aria-hidden="true" /> Pode falar agora… <u>tocar aqui para parar</u>
        </button>
      )}
    </VozCtx.Provider>
  );
}

function DicaMic({ pedido, aoFechar }: { pedido: PedidoDica; aoFechar: () => void }) {
  const usos = usosMic();
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    botao.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  const falar = (nuncaMais?: boolean) => {
    gravarUsosMic(nuncaMais ? VEZES_DICA_MIC : usos + 1);
    aoFechar();
    pedido.comecar();
  };
  return (
    <div className="folha-fundo" onClick={aoFechar}>
      <div className="folha" role="dialog" aria-modal="true" aria-labelledby="dica-mic-titulo" data-testid="dicaMic" onClick={(e) => e.stopPropagation()}>
        <div className="linha-lote">
          <h2 id="dica-mic-titulo">Como escrever falando</h2>
          <button type="button" className="fechar" aria-label="Fechar" onClick={aoFechar}><Icone nome="fechar" /></button>
        </div>
        <ol className="passos-mic">
          <li><span className="mic"><Icone nome="mic" /></span><div><b>1. Toque no microfone verde</b>ao lado do campo.</div></li>
          <li><span className="mic ouvindo"><Icone nome="mic" /></span><div><b>2. Ficou vermelho? Pode falar.</b>Fale perto do celular, com calma.{usos === 0 && <> Se o celular perguntar se pode usar o microfone, toque em <b style={{ display: 'inline' }}>Permitir</b>.</>}</div></li>
          <li><span className="mic ok" aria-hidden="true">✓</span><div><b>3. Confira o que apareceu no campo.</b>Se saiu errado, toque no microfone de novo ou digite.</div></li>
        </ol>
        <div className="dica"><b>Para este campo:</b> {EXEMPLOS[pedido.tipo]}</div>
        <button ref={botao} type="button" className="btn largo" onClick={() => falar()}><Icone nome="mic" /> Entendi, falar agora</button>
        <button type="button" className="btn sec largo" style={{ marginTop: 10 }} onClick={() => falar(true)}>Já sei usar, não mostrar mais</button>
        <p className="mudo" style={{ fontSize: 14, marginTop: 10, textAlign: 'center' }}>
          Esta explicação aparece nas {VEZES_DICA_MIC} primeiras vezes ({Math.min(usos + 1, VEZES_DICA_MIC)} de {VEZES_DICA_MIC}). Sem internet, em muitos celulares a voz não funciona: digite.
        </p>
      </div>
    </div>
  );
}

// ---------- Botão de microfone ----------
export function BotaoMic({ aoOuvir, rotulo = 'Falar', tipo = 'texto', grande }: {
  aoOuvir: (texto: string) => void; rotulo?: string; tipo?: TipoVoz; grande?: string;
}) {
  const [ouvindo, setOuvindo] = useState(false);
  const aviso = useAviso();
  const voz = useContext(VozCtx);
  const parar = useRef<() => void>();
  if (!vozDisponivel()) return null;
  const comecar = async () => {
    setOuvindo(true);
    const o = ouvir();
    parar.current = o.parar;
    voz.ouvindo(o.parar);
    try { aoOuvir(await o.promessa); }
    catch (e) { aviso((e as Error).message, true); }
    finally { setOuvindo(false); voz.ouvindo(null); }
  };
  const clicar = () => {
    if (ouvindo) { parar.current?.(); return; }
    if (voz.ensinar && usosMic() < VEZES_DICA_MIC) voz.ensinar({ tipo, comecar });
    else comecar();
  };
  return (
    <button type="button" className={`mic ${grande ? 'grande' : ''} ${ouvindo ? 'ouvindo' : ''}`} onClick={clicar} aria-label={ouvindo ? 'Parar de ouvir' : rotulo} title={rotulo}>
      <Icone nome="mic" />{grande && <span>{ouvindo ? 'Ouvindo… toque para parar' : grande}</span>}
    </button>
  );
}

// ---------- Campos que se escrevem falando ----------
type FormatoVoz = 'numero' | FormatoTexto;
type PropsEntrada = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: string; aoMudar: (v: string) => void;
  /** Como ler o que foi falado. false tira o microfone (só para campos que não são de escrever). */
  voz?: FormatoVoz | false;
  /** Nome do campo para o botão do microfone ("Falar peso"). */
  rotuloVoz?: string;
  unidade?: string;
  multilinha?: boolean;
  /** Peso de animal vivo em kg: se falar em arroba ("15 arrobas"), converte (30 kg por arroba de peso vivo). */
  pesoVivo?: boolean;
};

/** Caixa de texto com microfone ao lado. Base de todos os campos de escrever do app. */
export function Entrada({ valor, aoMudar, voz = 'texto', rotuloVoz, unidade, multilinha, pesoVivo, className, ...resto }: PropsEntrada) {
  const aviso = useAviso();
  const numero = voz === 'numero';
  const ouviu = (t: string) => {
    if (numero && (pesoVivo || unidade === 'kg')) {
      // Campo em kg: "15 arrobas" vira 450 kg no peso do animal; em outro campo de kg (ração), avisa que é em kg.
      const p = melhorPeso(t);
      if (p && 'kg' in p && (p.arrobas == null || pesoVivo)) {
        aoMudar(String(p.kg).replace('.', ','));
        if (p.arrobas != null) aviso(`${explicarArroba(p.arrobas, p.kg)}. Confira.`);
        return;
      }
      if (p) { aviso(AVISO_PESO_EM_KG, true); return; }
    }
    if (numero) {
      const n = melhorNumero(t);
      if (n == null) aviso(`Não entendi um número em "${t.split('|')[0]}". Tente de novo.`, true);
      else aoMudar(String(n).replace('.', ','));
      return;
    }
    const v = textoFalado(t, voz || 'texto');
    // Em caixa grande (observações) o que se fala é acrescentado; nos outros campos, substitui.
    aoMudar(multilinha && valor.trim() ? `${valor.trim()} ${v}` : v);
  };
  const tipoVoz: TipoVoz = numero ? (pesoVivo ? 'peso' : 'numero') : voz || 'texto';
  const rotulo = rotuloVoz ? `Falar ${rotuloVoz.toLowerCase()}` : 'Falar';
  return (
    <div className={`com-mic ${multilinha ? 'alto' : ''} ${className ?? ''}`}>
      {multilinha
        ? <textarea id={resto.id} name={resto.name} aria-label={resto['aria-label']} placeholder={resto.placeholder} value={valor} onChange={(e) => aoMudar(e.target.value)} />
        : <input type="text" autoComplete="off" {...(numero ? { inputMode: 'decimal' as const } : {})} {...resto} value={valor}
            onChange={(e) => aoMudar(numero ? e.target.value.replace(/[^\d.,-]/g, '') : e.target.value)} />}
      {unidade && <span className="unidade">{unidade}</span>}
      {voz !== false && <BotaoMic tipo={tipoVoz} rotulo={rotulo} aoOuvir={ouviu} />}
    </div>
  );
}

// ---------- Campo numérico com voz ----------
export function CampoNumero({ rotulo, valor, aoMudar, unidade, dica, nome, rotuloAcessivel, pesoVivo }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; unidade?: string; dica?: string; nome?: string; min?: number; passo?: string;
  /** Nome para leitor de tela quando o rótulo visível é genérico (ex.: "kg para Lote 5"). */
  rotuloAcessivel?: string;
  /** Peso do animal (por cabeça) em kg: aceita arroba falada e avisa quando o número digitado parece arroba. */
  pesoVivo?: boolean | 'total';
}) {
  const id = useId();
  const n = num(valor);
  // Por cabeça, menos de 40 kg quase sempre é arroba digitada (18 @ = 540 kg).
  const pareceArroba = pesoVivo === true && n != null && n > 0 && n < LIMITE_PARECE_ARROBA;
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <Entrada id={id} name={nome} aria-label={rotuloAcessivel} valor={valor} aoMudar={aoMudar} voz="numero" unidade={unidade} rotuloVoz={rotulo} pesoVivo={!!pesoVivo} />
      {pareceArroba && (
        <div className="alerta atencao" role="status" data-testid="pareceArroba" style={{ marginTop: 8, marginBottom: 0, flexWrap: 'wrap' }}>
          <span>O peso é em <b style={{ display: 'inline' }}>kg</b>, não em arroba. {n} kg é muito leve: se foram {n} arrobas, são {String(Math.round(n * KG_POR_ARROBA_VIVA * 100) / 100).replace('.', ',')} kg.</span>
          <button type="button" className="btn sec" onClick={() => aoMudar(String(Math.round(n * KG_POR_ARROBA_VIVA * 100) / 100).replace('.', ','))}>
            Era arroba: usar {String(Math.round(n * KG_POR_ARROBA_VIVA * 100) / 100).replace('.', ',')} kg
          </button>
        </div>
      )}
      {dica && <small>{dica}</small>}
    </div>
  );
}

/** Abaixo disso, o peso por cabeça digitado provavelmente está em arroba (bezerro ao nascer pesa uns 30 a 40 kg). */
export const LIMITE_PARECE_ARROBA = 40;

/** Converte o texto do campo ("320,5") em número. */
export function num(v: string): number | null {
  if (v == null || v.trim() === '') return null;
  const s = v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function CampoTexto({ rotulo, valor, aoMudar, dica, nome, tipo = 'text', voz = true, multilinha, formato, placeholder, maxLength, autoComplete, inputMode, aoEnter }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; dica?: ReactNode; nome?: string; tipo?: string;
  /** Deixe sempre ligado: todo campo de escrever tem microfone. */
  voz?: boolean;
  /** Caixa grande para observações (o que se fala é acrescentado ao texto). */
  multilinha?: boolean;
  /** Como ler a fala: texto livre, e-mail, código ou só números. */
  formato?: FormatoTexto;
  placeholder?: string; maxLength?: number; autoComplete?: string; inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']; aoEnter?: () => void;
}) {
  const id = useId();
  const f: FormatoTexto = formato ?? (tipo === 'email' ? 'email' : 'texto');
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <Entrada id={id} name={nome} type={tipo} valor={valor} aoMudar={aoMudar} voz={voz ? f : false} rotuloVoz={rotulo} multilinha={multilinha}
        placeholder={placeholder} maxLength={maxLength} autoComplete={autoComplete ?? 'off'} inputMode={inputMode}
        onKeyDown={aoEnter ? (e) => { if (e.key === 'Enter') aoEnter(); } : undefined} />
      {dica && <small>{dica}</small>}
    </div>
  );
}

/** Campo de data com microfone ("hoje", "ontem", "15 de março"). */
export function EntradaData({ valor, aoMudar, rotuloVoz = 'data', ...resto }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: string; aoMudar: (v: string) => void; rotuloVoz?: string;
}) {
  const aviso = useAviso();
  return (
    <div className="com-mic">
      <input type="date" {...resto} value={valor} onChange={(e) => aoMudar(e.target.value)} />
      <BotaoMic tipo="data" rotulo={`Falar ${rotuloVoz.toLowerCase()}`} aoOuvir={(t) => {
        const d = melhorData(t, hojeISO());
        if (d) aoMudar(d);
        else aviso(`Não entendi a data em "${t.split('|')[0]}". Fale “hoje”, “ontem” ou “15 de março”.`, true);
      }} />
    </div>
  );
}

export function CampoData({ rotulo, valor, aoMudar, nome, dica }: { rotulo: string; valor: string; aoMudar: (v: string) => void; nome?: string; dica?: ReactNode }) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <EntradaData id={id} name={nome} valor={valor} aoMudar={aoMudar} rotuloVoz={rotulo} />
      {dica && <small>{dica}</small>}
    </div>
  );
}

/** Lista de escolha (select) com microfone: fala o nome da opção e ela é escolhida. */
export function Escolha({ valor, aoMudar, children, rotuloVoz = 'opção', ...resto }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  valor: string | number; aoMudar: (v: string) => void; rotuloVoz?: string;
}) {
  const aviso = useAviso();
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <div className="com-mic">
      <select ref={ref} {...resto} value={valor} onChange={(e) => aoMudar(e.target.value)}>{children}</select>
      <BotaoMic tipo="escolha" rotulo={`Falar ${rotuloVoz.toLowerCase()}`} aoOuvir={(t) => {
        const opcoes = Array.from(ref.current?.options ?? []).filter((o) => !o.disabled).map((o) => ({ valor: o.value, texto: o.text }));
        const v = escolherOpcaoFalada(t, opcoes);
        if (v != null) aoMudar(v);
        else aviso(`Não achei "${t.split('|')[0]}" na lista. Fale de novo ou toque na lista para escolher.`, true);
      }} />
    </div>
  );
}

export function CampoEscolha({ rotulo, valor, aoMudar, nome, dica, children }: {
  rotulo: string; valor: string | number; aoMudar: (v: string) => void; nome?: string; dica?: ReactNode; children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <Escolha id={id} name={nome} valor={valor} aoMudar={aoMudar} rotuloVoz={rotulo}>{children}</Escolha>
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

/**
 * Campo de senha. É o único campo de escrever SEM microfone: falar a senha em voz alta deixa
 * quem está perto ouvir. Tem o botão "Ver" para conferir o que digitou.
 */
export function CampoSenha({ rotulo, valor, aoMudar, nome = 'senha', nova, dica, aoEnter }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; nome?: string;
  /** Senha nova (cadastro): o celular pode sugerir e guardar. */
  nova?: boolean; dica?: ReactNode; aoEnter?: () => void;
}) {
  const id = useId();
  const [ver, setVer] = useState(false);
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <div className="com-mic">
        <input id={id} name={nome} type={ver ? 'text' : 'password'} value={valor} onChange={(e) => aoMudar(e.target.value)}
          autoComplete={nova ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={72}
          onKeyDown={aoEnter ? (e) => { if (e.key === 'Enter') aoEnter(); } : undefined} />
        <button type="button" className="mic ver-senha" aria-pressed={ver} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'} onClick={() => setVer((v) => !v)}>
          {ver ? 'Esconder' : 'Ver'}
        </button>
      </div>
      {dica && <small>{dica}</small>}
    </div>
  );
}
