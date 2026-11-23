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
    const fazenda = '10000000-0000-4000-8000-000000000001';
    expect(() => validarPedido({ tipo: 'balanca', imagem: img, mime: 'image/webp' })).toThrow('fazenda');
    expect(() => validarPedido({ tipo: 'balanca', imagem: img, mime: 'image/webp', fazenda: "x' or 1=1" })).toThrow('fazenda');
    expect(validarPedido({ tipo: 'balanca', imagem: img, mime: 'image/webp', fazenda, extra: 1 })).toEqual({ tipo: 'balanca', imagem: img, mime: 'image/webp', fazenda });
  });

  it('só deixa passar números plausíveis do rótulo', () => {
    const r = limparLeitura('rotulo', { legivel: true, categoria: 'nucleo', nome: ' Núcleo <b>X</b> ', umidade: 10, pb: 40, ndt: 999, ca: 12.5, p: -1, nnp_pb: 28.1, consumo_texto: null, consumo_pct_pv: null, observacao: null });
    expect(r).toEqual({ legivel: true, categoria: 'nucleo', nome: 'Núcleo bX/b', ms: 90, pb: 40, ndt: null, ca: 12.5, p: null, ureia: false, ureiaTeor: 10, consumo: null, consumoPctPV: null, observacao: null });
    expect(limparLeitura('rotulo', 'lixo')).toMatchObject({ legivel: false, categoria: null, pb: null, ureia: false, ureiaTeor: null });
  });

  it('produto pronto: tipo, consumo do rótulo e ureia pura', () => {
    const r = limparLeitura('rotulo', { legivel: true, categoria: 'proteinado', nome: 'Proteinado Águas', umidade: 8, pb: 40, ndt: 50, ca: 5, p: 2, nnp_pb: 25, consumo_texto: '1 g por kg de peso vivo', consumo_pct_pv: 0.1, observacao: null });
    expect(r).toMatchObject({ categoria: 'proteinado', consumo: '1 g por kg de peso vivo', consumoPctPV: 0.001, ureiaTeor: 8.9 });
    expect(limparLeitura('rotulo', { legivel: true, categoria: 'foguete', pb: 281, consumo_pct_pv: 50 })).toMatchObject({ categoria: null, ureia: true, ureiaTeor: null, consumoPctPV: null });
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
