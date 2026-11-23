import { describe, it, expect } from 'vitest';
import { telaDeCima } from './navegacao';

describe('tela de cima (Voltar sem histórico)', () => {
  const casos: [string, string][] = [
    ['/', '/'],
    ['/lotes', '/'],
    ['/lotes/novo', '/lotes'],
    ['/lotes/5', '/lotes'],
    ['/lotes/5/editar', '/lotes/5'],
    ['/pesar', '/'],
    ['/pesar/5', '/lotes/5'],
    ['/nutricao', '/mais'],
    ['/nutricao/formula/3', '/nutricao'],
    ['/nutricao/ingrediente/novo', '/nutricao'],
    ['/fazenda', '/mais'],
    ['/estoque', '/mais'],
    ['/trato', '/'],
    ['/mais', '/'],
  ];
  for (const [de, para] of casos) it(`${de} → ${para}`, () => expect(telaDeCima(de)).toBe(para));
});
