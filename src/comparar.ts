// Comparação de produtos (suplementos, rações, núcleos) dentro da Simulação. Funções puras, testadas em comparar.test.ts.
import { calcularFormula, TIPOS, type IngredienteNut, type ResultadoFormula, type TipoFormula } from './nutricao';
import { avaliarNutrientes, type AvaliacaoNut, type ChaveNut } from './faixas';

/** ausentes: nutrientes que o rótulo não trouxe (ficam "sem dado", não contam como zero). */
export interface ProdutoComp { nome: string; tipo: TipoFormula; r: ResultadoFormula; consumoPctPV: number; ausentes?: ChaveNut[] }

/** O nutriente que mais pesa no preço de cada tipo: é por ele que medimos o custo-benefício. */
export const NUTRIENTE_CHAVE: Record<TipoFormula, { chave: 'pb' | 'ndt' | 'p'; nome: string }> = {
  sal_mineral: { chave: 'p', nome: 'fósforo' },
  proteinado: { chave: 'pb', nome: 'proteína' },
  proteico_energetico: { chave: 'pb', nome: 'proteína' },
  rip: { chave: 'pb', nome: 'proteína' },
  creep: { chave: 'pb', nome: 'proteína' },
  tip: { chave: 'ndt', nome: 'energia (NDT)' },
  confinamento: { chave: 'ndt', nome: 'energia (NDT)' },
  outro: { chave: 'pb', nome: 'proteína' },
};

export interface LinhaComp {
  nome: string; tipo: TipoFormula; custoKg: number; consumoPctPV: number;
  gDia: number; custoDia: number; custoMes: number;
  avaliacao: AvaliacaoNut[];
  ureiaAcima: boolean;
  criticos: number; atencao: number; pontos: number; // pontos: quanto menor, mais perto das faixas
  chave: { nome: string; valor: number; custoKg: number | null }; // R$ por kg do nutriente-chave entregue
}

export interface ResultadoComp {
  linhas: LinhaComp[];
  mesmoTipo: boolean;
  melhorTipo: number | null; // índice do produto mais adequado ao tipo
  melhorCusto: number | null; // índice do melhor custo-benefício
  criterioCusto: 'nutriente' | 'diaria';
}

export function compararProdutos(produtos: ProdutoComp[], pesoKg: number, cabecas: number): ResultadoComp {
  const linhas: LinhaComp[] = produtos.map((p) => {
    const ausentes = new Set<ChaveNut>(p.ausentes ?? []);
    if (ausentes.has('ca') || ausentes.has('p')) ausentes.add('caP');
    const avaliacao = avaliarNutrientes(p.tipo, p.r, p.consumoPctPV).map((a): AvaliacaoNut =>
      (ausentes.has(a.chave) ? { ...a, valor: null, status: 'sem_dado', critico: false, risco: undefined } : a));
    const max = TIPOS[p.tipo].ureiaMax;
    const ureiaAcima = max != null && p.r.ureiaPct > max;
    const criticos = avaliacao.filter((a) => a.critico).length + (ureiaAcima ? 1 : 0);
    const atencao = avaliacao.filter((a) => !a.critico && (a.status === 'abaixo' || a.status === 'acima' || a.status === 'incompleto')).length;
    const kgDia = pesoKg * p.consumoPctPV;
    const custoDia = kgDia * p.r.custoKg;
    const nc = NUTRIENTE_CHAVE[p.tipo];
    const valor = ausentes.has(nc.chave) ? 0 : p.r.mn[nc.chave]; // preço é na matéria natural, então o nutriente também
    return {
      nome: p.nome, tipo: p.tipo, custoKg: p.r.custoKg, consumoPctPV: p.consumoPctPV,
      gDia: kgDia * 1000, custoDia, custoMes: custoDia * 30 * Math.max(1, cabecas),
      avaliacao, ureiaAcima, criticos, atencao, pontos: criticos * 3 + atencao,
      chave: { nome: nc.nome, valor, custoKg: valor > 0 && p.r.custoKg > 0 ? p.r.custoKg / (valor / 100) : null },
    };
  });
  const mesmoTipo = new Set(linhas.map((l) => l.tipo)).size <= 1;
  if (linhas.length < 2) return { linhas, mesmoTipo, melhorTipo: null, melhorCusto: null, criterioCusto: 'nutriente' };

  // Mais adequado ao tipo: menos itens fora da faixa; empate = mais do nutriente-chave.
  let melhorTipo = 0;
  linhas.forEach((l, i) => {
    const m = linhas[melhorTipo];
    if (l.pontos < m.pontos || (l.pontos === m.pontos && l.chave.valor > m.chave.valor)) melhorTipo = i;
  });

  // Custo-benefício: R$ por kg do nutriente-chave, entre os que não têm problema crítico.
  // Tipos com nutriente-chave diferente: compara a diária por cabeça.
  const mesmaChave = new Set(linhas.map((l) => NUTRIENTE_CHAVE[l.tipo].chave)).size === 1;
  const criterioCusto = mesmaChave ? 'nutriente' : 'diaria';
  const seguros = linhas.map((l, i) => ({ l, i })).filter(({ l }) => l.criticos === 0);
  const candidatos = (seguros.length ? seguros : linhas.map((l, i) => ({ l, i })))
    .filter(({ l }) => (criterioCusto === 'nutriente' ? l.chave.custoKg != null : l.custoDia > 0));
  let melhorCusto: number | null = null;
  for (const { l, i } of candidatos) {
    const v = criterioCusto === 'nutriente' ? l.chave.custoKg! : l.custoDia;
    const atual = melhorCusto == null ? Infinity : criterioCusto === 'nutriente' ? linhas[melhorCusto].chave.custoKg! : linhas[melhorCusto].custoDia;
    if (v < atual) melhorCusto = i;
  }
  return { linhas, mesmoTipo, melhorTipo, melhorCusto, criterioCusto };
}

/** Produto digitado ou lido da foto vira uma "fórmula" de um ingrediente só (100%). */
export function produtoAvulso(nome: string, tipo: TipoFormula, consumoPctPV: number, ing: Omit<IngredienteNut, 'id' | 'nome'>, ausentes?: ChaveNut[]): ProdutoComp {
  return { nome, tipo, consumoPctPV, ausentes, r: calcularFormula([{ ingredienteId: 1, qtd: 100 }], [{ ...ing, id: 1, nome }]) };
}
