// Pasto no servidor: um ocupante por piquete (lotes, grupos e ocupações), o vaqueiro levando o gado,
// e o NDVI que só o satélite grava. Tenta furar como um app adulterado faria.
import { describe, it, expect, beforeAll } from 'vitest';
import { subirServidor, type Servidor } from './servidorTeste';

const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string }[];
type Linha = { tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean };

describe('pasto no servidor', () => {
  let s: Servidor;
  let ana: string, vito: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const lote = (n: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'lotes', gid: uuid(n), op: 'put',
    dados: { propriedadeId: uuid(1), nome: 'Lote ' + n, fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01', criadoEm: 0, ...extra },
  });
  const ocup = (n: number, piquete: number, loteN: number, entrada: string, saida: string | null, extra: Record<string, unknown> = {}) => ({
    tabela: 'ocupacoes', gid: uuid(n), op: 'put',
    dados: { piqueteId: uuid(piquete), tipo: 'lote', ocupanteId: uuid(loteN), entrada, saida, cabecas: 30, criadoEm: 0, ...extra },
  });
  const baixar = async (u: string, f: string) => s.rpc<Linha[]>(u, 'baixar_alteracoes', { f, desde: 0 });

  beforeAll(async () => {
    s = await subirServidor();
    [ana, vito, beto] = await Promise.all(['ana', 'vito', 'beto'].map((n) => s.novoUsuario(n + '@x')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 4)`, [fa]);
    await s.rpc(vito, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: 'vaqueiro' }), meu_nome: 'Vito' });
    const contorno = [{ lat: -20.1, lon: -54.1 }, { lat: -20.1, lon: -54.11 }, { lat: -20.11, lon: -54.11 }];
    const r = await enviar(ana, fa, [
      { tabela: 'propriedades', gid: uuid(1), op: 'put', dados: { nome: 'Boa Vista', criadoEm: 0 } },
      { tabela: 'modulos', gid: uuid(2), op: 'put', dados: { propriedadeId: uuid(1), nome: 'Retiro', sistema: 'rotacionado', diasOcupacao: 5, diasDescanso: 30, capacidadeUA: 2.5, criadoEm: 0 } },
      { tabela: 'piquetes', gid: uuid(3), op: 'put', dados: { moduloId: uuid(2), nome: 'Piquete 1', areaHa: 10, capim: 'Mombaça', contorno, criadoEm: 0 } },
      { tabela: 'piquetes', gid: uuid(4), op: 'put', dados: { moduloId: uuid(2), nome: 'Piquete 2', areaHa: 10, criadoEm: 0 } },
      lote(10), lote(11),
    ]);
    expect(r.filter((x) => !x.ok)).toEqual([]);
  }, 30000);

  it('dois lotes ativos não ficam no mesmo piquete', async () => {
    expect((await enviar(ana, fa, [lote(10, { piqueteId: uuid(3) })]))[0].ok).toBe(true);
    const r = await enviar(ana, fa, [lote(11, { piqueteId: uuid(3) })]);
    expect(r[0]).toMatchObject({ ok: false });
    expect(r[0].erro).toMatch(/^Piquete ocupado: Piquete 1 já tem o lote Lote 10/);
    // lote encerrado não ocupa
    expect((await enviar(ana, fa, [lote(12, { piqueteId: uuid(3), encerrado: true })]))[0].ok).toBe(true);
    // grupo de manejo da cria também conta
    await s.pg.query(`insert into public.registros (fazenda_id, tabela, gid, dados, versao) values ($1, 'grupos', $2, $3, nextval('public.registros_versao'))`,
      [fa, uuid(20), JSON.stringify({ nome: 'Matrizes', piqueteId: uuid(4) })]);
    expect((await enviar(ana, fa, [lote(11, { piqueteId: uuid(4) })]))[0].erro).toMatch(/já tem o grupo Matrizes/);
    await s.pg.query(`delete from public.registros where fazenda_id = $1 and tabela = 'grupos'`, [fa]);
  });

  it('o vaqueiro leva o gado: muda o piquete do lote e grava a ocupação, mas não muda o resto do lote', async () => {
    const r = await enviar(vito, fa, [
      ocup(30, 3, 10, '2026-11-01', '2026-11-06'),
      ocup(31, 4, 10, '2026-11-06', null, { alturaEntrada: 60, midiasEntrada: [{ arq: uuid(900), ext: 'jpg' }, { arq: uuid(901), ext: 'webm' }] }),
      lote(10, { piqueteId: uuid(4) }),
    ]);
    expect(r.filter((x) => !x.ok)).toEqual([]);
    expect((await enviar(vito, fa, [lote(10, { piqueteId: uuid(4), nome: 'Outro nome' })]))[0].erro).toMatch(/quantidade de cabeças e o piquete/);
  });

  it('ocupações do mesmo piquete não se cruzam; sair e entrar no mesmo dia pode', async () => {
    expect((await enviar(ana, fa, [ocup(32, 4, 11, '2026-11-08', null)]))[0].erro).toMatch(/^Piquete ocupado: Piquete 2 já tinha outro lote ou grupo de 06\/11\/2026 a hoje/);
    expect((await enviar(ana, fa, [ocup(33, 3, 11, '2026-11-02', '2026-11-04')]))[0].erro).toMatch(/Piquete ocupado/);
    expect((await enviar(ana, fa, [ocup(33, 3, 11, '2026-11-06', null)]))[0].ok).toBe(true);
    // o mesmo lote em dois piquetes ao mesmo tempo
    expect((await enviar(ana, fa, [ocup(34, 3, 10, '2026-11-20', null)]))[0].erro).toMatch(/Piquete ocupado/);
    expect((await enviar(ana, fa, [ocup(35, 3, 10, '2026-10-20', '2026-10-25')]))[0].ok).toBe(true);
    // saída antes da entrada e mídia com id torto
    expect((await enviar(ana, fa, [ocup(36, 3, 11, '2026-12-10', '2026-12-01')]))[0].erro).toMatch(/saída é antes da entrada/);
    expect((await enviar(ana, fa, [ocup(33, 3, 11, '2026-11-06', null, { midiasSaida: [{ arq: '../x', ext: 'jpg' }] })]))[0].erro).toMatch(/inválid/);
  });

  it('só dono e gerente apagam uma ocupação', async () => {
    expect((await enviar(vito, fa, [{ tabela: 'ocupacoes', gid: uuid(35), op: 'del' }]))[0].erro).toMatch(/Só o dono ou o gerente/);
    expect((await enviar(ana, fa, [{ tabela: 'ocupacoes', gid: uuid(35), op: 'del' }]))[0].ok).toBe(true);
  });

  it('NDVI: o app não grava; o satélite grava pelo service_role e o vaqueiro recebe', async () => {
    expect((await enviar(ana, fa, [{ tabela: 'ndvi', gid: uuid(50), op: 'put', dados: { piqueteId: uuid(3), data: '2026-11-01', ndvi: 0.8, criadoEm: 0 } }]))[0].erro)
      .toMatch(/vem do satélite/);
    await expect(s.rpc(ana, 'gravar_ndvi', { p_fazenda: fa, p_piquete: uuid(3), p_linhas: [] })).rejects.toThrow();
    await expect(s.rpc(ana, 'piquetes_para_ndvi', {})).rejects.toThrow();
    const pq = await s.pg.query<{ fazenda_id: string; gid: string }>(`select * from public.piquetes_para_ndvi()`);
    expect(pq.rows.map((x) => x.gid)).toEqual([uuid(3)]); // só o piquete com contorno
    const linhas = [{ data: '2026-11-01', ndvi: 0.71234, nuvemPct: 5 }, { data: '2026-11-06', ndvi: 0.65, min: 0.2, max: 0.9 }, { data: 'lixo', ndvi: 3 }];
    expect((await s.pg.query<{ n: number }>(`select public.gravar_ndvi($1, $2, $3) as n`, [fa, uuid(3), JSON.stringify(linhas)])).rows[0].n).toBe(2);
    // de novo, mesma data: atualiza sem duplicar
    await s.pg.query(`select public.gravar_ndvi($1, $2, $3)`, [fa, uuid(3), JSON.stringify(linhas.slice(0, 1))]);
    // piquete de outra fazenda: não grava
    expect((await s.pg.query<{ n: number }>(`select public.gravar_ndvi($1, $2, $3) as n`, [fb, uuid(3), JSON.stringify(linhas)])).rows[0].n).toBe(0);
    const nd = (await baixar(vito, fa)).filter((l) => l.tabela === 'ndvi' && !l.excluido);
    expect(nd).toHaveLength(2);
    expect(nd.find((l) => l.dados?.data === '2026-11-01')?.dados).toMatchObject({ piqueteId: uuid(3), ndvi: 0.712, nuvemPct: 5 });
    expect((await baixar(beto, fb)).some((l) => l.tabela === 'ndvi')).toBe(false);
    // apagou o piquete: o NDVI vai junto
    await enviar(ana, fa, [{ tabela: 'piquetes', gid: uuid(3), op: 'del' }]);
    expect((await baixar(ana, fa)).filter((l) => l.tabela === 'ndvi').every((l) => l.excluido)).toBe(true);
  });

  it('pedir NDVI: só dono/gerente e no máximo 2 por hora', async () => {
    await expect(s.rpc(vito, 'pedir_ndvi', { f: fa })).rejects.toThrow(/dono ou o gerente/);
    await expect(s.rpc(beto, 'pedir_ndvi', { f: fa })).rejects.toThrow();
    expect(await s.rpc(ana, 'pedir_ndvi', { f: fa })).toBe(true);
    expect(await s.rpc(ana, 'pedir_ndvi', { f: fa })).toBe(true);
    await expect(s.rpc(ana, 'pedir_ndvi', { f: fa })).rejects.toThrow();
  });

  it('foto do satélite: quem é da fazenda recebe o contorno da nuvem; outra fazenda não; com limite', async () => {
    const contorno = [{ lat: -20.2, lon: -54.2 }, { lat: -20.2, lon: -54.21 }, { lat: -20.21, lon: -54.21 }];
    await enviar(ana, fa, [{ tabela: 'piquetes', gid: uuid(5), op: 'put', dados: { moduloId: uuid(2), nome: 'Piquete 5', areaHa: 10, contorno, criadoEm: 0 } }]);
    expect(await s.rpc(vito, 'pedir_foto_satelite', { f: fa, p: uuid(5) })).toEqual(contorno);
    await expect(s.rpc(beto, 'pedir_foto_satelite', { f: fa, p: uuid(5) })).rejects.toThrow(/não faz parte/);
    await expect(s.rpc(beto, 'pedir_foto_satelite', { f: fb, p: uuid(5) })).rejects.toThrow(/sem contorno|não tem contorno/);
    await expect(s.rpc(ana, 'pedir_foto_satelite', { f: fa, p: uuid(4) })).rejects.toThrow(/não tem contorno/);
    for (let i = 0; i < 39; i++) await s.rpc(vito, 'pedir_foto_satelite', { f: fa, p: uuid(5) });
    await expect(s.rpc(vito, 'pedir_foto_satelite', { f: fa, p: uuid(5) })).rejects.toThrow(/Muitas tentativas/);
  });

  it('áudio do pasto no balde (webm/ogg/m4a), e nada fora disso', async () => {
    const f = (nome: string) => s.pg.query<{ f: string | null }>(`select bf_privado.fazenda_da_foto($1) as f`, [nome]).then((r) => r.rows[0].f);
    expect(await f(`${fa}/${uuid(901)}.webm`)).toBe(fa);
    expect(await f(`${fa}/${uuid(901)}.m4a`)).toBe(fa);
    expect(await f(`${fa}/${uuid(901)}.mp3`)).toBeNull();
    expect(await f(`${fa}/${uuid(901)}.jpg.webm`)).toBeNull();
  });
});
