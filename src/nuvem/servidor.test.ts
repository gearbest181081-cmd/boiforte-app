// Testes do servidor: rodam as migrações reais do Supabase num Postgres em memória e tentam
// furar a segurança do jeito que um app adulterado faria (chamando a API direto).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gerarSqlEsquemas } from './gerarSql';
import { subirServidor, type Servidor } from './servidorTeste';

const ARQ = fileURLToPath(new URL('../../supabase/migrations/20261119000002_esquemas.sql', import.meta.url));
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string; versao?: number; dados?: Record<string, unknown> }[];

describe('SQL das regras', () => {
  it('está igual ao gerado a partir de src/validar.ts', () => {
    const novo = gerarSqlEsquemas();
    if (process.env.ATUALIZAR_SQL) writeFileSync(ARQ, novo);
    expect(readFileSync(ARQ, 'utf8')).toBe(novo);
  });
});

describe('servidor', () => {
  let s: Servidor;
  let ana: string, beto: string, caio: string, duda: string, eva: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const prop = (n: number, nome = 'Fazenda') => ({ tabela: 'propriedades', gid: uuid(n), op: 'put', dados: { nome, criadoEm: 0 } });
  const lote = (n: number, p: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'lotes', gid: uuid(n), op: 'put',
    dados: { propriedadeId: uuid(p), nome: 'Lote ' + n, fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01', criadoEm: 0, ...extra },
  });

  beforeAll(async () => {
    s = await subirServidor();
    ana = await s.novoUsuario('ana@x');
    beto = await s.novoUsuario('beto@x');
    caio = await s.novoUsuario('caio@x');
    duda = await s.novoUsuario('duda@x');
    eva = await s.novoUsuario('eva@x');
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    const r = await enviar(ana, fa, [prop(1), lote(2, 1)]);
    expect(r.every((x) => x.ok)).toBe(true);
  }, 30000);

  it('sem login não faz nada', async () => {
    await expect(s.rpc(null, 'criar_fazenda', { p_nome: 'X' })).rejects.toThrow();
    const r = await s.como(null, () => s.pg.query('select * from public.registros').catch((e) => e));
    expect(String(r)).toMatch(/permission denied/);
  });

  it('cada um só vê a própria fazenda', async () => {
    const deBeto = await s.como(beto, () => s.pg.query('select * from public.registros').catch((e) => e));
    expect(String(deBeto)).toMatch(/permission denied/); // leitura só por baixar_alteracoes
    const fazBeto = await s.como(beto, () => s.pg.query<{ id: string }>('select id from public.fazendas'));
    expect(fazBeto.rows.map((x) => x.id)).toEqual([fb]);
    await expect(s.rpc(beto, 'baixar_alteracoes', { f: fa, desde: 0 })).rejects.toThrow('não faz parte');
    await expect(enviar(beto, fa, [prop(99)])).rejects.toThrow('não faz parte');
  });

  it('o app não grava direto nas tabelas nem chama funções internas', async () => {
    const tentativas = [
      `insert into public.registros (fazenda_id, tabela, gid, dados, versao) values ('${fa}', 'lotes', '${uuid(50)}', '{}', 1)`,
      `update public.registros set dados = '{}'`,
      `delete from public.registros`,
      `insert into public.membros (fazenda_id, usuario_id, papel) values ('${fa}', '${beto}', 'dono')`,
      `update public.membros set papel = 'dono'`,
      `insert into public.cotacoes (produto, praca, data, valor, unidade, fonte) values ('boi_gordo', 'SP', '2026-11-19', 1, 'R$/@', 'x')`,
      `select public.bf_validar('lotes', '{}', '${fa}')`,
      `select public.bf_limite('x', 1, 1)`,
      `select * from public.limites`,
      `select * from public.bf_esquemas`,
    ];
    for (const sql of tentativas) {
      const e = await s.como(beto, () => s.pg.query(sql).then(() => null, (x) => x));
      expect(String(e), sql).toMatch(/permission denied|row-level security/);
    }
  });

  it('referência para registro de outra fazenda é recusada', async () => {
    await enviar(beto, fb, [prop(10, 'SR')]);
    const r = await enviar(beto, fb, [lote(11, 1)]); // propriedade 1 é da Ana
    expect(r[0].ok).toBe(false);
    expect(r[0].erro).toMatch(/não existe nesta fazenda/);
  });

  it('valida cada campo como o celular e descarta o que não conhece', async () => {
    const r = await enviar(ana, fa, [
      { tabela: 'pesagens', gid: uuid(20), op: 'put', dados: { loteId: uuid(2), data: '2026-02-30', tipo: 'media', pesoMedio: 300, qtdPesada: 30, criadoEm: 0 } },
      { tabela: 'pesagens', gid: uuid(21), op: 'put', dados: { loteId: uuid(2), data: '2026-10-01', tipo: 'media', pesoMedio: 99999, qtdPesada: 30, criadoEm: 0 } },
      { tabela: 'lotes', gid: uuid(22), op: 'put', dados: { ...lote(22, 1).dados, fase: 'hacker' } },
      { tabela: 'propriedades', gid: uuid(23), op: 'put', dados: { nome: '  Sítio\u0007 ', criadoEm: 0, admin: true, fazenda_id: fb } },
      { tabela: 'propriedades', gid: 'nao-e-uuid', op: 'put', dados: { nome: 'x', criadoEm: 0 } },
      { tabela: 'usuarios', gid: uuid(24), op: 'put', dados: {} },
      { tabela: 'lotes', gid: uuid(25), op: 'put', dados: { ...lote(25, 1).dados, qtdCabecas: 2.5 } },
      { tabela: 'lotes', gid: uuid(26), op: 'put', dados: { ...lote(26, 1).dados, nome: 'x'.repeat(81) } },
    ]);
    expect(r.map((x) => x.ok)).toEqual([false, false, false, true, false, false, false, false]);
    expect(r[0].erro).toMatch(/data "data" inválida/);
    expect(r[1].erro).toMatch(/fora do limite/);
    expect(r[2].erro).toMatch(/não permitido/);
    expect(r[3].dados).toEqual({ nome: 'Sítio', criadoEm: 0 });
    expect(r[4].erro).toMatch(/Identificador/);
    expect(r[5].erro).toMatch(/Tabela desconhecida/);
    expect(r[6].erro).toMatch(/inteiro/);
    expect(r[7].erro).toMatch(/passou de 80/);
  });

  it('refaz as contas de dinheiro: valor adulterado é corrigido', async () => {
    const r = await enviar(ana, fa, [
      { tabela: 'vendas', gid: uuid(30), op: 'put', dados: { loteId: uuid(2), data: '2026-11-10', tipo: 'venda', cabecas: 10, pesoMedio: 366, modo: 'arroba', preco: 320, rendimento: 0.5, comissaoPct: 0.02, frete: 0, valorBruto: 1, valorLiquido: 9999999, criadoEm: 0 } },
      { tabela: 'lancamentos', gid: uuid(31), op: 'put', dados: { data: '2026-09-01', tipo: 'despesa', categoria: 'compra_animais', valor: 1, loteId: uuid(2), origem: 'compra_lote', refId: uuid(2), compraQtd: 40, compraPreco: 3000, compraComissao: 0.02, compraFrete: 1000, compraNf: 0, criadoEm: 0 } },
      { tabela: 'vendas', gid: uuid(32), op: 'put', dados: { loteId: uuid(2), data: '2026-11-10', tipo: 'morte', cabecas: 1, valorBruto: 500, valorLiquido: 500, criadoEm: 0 } },
    ]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r[0].dados).toMatchObject({ valorBruto: 39040, valorLiquido: 38259.2 });
    expect(r[1].dados).toMatchObject({ valor: 123400 });
    expect(r[2].dados).toMatchObject({ valorBruto: 0, valorLiquido: 0 });
    // e o dinheiro fica na auditoria
    const aud = await s.como(ana, () => s.pg.query<{ acao: string }>(`select acao from public.auditoria where tabela = 'vendas'`));
    expect(aud.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('convite: entra uma vez, com o papel do convite', async () => {
    await expect(s.rpc(caio, 'criar_convite', { f: fa, p_papel: 'vaqueiro' })).rejects.toThrow('Só o dono');
    const cod = await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: 'vaqueiro' });
    expect(cod).toMatch(/^[A-Z2-9]{10}$/);
    await expect(s.rpc(ana, 'criar_convite', { f: fa, p_papel: 'dono' })).rejects.toThrow('Convide como gerente');
    expect(await s.rpc(caio, 'aceitar_convite', { p_codigo: cod.toLowerCase(), meu_nome: 'Caio' })).toBe(fa);
    expect(await s.rpc(duda, 'aceitar_convite', { p_codigo: cod })).toBeNull(); // já usado
    const cons = await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: 'consultor' });
    await s.rpc(duda, 'aceitar_convite', { p_codigo: cons, meu_nome: 'Duda' });
    const eq = await s.rpc<{ nome: string; papel: string }[]>(caio, 'equipe', { f: fa });
    expect(eq.map((x) => `${x.nome}:${x.papel}`).sort()).toEqual(['Ana:dono', 'Caio:vaqueiro', 'Duda:consultor']);
  });

  it('código vencido não serve', async () => {
    const cod = await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: 'gerente' });
    await s.pg.query(`update public.convites set expira_em = now() - interval '1 minute' where codigo = $1`, [cod]);
    expect(await s.rpc(eva, 'aceitar_convite', { p_codigo: cod })).toBeNull();
  });

  it('não dá para adivinhar código: depois de 10 tentativas na hora, bloqueia', async () => {
    const u = await s.novoUsuario('chute@x');
    for (let i = 0; i < 10; i++) expect(await s.rpc(u, 'aceitar_convite', { p_codigo: 'AAAAAAAAA' + i })).toBeNull();
    await expect(s.rpc(u, 'aceitar_convite', { p_codigo: 'BBBBBBBBBB' })).rejects.toThrow('Muitas tentativas');
  });

  it('vaqueiro: pesa e trata, mas não vê nem mexe no dinheiro', async () => {
    const ok = await enviar(caio, fa, [
      { tabela: 'pesagens', gid: uuid(40), op: 'put', dados: { loteId: uuid(2), data: '2026-10-01', tipo: 'media', pesoMedio: 324, qtdPesada: 40, criadoEm: 0 } },
      { tabela: 'lotes', gid: uuid(2), op: 'put', dados: { ...lote(2, 1).dados, qtdCabecas: 31 } },
    ]);
    expect(ok.map((x) => x.ok)).toEqual([true, true]);
    const nao = await enviar(caio, fa, [
      { tabela: 'vendas', gid: uuid(41), op: 'put', dados: { loteId: uuid(2), data: '2026-11-10', tipo: 'morte', cabecas: 1, valorBruto: 0, valorLiquido: 0, criadoEm: 0 } },
      { tabela: 'lotes', gid: uuid(2), op: 'put', dados: { ...lote(2, 1).dados, qtdCabecas: 31, nome: 'Renomeado' } },
      { tabela: 'lancamentos', gid: uuid(42), op: 'put', dados: { data: '2026-09-01', tipo: 'despesa', categoria: 'outros', valor: 10, origem: 'manual', criadoEm: 0 } },
      { tabela: 'lancamentos', gid: uuid(31), op: 'del' },
      { tabela: 'lotes', gid: uuid(2), op: 'del' },
      { tabela: 'config', gid: 'precoArroba', op: 'put', dados: { chave: 'precoArroba', valor: 1 } },
    ]);
    expect(nao.map((x) => x.ok)).toEqual([false, false, false, false, false, false]);
    const vac = await enviar(caio, fa, [
      { tabela: 'sanidade', gid: uuid(44), op: 'put', dados: { loteId: uuid(2), data: '2026-11-19', feito: true, tipo: 'vacina', produto: 'Aftosa', custo: 240, criadoEm: 0 } },
      { tabela: 'lancamentos', gid: uuid(43), op: 'put', dados: { data: '2026-11-19', tipo: 'despesa', categoria: 'sanidade', valor: 240, loteId: uuid(2), origem: 'sanidade', refId: uuid(44), criadoEm: 0 } },
    ]);
    expect(vac.map((x) => x.ok)).toEqual([true, true]); // custo da vacina que ele aplicou
    const baixou = await s.rpc<{ tabela: string }[]>(caio, 'baixar_alteracoes', { f: fa, desde: 0 });
    expect(baixou.some((x) => x.tabela === 'vendas' || x.tabela === 'lancamentos')).toBe(false);
    expect(baixou.some((x) => x.tabela === 'pesagens')).toBe(true);
    const direto = await s.como(caio, () => s.pg.query(`select tabela from public.registros`).catch((e) => e));
    expect(String(direto)).toMatch(/permission denied/);
    const aud = await s.como(caio, () => s.pg.query('select * from public.auditoria'));
    expect(aud.rows).toHaveLength(0); // auditoria é só do dono
  });

  it('consultor só olha', async () => {
    await expect(enviar(duda, fa, [prop(60)])).rejects.toThrow('Consultor');
    const r = await s.rpc<unknown[]>(duda, 'baixar_alteracoes', { f: fa, desde: 0 });
    expect(r.length).toBeGreaterThan(3);
  });

  it('só o dono muda papéis, e a fazenda nunca fica sem dono', async () => {
    await expect(s.rpc(caio, 'mudar_papel', { f: fa, usuario: caio, p_papel: 'dono' })).rejects.toThrow('Só o dono');
    await expect(s.rpc(ana, 'mudar_papel', { f: fa, usuario: ana, p_papel: 'gerente' })).rejects.toThrow('pelo menos um dono');
    await expect(s.rpc(ana, 'remover_membro', { f: fa, usuario: ana })).rejects.toThrow('pelo menos um dono');
    await expect(s.rpc(caio, 'remover_membro', { f: fa, usuario: duda })).rejects.toThrow('Só o dono');
    await s.rpc(ana, 'mudar_papel', { f: fa, usuario: duda, p_papel: 'gerente' });
    const eq = await s.rpc<{ nome: string; papel: string }[]>(ana, 'equipe', { f: fa });
    expect(eq.find((x) => x.nome === 'Duda')!.papel).toBe('gerente');
    await expect(s.rpc(duda, 'criar_convite', { f: fa, p_papel: 'vaqueiro' })).rejects.toThrow('Só o dono'); // gerente não chama gente
  });

  it('versões: baixa só o que mudou e apagar vira marca de apagado', async () => {
    const tudo = await s.rpc<{ versao: number }[]>(ana, 'baixar_alteracoes', { f: fa, desde: 0 });
    const ultima = Math.max(...tudo.map((x) => Number(x.versao)));
    expect(await s.rpc<unknown[]>(ana, 'baixar_alteracoes', { f: fa, desde: ultima })).toHaveLength(0);
    await enviar(ana, fa, [{ tabela: 'vendas', gid: uuid(32), op: 'del' }]);
    const novo = await s.rpc<{ gid: string; excluido: boolean; dados: unknown }[]>(ana, 'baixar_alteracoes', { f: fa, desde: ultima });
    expect(novo).toEqual([expect.objectContaining({ gid: uuid(32), excluido: true, dados: null })]);
    // mandar de novo o mesmo registro igual não cria versão nova
    const r1 = await enviar(ana, fa, [prop(1)]);
    const r2 = await enviar(ana, fa, [prop(1)]);
    expect(r2[0].versao).toBe(r1[0].versao);
  });

  it('limita o tamanho do envio', async () => {
    const muitos = Array.from({ length: 501 }, (_, i) => prop(1000 + i));
    await expect(enviar(ana, fa, muitos)).rejects.toThrow('máximo de 500');
  });

  it('apagar a fazenda exige o nome e só o dono', async () => {
    await expect(s.rpc(beto, 'apagar_fazenda', { f: fa, confirmar_nome: 'Boa Vista' })).rejects.toThrow('Só o dono');
    await expect(s.rpc(beto, 'apagar_fazenda', { f: fb, confirmar_nome: 'errado' })).rejects.toThrow('igualzinho');
    await s.rpc(beto, 'apagar_fazenda', { f: fb, confirmar_nome: 'Santa Rita' });
    const r = await s.pg.query(`select count(*)::int as n from public.registros where fazenda_id = $1`, [fb]);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
  it('foto: só quem é de uma fazenda, e no máximo 30 por dia', async () => {
    const sem = await s.novoUsuario('sem@x');
    await expect(s.rpc(null, 'pode_usar_foto', {})).rejects.toThrow();
    await expect(s.rpc(sem, 'pode_usar_foto', {})).rejects.toThrow('Ligue o celular');
    for (let i = 0; i < 30; i++) expect(await s.rpc(ana, 'pode_usar_foto', {})).toBe(true);
    await expect(s.rpc(ana, 'pode_usar_foto', {})).rejects.toThrow('Muitas tentativas');
  });

  it('cotações: o app só lê; o servidor grava e descarta número absurdo', async () => {
    await expect(s.rpc(ana, 'gravar_cotacoes', { lista: [] })).rejects.toThrow();
    await expect(s.como(ana, () => s.pg.query(`insert into public.cotacoes values ('boi_gordo','SP',current_date,300,'R$/@','x')`))).rejects.toThrow();
    const hoje = new Date().toISOString().slice(0, 10);
    await s.pg.exec('set role service_role');
    const n = await s.pg.query<{ n: number }>(`select public.gravar_cotacoes($1) as n`, [JSON.stringify([
      { produto: 'boi_gordo', praca: 'SP', data: hoje, valor: 312.4, unidade: 'R$/@', fonte: 'Cepea' },
      { produto: 'boi_gordo', praca: 'MS', data: hoje, valor: 3124, unidade: 'R$/@', fonte: 'Cepea' },
      { produto: 'milho', praca: 'Campinas', data: hoje, valor: 70, unidade: 'R$/t', fonte: 'Cepea' },
      { produto: 'milho', praca: 'Campinas', data: 'xx', valor: 70, unidade: 'R$/sc60', fonte: 'Cepea' },
      { produto: 'bezerro', praca: 'MS', data: hoje, valor: 2900, unidade: 'R$/cab', fonte: 'Cepea' },
    ])]);
    await s.pg.exec('reset role');
    expect(n.rows[0].n).toBe(2);
    const lidas = await s.como(caio, () => s.pg.query<{ produto: string }>(`select produto from public.cotacoes order by produto`));
    expect(lidas.rows.map((r) => r.produto)).toEqual(['bezerro', 'boi_gordo']);
  });
  it('apagar a própria conta: some junto a fazenda só dela; dona única de equipe precisa passar antes', async () => {
    const zeca = await s.novoUsuario('zeca@x');
    const fz = await s.rpc<string>(zeca, 'criar_fazenda', { p_nome: 'Só do Zeca', meu_nome: 'Zeca' });
    await expect(s.rpc(zeca, 'apagar_minha_conta', { confirmar: 'sim' })).rejects.toThrow('APAGAR');
    await expect(s.rpc(ana, 'apagar_minha_conta', { confirmar: 'APAGAR' })).rejects.toThrow('única dona');
    await s.rpc(zeca, 'apagar_minha_conta', { confirmar: 'APAGAR' });
    const r = await s.pg.query<{ f: number; u: number }>(`select (select count(*) from public.fazendas where id = $1)::int f, (select count(*) from auth.users where id = $2)::int u`, [fz, zeca]);
    expect(r.rows[0]).toEqual({ f: 0, u: 0 });
  });
});

// Correções da auditoria de segurança de 23/11/2026 (A1 a A6).
describe('servidor: correções da auditoria', () => {
  let s: Servidor;
  let dono: string, vaq: string, f: string;
  const enviar = (u: string, fz: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f: fz, ops });
  const put = (tabela: string, n: number, dados: Record<string, unknown>) => ({ tabela, gid: uuid(n), op: 'put', dados: { criadoEm: 0, ...dados } });
  const ing = (n: number, preco: number) => put('ingredientes', n, { nome: 'Ing ' + n, ms: 88, pb: 9, ndt: 80, ca: 0.1, p: 0.3, preco, ativo: true });

  beforeAll(async () => {
    s = await subirServidor();
    dono = await s.novoUsuario('dono@x');
    vaq = await s.novoUsuario('vaq@x');
    f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: 'Canaã', meu_nome: 'Dono' });
    const r = await enviar(dono, f, [
      put('propriedades', 1, { nome: 'Sede' }),
      ing(2, 1.5), ing(3, 4),
      put('formulas', 4, { nome: 'Proteinado', tipo: 'proteinado', unidade: 'kg', modo: 'direto', consumoPctPV: 0.002, itens: [{ ingredienteId: uuid(2), qtd: 3 }, { ingredienteId: uuid(3), qtd: 1 }] }),
      put('formulas', 5, { nome: 'Batida', tipo: 'tip', unidade: 'kg', modo: 'batida', consumoPctPV: 0.015, itens: [{ ingredienteId: uuid(2), qtd: 1 }], custoEstoque: 2 }),
      put('lotes', 6, { propriedadeId: uuid(1), nome: 'Recria', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-01', formulaId: uuid(4) }),
      put('batidas', 7, { formulaId: uuid(5), data: '2026-10-01', kg: 100, custoTotal: 150, itens: [{ ingredienteId: uuid(2), kg: 100, custo: 150 }] }),
      put('movimentos', 8, { ingredienteId: uuid(2), data: '2026-10-01', tipo: 'entrada', kg: 1000, valor: 1500, origem: 'compra' }),
      { tabela: 'config', gid: 'precoArroba', op: 'put', dados: { chave: 'precoArroba', valor: 320 } },
      { tabela: 'config', gid: 'rendimento', op: 'put', dados: { chave: 'rendimento', valor: 0.52 } },
    ]);
    expect(r.map((x) => x.erro ?? x.ok)).toEqual(Array(r.length).fill(true));
    const c = await s.rpc<string>(dono, 'criar_convite', { f, p_papel: 'vaqueiro' });
    await s.rpc(vaq, 'aceitar_convite', { p_codigo: c, meu_nome: 'Vaq' });
  }, 30000);

  it('A1: conta criada com senha (fora do app) fica bloqueada', async () => {
    const intruso = await s.novoUsuario('vitima@x');
    await s.pg.query(`update auth.users set encrypted_password = '$2a$10$abc' where id = $1`, [intruso]);
    await expect(s.rpc(intruso, 'criar_fazenda', { p_nome: 'X' })).rejects.toThrow('criada fora do app');
    expect(await s.rpc<unknown[]>(intruso, 'minhas_fazendas', {})).toHaveLength(0);
    // mesmo se já estivesse numa equipe, o papel some
    await s.pg.query(`insert into public.membros (fazenda_id, usuario_id, papel) values ($1, $2, 'gerente')`, [f, intruso]);
    await expect(s.rpc(intruso, 'baixar_alteracoes', { f, desde: 0 })).rejects.toThrow();
    const fz = await s.como(intruso, () => s.pg.query('select id from public.fazendas'));
    expect(fz.rows).toHaveLength(0);
    await s.pg.query(`delete from public.membros where usuario_id = $1`, [intruso]);
  });

  it('A3: o vaqueiro baixa tudo do trato, mas sem preço nem custo', async () => {
    const l = await s.rpc<{ tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean }[]>(vaq, 'baixar_alteracoes', { f, desde: 0 });
    const de = (t: string) => l.filter((x) => x.tabela === t).map((x) => x.dados);
    expect(de('ingredientes').map((d) => d?.preco)).toEqual([0, 0]);
    expect(de('formulas').every((d) => d && !('custoEstoque' in d))).toBe(true);
    expect(de('movimentos').every((d) => d && !('valor' in d))).toBe(true);
    expect(de('batidas')[0]).toMatchObject({ custoTotal: 0, itens: [{ custo: 0 }] });
    const arroba = l.find((x) => x.tabela === 'config' && x.gid === 'precoArroba');
    expect(arroba).toMatchObject({ excluido: true, dados: null });
    expect(l.find((x) => x.gid === 'rendimento')?.dados).toEqual({ chave: 'rendimento', valor: 0.52 });
    // o dono continua recebendo os valores
    const d = await s.rpc<{ tabela: string; dados: Record<string, unknown> }[]>(dono, 'baixar_alteracoes', { f, desde: 0 });
    expect(d.filter((x) => x.tabela === 'ingredientes').map((x) => x.dados.preco).sort()).toEqual([1.5, 4]);
  });

  it('A4: o vaqueiro não lança receita e o valor da vacina vem da aplicação', async () => {
    const r = await enviar(vaq, f, [
      put('sanidade', 20, { loteId: uuid(6), data: '2026-11-19', feito: true, tipo: 'vacina', produto: 'Aftosa', custo: 240 }),
      put('lancamentos', 21, { data: '2026-11-19', tipo: 'receita', categoria: 'venda_animais', valor: 1, origem: 'sanidade', refId: uuid(20) }),
      put('lancamentos', 22, { data: '2026-11-19', tipo: 'despesa', categoria: 'sanidade', valor: 99999, origem: 'sanidade' }),
      put('lancamentos', 23, { data: '2026-01-01', tipo: 'despesa', categoria: 'sanidade', valor: 99999, origem: 'sanidade', refId: uuid(20) }),
    ]);
    expect(r.map((x) => x.ok)).toEqual([true, false, false, true]);
    expect(r[3].dados).toMatchObject({ valor: 240, data: '2026-11-19' });
  });

  it('A4: custo do trato do vaqueiro é calculado no servidor; valor de estoque dele é ignorado', async () => {
    const r = await enviar(vaq, f, [
      put('fornecimentos', 30, { loteId: uuid(6), formulaId: uuid(4), data: '2026-11-19', cabecas: 30, pesoRef: 300, kgPrevisto: 20, kgFornecido: 20, custo: 0 }),
      put('fornecimentos', 31, { loteId: uuid(6), formulaId: uuid(5), data: '2026-11-20', cabecas: 30, pesoRef: 300, kgPrevisto: 10, kgFornecido: 10, custo: 999 }),
      put('movimentos', 32, { ingredienteId: uuid(2), data: '2026-11-19', tipo: 'entrada', kg: 10, valor: 50000, origem: 'compra' }),
      put('movimentos', 8, { ingredienteId: uuid(2), data: '2026-10-01', tipo: 'entrada', kg: 1000, origem: 'compra' }),
    ]);
    expect(r.map((x) => x.erro ?? x.ok)).toEqual([true, true, true, true]);
    expect(r[0].dados).toMatchObject({ custo: 0 }); // a resposta para ele também vem sem dinheiro
    const d = await s.rpc<{ gid: string; dados: Record<string, unknown> }[]>(dono, 'baixar_alteracoes', { f, desde: 0 });
    const pega = (n: number) => d.find((x) => x.gid === uuid(n))!.dados;
    expect(pega(30).custo).toBe(42.5); // 20 kg x (3/4 x 1,50 + 1/4 x 4,00), igual a calcularFormula
    expect(pega(31).custo).toBe(20); // 10 kg x custo do estoque 2,00
    expect('valor' in pega(32)).toBe(false);
    expect(pega(8).valor).toBe(1500); // valor da compra lançado pelo dono fica
  });

  it('A5: quem criou a fazenda apaga a conta e a fazenda continua com o dono', async () => {
    const criador = await s.novoUsuario('criador@x');
    const novo = await s.novoUsuario('novo@x');
    const fz = await s.rpc<string>(criador, 'criar_fazenda', { p_nome: 'Vendida', meu_nome: 'C' });
    const c = await s.rpc<string>(criador, 'criar_convite', { f: fz, p_papel: 'gerente' });
    await s.rpc(novo, 'aceitar_convite', { p_codigo: c });
    await s.rpc(criador, 'mudar_papel', { f: fz, usuario: novo, p_papel: 'dono' });
    await s.rpc(novo, 'mudar_papel', { f: fz, usuario: criador, p_papel: 'vaqueiro' });
    await s.rpc(criador, 'apagar_minha_conta', { confirmar: 'APAGAR' });
    const m = await s.rpc<{ fazenda_id: string }[]>(novo, 'minhas_fazendas', {});
    expect(m.map((x) => x.fazenda_id)).toEqual([fz]);
  });

  it('A6: só o dono cancela convite, e o código cancelado não serve mais', async () => {
    const c = await s.rpc<string>(dono, 'criar_convite', { f, p_papel: 'gerente' });
    await expect(s.rpc(vaq, 'cancelar_convite', { f, p_codigo: c })).rejects.toThrow('Só o dono');
    await s.rpc(dono, 'cancelar_convite', { f, p_codigo: c });
    const outro = await s.novoUsuario('outro@x');
    expect(await s.rpc(outro, 'aceitar_convite', { p_codigo: c })).toBeNull();
    await expect(s.rpc(dono, 'cancelar_convite', { f, p_codigo: c })).rejects.toThrow('não encontrado');
  });

  it('A2: leitura por foto tem teto para o sistema todo', async () => {
    await s.pg.query(`insert into public.limites (usuario_id, tipo, janela, contagem)
      values ('00000000-0000-0000-0000-000000000000', 'foto_total', to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 300)`);
    await expect(s.rpc(dono, 'pode_usar_foto', {})).rejects.toThrow('limite de hoje');
  });
});
