import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ajusteDoMenu, atalhosDoInicio, escolhaValida, ESCOLHER_LOTE, itensVisiveis, ITENS_MENU, procurarNoMenu, SECOES, type Escolha,
} from './menu';

// Rotas do App.tsx e cartões de ajuste do Menu, lidos do código para o teste acompanhar as telas novas.
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const rotas = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((r) => r !== '*');
const telaMenu = readFileSync(new URL('./pages/Mais.tsx', import.meta.url), 'utf8');
const caminho = (para: string) => para.split('?')[0];
const existeRota = (c: string) => rotas.some((r) => new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`).test(c));
const ids = (l: { id: string }[]) => l.map((i) => i.id);

describe('Menu: toda função tem caminho', () => {
  it('leu as rotas do App', () => expect(rotas).toContain('/lotes/:id'));

  it('toda tela principal do App aparece no Menu', () => {
    // telas de primeiro nível (/estoque, /pasto…). O Início e o próprio Menu (/mais) ficam de fora.
    const principais = rotas.filter((r) => /^\/[^/:]+$/.test(r) && r !== '/mais');
    const noMenu = new Set(ITENS_MENU.map((i) => caminho(i.para)));
    const faltando = principais.filter((r) => !noMenu.has(r));
    expect(faltando, 'acrescente estas telas em src/menu.ts').toEqual([]);
  });

  it('todo item do Menu leva a uma tela que existe', () => {
    for (const i of ITENS_MENU) expect(existeRota(caminho(i.para)), `${i.id}: ${i.para}`).toBe(true);
  });

  it('os ajustes (/mais?ver=…) têm o cartão com o id certo na tela do Menu', () => {
    const ajustes = ITENS_MENU.map((i) => ajusteDoMenu(i.para)).filter((a): a is string => !!a);
    expect(ajustes.length).toBeGreaterThan(3);
    for (const a of ajustes) expect(telaMenu, `falta id="aj-${a}" em Mais.tsx`).toContain(`id="aj-${a}"`);
  });

  it('ajusteDoMenu só reconhece /mais?ver=…', () => {
    expect(ajusteDoMenu('/mais?ver=mercado')).toBe('mercado');
    expect(ajusteDoMenu('/mais')).toBeNull();
    expect(ajusteDoMenu('/financeiro?aba=fixos')).toBeNull();
  });

  it('ids únicos, todo item com ícone, explicação e palavras, e todo assunto com itens', () => {
    expect(new Set(ids(ITENS_MENU)).size).toBe(ITENS_MENU.length);
    for (const i of ITENS_MENU) {
      expect(i.icone && i.titulo && i.descricao && i.palavras.trim(), i.id).toBeTruthy();
      expect(i.palavras, `${i.id}: palavras de busca vão sem acento`).toBe(i.palavras.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    }
    for (const s of SECOES) expect(ITENS_MENU.some((i) => i.secao === s.id), s.id).toBe(true);
  });

  it('escolher o lote: cada ação leva a uma tela do lote e tem o mesmo acesso do item do Menu', () => {
    for (const [e, a] of Object.entries(ESCOLHER_LOTE) as [Escolha, (typeof ESCOLHER_LOTE)[Escolha]][]) {
      expect(existeRota(caminho(a.para(7))), e).toBe(true);
      const item = ITENS_MENU.find((i) => i.para === `/lotes?escolher=${e}`);
      expect(item, `item do Menu para ${e}`).toBeTruthy();
      expect(item!.acesso ?? 'todos', e).toBe(a.acesso);
    }
    expect(ESCOLHER_LOTE.saude.para(7)).toBe('/lotes/7?aba=saude');
    expect(ESCOLHER_LOTE.venda.para(7)).toBe('/lotes/7?aba=dinheiro&acao=venda');
  });

  it('escolhaValida aceita só as ações conhecidas', () => {
    expect(escolhaValida('saude')).toBe('saude');
    expect(escolhaValida('toString')).toBeNull();
    expect(escolhaValida('')).toBeNull();
    expect(escolhaValida(null)).toBeNull();
  });
});

describe('Menu: cada papel vê o que pode usar', () => {
  it('vaqueiro não vê dinheiro nem cadastro de lote, mas vê o dia a dia', () => {
    const v = ids(itensVisiveis('vaqueiro'));
    for (const x of ['financeiro', 'lancar', 'venda', 'compraLote', 'funcionarios', 'mercado', 'juros', 'relatorios', 'simular', 'comparar', 'fixos', 'novoLote', 'fase', 'rotulo']) {
      expect(v, x).not.toContain(x);
    }
    for (const x of ['pesar', 'trato', 'vacina', 'mover', 'anotar', 'anotacoes', 'lotes', 'pasto', 'sanidade', 'estoque', 'nuvem', 'relatorioPesagem']) expect(v, x).toContain(x);
  });

  it('consultor só olha: não vê o que lança', () => {
    const c = ids(itensVisiveis('consultor'));
    for (const x of ['pesar', 'trato', 'vacina', 'mover', 'anotar', 'venda', 'lancar', 'novoLote', 'compraLote', 'rotulo', 'fase']) expect(c, x).not.toContain(x);
    for (const x of ['financeiro', 'relatorios', 'funcionarios', 'simular', 'lotes', 'pasto', 'sanidade']) expect(c, x).toContain(x);
  });

  it('dono, gerente e celular sem nuvem veem tudo; "Minha conta" só com e-mail', () => {
    const todos = ITENS_MENU.filter((i) => i.acao !== 'perfil').length;
    expect(itensVisiveis(null)).toHaveLength(todos);
    expect(itensVisiveis('dono')).toHaveLength(todos);
    expect(itensVisiveis('gerente')).toHaveLength(todos);
    expect(ids(itensVisiveis('dono'))).not.toContain('conta');
    expect(ids(itensVisiveis('dono', true))).toContain('conta');
  });

  it('atalhos do Início mudam com o papel', () => {
    expect(ids(atalhosDoInicio('vaqueiro'))).toEqual(['pesar', 'vacina', 'mover', 'anotar', 'trato', 'pasto']);
    expect(ids(atalhosDoInicio('dono'))).toEqual(['pesar', 'vacina', 'mover', 'venda', 'anotar', 'novoLote']);
    expect(ids(atalhosDoInicio(null))).toEqual(ids(atalhosDoInicio('gerente')));
    expect(ids(atalhosDoInicio('consultor'))).toEqual(['pasto', 'relatorioPesagem', 'financeiro', 'relatorios', 'sanidade', 'lotes']);
    for (const p of ['dono', 'gerente', 'vaqueiro', 'consultor', null] as const) {
      for (const i of atalhosDoInicio(p)) expect(i.curto ?? i.titulo, `${i.id}: nome curto cabe no botão`).toMatch(/^.{1,20}$/);
    }
  });
});

describe('Menu: busca escrevendo ou falando', () => {
  const primeiro = (t: string) => procurarNoMenu(t)[0]?.id;
  const casos: [string, string][] = [
    ['vacina', 'vacina'],
    ['vacinas', 'vacina'],
    ['remédio para carrapato', 'vacina'],
    ['salário', 'funcionarios'],
    ['vender boi', 'venda'],
    ['vend', 'venda'],
    ['morreu um boi', 'venda'],
    ['quero lançar uma despesa de diesel', 'lancar'],
    ['mudar o gado de piquete', 'mover'],
    ['backup', 'copia'],
    ['preço da @', 'mercado'],
    ['trocar a senha', 'conta'],
    ['satélite', 'pasto'],
    ['comprei bezerro', 'compraLote'],
  ];
  for (const [texto, id] of casos) it(`"${texto}" → ${id}`, () => expect(primeiro(texto)).toBe(id));

  it('sem palavra que ajude, não acha nada', () => {
    expect(procurarNoMenu('')).toEqual([]);
    expect(procurarNoMenu('quero ver')).toEqual([]);
    expect(procurarNoMenu('xyzw')).toEqual([]);
  });

  it('"boi" não acha o nome do app (BoiForte)', () => {
    expect(procurarNoMenu('vender boi').map((i) => i.id)).not.toContain('instalar');
  });

  it('procura só no que a pessoa pode ver', () => {
    expect(ids(procurarNoMenu('salário', itensVisiveis('vaqueiro')))).not.toContain('funcionarios');
  });
});
