// Quem está usando o app neste celular. A tela de entrada usa isto para abrir ou não o app.
// Lembrete: isto é só a porta da TELA. Quem protege os dados da nuvem é o servidor (ver SEGURANCA.md).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { contaGuardada, nuvemConfigurada, sb, tenhoSenha, type Conta } from './cliente';

const CHAVE_DONO = 'boiforte-conta-do-celular';
const CHAVE_NOVA_SENHA = 'boiforte-cadastrar-senha';
const CHAVE_TEM_SENHA = 'boiforte-tem-senha';

// Link de "esqueci a senha": o endereço chega com #...type=recovery. Lido antes de a biblioteca limpar o endereço.
// Fica guardado até a senha nova ser cadastrada (ou a pessoa sair), para não perder se o app recarregar.
try {
  if (/(^|[#&?])type=recovery(&|$)/.test(location.hash)) localStorage.setItem(CHAVE_NOVA_SENHA, '1');
} catch { /* sem armazenamento */ }

function lerTemSenha(id: string | undefined): boolean | null {
  if (!id) return null;
  try { return localStorage.getItem(CHAVE_TEM_SENHA) === id ? true : null; } catch { return null; }
}

interface Sessao {
  /** Pede tela de entrada? (só quando o app está ligado a um servidor) */
  exigeEntrada: boolean;
  conta: Conta | null;
  /** Falta cadastrar a senha (primeiro acesso pelo link) ou trocar (link de "esqueci a senha"). */
  precisaSenha: 'criar' | 'trocar' | null;
  senhaCadastrada: () => void;
}

const Ctx = createContext<Sessao>({ exigeEntrada: false, conta: null, precisaSenha: null, senhaCadastrada: () => {} });
export const useSessao = () => useContext(Ctx);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const exigeEntrada = nuvemConfigurada();
  // Lido na hora, do próprio celular: abre direto, sem piscar a tela de entrada e sem precisar de internet.
  const [conta, setConta] = useState<Conta | null>(contaGuardada);
  const [trocar, setTrocar] = useState(() => { try { return localStorage.getItem(CHAVE_NOVA_SENHA) === '1'; } catch { return false; } });
  const marcarTrocar = (sim: boolean) => {
    try { if (sim) localStorage.setItem(CHAVE_NOVA_SENHA, '1'); else localStorage.removeItem(CHAVE_NOVA_SENHA); } catch { /* sem armazenamento */ }
    setTrocar(sim);
  };
  useEffect(() => {
    if (!exigeEntrada) return;
    let fim = false;
    let cancelar: (() => void) | undefined;
    sb().then((c) => {
      if (fim) return;
      const { data } = c.auth.onAuthStateChange((evento, s) => {
        if (evento === 'PASSWORD_RECOVERY') marcarTrocar(true);
        if (evento === 'SIGNED_OUT') marcarTrocar(false);
        // Sem sessão válida mas ainda guardada (sem internet, entrada vencida): continua aberto.
        const nova = s?.user ? { id: s.user.id, email: s.user.email ?? '' } : contaGuardada();
        setConta((atual) => (atual?.id === nova?.id && atual?.email === nova?.email ? atual : nova));
      });
      cancelar = () => data.subscription.unsubscribe();
    }).catch(() => { /* sem a biblioteca (primeira vez sem internet): fica o que está guardado */ });
    return () => { fim = true; cancelar?.(); };
  }, [exigeEntrada]);
  // Já tem senha? Guardado no celular depois que o servidor confirma; sem internet, não trava a entrada.
  const [temSenha, setTemSenha] = useState<boolean | null>(() => lerTemSenha(conta?.id));
  useEffect(() => {
    const id = conta?.id;
    setTemSenha(lerTemSenha(id));
    if (!exigeEntrada || !id || lerTemSenha(id)) return;
    let fim = false;
    tenhoSenha().then((t) => {
      if (fim) return;
      setTemSenha(t);
      try { if (t) localStorage.setItem(CHAVE_TEM_SENHA, id); } catch { /* sem armazenamento */ }
    }).catch(() => { /* sem internet: pergunta de novo na próxima vez */ });
    return () => { fim = true; };
  }, [exigeEntrada, conta?.id]);
  const senhaCadastrada = () => {
    marcarTrocar(false);
    try { if (conta) localStorage.setItem(CHAVE_TEM_SENHA, conta.id); } catch { /* sem armazenamento */ }
    setTemSenha(true);
  };
  const precisaSenha = !exigeEntrada || !conta ? null : trocar ? 'trocar' : temSenha === false ? 'criar' : null;
  return <Ctx.Provider value={{ exigeEntrada, conta, precisaSenha, senhaCadastrada }}>{children}</Ctx.Provider>;
}

// ---------- de quem são os dados deste celular ----------
// Se outra pessoa entrar neste celular, ela não pode ver os dados de quem usava antes.

export function donoDoCelular(): Conta | null {
  try { return JSON.parse(localStorage.getItem(CHAVE_DONO) ?? 'null'); } catch { return null; }
}
export function marcarDono(c: Conta | null) {
  try { if (c) localStorage.setItem(CHAVE_DONO, JSON.stringify(c)); else localStorage.removeItem(CHAVE_DONO); } catch { /* sem armazenamento */ }
}

/** Nome para mostrar: o que a pessoa escreveu para a equipe, senão o começo do e-mail. */
export function nomeParaMostrar(c: Conta): string {
  let n = '';
  try { n = localStorage.getItem('boiforte-meu-nome')?.trim() ?? ''; } catch { /* sem armazenamento */ }
  return n || c.email.split('@')[0] || 'Você';
}
