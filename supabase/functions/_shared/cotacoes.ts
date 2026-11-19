// Coleta das cotações. Sem dependências (roda no Deno da função e nos testes do app).
// As fontes podem ser trocadas sem mexer no código (variável FONTES_COTACOES, em JSON).
// Tudo que chega passa ainda pela faixa plausível do banco (bf_cotacao_plausivel).

export interface Fonte { produto: string; praca: string; unidade: string; url: string; fonte: string }
export interface CotacaoLida { produto: string; praca: string; unidade: string; fonte: string; data: string; valor: number }

export const FONTES_PADRAO: Fonte[] = [
  { produto: 'boi_gordo', praca: 'São Paulo', unidade: 'R$/@', url: 'https://www.cepea.org.br/br/indicador/boi-gordo.aspx', fonte: 'Cepea/Esalq' },
  { produto: 'bezerro', praca: 'Mato Grosso do Sul', unidade: 'R$/cab', url: 'https://www.cepea.org.br/br/indicador/bezerro.aspx', fonte: 'Cepea/Esalq' },
  { produto: 'milho', praca: 'Campinas', unidade: 'R$/sc60', url: 'https://www.cepea.org.br/br/indicador/milho.aspx', fonte: 'Cepea/Esalq' },
  { produto: 'soja', praca: 'Paranaguá', unidade: 'R$/sc60', url: 'https://www.cepea.org.br/br/indicador/soja.aspx', fonte: 'Cepea/Esalq' },
];

export function lerFontes(json: string | undefined): Fonte[] {
  if (!json) return FONTES_PADRAO;
  const l = JSON.parse(json) as Fonte[];
  if (!Array.isArray(l)) throw new Error('FONTES_COTACOES precisa ser uma lista.');
  return l.filter((f) => f && typeof f.url === 'string' && /^https:\/\//.test(f.url)).slice(0, 30);
}

const numeroBr = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/**
 * Acha a linha mais recente de uma tabela de indicador: uma data dd/mm/aaaa seguida de um valor
 * "1.234,56" na célula seguinte. Funciona com o HTML das páginas de indicador (tabela Data | Valor).
 */
export function lerTabelaIndicador(html: string): { data: string; valor: number } | null {
  const texto = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, '|').replace(/&nbsp;/g, ' ');
  const re = /(\d{2})\/(\d{2})\/(\d{4})\s*(?:\|\s*)+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+,\d{1,4})/g;
  let melhor: { data: string; valor: number } | null = null;
  for (const m of texto.matchAll(re)) {
    const data = `${m[3]}-${m[2]}-${m[1]}`;
    const valor = numeroBr(m[4]);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    if (!melhor || data > melhor.data) melhor = { data, valor };
  }
  return melhor;
}
