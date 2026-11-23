// Simulação ("E se...") e simulador de compra (mesmas fórmulas da aba SIMULADOR da planilha).
import { arrobas } from './calc';

export interface EntradaSimulador {
  pesoEntrada: number; // kg
  precoCompra: number; // R$/cab
  dias: number;
  precoArroba: number; // R$/@ de venda
  custoKgSuplemento: number; // R$/kg
  consumoPctPV: number; // fração (0,003 = 0,3%)
  gmd: number; // kg/dia
  rendimento: number; // fração
  maoObraMes: number; // R$/cab/mês
  outrosCab: number; // R$/cab no período
  oportunidadeMes: number; // fração ao mês
}

export interface ResultadoSimulador {
  pesoFinal: number; ganho: number; consumoDia: number; consumoTotal: number; custoSuplemento: number; custoMaoObra: number;
  custoOportunidade: number; custoTotal: number; arrobasCompra: number; arrobasVenda: number; arrobasProduzidas: number;
  custoArrobaProduzida: number | null; valorVenda: number; lucro: number; margemCusto: number; margemReceita: number; margemMes: number;
  agioPorArroba: number | null; agioPct: number | null; breakEvenVenda: number | null; breakEvenCompra: number;
}

export function simularCompra(e: EntradaSimulador): ResultadoSimulador {
  const pesoFinal = e.pesoEntrada + e.gmd * e.dias;
  const ganho = pesoFinal - e.pesoEntrada;
  const consumoDia = ((e.pesoEntrada + pesoFinal) / 2) * e.consumoPctPV;
  const consumoTotal = consumoDia * e.dias;
  const custoSuplemento = consumoTotal * e.custoKgSuplemento;
  const custoMaoObra = e.maoObraMes * (e.dias / 30);
  const meses = e.dias / 30;
  const custoOportunidade = (e.precoCompra + (custoSuplemento + custoMaoObra + e.outrosCab) / 2) * e.oportunidadeMes * meses;
  const custoTotal = e.precoCompra + custoSuplemento + custoMaoObra + e.outrosCab + custoOportunidade;
  const arrobasCompra = arrobas(e.pesoEntrada, e.rendimento);
  const arrobasVenda = arrobas(pesoFinal, e.rendimento);
  const arrobasProduzidas = arrobasVenda - arrobasCompra;
  const valorVenda = arrobasVenda * e.precoArroba;
  const lucro = valorVenda - custoTotal;
  const precoArrobaCompra = arrobasCompra > 0 ? e.precoCompra / arrobasCompra : null;
  // break-even de compra: preço máximo de compra com lucro zero (resolvido para a fórmula acima)
  const fatorOp = e.oportunidadeMes * meses;
  const operacional = custoSuplemento + custoMaoObra + e.outrosCab;
  const breakEvenCompra = (valorVenda - operacional - (operacional / 2) * fatorOp) / (1 + fatorOp);
  return {
    pesoFinal, ganho, consumoDia, consumoTotal, custoSuplemento, custoMaoObra, custoOportunidade, custoTotal,
    arrobasCompra, arrobasVenda, arrobasProduzidas,
    custoArrobaProduzida: arrobasProduzidas > 0 ? (custoTotal - e.precoCompra) / arrobasProduzidas : null,
    valorVenda, lucro,
    margemCusto: custoTotal ? lucro / custoTotal : 0,
    margemReceita: valorVenda ? lucro / valorVenda : 0,
    margemMes: custoTotal && e.dias ? lucro / custoTotal / meses : 0,
    agioPorArroba: precoArrobaCompra != null ? precoArrobaCompra - e.precoArroba : null,
    agioPct: precoArrobaCompra != null && e.precoArroba ? precoArrobaCompra / e.precoArroba - 1 : null,
    breakEvenVenda: arrobasVenda > 0 ? custoTotal / arrobasVenda : null,
    breakEvenCompra,
  };
}

/** E se o GMD mudar: quantos dias antecipa (ou atrasa) a saída e quanto economiza de custo diário. */
export function seMudarGmd(pesoAtual: number, pesoAlvo: number, gmdAtual: number, gmdNovo: number, custoDiaCab: number) {
  if (!(gmdAtual > 0) || !(gmdNovo > 0) || pesoAtual >= pesoAlvo) return null;
  const diasAtual = Math.ceil((pesoAlvo - pesoAtual) / gmdAtual);
  const diasNovo = Math.ceil((pesoAlvo - pesoAtual) / gmdNovo);
  return { diasAtual, diasNovo, antecipa: diasAtual - diasNovo, economiaCab: (diasAtual - diasNovo) * custoDiaCab };
}

/**
 * E se eu segurar o lote mais X dias com a @ travada: retorno por cabeça frente a vender hoje.
 * retorno = (peso futuro × rend ÷ 15 × @ travada) − (peso hoje × rend ÷ 15 × @ hoje) − custo diário × dias
 */
export function seSegurar(p: { pesoHoje: number; gmd: number; dias: number; rendimento: number; arrobaHoje: number; arrobaTravada: number; custoDiaCab: number }) {
  const pesoFuturo = p.pesoHoje + p.gmd * p.dias;
  const receitaHoje = arrobas(p.pesoHoje, p.rendimento) * p.arrobaHoje;
  const receitaFutura = arrobas(pesoFuturo, p.rendimento) * p.arrobaTravada;
  const custo = p.custoDiaCab * p.dias;
  return { pesoFuturo, arrobasGanhas: arrobas(pesoFuturo - p.pesoHoje, p.rendimento), receitaHoje, receitaFutura, custo, retornoCab: receitaFutura - receitaHoje - custo };
}
