import { describe, expect, it } from 'vitest';
import { problemaNaSenha } from './cliente';

describe('senha', () => {
  it('pede 8 ou mais, com letras e números', () => {
    expect(problemaNaSenha('abc12')).toMatch('pelo menos 8');
    expect(problemaNaSenha('abcdefgh')).toMatch('letras e números');
    expect(problemaNaSenha('12345678')).toMatch('letras e números');
    expect(problemaNaSenha('boi2026forte')).toBeNull();
    expect(problemaNaSenha('pião2026')).toBeNull();
    expect(problemaNaSenha('a1'.repeat(40))).toMatch('comprida');
  });
});
