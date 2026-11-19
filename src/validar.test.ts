import { describe, it, expect } from 'vitest';
import { validarRegistro } from './validar';

describe('validação dos dados', () => {
  it('limpa texto, descarta campos estranhos', () => {
    const r = validarRegistro('propriedades', { nome: '  Boa Vista\u0007 ', criadoEm: 1, hack: '<script>', __proto__x: 1 });
    expect(r).toEqual({ nome: 'Boa Vista', criadoEm: 1 });
  });
  it('recusa campo obrigatório vazio, número fora do limite e enum inválido', () => {
    expect(() => validarRegistro('propriedades', { nome: '   ' })).toThrow('obrigatório');
    expect(() => validarRegistro('pesagens', { loteId: 1, data: '2026-10-01', tipo: 'media', pesoMedio: 99999, qtdPesada: 1 })).toThrow('fora do limite');
    expect(() => validarRegistro('lotes', { propriedadeId: 1, nome: 'L', fase: 'xx', sexo: 'macho', controle: 'lote', qtdCabecas: 1, dataEntrada: '2026-01-01' })).toThrow('não permitido');
  });
  it('recusa datas impossíveis e tipos errados', () => {
    expect(() => validarRegistro('pesagens', { loteId: 1, data: '2026-02-30', tipo: 'media', pesoMedio: 300, qtdPesada: 1 })).toThrow('data');
    expect(() => validarRegistro('pesagens', { loteId: '1', data: '2026-02-01', tipo: 'media', pesoMedio: 300, qtdPesada: 1 })).toThrow('referência');
    expect(() => validarRegistro('pesagens', { loteId: 1, data: '2026-02-01', tipo: 'media', pesoMedio: NaN, qtdPesada: 1 })).toThrow('número');
  });
  it('valida listas internas', () => {
    expect(() => validarRegistro('formulas', { nome: 'F', tipo: 'rip', unidade: 'kg', modo: 'direto', consumoPctPV: 0.007, itens: [{ ingredienteId: 1, qtd: -5 }] })).toThrow('fora do limite');
  });
  it('texto longo demais', () => {
    expect(() => validarRegistro('modulos', { propriedadeId: 1, nome: 'x'.repeat(81) })).toThrow('passou de 80');
  });
});
