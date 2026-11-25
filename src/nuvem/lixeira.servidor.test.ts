// Lixeira no servidor: apagar guarda os dados (com o pacote do que foi apagado junto), toda a equipe recebe a
// lixeira, e restaurar passa pelas mesmas regras de gravar. Tenta furar como um app adulterado faria.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subirServidor, type Servidor } from './servidorTeste';

const MIGRACAO = fileURLToPath(new URL('../../supabase/migrations/20261125020000_lixeira.sql', import.meta.url));
const uuid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pacote = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string; versao?: number; dados?: Record<string, unknown> }[];
type Linha = {
  tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean; versao: number;
  lixeira: string | null; apagado_em: Date | string | null; apagado_por: string | null;
};
type NoBanco = { dados: Record<string, unknown> | null; excluido: boolean; lixeira: string | null; versao: number };

describe('lixeira no servidor', () => {
  let s: Servidor;
  let ana: string, gil: string, vito: string, cris: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const put = (tabela: string, n: number, dados: Record<string, unknown>) => ({ tabela, gid: uuid(n), op: 'put', dados: { criadoEm: 0, ...dados } });
  const del = (tabela: string, n: number, lixeira?: string) => ({ tabela, gid: uuid(n), op: 'del', ...(lixeira !== undefined ? { lixeira } : {}) });
  const baixar = (u: string, f = fa) => s.rpc<Linha[]>(u, 'baixar_alteracoes', { f, desde: 0 });
  const linha = async (u: string, n: number) => (await baixar(u)).find((l) => l.gid === uuid(n));
  const banco = async (n: number, tabela?: string) => (await s.pg.query<NoBanco>(
    `select dados, excluido, lixeira, versao::int as versao from public.registros where fazenda_id = $1 and gid = $2 ${tabela ? 'and tabela = $3' : ''}`,
    tabela ? [fa, uuid(n), tabela] : [fa, uuid(n)])).rows[0];
  const tudoOk = (r: Res) => expect(r.map((x) => x.erro ?? x.ok)).toEqual(r.map(() => true));

  const LOTE = (nome: string) => ({ propriedadeId: uuid(1), nome, fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01' });
  const PESAGEM = { loteId: uuid(10), data: '2026-11-01', tipo: 'media', pesoMedio: 280, qtdPesada: 30 };
  const MORTE = (dia: number) => ({ loteId: uuid(30), data: `2026-11-${String(dia).padStart(2, '0')}`, tipo: 'morte', cabecas: 1, valorBruto: 0, valorLiquido: 0 });
  const TRATO = { loteId: uuid(30), formulaId: uuid(4), data: '2026-11-19', cabecas: 30, pesoRef: 300, kgPrevisto: 20, kgFornecido: 20, custo: 30 };
  const CONTORNO = [{ lat: -20.1, lon: -54.1 }, { lat: -20.1, lon: -54.11 }, { lat: -20.11, lon: -54.11 }];

  beforeAll(async () => {
    s = await subirServidor();
    [ana, gil, vito, cris, beto] = await Promise.all(['ana', 'gil', 'vito', 'cris', 'beto'].map((n) => s.novoUsuario(n + '@x')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 4)`, [fa]);
    for (const [u, papel, nome] of [[gil, 'gerente', 'Gil'], [vito, 'vaqueiro', 'Vito'], [cris, 'consultor', 'Cris']]) {
      await s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: papel }), meu_nome: nome });
    }
    tudoOk(await enviar(ana, fa, [
      put('propriedades', 1, { nome: 'Sede' }),
      put('ingredientes', 2, { nome: 'Milho', ms: 88, pb: 9, ndt: 80, ca: 0.1, p: 0.3, preco: 1.5, ativo: true }),
      put('formulas', 4, { nome: 'Proteinado', tipo: 'proteinado', unidade: 'kg', modo: 'direto', consumoPctPV: 0.002, itens: [{ ingredienteId: uuid(2), qtd: 1 }] }),
      put('lotes', 10, LOTE('Nelore 1')),
      put('pesagens', 11, PESAGEM),
      put('lotes', 30, LOTE('Nelore 2')),
      put('lotes', 31, LOTE('Nelore 3')),
      put('vendas', 12, MORTE(10)), put('vendas', 13, MORTE(11)), put('vendas', 14, MORTE(12)), put('vendas', 16, MORTE(13)),
      put('fornecimentos', 15, TRATO),
      put('modulos', 20, { propriedadeId: uuid(1), nome: 'Retiro', sistema: 'rotacionado', diasOcupacao: 5, diasDescanso: 30, capacidadeUA: 2.5 }),
      put('piquetes', 21, { moduloId: uuid(20), nome: 'Piquete 1', areaHa: 10, contorno: CONTORNO }),
    ]));
  }, 30000);

  it('apagar guarda os dados, com o pacote do que foi junto e quem apagou', async () => {
    tudoOk(await enviar(ana, fa, [del('pesagens', 11, pacote(1)), del('lotes', 10, pacote(1))]));
    expect(await banco(11)).toMatchObject({ excluido: true, lixeira: pacote(1), dados: expect.objectContaining({ pesoMedio: 280, loteId: uuid(10) }) });
    // o gerente (outro celular) recebe a lixeira igual, com quando e quem apagou
    const l = await linha(gil, 10);
    expect(l).toMatchObject({ excluido: true, lixeira: pacote(1), apagado_por: 'Ana', dados: expect.objectContaining({ nome: 'Nelore 1' }) });
    expect(Date.now() - new Date(l!.apagado_em!).getTime()).toBeLessThan(60_000);
    // a auditoria continua anotando o que foi apagado
    const au = await s.pg.query<{ antes: Record<string, unknown> }>(`select antes from public.auditoria where fazenda_id = $1 and acao = 'apagar' and gid = $2`, [fa, uuid(10)]);
    expect(au.rows[0].antes).toMatchObject({ nome: 'Nelore 1' });
    // apagar de novo (outro celular, outro pacote) não muda o que já está na lixeira
    const antes = await banco(10);
    tudoOk(await enviar(gil, fa, [del('lotes', 10, pacote(2))]));
    expect(await banco(10)).toEqual(antes);
  });

  it('sem pacote (app antigo) ou com pacote torto: um pacote por envio, criado pelo servidor', async () => {
    tudoOk(await enviar(ana, fa, [del('vendas', 12), del('vendas', 13, 'não-é-uuid')]));
    tudoOk(await enviar(ana, fa, [del('vendas', 14, "x'; drop table public.registros; --")]));
    const [a, b, c] = [await banco(12), await banco(13), await banco(14)];
    expect(a.lixeira).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.lixeira).toBe(a.lixeira);
    expect(c.lixeira).not.toBe(a.lixeira);
    expect(c.dados).toMatchObject({ tipo: 'morte', data: '2026-11-12' });
  });

  it('restaurar é gravar de novo: volta inteiro, sai da lixeira e fica na auditoria', async () => {
    // a pesagem precisa do lote: sozinha, não volta
    const r1 = await enviar(ana, fa, [put('pesagens', 11, PESAGEM)]);
    expect(r1[0].ok).toBe(false);
    expect(await banco(11)).toMatchObject({ excluido: true, lixeira: pacote(1) });
    // o lote primeiro (o celular manda nesta ordem), depois a pesagem
    tudoOk(await enviar(ana, fa, [put('lotes', 10, LOTE('Nelore 1')), put('pesagens', 11, PESAGEM)]));
    expect(await banco(10)).toMatchObject({ excluido: false, lixeira: null, dados: expect.objectContaining({ nome: 'Nelore 1' }) });
    const l = await linha(gil, 11);
    expect(l).toMatchObject({ excluido: false, lixeira: null, apagado_em: null, apagado_por: null, dados: expect.objectContaining({ pesoMedio: 280 }) });
    const au = await s.pg.query<{ antes: Record<string, unknown>; depois: Record<string, unknown> }>(
      `select antes, depois from public.auditoria where fazenda_id = $1 and acao = 'restaurar' and gid = $2`, [fa, uuid(11)]);
    expect(au.rows).toHaveLength(1);
    expect(au.rows[0]).toMatchObject({ antes: { pesoMedio: 280 }, depois: { pesoMedio: 280 } });
  });

  it('o vaqueiro: recebe a lixeira sem dinheiro, restaura o trato com o custo do servidor e não restaura lote', async () => {
    // trato apagado pelo próprio vaqueiro: a lixeira dele vem sem o custo
    tudoOk(await enviar(vito, fa, [del('fornecimentos', 15, pacote(3))]));
    const custo = (await banco(15)).dados!.custo;
    expect(custo).toBeGreaterThan(0);
    const dele = await baixar(vito);
    expect(dele.find((x) => x.gid === uuid(15))).toMatchObject({ excluido: true, lixeira: pacote(3), apagado_por: 'Vito', dados: expect.objectContaining({ custo: 0 }) });
    expect(dele.some((x) => x.tabela === 'vendas')).toBe(false); // vendas apagadas não descem para ele
    // restaura com o que tem (custo 0, ou um valor inventado): fica o custo guardado no servidor
    tudoOk(await enviar(vito, fa, [put('fornecimentos', 15, { ...TRATO, custo: 0 })]));
    expect((await banco(15)).dados!.custo).toBe(custo);
    tudoOk(await enviar(vito, fa, [del('fornecimentos', 15, pacote(3))]));
    tudoOk(await enviar(vito, fa, [put('fornecimentos', 15, { ...TRATO, custo: 99999 })]));
    expect((await banco(15)).dados!.custo).toBe(custo);
    // lote apagado pelo dono: o vaqueiro não traz de volta
    tudoOk(await enviar(ana, fa, [del('lotes', 31, pacote(4))]));
    const r = await enviar(vito, fa, [put('lotes', 31, LOTE('Nelore 3'))]);
    expect(r[0].erro).toMatch(/O vaqueiro só pode atualizar a quantidade de cabeças e o piquete/);
    expect(await banco(31)).toMatchObject({ excluido: true, lixeira: pacote(4) });
  });

  it('consultor não restaura e outra fazenda não vê nem restaura', async () => {
    expect(await linha(cris, 31)).toMatchObject({ excluido: true, lixeira: pacote(4) }); // vê a lixeira
    await expect(enviar(cris, fa, [put('lotes', 31, LOTE('Nelore 3'))])).rejects.toThrow('Consultor');
    await expect(baixar(beto, fa)).rejects.toThrow('não faz parte');
    await expect(enviar(beto, fa, [put('lotes', 31, LOTE('Nelore 3'))])).rejects.toThrow('não faz parte');
    // o mesmo gid na fazenda dele é outro registro (e a pesagem aponta para um lote que lá não existe)
    expect((await enviar(beto, fb, [put('pesagens', 11, PESAGEM)]))[0].ok).toBe(false);
    expect(await banco(31)).toMatchObject({ excluido: true, lixeira: pacote(4) });
  });

  it('NDVI: fica guardado com o piquete apagado e volta junto com ele', async () => {
    await s.pg.query(`select public.gravar_ndvi($1, $2, $3)`, [fa, uuid(21), JSON.stringify([{ data: '2026-11-01', ndvi: 0.71 }, { data: '2026-11-06', ndvi: 0.65 }])]);
    const nd = async () => (await s.pg.query<NoBanco>(`select dados, excluido, lixeira, versao::int as versao from public.registros where fazenda_id = $1 and tabela = 'ndvi' order by dados->>'data'`, [fa])).rows;
    expect((await nd()).map((x) => x.excluido)).toEqual([false, false]);
    tudoOk(await enviar(gil, fa, [del('piquetes', 21, pacote(5))]));
    const guardado = await nd();
    expect(guardado.map((x) => [x.excluido, x.lixeira, x.dados?.ndvi])).toEqual([[true, pacote(5), 0.71], [true, pacote(5), 0.65]]);
    tudoOk(await enviar(gil, fa, [put('piquetes', 21, { moduloId: uuid(20), nome: 'Piquete 1', areaHa: 10, contorno: CONTORNO })]));
    const voltou = await nd();
    expect(voltou.map((x) => [x.excluido, x.lixeira, x.dados?.ndvi])).toEqual([[false, null, 0.71], [false, null, 0.65]]);
    expect(voltou[0].versao).toBeGreaterThan(guardado[0].versao); // desce de novo para os celulares
    // e o app continua sem poder gravar NDVI
    const r = await enviar(ana, fa, [put('ndvi', 50, { piqueteId: uuid(21), data: '2026-11-10', ndvi: 0.5 })]);
    expect(r[0].ok).toBe(false);
  });

  it('anotação restaurada continua de quem anotou (e o vaqueiro só apaga a dele)', async () => {
    const anot = { texto: 'Cerca caída', categoria: 'cerca', urgente: false, feita: false, data: '2026-11-23' };
    tudoOk(await enviar(vito, fa, [put('anotacoes', 40, anot)]));
    tudoOk(await enviar(ana, fa, [put('anotacoes', 42, anot)]));
    expect((await enviar(vito, fa, [del('anotacoes', 42, pacote(6))]))[0].erro).toMatch(/só quem anotou/);
    tudoOk(await enviar(ana, fa, [del('anotacoes', 40, pacote(6))]));
    expect((await banco(40)).dados).toMatchObject({ autor: 'Vito', autorId: vito });
    // a Ana restaura com os dados da lixeira (ou com outro autor, de um app adulterado): o autor não muda
    tudoOk(await enviar(ana, fa, [put('anotacoes', 40, { ...anot, autor: 'Ana', autorId: ana })]));
    expect((await banco(40)).dados).toMatchObject({ autor: 'Vito', autorId: vito, texto: 'Cerca caída' });
  });

  it('funcionário com conta do app: só o dono restaura', async () => {
    const func = { nome: 'Vito', funcao: 'Vaqueiro', salario: 2400, admissao: '2026-09-01', usuarioId: vito };
    tudoOk(await enviar(ana, fa, [put('funcionarios', 41, func)]));
    tudoOk(await enviar(ana, fa, [del('funcionarios', 41, pacote(7))]));
    expect((await enviar(gil, fa, [put('funcionarios', 41, func)]))[0].erro).toMatch(/Só o dono liga o funcionário/);
    expect(await linha(vito, 41)).toBeUndefined(); // o vaqueiro não recebe funcionários, nem na lixeira
    tudoOk(await enviar(ana, fa, [put('funcionarios', 41, func)]));
    expect(await banco(41)).toMatchObject({ excluido: false, dados: expect.objectContaining({ salario: 2400, usuarioId: vito }) });
  });

  it('o que foi apagado antes da migração volta para a lixeira com os dados da auditoria', async () => {
    // como ficava antes: registro apagado sem dados e o "antes" guardado na auditoria
    const velho = async (n: number, tabela: string, gid = uuid(n)) => {
      await s.pg.query(`insert into public.registros (fazenda_id, tabela, gid, dados, excluido, versao, atualizado_por, atualizado_em)
        values ($1, $2, $3, null, true, nextval('public.registros_versao'), $4, '2026-11-20 10:00:00+00')`, [fa, tabela, gid, tabela === 'ndvi' ? null : gil]);
    };
    const apagou = async (gid: string, tabela: string, antes: unknown, em: string, quem = gil) =>
      s.pg.query(`insert into public.auditoria (fazenda_id, usuario_id, acao, tabela, gid, antes, em) values ($1, $2, 'apagar', $3, $4, $5, $6)`,
        [fa, quem, tabela, gid, JSON.stringify(antes), em]);
    await velho(60, 'vendas'); await velho(61, 'vendas'); await velho(62, 'vendas');
    await velho(0, 'config', 'precoArroba'); await velho(63, 'ndvi'); await velho(64, 'vendas');
    await apagou(uuid(60), 'vendas', MORTE(20), '2026-11-20 10:00:00+00');
    await apagou(uuid(61), 'vendas', MORTE(21), '2026-11-20 10:00:00+00'); // mesmo envio: mesmo pacote
    await apagou(uuid(62), 'vendas', MORTE(1), '2026-11-01 08:00:00+00');
    await apagou(uuid(62), 'vendas', MORTE(22), '2026-11-21 09:00:00+00'); // apagado de novo depois: vale o último
    await apagou('precoArroba', 'config', { chave: 'precoArroba', valor: 300 }, '2026-11-20 10:00:00+00');
    await apagou(uuid(63), 'ndvi', { piqueteId: uuid(21), data: '2026-10-01', ndvi: 0.5 }, '2026-11-20 10:00:00+00');
    await apagou(uuid(64), 'vendas', null, '2026-11-20 10:00:00+00'); // sem "antes": fica como está
    const antes = await banco(60);

    const sql = readFileSync(MIGRACAO, 'utf8');
    await s.pg.exec(sql.slice(sql.indexOf('-- ---------------------------------------------------------------- 6.'), sql.indexOf('-- ---------------------------------------------------------------- permissões')));

    const [a, b, c] = [await banco(60), await banco(61), await banco(62)];
    expect(a).toMatchObject({ excluido: true, dados: expect.objectContaining({ data: '2026-11-20' }) });
    expect(a.lixeira).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.lixeira).toBe(a.lixeira);
    expect(c).toMatchObject({ dados: expect.objectContaining({ data: '2026-11-22' }) });
    expect(c.lixeira).not.toBe(a.lixeira);
    expect(a.versao).toBeGreaterThan(antes.versao); // desce para os celulares
    expect((await banco(63, 'ndvi')).dados).toBeNull();
    expect((await banco(64)).dados).toBeNull();
    const cfg = await s.pg.query<{ dados: unknown }>(`select dados from public.registros where fazenda_id = $1 and tabela = 'config' and gid = 'precoArroba'`, [fa]);
    expect(cfg.rows[0].dados).toBeNull();
    // quem apagou e quando continuam os de antes
    const l = await linha(ana, 60);
    expect(l).toMatchObject({ lixeira: a.lixeira, apagado_por: 'Gil' });
    expect(new Date(l!.apagado_em!).toISOString()).toBe('2026-11-20T10:00:00.000Z');
    // e dá para restaurar
    tudoOk(await enviar(ana, fa, [put('vendas', 60, MORTE(20))]));
    expect(await banco(60)).toMatchObject({ excluido: false, lixeira: null });
  });

  it('a migração pode rodar de novo sem estragar nada', async () => {
    const foto = async () => (await s.pg.query<{ gid: string; excluido: boolean; lixeira: string | null; dados: unknown }>(
      `select gid, excluido, lixeira, dados from public.registros where fazenda_id = $1 order by tabela, gid`, [fa])).rows;
    const antes = await foto();
    await s.pg.exec(readFileSync(MIGRACAO, 'utf8'));
    expect(await foto()).toEqual(antes);
    // e as funções continuam funcionando, com as mesmas permissões
    tudoOk(await enviar(ana, fa, [del('vendas', 16, pacote(8))]));
    expect(await linha(gil, 16)).toMatchObject({ lixeira: pacote(8), apagado_por: 'Ana' });
    await expect(s.rpc(null, 'baixar_alteracoes', { f: fa, desde: 0 })).rejects.toThrow();
    const r = await s.como(ana, () => s.pg.query('select public.bf_ndvi_do_piquete_restaurado()').catch((e) => e));
    expect(String(r)).toMatch(/permission denied|trigger/);
  });
});
