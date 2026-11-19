import { describe, it, expect } from 'vitest';
import { LeitorBalanca, lerLinhaBalanca } from './balanca';

describe('balança bluetooth', () => {
  it('entende os formatos mais comuns', () => {
    expect(lerLinhaBalanca('ST,GS,+  352.5kg')).toBe(352.5);
    expect(lerLinhaBalanca('W:0352')).toBe(352);
    expect(lerLinhaBalanca('  418,0 kg')).toBe(418);
    expect(lerLinhaBalanca('US,GS,-   12.0kg')).toBeNull();
    expect(lerLinhaBalanca('OL')).toBeNull();
  });
  it('avisa só quando o peso para, e um por animal', () => {
    const pesos: number[] = [];
    const l = new LeitorBalanca((kg) => pesos.push(kg));
    l.receber('0\r\n120\r\n300\r\n35'); // pedaço cortado no meio
    l.receber('1\r\n351\r\n351\r\n351\r\n351\r\n');
    l.receber('0\r\n2\r\n380\r\n380\r\n380\r\n');
    expect(pesos).toEqual([351, 380]);
  });
});
