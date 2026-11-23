import { describe, it, expect } from 'vitest';
import { escolherOpcaoFalada, lerDataFalada, melhorData, textoFalado } from './voz';

const HOJE = '2026-11-23';

describe('datas faladas', () => {
  const casos: [string, string | null][] = [
    ['hoje', '2026-11-23'],
    ['Ontem', '2026-11-22'],
    ['anteontem', '2026-11-21'],
    ['amanhã', '2026-11-24'],
    ['depois de amanhã', '2026-11-25'],
    ['daqui a 30 dias', '2026-12-23'],
    ['daqui a duas semanas', '2026-12-07'],
    ['há cinco dias', '2026-11-18'],
    ['10 dias atrás', '2026-11-13'],
    ['15 de março', '2026-03-15'],
    ['quinze de março de 2025', '2025-03-15'],
    ['primeiro de abril', '2026-04-01'],
    ['dia vinte e cinco de dezembro', '2026-12-25'],
    ['15/03', '2026-03-15'],
    ['15/03/2025', '2025-03-15'],
    ['5/1/27', '2027-01-05'],
    ['15 do 3', '2026-03-15'],
    ['dia 10', '2026-11-10'],
    ['31 de fevereiro', null],
    ['bom dia', null],
    ['', null],
  ];
  for (const [t, e] of casos) it(`"${t}" → ${e}`, () => expect(lerDataFalada(t, HOJE)).toBe(e));
  it('usa a primeira alternativa que é data', () => expect(melhorData('bom dia|ontem', HOJE)).toBe('2026-11-22'));
});

describe('texto falado', () => {
  it('texto começa com maiúscula', () => expect(textoFalado('retiro de cima|outra')).toBe('Retiro de cima'));
  it('e-mail', () => expect(textoFalado('Luiz ponto silva arroba gmail ponto com', 'email')).toBe('luiz.silva@gmail.com'));
  it('código', () => expect(textoFalado('ab 12 traço cd', 'codigo')).toBe('AB12-CD'));
  it('só dígitos', () => {
    expect(textoFalado('1 2 3 4 5 6', 'digitos')).toBe('123456');
    expect(textoFalado('um dois três quatro cinco seis', 'digitos')).toBe('123456');
  });
});

describe('escolha falada', () => {
  const ings = [
    { valor: '0', texto: 'Escolha…' },
    { valor: '1', texto: 'Milho moído' },
    { valor: '2', texto: 'Farelo de soja' },
    { valor: '3', texto: 'Núcleo RIP 80' },
    { valor: '4', texto: 'Ureia' },
  ];
  it('palavra única', () => expect(escolherOpcaoFalada('milho', ings)).toBe('1'));
  it('sem acento e maiúsculas', () => expect(escolherOpcaoFalada('NUCLEO', ings)).toBe('3'));
  it('várias palavras', () => expect(escolherOpcaoFalada('farelo de soja', ings)).toBe('2'));
  it('alternativas', () => expect(escolherOpcaoFalada('uréia|urea', ings)).toBe('4'));
  it('nada parecido', () => expect(escolherOpcaoFalada('cavalo', ings)).toBeNull());
  const lotes = [
    { valor: '5', texto: 'Lote 5 (40 cab)' },
    { valor: '6', texto: 'Lote 6 (12 cab)' },
    { valor: '7', texto: 'Novilhas TIP (20 cab)' },
  ];
  it('número falado por extenso', () => expect(escolherOpcaoFalada('lote seis', lotes)).toBe('6'));
  it('nome do lote', () => expect(escolherOpcaoFalada('novilhas', lotes)).toBe('7'));
});
