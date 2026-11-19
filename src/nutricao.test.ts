import { describe, it, expect } from 'vitest';
import { avaliarFormula, batida, calcularFormula, custoArrobaNutricao, kgCabDia, INGREDIENTES_PADRAO, type IngredienteNut } from './nutricao';

const ing = (id: number, nome: string): IngredienteNut => ({ id, ...INGREDIENTES_PADRAO.find((i) => i.nome.startsWith(nome))! });
const milho = ing(1, 'Milho'), soja = ing(2, 'Farelo de soja'), nucleo = ing(3, 'Núcleo TIP'), ureia = ing(4, 'Ureia'), calc = ing(5, 'Calcário');
const todos = [milho, soja, nucleo, ureia, calc];

describe('formulação', () => {
  it('reproduz o custo da RIP da planilha: 575 milho + 275 soja + 150 núcleo = R$ 1,874/kg', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 575 }, { ingredienteId: 2, qtd: 275 }, { ingredienteId: 3, qtd: 150 }], todos);
    expect(r.totalKg).toBe(1000);
    expect(r.custoKg).toBeCloseTo(1.87425, 5);
  });
  it('dá o mesmo resultado em % ou em kg', () => {
    const a = calcularFormula([{ ingredienteId: 1, qtd: 57.5 }, { ingredienteId: 2, qtd: 27.5 }, { ingredienteId: 3, qtd: 15 }], todos);
    const b = calcularFormula([{ ingredienteId: 1, qtd: 575 }, { ingredienteId: 2, qtd: 275 }, { ingredienteId: 3, qtd: 150 }], todos);
    expect(a.mn.pb).toBeCloseTo(b.mn.pb, 9);
    expect(a.custoKg).toBeCloseTo(b.custoKg, 9);
  });
  it('calcula PB, NDT, Ca, P e Ca:P ponderados', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 50 }, { ingredienteId: 2, qtd: 50 }], todos);
    expect(r.mn.pb).toBeCloseTo((8 + 45) / 2, 6);
    expect(r.mn.ndt).toBeCloseTo((78 + 73) / 2, 6);
    expect(r.caP).toBeCloseTo(0.165 / 0.415, 6);
    expect(r.mn.ms).toBeCloseTo(88.5, 6);
    expect(r.ms.pb).toBeCloseTo(26.5 / 0.885, 6);
  });
  it('conta a ureia da mistura e marca ingrediente apagado', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 90 }, { ingredienteId: 4, qtd: 10 }, { ingredienteId: 99, qtd: 0 }], todos);
    expect(r.ureiaPct).toBeCloseTo(10, 6);
    expect(calcularFormula([{ ingredienteId: 99, qtd: 5 }], todos).ingredientesFaltando).toEqual([99]);
  });
  it('quantidade de cada ingrediente numa batida', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 575 }, { ingredienteId: 2, qtd: 275 }, { ingredienteId: 3, qtd: 150 }], todos);
    expect(batida(r, 950).map((b) => Math.round(b.kg * 100) / 100)).toEqual([546.25, 261.25, 142.5]);
  });
});

describe('alertas de faixa', () => {
  it('RIP da planilha fica dentro das faixas', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 575 }, { ingredienteId: 2, qtd: 275 }, { ingredienteId: 3, qtd: 150 }], todos);
    const a = avaliarFormula('rip', r);
    expect(a.map((x) => x.nivel)).toEqual(['bom']);
  });
  it('só milho para TIP: proteína baixa e Ca:P muito baixo (cálculo urinário)', () => {
    const a = avaliarFormula('tip', calcularFormula([{ ingredienteId: 1, qtd: 100 }], todos));
    expect(a.some((x) => x.texto.startsWith('PB (proteína) muito baixo'))).toBe(true);
    const caP = a.find((x) => x.texto.includes('Ca:P'));
    expect(caP?.nivel).toBe('ruim');
    expect(caP?.risco).toContain('cálculo urinário');
  });
  it('ureia acima do limite e ureia no creep', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 85 }, { ingredienteId: 4, qtd: 5 }, { ingredienteId: 5, qtd: 10 }], todos);
    expect(avaliarFormula('tip', r).some((x) => x.texto.startsWith('Ureia acima'))).toBe(true);
    expect(avaliarFormula('creep', r).some((x) => x.texto.includes('não use ureia'))).toBe(true);
    expect(avaliarFormula('tip', r).find((x) => x.texto.startsWith('Ureia'))?.risco).toContain('intoxicação');
  });
  it('energia alta demais avisa risco de acidose', () => {
    const r = calcularFormula([{ ingredienteId: 1, qtd: 100 }], todos);
    const a = avaliarFormula('proteinado', r);
    expect(a.some((x) => x.texto.startsWith('NDT') && x.risco?.includes('acidose'))).toBe(true);
  });
  it('fórmula vazia', () => {
    expect(avaliarFormula('rip', calcularFormula([], todos))[0].texto).toContain('Adicione');
  });
});

describe('diária e custo da arroba', () => {
  it('kg por cabeça por dia', () => {
    expect(kgCabDia(250, 0.003)).toBeCloseTo(0.75, 9);
  });
  it('custo da @ produzida só com nutrição', () => {
    // diária de R$ 1,50, GMD 0,75 e rendimento 50% => 0,025 @/dia => R$ 60/@
    expect(custoArrobaNutricao(1.5, 0.75)).toBeCloseTo(60, 9);
    expect(custoArrobaNutricao(1.5, 0)).toBeNull();
  });
});
