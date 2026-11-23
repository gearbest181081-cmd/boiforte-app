import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { armazemNuvem, nuvemConfigurada, transporteNuvem, usuarioAtual } from './cliente';
import { fazendaLigada, sincronizar, type FazendaNuvem } from './sinc';
import { limparFotosAntigas, sincronizarFotos } from '../anotacoes';

export interface EstadoNuvem {
  fazenda?: FazendaNuvem; ultima?: number; pendentes: number; erros: { tabela: string; erro: string }[]; falha?: string; rodando: boolean;
  /** fotos de anotações esperando para subir */
  fotosPendentes: number;
}

export function useEstadoNuvem(): EstadoNuvem | undefined {
  return useLiveQuery(async () => {
    const [f, u, falha, rodando, pend, fotos] = await Promise.all([
      db.sincEstado.get('fazenda'), db.sincEstado.get('ultima'), db.sincEstado.get('falha'), db.sincEstado.get('rodando'), db.pendentes.toArray(),
      db.fotosAnotacao.where('estado').anyOf('enviar', 'apagar').count(),
    ]);
    return {
      fazenda: f?.valor as FazendaNuvem | undefined,
      ultima: u?.valor as number | undefined,
      falha: falha?.valor as string | undefined,
      rodando: !!rodando?.valor,
      pendentes: pend.filter((p) => !p.erro).length,
      erros: pend.filter((p) => p.erro).map((p) => ({ tabela: p.tabela, erro: p.erro! })),
      fotosPendentes: fotos,
    };
  });
}

/** Roda uma sincronização e guarda o resultado para a tela mostrar. */
export async function sincronizarAgora() {
  if (!nuvemConfigurada() || !(await usuarioAtual())) return null;
  await db.sincEstado.put({ chave: 'rodando', valor: true });
  try {
    const r = await sincronizar(transporteNuvem);
    await db.sincEstado.delete('falha');
    // Fotos das anotações: depois dos registros. Falha aqui não atrapalha o resto (tenta na próxima).
    const f = await fazendaLigada();
    if (f) {
      try { await sincronizarFotos(armazemNuvem, f.id, f.papel !== 'consultor'); await limparFotosAntigas(); } catch { /* próxima rodada */ }
    }
    return r;
  } catch (e) {
    await db.sincEstado.put({ chave: 'falha', valor: (e as Error).message });
    throw e;
  } finally {
    await db.sincEstado.put({ chave: 'rodando', valor: false });
  }
}

/** Sincroniza sozinho: ao abrir, quando volta a internet, a cada 2 minutos e pouco depois de cada mudança. */
export function SincAutomatica() {
  const est = useEstadoNuvem();
  const timer = useRef<number>();
  const ligada = !!est?.fazenda;
  useEffect(() => {
    if (!ligada || !nuvemConfigurada()) return;
    const vai = () => { if (navigator.onLine) sincronizarAgora().catch(() => {}); };
    vai();
    const i = window.setInterval(vai, 120_000);
    window.addEventListener('online', vai);
    return () => { window.clearInterval(i); window.removeEventListener('online', vai); };
  }, [ligada]);
  useEffect(() => {
    if (!ligada || !(est?.pendentes || est?.fotosPendentes) || !nuvemConfigurada()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (navigator.onLine) sincronizarAgora().catch(() => {}); }, 8000);
    return () => window.clearTimeout(timer.current);
  }, [ligada, est?.pendentes, est?.fotosPendentes]);
  return null;
}

/** Papel deste celular na fazenda da nuvem (vazio = sem nuvem, dono de tudo). */
export function usePapel() {
  return useLiveQuery(async () => ((await db.sincEstado.get('fazenda'))?.valor as FazendaNuvem | undefined)?.papel ?? null);
}

/** O vaqueiro não vê dinheiro. O servidor já manda os preços zerados para ele; aqui só some da tela. */
export function useVeDinheiro() {
  return usePapel() !== 'vaqueiro';
}
