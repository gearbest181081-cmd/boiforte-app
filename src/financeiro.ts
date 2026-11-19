// Financeiro do BoiForte: custo de compra, venda, rateio, DRE por lote e da fazenda, fluxo de caixa.
// Funções puras, testadas em financeiro.test.ts. As fórmulas de compra, venda e custo de
// oportunidade seguem a planilha de recria/TIP do Luiz.
import { arrobas, diaNum, diasEntre, pesoEstimado, somaDias, type PontoPeso } from './calc';

export const CATEGORIAS_DESPESA = {
  compra_animais: 'Compra de animais',
  pasto: 'Pasto / arrendamento',
  sanidade: 'Sanidade',
  mao_obra: 'Mão de obra',
  frete: 'Frete',
  impostos: 'Impostos, GTA e taxas',
  manutencao: 'Manutenção e cercas',
  combustivel: 'Combustível e energia',
  outros: 'Outros',
} as const;
export const CATEGORIAS_RECEITA = { venda_animais: 'Venda de animais', outras_receitas: 'Outras receitas' } as const;
export type CategoriaDespesa = keyof typeof CATEGORIAS_DESPESA;
export type CategoriaReceita = keyof typeof CATEGORIAS_RECEITA;
export type Categoria = CategoriaDespesa | CategoriaReceita;
export const NOMES_CATEGORIA: Record<string, string> = { ...CATEGORIAS_DESPESA, ...CATEGORIAS_RECEITA, nutricao: 'Nutrição (trato)', fixos: 'Custos fixos rateados', oportunidade: 'Custo de oportunidade' };

export interface LancamentoFin { data: string; tipo: 'despesa' | 'receita'; categoria: Categoria; valor: number; loteId?: number | null }
export interface CustoFixoFin { nome: string; valorMensal: number; desde: string; ate?: string | null }
export interface VendaFin { loteId: number; data: string; tipo: 'venda' | 'morte'; cabecas: number; pesoMedio?: number; valorLiquido: number }
export interface FornecimentoFin { loteId: number; data: string; custo: number }
export interface LoteFin { id: number; nome: string; dataEntrada: string; qtdCabecas: number; encerrado?: boolean; dataSaida?: string | null }

// ---------- Compra e venda (fórmulas da planilha) ----------

/** Custo de compra = qtd × preço × (1 + comissão) + frete + NF/GTA. */
export function custoCompra(qtd: number, precoCab: number, comissaoPct: number, frete: number, nfGta: number): number {
  return qtd * precoCab * (1 + comissaoPct) + frete + nfGta;
}

export interface CalculoVenda { arrobasCab: number; brutoCab: number; bruto: number; comissao: number; liquido: number; liquidoCab: number }
/**
 * Venda: por arroba (peso × rendimento ÷ 15 × preço da @) ou por cabeça.
 * Líquido = bruto − frete − comissão (comissão sobre o bruto).
 */
export function calcularVenda(p: { cabecas: number; pesoMedio: number; rendimento: number; modo: 'arroba' | 'cabeca'; preco: number; comissaoPct: number; frete: number; outros?: number }): CalculoVenda {
  const arrobasCab = arrobas(p.pesoMedio, p.rendimento);
  const brutoCab = p.modo === 'arroba' ? arrobasCab * p.preco : p.preco;
  const bruto = brutoCab * p.cabecas;
  const comissao = bruto * p.comissaoPct;
  const liquido = bruto - comissao - p.frete - (p.outros ?? 0);
  return { arrobasCab, brutoCab, bruto, comissao, liquido, liquidoCab: p.cabecas ? liquido / p.cabecas : 0 };
}

// ---------- Cabeças por dia e rateio ----------

/** Cabeças presentes no lote num dia (saídas contam a partir do dia seguinte à data). */
export function cabecasNoDia(lote: LoteFin, saidas: VendaFin[], dia: string): number {
  if (dia < lote.dataEntrada) return 0;
  if (lote.dataSaida && dia > lote.dataSaida) return 0;
  const depois = saidas.filter((s) => s.loteId === lote.id && s.data >= dia).reduce((t, s) => t + s.cabecas, 0);
  return lote.qtdCabecas + depois;
}

export function cabecaDias(lote: LoteFin, saidas: VendaFin[], de: string, ate: string): number {
  let t = 0;
  for (let d = de; d <= ate; d = somaDias(d, 1)) t += cabecasNoDia(lote, saidas, d);
  return t;
}

function fimDoMes(d: string): string {
  const [a, m] = d.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
function inicioDoMes(d: string): string { return d.slice(0, 8) + '01'; }

/**
 * Rateia custos indiretos entre os lotes:
 * - lançamento sem lote: dividido pelas cabeça-dias de cada lote no mês do lançamento;
 * - custo fixo mensal: cada dia vale valorMensal × 12 ÷ 365, dividido pelas cabeças do dia.
 * Retorna R$ por lote até a data `ate`.
 */
export function ratear(lotes: LoteFin[], saidas: VendaFin[], lancamentos: LancamentoFin[], fixos: CustoFixoFin[], ate: string): Map<number, number> {
  const out = new Map<number, number>(lotes.map((l) => [l.id, 0]));
  if (!lotes.length) return out;
  const inicio = lotes.reduce((m, l) => (l.dataEntrada < m ? l.dataEntrada : m), ate);
  // cabeças por dia por lote (cache)
  const cab = new Map<string, number[]>();
  const diaCab = (d: string) => {
    let v = cab.get(d);
    if (!v) { v = lotes.map((l) => cabecasNoDia(l, saidas, d)); cab.set(d, v); }
    return v;
  };
  for (const l of lancamentos) {
    if (l.tipo !== 'despesa' || l.loteId || l.data > ate) continue;
    const ini = inicioDoMes(l.data), fim = fimDoMes(l.data);
    const pesos = lotes.map(() => 0);
    for (let d = ini; d <= fim; d = somaDias(d, 1)) diaCab(d).forEach((c, i) => { pesos[i] += c; });
    const total = pesos.reduce((a, b) => a + b, 0);
    if (!total) continue;
    lotes.forEach((lt, i) => out.set(lt.id, out.get(lt.id)! + (l.valor * pesos[i]) / total));
  }
  for (const f of fixos) {
    const de = f.desde > inicio ? f.desde : inicio;
    const fim = f.ate && f.ate < ate ? f.ate : ate;
    const porDia = (f.valorMensal * 12) / 365;
    for (let d = de; d <= fim; d = somaDias(d, 1)) {
      const c = diaCab(d);
      const total = c.reduce((a, b) => a + b, 0);
      if (!total) continue;
      lotes.forEach((lt, i) => { if (c[i]) out.set(lt.id, out.get(lt.id)! + (porDia * c[i]) / total); });
    }
  }
  return out;
}

// ---------- DRE por lote ----------

export interface DreLote {
  ate: string;
  dias: number;
  cabecasEntrada: number;
  cabecasAtuais: number;
  receitas: number; // vendas líquidas
  valorRebanho: number; // cabeças atuais × @ estimadas × preço da @
  custos: Record<string, number>; // por categoria
  custoTotal: number; // sem oportunidade
  oportunidade: number;
  resultado: number; // receitas + valor do rebanho − custos − oportunidade
  margemCusto: number | null;
  arrobasProduzidas: number;
  custoArrobaProduzida: number | null; // (custo total − compra) ÷ @ produzidas
  custoCabeca: number | null;
  pesoEntrada: number | null;
  pesoAtual: number | null;
}

export function dreLote(p: {
  lote: LoteFin; pontos: PontoPeso[]; gmdMeta?: number | null; saidas: VendaFin[]; lancamentos: LancamentoFin[];
  fornecimentos: FornecimentoFin[]; rateio: number; precoArroba: number; rendimento: number; taxaOportunidadeMes: number; ate: string;
}): DreLote {
  const { lote, ate } = p;
  const fimLote = lote.dataSaida && lote.dataSaida < ate ? lote.dataSaida : ate;
  const dias = Math.max(0, diasEntre(lote.dataEntrada, fimLote));
  const minhas = p.saidas.filter((s) => s.loteId === lote.id);
  const cabecasEntrada = lote.qtdCabecas + minhas.reduce((t, s) => t + s.cabecas, 0);
  const saidasAte = minhas.filter((s) => s.data <= ate);
  const cabecasAtuais = cabecasEntrada - saidasAte.reduce((t, s) => t + s.cabecas, 0);
  const custos: Record<string, number> = {};
  let receitas = saidasAte.reduce((t, s) => t + s.valorLiquido, 0);
  for (const l of p.lancamentos) {
    if (l.loteId !== lote.id || l.data > ate) continue;
    if (l.tipo === 'receita') { if (l.categoria !== 'venda_animais') receitas += l.valor; continue; }
    custos[l.categoria] = (custos[l.categoria] ?? 0) + l.valor;
  }
  const nutricao = p.fornecimentos.filter((f) => f.loteId === lote.id && f.data <= ate).reduce((t, f) => t + f.custo, 0);
  if (nutricao) custos.nutricao = nutricao;
  if (p.rateio) custos.fixos = p.rateio;
  const custoTotal = Object.values(custos).reduce((a, b) => a + b, 0);
  const compra = custos.compra_animais ?? 0;
  // planilha: oportunidade sobre o capital médio (compra + metade dos demais custos) × meses
  const oportunidade = (compra + (custoTotal - compra) / 2) * p.taxaOportunidadeMes * (dias / 30);
  const pesoEntrada = p.pontos.length ? p.pontos[0].peso : null;
  const pesoAtual = pesoEstimado(p.pontos, fimLote, p.gmdMeta);
  const valorRebanho = cabecasAtuais > 0 && pesoAtual ? cabecasAtuais * arrobas(pesoAtual, p.rendimento) * p.precoArroba : 0;
  // @ produzidas: ganho dos que ficaram + ganho dos vendidos (pelo peso de saída, se informado)
  let arrobasProduzidas = 0;
  if (pesoEntrada != null) {
    if (pesoAtual) arrobasProduzidas += cabecasAtuais * arrobas(pesoAtual - pesoEntrada, p.rendimento);
    for (const s of saidasAte) if (s.tipo === 'venda' && s.pesoMedio) arrobasProduzidas += s.cabecas * arrobas(s.pesoMedio - pesoEntrada, p.rendimento);
  }
  const resultado = receitas + valorRebanho - custoTotal - oportunidade;
  return {
    ate: fimLote, dias, cabecasEntrada, cabecasAtuais, receitas, valorRebanho, custos, custoTotal, oportunidade, resultado,
    margemCusto: custoTotal + oportunidade > 0 ? resultado / (custoTotal + oportunidade) : null,
    arrobasProduzidas,
    custoArrobaProduzida: arrobasProduzidas > 0 ? (custoTotal - compra) / arrobasProduzidas : null,
    custoCabeca: cabecasEntrada ? (custoTotal + oportunidade) / cabecasEntrada : null,
    pesoEntrada, pesoAtual,
  };
}

// ---------- DRE da fazenda (por período / ciclo) e fluxo de caixa ----------

export interface DrePeriodo { receitas: Record<string, number>; despesas: Record<string, number>; totalReceitas: number; totalDespesas: number; resultado: number }

/** Regime de competência: nutrição pelo que foi fornecido, fixos pelo dia, demais pela data do lançamento. */
export function drePeriodo(de: string, ate: string, lancamentos: LancamentoFin[], vendas: VendaFin[], fornecimentos: FornecimentoFin[], fixos: CustoFixoFin[]): DrePeriodo {
  const receitas: Record<string, number> = {}, despesas: Record<string, number> = {};
  for (const v of vendas) if (v.data >= de && v.data <= ate && v.valorLiquido) receitas.venda_animais = (receitas.venda_animais ?? 0) + v.valorLiquido;
  for (const l of lancamentos) {
    if (l.data < de || l.data > ate) continue;
    const alvo = l.tipo === 'receita' ? receitas : despesas;
    alvo[l.categoria] = (alvo[l.categoria] ?? 0) + l.valor;
  }
  const nut = fornecimentos.filter((f) => f.data >= de && f.data <= ate).reduce((t, f) => t + f.custo, 0);
  if (nut) despesas.nutricao = nut;
  let fx = 0;
  for (const f of fixos) {
    const a = f.desde > de ? f.desde : de, b = f.ate && f.ate < ate ? f.ate : ate;
    if (b >= a) fx += ((f.valorMensal * 12) / 365) * (diasEntre(a, b) + 1);
  }
  if (fx) despesas.fixos = fx;
  const totalReceitas = Object.values(receitas).reduce((a, b) => a + b, 0);
  const totalDespesas = Object.values(despesas).reduce((a, b) => a + b, 0);
  return { receitas, despesas, totalReceitas, totalDespesas, resultado: totalReceitas - totalDespesas };
}

export interface MesCaixa { mes: string; entradas: number; saidas: number; saldo: number; acumulado: number }

/** Fluxo de caixa mensal: dinheiro que entrou e saiu (compras de insumo entram pela data da compra). */
export function fluxoCaixa(de: string, ate: string, lancamentos: LancamentoFin[], vendas: VendaFin[], comprasInsumo: { data: string; valor: number }[], fixos: CustoFixoFin[]): MesCaixa[] {
  const meses: MesCaixa[] = [];
  let acumulado = 0;
  for (let m = inicioDoMes(de); m <= ate; m = somaDias(fimDoMes(m), 1)) {
    const fim = fimDoMes(m);
    const dentro = (d: string) => d >= m && d <= fim && d >= de && d <= ate;
    let entradas = 0, saidas = 0;
    for (const v of vendas) if (dentro(v.data)) entradas += v.valorLiquido;
    for (const l of lancamentos) if (dentro(l.data)) { if (l.tipo === 'receita') entradas += l.valor; else saidas += l.valor; }
    for (const c of comprasInsumo) if (dentro(c.data)) saidas += c.valor;
    for (const f of fixos) if (f.desde <= fim && (!f.ate || f.ate >= m)) saidas += f.valorMensal;
    acumulado += entradas - saidas;
    meses.push({ mes: m.slice(0, 7), entradas, saidas, saldo: entradas - saidas, acumulado });
  }
  return meses;
}

/** Variação do custo da @ produzida entre dois momentos (para o alerta "subiu 5% este mês"). */
export function variacao(antes: number | null, depois: number | null): number | null {
  if (antes == null || depois == null || antes <= 0) return null;
  return (depois - antes) / antes;
}

export const mesNome = (ym: string) => {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [a, m] = ym.split('-');
  return `${nomes[Number(m) - 1]}/${a.slice(2)}`;
};

export { diaNum };
