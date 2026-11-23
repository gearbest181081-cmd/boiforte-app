import { describe, it, expect } from 'vitest';
import { compararProdutos, produtoAvulso } from './comparar';

const base = { ms: 92, ndt: 55, ca: 5, p: 1.5, fb: 8, cobre: 200, manganes: 250 };

describe('comparar produtos', () => {
  it('proteinados: o mais adequado e o de menor custo por kg de proteína', () => {
    const a = produtoAvulso('Barato fraco', 'proteinado', 0.001, { ...base, pb: 25, preco: 2.4 }); // PB abaixo de 30%
    const b = produtoAvulso('Bom', 'proteinado', 0.001, { ...base, pb: 40, preco: 3.6 }); // R$ 9,00 por kg de PB
    const c = produtoAvulso('Bom caro', 'proteinado', 0.001, { ...base, pb: 40, preco: 4.0 });
    const r = compararProdutos([a, b, c], 300, 50);
    expect(r.mesmoTipo).toBe(true);
    expect(r.melhorTipo).toBe(1);
    expect(r.linhas[1].chave.custoKg).toBeCloseTo(9, 6);
    expect(r.linhas[0].chave.custoKg).toBeCloseTo(9.6, 6);
    expect(r.melhorCusto).toBe(1);
    // 300 kg × 0,1% = 300 g/dia × R$ 3,60 = R$ 1,08/cab/dia; 50 cab × 30 dias = R$ 1.620
    expect(r.linhas[1].gDia).toBeCloseTo(300, 6);
    expect(r.linhas[1].custoMes).toBeCloseTo(1620, 6);
  });
  it('produto com problema crítico (ureia acima) não ganha o custo-benefício', () => {
    const perigoso = produtoAvulso('Barato com ureia', 'proteinado', 0.001, { ...base, pb: 45, preco: 2.0, ureiaTeor: 20 });
    const ok = produtoAvulso('Seguro', 'proteinado', 0.001, { ...base, pb: 40, preco: 3.6 });
    const r = compararProdutos([perigoso, ok], 300, 1);
    expect(r.linhas[0].ureiaAcima).toBe(true);
    expect(r.linhas[0].criticos).toBeGreaterThan(0);
    expect(r.melhorCusto).toBe(1);
    expect(r.melhorTipo).toBe(1);
  });
  it('tipos diferentes: avisa e compara pela diária', () => {
    const sal = produtoAvulso('Sal', 'sal_mineral', 0.0005, { ...base, pb: 0, ndt: 0, ca: 18, p: 8, cobre: 600, manganes: 900, preco: 3 });
    const prot = produtoAvulso('Proteinado', 'proteinado', 0.001, { ...base, pb: 40, preco: 3.6 });
    const r = compararProdutos([sal, prot], 300, 1);
    expect(r.mesmoTipo).toBe(false);
    expect(r.criterioCusto).toBe('diaria');
    expect(r.melhorCusto).toBe(0); // 150 g × 3 = R$ 0,45 contra R$ 1,08
  });
  it('campo vazio no rótulo fica "sem dado" e não conta como problema', () => {
    const semNdt = produtoAvulso('Sem NDT', 'proteinado', 0.001, { ...base, pb: 40, ndt: 0, ca: 0, p: 0, preco: 3.6 }, ['ndt', 'ca', 'p']);
    const l = compararProdutos([semNdt, semNdt], 300, 1).linhas[0];
    expect(l.avaliacao.filter((a) => a.status === 'sem_dado').map((a) => a.chave)).toEqual(['ndt', 'ca', 'p', 'caP']);
    expect(l.criticos).toBe(0);
  });
  it('um produto só não tem vencedor', () => {
    expect(compararProdutos([produtoAvulso('X', 'rip', 0.007, { ...base, pb: 20, preco: 2 })], 300, 1).melhorTipo).toBeNull();
  });
});
