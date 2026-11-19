import { describe, it, expect } from 'vitest';
import { limparLeitura, validarPedido, segredoConfere } from '../../supabase/functions/_shared/foto';

const img = 'A'.repeat(200);

describe('leitura por foto (regras do servidor)', () => {
  it('recusa pedido estranho', () => {
    expect(() => validarPedido(null)).toThrow();
    expect(() => validarPedido({ tipo: 'outro', imagem: img, mime: 'image/jpeg' })).toThrow('Tipo');
    expect(() => validarPedido({ tipo: 'rotulo', imagem: img, mime: 'image/gif' })).toThrow('JPG');
    expect(() => validarPedido({ tipo: 'rotulo', imagem: img + '<script>', mime: 'image/png' })).toThrow('inválida');
    expect(() => validarPedido({ tipo: 'rotulo', imagem: 'A'.repeat(6_000_001), mime: 'image/png' })).toThrow('grande');
    expect(validarPedido({ tipo: 'balanca', imagem: img, mime: 'image/webp', extra: 1 })).toEqual({ tipo: 'balanca', imagem: img, mime: 'image/webp' });
  });

  it('só deixa passar números plausíveis do rótulo', () => {
    const r = limparLeitura('rotulo', { legivel: true, nome: ' Núcleo <b>X</b> ', umidade: 10, pb: 40, ndt: 999, ca: 12.5, p: -1, nnp_pb: 20, observacao: null });
    expect(r).toEqual({ legivel: true, nome: 'Núcleo bX/b', ms: 90, pb: 40, ndt: null, ca: 12.5, p: null, ureia: true, observacao: null });
    expect(limparLeitura('rotulo', 'lixo')).toMatchObject({ legivel: false, pb: null, ureia: false });
  });

  it('balança: peso fora da faixa não vale', () => {
    expect(limparLeitura('balanca', { legivel: true, peso: 352.5, brinco: '101' })).toEqual({ legivel: true, peso: 352.5, brinco: '101' });
    expect(limparLeitura('balanca', { legivel: true, peso: 5000, brinco: null })).toMatchObject({ legivel: false, peso: null });
  });

  it('segredo confere só quando é igual', () => {
    expect(segredoConfere('abc123', 'abc123')).toBe(true);
    expect(segredoConfere('abc123', 'abc124')).toBe(false);
    expect(segredoConfere('', '')).toBe(false);
  });
});
