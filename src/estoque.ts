// Estoque de insumos e misturas. Funções puras, testadas em estoque.test.ts.
import { diasEntre, somaDias } from './calc';

export type TipoMov = 'entrada' | 'saida' | 'ajuste';
export interface MovimentoBase { data: string; tipo: TipoMov; kg: number; valor?: number }

/** Saldo em kg. Entrada soma, saída subtrai, ajuste soma o valor com sinal (pode ser negativo). */
export function saldo(movs: MovimentoBase[]): number {
  return movs.reduce((s, m) => s + (m.tipo === 'entrada' ? m.kg : m.tipo === 'saida' ? -m.kg : m.kg), 0);
}

/** Preço médio ponderado depois de uma compra. */
export function precoMedioAposCompra(saldoAtual: number, precoAtual: number, kgCompra: number, precoCompra: number): number {
  const s = Math.max(0, saldoAtual);
  if (s + kgCompra <= 0) return precoCompra;
  return (s * precoAtual + kgCompra * precoCompra) / (s + kgCompra);
}

/** Consumo médio por dia (kg) considerando as saídas dos últimos `janela` dias até `hoje`. */
export function consumoMedioDia(movs: MovimentoBase[], hoje: string, janela = 14): number {
  const ini = somaDias(hoje, -janela + 1);
  const saidas = movs.filter((m) => m.tipo === 'saida' && m.data >= ini && m.data <= hoje);
  if (!saidas.length) return 0;
  const primeiro = saidas.reduce((a, m) => (m.data < a ? m.data : a), hoje);
  const dias = Math.max(1, Math.min(janela, diasEntre(primeiro, hoje) + 1));
  return saidas.reduce((s, m) => s + m.kg, 0) / dias;
}

export interface SituacaoEstoque {
  saldoKg: number;
  consumoDia: number;
  diasRestantes: number | null;
  acabaEm: string | null;
  nivel: 'ruim' | 'atencao' | 'bom' | 'parado';
  texto: string;
}

/**
 * Situação do estoque. `consumoPlanejado` (kg/dia) vem da escala de fornecimento
 * e é usado quando ainda não há histórico de saídas.
 */
export function situacao(movs: MovimentoBase[], hoje: string, diasAlerta = 7, consumoPlanejado = 0): SituacaoEstoque {
  const s = saldo(movs);
  const historico = consumoMedioDia(movs, hoje);
  const consumoDia = historico > 0 ? historico : consumoPlanejado;
  if (s <= 0.0001 && consumoDia > 0) return { saldoKg: s, consumoDia, diasRestantes: 0, acabaEm: hoje, nivel: 'ruim', texto: 'Acabou. Compre ou bata mais.' };
  if (s <= 0.0001) return { saldoKg: s, consumoDia, diasRestantes: null, acabaEm: null, nivel: 'parado', texto: 'Sem estoque.' };
  if (consumoDia <= 0) return { saldoKg: s, consumoDia, diasRestantes: null, acabaEm: null, nivel: 'parado', texto: 'Sem consumo registrado.' };
  const dias = s / consumoDia;
  const acabaEm = somaDias(hoje, Math.floor(dias));
  if (dias <= diasAlerta / 2) return { saldoKg: s, consumoDia, diasRestantes: dias, acabaEm, nivel: 'ruim', texto: `Acaba em ${Math.floor(dias)} dia(s).` };
  if (dias <= diasAlerta) return { saldoKg: s, consumoDia, diasRestantes: dias, acabaEm, nivel: 'atencao', texto: `Acaba em ${Math.floor(dias)} dias. Hora de repor.` };
  return { saldoKg: s, consumoDia, diasRestantes: dias, acabaEm, nivel: 'bom', texto: `Dá para ${Math.floor(dias)} dias.` };
}
