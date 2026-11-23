// Quem está usando o app neste celular. A tela de entrada usa isto para abrir ou não o app.
// Lembrete: isto é só a porta da TELA. Quem protege os dados da nuvem é o servidor (ver SEGURANCA.md).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { contaGuardada, nuvemConfigurada, sb, type Conta } from './cliente';

const CHAVE_DONO = 'boiforte-conta-do-celular';

interface Sessao {
  /** Pede tela de entrada? (só quando o app está ligado a um servidor) */
  exigeEntrada: boolean;
  conta: Conta | null;
}

const Ctx = createContext<Sessao>({ exigeEntrada: false, conta: null });
export const useSessao = () => useContext(Ctx);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const exigeEntrada = nuvemConfigurada();
  // Lido na hora, do próprio celular: abre direto, sem piscar a tela de entrada e sem precisar de internet.
  const [conta, setConta] = useState<Conta | null>(contaGuardada);
  useEffect(() => {
    if (!exigeEntrada) return;
    let fim = false;
    let cancelar: (() => void) | undefined;
    sb().then((c) => {
      if (fim) return;
      const { data } = c.auth.onAuthStateChange((_evento, s) => {
        // Sem sessão válida mas ainda guardada (sem internet, entrada vencida): continua aberto.
        const nova = s?.user ? { id: s.user.id, email: s.user.email ?? '' } : contaGuardada();
        setConta((atual) => (atual?.id === nova?.id && atual?.email === nova?.email ? atual : nova));
      });
      cancelar = () => data.subscription.unsubscribe();
    }).catch(() => { /* sem a biblioteca (primeira vez sem internet): fica o que está guardado */ });
    return () => { fim = true; cancelar?.(); };
  }, [exigeEntrada]);
  return <Ctx.Provider value={{ exigeEntrada, conta }}>{children}</Ctx.Provider>;
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
