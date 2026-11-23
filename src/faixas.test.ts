import { describe, it, expect } from 'vitest';
import { calcularFormula, INGREDIENTES_PADRAO, type IngredienteNut } from './nutricao';
import { avaliarNutrientes, faixasDoTipo, textoFaixa } from './faixas';
import { avaliarFormula } from './nutricao';

const ing = (id: number, nome: string, extra: Partial<IngredienteNut> = {}): IngredienteNut => ({ id, ...INGREDIENTES_PADRAO.find((i) => i.nome.startsWith(nome))!, ...extra });
const milho = ing(1, 'Milho'), soja = ing(2, 'Farelo de soja');
const nucleo = ing(3, 'Núcleo TIP', { cobre: 400, manganes: 500, fb: 4 });
const rip = [{ ingredienteId: 1, qtd: 575 }, { ingredienteId: 2, qtd: 275 }, { ingredienteId: 3, qtd: 150 }];
const por = (t: ReturnType<typeof avaliarNutrientes>, k: string) => t.find((a) => a.chave === k)!;

describe('faixa adequada por tipo', () => {
  it('a faixa dos minerais muda entre RIP e TIP (o TIP come mais, precisa de menos concentração)', () => {
    const fRip = faixasDoTipo('rip', 0.007), fTip = faixasDoTipo('tip', 0.015);
    expect(fRip.cobre!.min!).toBeGreaterThan(fTip.cobre!.min!);
    expect(fRip.p!.min!).toBeGreaterThan(fTip.p!.min!);
    expect(textoFaixa(fRip.pb!)).toBe('16 a 24%');
    expect(textoFaixa(fTip.pb!)).toBe('13 a 18%');
    expect(textoFaixa(fRip.fb!)).toBe('até 10%');
  });
  it('sal mineral: cobre e manganês na faixa dos rótulos comuns (centenas a milhares de mg/kg)', () => {
    const f = faixasDoTipo('sal_mineral', 0.0005);
    // (10 − 4) × 0,023 ÷ 0,0005 = 276; (20 − 4) × 46 = 736; tóxico: (40 − 4) × 46 = 1.656
    expect(f.cobre).toMatchObject({ min: 280, max: 740, critMax: 1700, unidade: 'mg/kg' });
    expect(f.pb).toBeUndefined();
    expect(f.fb).toBeUndefined();
  });
  it('confinamento usa a exigência direto na matéria seca', () => {
    const f = faixasDoTipo('confinamento', 0.023);
    expect(f.cobre).toMatchObject({ min: 10, max: 20, critMax: 40 });
    expect(f.ca).toMatchObject({ min: 0.4, max: 1 });
    expect(f.fb).toMatchObject({ min: 10, critMin: 7 });
  });
  it('"Outro" não tem faixa', () => {
    expect(faixasDoTipo('outro', 0.003)).toEqual({});
  });
});

describe('avaliação dos nutrientes da fórmula', () => {
  it('RIP da planilha com núcleo informado: cobre, manganês e fibra calculados e dentro', () => {
    const r = calcularFormula(rip, [milho, soja, nucleo]);
    // fibra: 0,575×2,2 + 0,275×6 + 0,15×4 = 3,515%
    expect(r.extras.fb.mn).toBeCloseTo(3.515, 6);
    expect(r.extras.cobre.mn).toBeCloseTo(0.575 * 3 + 0.275 * 15 + 0.15 * 400, 6);
    const a = avaliarNutrientes('rip', r, 0.007);
    expect(a.map((x) => x.chave)).toEqual(['pb', 'ndt', 'ca', 'p', 'caP', 'fb', 'cobre', 'manganes']);
    expect(por(a, 'fb').status).toBe('dentro');
    expect(por(a, 'cobre').status).toBe('acima'); // 66 mg/kg contra faixa de 20 a 53: acima, mas não tóxico
    expect(por(a, 'cobre').critico).toBe(false);
    expect(avaliarFormula('rip', r, 0.007).map((x) => x.nivel)).toEqual(['bom']);
  });
  it('núcleo sem cobre no cadastro: mostra "sem dado" só se ninguém informar; senão conta parcial', () => {
    const semNucleo = calcularFormula(rip, [milho, soja, ing(3, 'Núcleo TIP')]);
    expect(por(avaliarNutrientes('rip', semNucleo, 0.007), 'cobre')).toMatchObject({ status: 'incompleto', critico: false, semDado: 1 });
    const so = calcularFormula([{ ingredienteId: 3, qtd: 100 }], [ing(3, 'Núcleo TIP')]);
    expect(por(avaliarNutrientes('rip', so, 0.007), 'cobre').status).toBe('sem_dado');
  });
  it('ingrediente de partida antigo (sem os campos novos) usa o valor de tabela', () => {
    const antigo = { ...milho, fb: undefined, cobre: undefined, manganes: undefined };
    expect(calcularFormula([{ ingredienteId: 1, qtd: 1 }], [antigo]).extras.fb).toMatchObject({ mn: 2.2, informado: true, semDado: 0 });
  });
  it('cobre tóxico vira alerta vermelho', () => {
    const sal = ing(9, 'Sal mineral 80', { cobre: 5000, manganes: 1200, fb: 0 });
    const r = calcularFormula([{ ingredienteId: 9, qtd: 100 }], [sal]);
    const al = avaliarFormula('sal_mineral', r, 0.0005);
    const cu = al.find((x) => x.texto.startsWith('Cobre'));
    expect(cu?.nivel).toBe('ruim');
    expect(cu?.risco).toContain('intoxicar');
  });
});
