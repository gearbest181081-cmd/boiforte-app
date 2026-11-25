// Rastreabilidade no servidor: documentos e contorno da fazenda são guardados, GTAs só por dono/gerente,
// o vaqueiro vê mas não lança, e as conferências da GTA (animais > 0, lote da mesma fazenda).
import { describe, it, expect, beforeAll } from 'vitest';
import { subirServidor, type Servidor } from './servidorTeste';

const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string }[];
type Linha = { tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean };

describe('rastreabilidade no servidor', () => {
  let s: Servidor;
  let ana: string, gil: string, vito: string, duda: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const ler = async (u: string, f: string, gid: string) =>
    (await s.rpc<Linha[]>(u, 'baixar_alteracoes', { f, desde: 0 })).filter((l) => l.gid === gid).pop();
  const entrar = async (u: string, papel: string, nome: string) =>
    s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: papel }), meu_nome: nome });
  const gta = (n: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'gtas', gid: uuid(n), op: 'put',
    dados: { propriedadeId: uuid(1), loteId: uuid(3), sentido: 'entrada', numero: '123456', uf: 'MS', emissao: '2026-11-20', machos: 30, femeas: 0, criadoEm: 0, ...extra },
  });
  const contorno = [{ lat: -20.1, lon: -54.1 }, { lat: -20.1, lon: -54.0 }, { lat: -20.0, lon: -54.0 }, { lat: -20.0, lon: -54.1 }];
  const prop = (n: number, extra: Record<string, unknown> = {}) => ({ tabela: 'propriedades', gid: uuid(n), op: 'put', dados: { nome: 'Fazenda ' + n, criadoEm: 0, ...extra } });
  const lote = (n: number, p: number) => ({
    tabela: 'lotes', gid: uuid(n), op: 'put',
    dados: { propriedadeId: uuid(p), nome: 'Lote ' + n, fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01', criadoEm: 0 },
  });

  beforeAll(async () => {
    s = await subirServidor();
    [ana, gil, vito, duda, beto] = await Promise.all(['ana', 'gil', 'vito', 'duda', 'beto'].map((n) => s.novoUsuario(n + '@x')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 4)`, [fa]);
    await entrar(gil, 'gerente', 'Gil');
    await entrar(vito, 'vaqueiro', 'Vito');
    await entrar(duda, 'consultor', 'Duda');
    const r = await enviar(ana, fa, [prop(1), prop(2), lote(3, 1), lote(4, 2)]);
    expect(r.every((x) => x.ok)).toBe(true);
    await enviar(beto, fb, [prop(50), lote(51, 50)]);
  }, 30000);

  it('documentos e contorno da fazenda são guardados e conferidos', async () => {
    const r = await enviar(ana, fa, [prop(1, { lat: -20.05, lon: -54.05, contorno, car: 'MS-5002704-0123456789ABCDEF0123456789ABCDEF', carSituacao: 'ativo', cib: '12345678', itrAno: 2026, semDesmate: true })]);
    expect(r[0]).toMatchObject({ ok: true });
    expect((await ler(vito, fa, uuid(1)))?.dados).toMatchObject({ lat: -20.05, contorno, carSituacao: 'ativo', itrAno: 2026, semDesmate: true });
    // coordenada impossível, situação inventada e contorno gigante são recusados
    expect((await enviar(ana, fa, [prop(1, { lat: -120 })]))[0].ok).toBe(false);
    expect((await enviar(ana, fa, [prop(1, { carSituacao: 'aprovado' })]))[0].ok).toBe(false);
    const enorme = Array.from({ length: 2001 }, (_, i) => ({ lat: -20 - i * 1e-5, lon: -54 }));
    expect((await enviar(ana, fa, [prop(1, { contorno: enorme })]))[0].ok).toBe(false);
    expect((await enviar(ana, fa, [prop(1, { contorno: [{ lat: -20, lon: 'x' }] })]))[0].ok).toBe(false);
  });

  it('vaqueiro não muda os documentos da fazenda', async () => {
    const r = await enviar(vito, fa, [prop(1, { car: 'outro' })]);
    expect(r[0].ok).toBe(false);
  });

  it('dono e gerente lançam GTA; vaqueiro vê mas não lança; consultor não lança', async () => {
    expect((await enviar(ana, fa, [gta(10)]))[0]).toMatchObject({ ok: true });
    expect((await enviar(gil, fa, [gta(11, { sentido: 'saida', finalidade: 'abate', loteId: null })]))[0]).toMatchObject({ ok: true });
    expect((await ler(vito, fa, uuid(10)))?.dados).toMatchObject({ numero: '123456', machos: 30 });
    expect((await enviar(vito, fa, [gta(12)]))[0].ok).toBe(false);
    expect((await enviar(vito, fa, [{ tabela: 'gtas', gid: uuid(10), op: 'del' }]))[0].ok).toBe(false);
    await expect(enviar(duda, fa, [gta(13)])).rejects.toThrow(/Consultor/);
  });

  it('GTA sem animais, com lote de outra fazenda ou de outra conta é recusada', async () => {
    const semAnimais = await enviar(ana, fa, [gta(20, { machos: 0, femeas: 0 })]);
    expect(semAnimais[0]).toMatchObject({ ok: false });
    expect(semAnimais[0].erro).toMatch(/animais/);
    const outraProp = await enviar(ana, fa, [gta(21, { loteId: uuid(4) })]);
    expect(outraProp[0]).toMatchObject({ ok: false });
    expect(outraProp[0].erro).toMatch(/outra fazenda/);
    expect((await enviar(ana, fa, [gta(22, { loteId: uuid(51) })]))[0].ok).toBe(false); // lote da conta do Beto
    expect((await enviar(ana, fa, [gta(23, { finalidade: 'contrabando' })]))[0].ok).toBe(false);
  });

  it('outra conta não vê as GTAs', async () => {
    const linhas = await s.rpc<Linha[]>(beto, 'baixar_alteracoes', { f: fb, desde: 0 });
    expect(linhas.some((l) => l.tabela === 'gtas')).toBe(false);
    await expect(s.rpc(beto, 'baixar_alteracoes', { f: fa, desde: 0 })).rejects.toThrow();
  });
});
