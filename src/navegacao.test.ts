import { describe, it, expect } from 'vitest';
import { paraDoAviso, telaDeCima } from './navegacao';
import type { Alerta } from './alertas';
import type { ResumoModulo } from './pasto';

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

describe('para onde o aviso do Início leva', () => {
  const aviso = (titulo: string, para?: string): Alerta => ({ nivel: 'atencao', titulo, texto: '', para });
  it('o próprio aviso pode dizer', () => expect(paraDoAviso(aviso('Lote 5: sem pesagem', '/pesar/5'))).toBe('/pesar/5'));
  it('estoque vai para o Estoque', () => expect(paraDoAviso(aviso('Estoque: Milho'))).toBe('/estoque'));
  it('pasto: aviso do piquete e do satélite vão para o piquete; o do módulo, para o Pasto', () => {
    const doPiquete = aviso('Piquete 3: passou dos dias de ocupação'), doSatelite = aviso('Piquete 4: o verde caiu'), doModulo = aviso('Lotação alta');
    const r = {
      estados: [{ piquete: { id: 3 }, alertas: [doPiquete] }],
      ndvi: new Map([[4, { alertas: [doSatelite] }]]),
      alertas: [doModulo, doPiquete, doSatelite],
    } as unknown as ResumoModulo;
    expect(paraDoAviso(doPiquete, [r])).toBe('/pasto/piquete/3');
    expect(paraDoAviso(doSatelite, [r])).toBe('/pasto/piquete/4');
    expect(paraDoAviso(doModulo, [r])).toBe('/pasto');
    expect(paraDoAviso(aviso('Outro aviso'), [r])).toBeUndefined();
  });
});
