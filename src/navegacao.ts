// Para onde o botão "Voltar" leva quando o app foi aberto direto numa tela (sem tela anterior no histórico).

const ABAS = new Set(['lotes', 'pesar', 'trato', 'mais']);

/** A tela "de cima" de um endereço: /lotes/5/editar → /lotes/5, /nutricao/formula/3 → /nutricao, /estoque → /mais. */
export function telaDeCima(caminho: string): string {
  const p = caminho.split('/').filter(Boolean);
  if (!p.length) return '/';
  if (p[0] === 'lotes') return p.length >= 3 ? `/lotes/${p[1]}` : p.length === 2 ? '/lotes' : '/';
  if (p[0] === 'pesar') return p[1] ? `/lotes/${p[1]}` : '/';
  if (p.length > 1) return `/${p[0]}`;
  return ABAS.has(p[0]) ? '/' : '/mais';
}

// ---------- Para onde cada aviso do Início leva ----------
import type { Alerta } from './alertas';
import type { ResumoModulo } from './pasto';

/**
 * Tela onde a pessoa resolve o aviso: o próprio aviso pode dizer (para), o de estoque vai para o Estoque
 * e os do pasto vão para o piquete (ou para o Pasto, quando o aviso é do módulo todo).
 */
export function paraDoAviso(a: Alerta, pasto: ResumoModulo[] = []): string | undefined {
  if (a.para) return a.para;
  if (a.titulo.startsWith('Estoque:')) return '/estoque';
  for (const r of pasto) {
    const e = r.estados.find((x) => x.alertas.includes(a));
    if (e) return `/pasto/piquete/${e.piquete.id}`;
    for (const [piqueteId, an] of r.ndvi) if (an.alertas.includes(a)) return `/pasto/piquete/${piqueteId}`;
    if (r.alertas.includes(a)) return '/pasto';
  }
  return undefined;
}
