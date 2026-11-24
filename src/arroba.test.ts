import { describe, it, expect } from 'vitest';
import { lerPesagemFalada, lerPesoFalado, melhorPeso, explicarArroba } from './voz';

describe('peso falado em arroba de peso vivo', () => {
  const casos: [string, number, number | undefined][] = [
    ['320', 320, undefined],
    ['trezentos e vinte quilos', 320, undefined],
    ['15 arrobas', 225, 15],
    ['quinze arrobas', 225, 15],
    ['Quinze Arrobas', 225, 15],
    ['uma arroba', 15, 1],
    ['18 @', 270, 18],
    ['18@', 270, 18],
    ['quinze arrobas e meia', 232.5, 15.5],
    ['15,5 arrobas', 232.5, 15.5],
    ['dezoito arrobas e dez quilos', 280, 18],
    ['doze arrobas de peso vivo', 180, 12],
    ['vinte arrobas vivas', 300, 20],
  ];
  for (const [t, kg, arrobas] of casos) {
    it(`"${t}" → ${kg} kg`, () => {
      const r = lerPesoFalado(t);
      expect(r).toEqual(arrobas == null ? { kg } : { kg, arrobas });
    });
  }
  it('arroba sem número dá erro (avisar que é em kg)', () => {
    expect(lerPesoFalado('arroba')).toEqual({ erro: 'arroba' });
    expect(lerPesoFalado('umas arrobas')).toEqual({ erro: 'arroba' });
    expect(lerPesoFalado('quinze arrobas e mais um pouco')).toEqual({ erro: 'arroba' });
  });
  it('sem número nem arroba', () => expect(lerPesoFalado('bom dia')).toBeNull());
  it('melhorPeso prefere a alternativa entendida', () => {
    expect(melhorPeso('umas arrobas|quinze arrobas')).toEqual({ kg: 225, arrobas: 15 });
    expect(melhorPeso('arroba|bom dia')).toEqual({ erro: 'arroba' });
    expect(melhorPeso('bom dia')).toBeNull();
  });
  it('pesagem falada com arroba', () => {
    expect(lerPesagemFalada('brinco 12 peso 21 arrobas')).toEqual({ brinco: '12', peso: 315, arrobas: 21 });
    expect(lerPesagemFalada('brinco 12 peso 318')).toEqual({ brinco: '12', peso: 318 });
    expect(lerPesagemFalada('brinco 12 peso arroba')).toBe('arroba');
  });
  it('explica a conta', () => expect(explicarArroba(15.5, 232.5)).toBe('15,5 @ de peso vivo × 15 kg = 232,5 kg'));
});
