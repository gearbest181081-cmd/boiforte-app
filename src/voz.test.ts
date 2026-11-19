import { describe, it, expect } from 'vitest';
import { lerNumeroFalado, lerPesagemFalada, melhorNumero } from './voz';

describe('números falados', () => {
  const casos: [string, number][] = [
    ['320', 320],
    ['320,5', 320.5],
    ['320.5', 320.5],
    ['1.250', 1250],
    ['1.250,75', 1250.75],
    ['trezentos e vinte', 320],
    ['Trezentos e vinte quilos', 320],
    ['trezentos e vinte e meio', 320.5],
    ['trezentos e vinte vírgula cinco', 320.5],
    ['zero vírgula setecentos e cinquenta', 0.75],
    ['zero vírgula sete cinco', 0.75],
    ['cem', 100],
    ['cento e oito dias', 108],
    ['mil duzentos e cinquenta', 1250],
    ['dois mil', 2000],
    ['quarenta cabeças', 40],
    ['280 kg', 280],
  ];
  for (const [texto, esperado] of casos) {
    it(`"${texto}" = ${esperado}`, () => expect(lerNumeroFalado(texto)).toBeCloseTo(esperado, 6));
  }
  it('texto sem número', () => {
    expect(lerNumeroFalado('bom dia')).toBeNull();
    expect(lerNumeroFalado('')).toBeNull();
  });
  it('escolhe a alternativa que vira número', () => {
    expect(melhorNumero('trezentos e vinte|320')).toBe(320);
    expect(melhorNumero('olá|trezentos')).toBe(300);
  });
});

describe('pesagem falada', () => {
  it('brinco e peso por extenso', () => {
    expect(lerPesagemFalada('brinco doze peso trezentos e dezoito')).toEqual({ brinco: '12', peso: 318 });
  });
  it('brinco e peso com dígitos', () => {
    expect(lerPesagemFalada('Brinco 45 peso 320,5 quilos')).toEqual({ brinco: '45', peso: 320.5 });
  });
  it('só os dois números', () => {
    expect(lerPesagemFalada('12 318')).toEqual({ brinco: '12', peso: 318 });
  });
  it('brinco com letras', () => {
    expect(lerPesagemFalada('brinco AB peso 300')).toEqual({ brinco: 'AB', peso: 300 });
  });
  it('frase sem sentido', () => {
    expect(lerPesagemFalada('o boi fugiu')).toBeNull();
  });
});
