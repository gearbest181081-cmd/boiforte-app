import { describe, it, expect } from 'vitest';
import { emCarencia, liberacaoAbate, pendenciasSanidade, proximaData } from './sanidade';

const ev = [
  { loteId: 1, data: '2026-11-01', feito: true, produto: 'Ivermectina 3,15%', tipo: 'vermifugo' as const, carenciaDias: 122 },
  { loteId: 1, data: '2026-11-10', feito: true, produto: 'Oxitetraciclina', tipo: 'antibiotico' as const, carenciaDias: 28 },
  { loteId: 1, data: '2026-11-15', feito: false, produto: 'Clostridiose reforço', tipo: 'vacina' as const },
  { loteId: 2, data: '2026-11-25', feito: false, produto: 'Vermífugo', tipo: 'vermifugo' as const },
];

describe('sanidade', () => {
  it('liberação para abate pela maior carência', () => {
    expect(liberacaoAbate(ev, 1)).toEqual({ data: '2027-03-03', produto: 'Ivermectina 3,15%' });
    expect(liberacaoAbate(ev, 2)).toBeNull();
    expect(emCarencia(ev, 1, '2027-03-03')).toBeNull();
    expect(emCarencia(ev, 1, '2027-03-02')?.produto).toContain('Ivermectina');
  });
  it('pendências: atrasadas, próximas e lembretes', () => {
    const p = pendenciasSanidade(ev, [{ titulo: 'Declaração', mes: 11, dia: 30, antecedenciaDias: 30 }], '2026-11-19');
    expect(p.map((x) => x.nivel)).toEqual(['ruim', 'atencao', 'atencao']);
    expect(p[0].texto).toContain('4 dia(s) de atraso');
    // a dose marcada guarda o lote (a Sanidade leva para a aba Saúde dele); o lembrete do calendário não tem lote
    expect(p.map((x) => x.loteId ?? null)).toEqual([1, 2, null]);
  });
  it('próxima data do lembrete anual', () => {
    expect(proximaData({ titulo: '', mes: 5, dia: 31, antecedenciaDias: 0 }, '2026-11-19')).toBe('2027-05-31');
    expect(proximaData({ titulo: '', mes: 2, dia: 30, antecedenciaDias: 0 }, '2026-11-19')).toBe('2027-02-28');
  });
});
