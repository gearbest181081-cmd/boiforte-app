// Área do módulo no servidor: a soma das áreas dos piquetes não passa da área do módulo.
// Tenta furar como um app adulterado (ou desatualizado) faria, chamando a API direto.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subirServidor, type Servidor } from './servidorTeste';

const uuid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string; dados?: Record<string, unknown> }[];
const MIGRACAO = fileURLToPath(new URL('../../supabase/migrations/20261124204700_area_modulo.sql', import.meta.url));

describe('área do módulo no servidor', () => {
  let s: Servidor;
  let ana: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const um = async (u: string, f: string, op: unknown) => (await enviar(u, f, [op]))[0];
  const modulo = (n: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'modulos', gid: uuid(n), op: 'put', dados: { propriedadeId: uuid(1), nome: 'Retiro ' + n, criadoEm: 0, ...extra },
  });
  const piquete = (n: number, mod: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'piquetes', gid: uuid(n), op: 'put', dados: { moduloId: uuid(mod), nome: 'P' + n, criadoEm: 0, ...extra },
  });
  const regras = async (tabela: string) =>
    (await s.pg.query<{ regras: Record<string, unknown> }>('select regras from public.bf_esquemas where tabela = $1', [tabela])).rows[0].regras;

  beforeAll(async () => {
    s = await subirServidor();
    [ana, beto] = await Promise.all(['ana', 'beto'].map((n) => s.novoUsuario(n + '@x')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    for (const [u, f] of [[ana, fa], [beto, fb]]) {
      const r = await enviar(u, f, [{ tabela: 'propriedades', gid: uuid(1), op: 'put', dados: { nome: 'Fazenda', criadoEm: 0 } }]);
      expect(r.every((x) => x.ok)).toBe(true);
    }
    expect((await um(ana, fa, modulo(2, { areaHa: 30 }))).ok).toBe(true);
  }, 30000);

  it('a soma dos piquetes não passa da área do módulo', async () => {
    expect((await enviar(ana, fa, [piquete(10, 2, { areaHa: 12 }), piquete(11, 2, { areaHa: 12 })])).every((x) => x.ok)).toBe(true);
    const r = await um(ana, fa, piquete(12, 2, { areaHa: 7 }));
    expect(r.ok).toBe(false);
    expect(r.erro).toBe('Área do módulo: o módulo Retiro 2 tem 30 ha e os outros piquetes já usam 24 ha. O piquete P12 pode ter no máximo 6 ha.');
    expect((await um(ana, fa, piquete(12, 2, { areaHa: 6 }))).ok).toBe(true);
    expect((await um(ana, fa, piquete(13, 2))).ok).toBe(true); // piquete sem área não pesa
    expect((await um(ana, fa, piquete(14, 2, { areaHa: 0.0005 }))).ok).toBe(true); // folga de arredondamento (10 m²)
    expect((await um(ana, fa, piquete(14, 2, { areaHa: 0.01 }))).erro).toMatch(/^Área do módulo:.*no máximo 0 ha\.$/);
  });

  it('crescer não cabe; diminuir, mudar o nome ou o contorno sempre pode', async () => {
    expect((await um(ana, fa, piquete(10, 2, { areaHa: 13 }))).erro).toMatch(/^Área do módulo: .*O piquete P10 pode ter no máximo 12 ha\./);
    const contorno = [{ lat: -20.1, lon: -54.1 }, { lat: -20.1, lon: -54.11 }, { lat: -20.11, lon: -54.11 }];
    expect((await um(ana, fa, piquete(10, 2, { areaHa: 10, nome: 'Beira do rio', contorno }))).ok).toBe(true);
    expect((await um(ana, fa, piquete(10, 2, { areaHa: 12, nome: 'Beira do rio', contorno }))).ok).toBe(true);
  });

  it('o módulo não fica menor que os piquetes, nem volta a ficar em branco', async () => {
    expect((await um(ana, fa, modulo(2, { areaHa: 29.99 }))).erro).toBe('Área do módulo: os piquetes do módulo Retiro 2 já somam 30 ha. A área do módulo não pode ser menor que isso.');
    expect((await um(ana, fa, modulo(2))).erro).toMatch(/^Área do módulo: a área não pode ficar em branco/); // app desatualizado
    expect((await um(ana, fa, modulo(2, { areaHa: 0 }))).erro).toMatch(/fora do limite/);
    expect((await um(ana, fa, modulo(2, { areaHa: '40' }))).erro).toMatch(/deve ser um número/);
    expect((await um(ana, fa, modulo(2, { areaHa: 40, diasDescanso: 30 }))).ok).toBe(true);
    expect((await um(ana, fa, piquete(12, 2, { areaHa: 16 }))).ok).toBe(true); // agora cabe
    expect((await um(ana, fa, modulo(2, { areaHa: 40, diasDescanso: 28 }))).ok).toBe(true); // mesma área: só o manejo
  });

  it('piquete que muda de módulo é conferido no módulo novo', async () => {
    expect((await um(ana, fa, modulo(3, { areaHa: 5 }))).ok).toBe(true);
    expect((await um(ana, fa, piquete(10, 3, { areaHa: 12, nome: 'Beira do rio' }))).erro).toMatch(/^Área do módulo: o módulo Retiro 3 tem 5 ha\. O piquete Beira do rio pode ter no máximo 5 ha\./);
    expect((await um(ana, fa, piquete(10, 3, { areaHa: 5, nome: 'Beira do rio' }))).ok).toBe(true);
  });

  it('módulo antigo, sem área: sem limite até informar a área', async () => {
    expect((await um(ana, fa, modulo(4))).ok).toBe(true);
    expect((await enviar(ana, fa, [piquete(20, 4, { areaHa: 50 }), piquete(21, 4, { areaHa: 60 })])).every((x) => x.ok)).toBe(true);
    expect((await um(ana, fa, modulo(4, { areaHa: 100 }))).erro).toMatch(/já somam 110 ha/);
    expect((await um(ana, fa, modulo(4, { areaHa: 110 }))).ok).toBe(true);
    expect((await um(ana, fa, piquete(22, 4, { areaHa: 1 }))).erro).toMatch(/^Área do módulo: .*no máximo 0 ha/);
  });

  it('apagar um piquete libera a área; trazer de volta confere de novo', async () => {
    const antes = (await s.pg.query<{ dados: unknown }>(`select dados from public.registros where fazenda_id = $1 and tabela = 'piquetes' and gid = $2`, [fa, uuid(21)])).rows[0].dados;
    expect((await um(ana, fa, { tabela: 'piquetes', gid: uuid(21), op: 'del' })).ok).toBe(true);
    expect((await um(ana, fa, piquete(22, 4, { areaHa: 59 }))).ok).toBe(true);
    // a lixeira (ou alguém direto no banco) trazendo o piquete apagado de volta também passa pela conferência
    await expect(s.pg.query(`update public.registros set excluido = false, dados = $3 where fazenda_id = $1 and tabela = 'piquetes' and gid = $2`, [fa, uuid(21), JSON.stringify(antes)]))
      .rejects.toThrow(/^Área do módulo: o módulo Retiro 4 tem 110 ha e os outros piquetes já usam 109 ha/);
    // o mesmo gid recriado pelo app também
    expect((await um(ana, fa, piquete(21, 4, { areaHa: 60 }))).erro).toMatch(/no máximo 1 ha/);
  });

  it('cada fazenda conta só os próprios piquetes', async () => {
    // mesmos gids na outra fazenda: os 40 ha de piquetes da Boa Vista não pesam na Santa Rita
    expect((await um(beto, fb, modulo(2, { areaHa: 5 }))).ok).toBe(true);
    expect((await um(beto, fb, piquete(10, 2, { areaHa: 5 }))).ok).toBe(true);
    expect((await um(beto, fb, piquete(11, 2, { areaHa: 0.5 }))).erro).toMatch(/^Área do módulo: o módulo Retiro 2 tem 5 ha/);
  });

  it('a migração só acrescenta a área ao módulo e pode rodar de novo', async () => {
    // Simula a ordem trocada: uma regra nova de outra migração (ex.: Cria) e a área do módulo apagada por um bloco antigo.
    await s.pg.query(`update public.bf_esquemas set regras = regras || '{"grupoId":{"t":"id","obrigatorio":false}}'::jsonb where tabela = 'animais'`);
    await s.pg.query(`update public.bf_esquemas set regras = regras - 'areaHa' where tabela = 'modulos'`);
    const lotes = await regras('lotes');
    await s.pg.exec(readFileSync(MIGRACAO, 'utf8'));
    await s.pg.exec(readFileSync(MIGRACAO, 'utf8'));
    expect((await regras('modulos')).areaHa).toEqual({ t: 'num', min: 0.01, max: 1000000, obrigatorio: false, inteiro: false });
    expect((await regras('animais')).grupoId).toBeTruthy(); // não desfez a regra da outra migração
    expect(await regras('lotes')).toEqual(lotes);
    // e o gatilho continua um só, valendo (o Retiro 2 tem 40 ha e os piquetes dele somam 28 ha)
    expect((await um(ana, fa, piquete(30, 2, { areaHa: 20 }))).erro).toMatch(/^Área do módulo: .*no máximo 12 ha\.$/);
    const gat = await s.pg.query(`select count(*)::int as n from pg_trigger where tgname = 'registros_area_modulo'`);
    expect(gat.rows[0]).toEqual({ n: 1 });
  });

  it('o app não chama as funções do gatilho', async () => {
    await expect(s.rpc(ana, 'bf_ha', { v: 1 })).rejects.toThrow(/permission denied/);
  });
});
