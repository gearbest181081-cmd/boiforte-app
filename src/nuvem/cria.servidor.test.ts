// Cria no servidor: regras das tabelas novas, referências só da mesma fazenda e o que o vaqueiro pode.
import { describe, it, expect, beforeAll } from 'vitest';
import { subirServidor, type Servidor } from './servidorTeste';

const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string }[];
type Linha = { tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean };

describe('Cria no servidor', () => {
  let s: Servidor;
  let ana: string, vito: string, duda: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const baixar = (u: string, f: string) => s.rpc<Linha[]>(u, 'baixar_alteracoes', { f, desde: 0 });
  const vaca = (n: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'animais', gid: uuid(n), op: 'put',
    dados: { grupoId: uuid(3), brinco: `V${n}`, sexo: 'femea', categoria: 'matriz', ativo: true, nascimento: '2019-05-01', criadoEm: 0, ...extra },
  });

  beforeAll(async () => {
    s = await subirServidor();
    [ana, vito, duda, beto] = await Promise.all(['ana', 'vito', 'duda', 'beto'].map((n) => s.novoUsuario(n + '@c')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 4)`, [fa]);
    for (const [u, papel, nome] of [[vito, 'vaqueiro', 'Vito'], [duda, 'consultor', 'Duda']]) {
      await s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: papel }), meu_nome: nome });
    }
    const r = await enviar(ana, fa, [
      { tabela: 'propriedades', gid: uuid(1), op: 'put', dados: { nome: 'Boa Vista', criadoEm: 0 } },
      { tabela: 'grupos', gid: uuid(3), op: 'put', dados: { propriedadeId: uuid(1), nome: 'Vacas', tipo: 'matrizes', criadoEm: 0 } },
      vaca(10),
      { tabela: 'animais', gid: uuid(11), op: 'put', dados: { grupoId: uuid(3), brinco: 'Touros', sexo: 'macho', categoria: 'touro', qtd: 3, ativo: true, criadoEm: 0 } },
      { tabela: 'estacoes', gid: uuid(4), op: 'put', dados: { nome: 'Estação 26/27', inicio: '2026-11-01', fim: '2027-01-31', metodo: 'ia_repasse', criadoEm: 0 } },
    ]);
    expect(r.map((x) => x.erro ?? 'ok')).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    await enviar(beto, fb, [
      { tabela: 'propriedades', gid: uuid(101), op: 'put', dados: { nome: 'Santa Rita', criadoEm: 0 } },
      { tabela: 'grupos', gid: uuid(103), op: 'put', dados: { propriedadeId: uuid(101), nome: 'Vacas', tipo: 'matrizes', criadoEm: 0 } },
      { tabela: 'animais', gid: uuid(110), op: 'put', dados: { grupoId: uuid(103), brinco: 'X', sexo: 'femea', categoria: 'matriz', ativo: true, criadoEm: 0 } },
    ]);
  }, 30000);

  it('bezerro com mãe e pai da própria fazenda; mãe de outra fazenda é recusada', async () => {
    const ok = await enviar(ana, fa, [{ tabela: 'animais', gid: uuid(20), op: 'put', dados: { grupoId: uuid(3), brinco: 'B1', sexo: 'macho', categoria: 'bezerro', ativo: true, nascimento: '2026-09-01', maeId: uuid(10), paiId: uuid(11), pesoNascer: 31, creep: true, criadoEm: 0 } }]);
    expect(ok[0].ok).toBe(true);
    const ruim = await enviar(ana, fa, [{ tabela: 'animais', gid: uuid(21), op: 'put', dados: { grupoId: uuid(3), brinco: 'B2', ativo: true, maeId: uuid(110), criadoEm: 0 } }]);
    expect(ruim[0].ok).toBe(false);
  });

  it('valida os campos novos (categoria, sisbov, pacote da desmama)', async () => {
    const r = await enviar(ana, fa, [
      vaca(30, { categoria: 'boi' }),
      vaca(31, { sisbov: '1234567890123456' }),
      { tabela: 'desmamas', gid: uuid(32), op: 'put', dados: { data: '2026-10-01', ano: 2026, versao: 1, fase: 'tip', itens: [], cabecas: 1, kgTotal: 200, pesoMedio: 200, criadoEm: 0 } },
    ]);
    expect(r.map((x) => x.ok)).toEqual([false, false, false]);
  });

  it('vaqueiro lança cobertura, diagnóstico, parto e pesagem, mas não grupo, estação nem desmama', async () => {
    const r = await enviar(vito, fa, [
      { tabela: 'reproducao', gid: uuid(40), op: 'put', dados: { matrizId: uuid(10), data: '2026-11-05', tipo: 'ia', semen: 'Nelore X', estacaoId: uuid(4), criadoEm: 0 } },
      { tabela: 'reproducao', gid: uuid(41), op: 'put', dados: { matrizId: uuid(10), data: '2027-01-05', tipo: 'diagnostico', resultado: 'prenhe', diasGestacao: 60, criadoEm: 0 } },
      { tabela: 'pesosCria', gid: uuid(42), op: 'put', dados: { animalId: uuid(20), data: '2026-11-01', peso: 70, criadoEm: 0 } },
      { tabela: 'grupos', gid: uuid(43), op: 'put', dados: { propriedadeId: uuid(1), nome: 'Do vaqueiro', tipo: 'misto', criadoEm: 0 } },
      { tabela: 'estacoes', gid: uuid(44), op: 'put', dados: { nome: 'X', inicio: '2026-11-01', fim: '2027-01-31', metodo: 'monta', criadoEm: 0 } },
      { tabela: 'desmamas', gid: uuid(45), op: 'put', dados: { data: '2026-10-01', ano: 2026, versao: 1, fase: 'recria', itens: [{ animalId: uuid(20), peso: 200, sexo: 'macho', idadeDias: 210, destino: 'lote' }], cabecas: 1, kgTotal: 200, pesoMedio: 200, criadoEm: 0 } },
    ]);
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false, false, false]);
    const tabs = new Set((await baixar(vito, fa)).map((l) => l.tabela));
    for (const t of ['grupos', 'estacoes', 'reproducao', 'pesosCria']) expect(tabs.has(t)).toBe(true);
  });

  it('consultor só olha', async () => {
    await expect(enviar(duda, fa, [{ tabela: 'pesosCria', gid: uuid(50), op: 'put', dados: { animalId: uuid(20), data: '2026-11-10', peso: 75, criadoEm: 0 } }])).rejects.toThrow('só pode ver');
  });
});
