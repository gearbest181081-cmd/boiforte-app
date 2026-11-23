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
