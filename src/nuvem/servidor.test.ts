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
    const deBeto = await s.como(beto, () => s.pg.query('select * from public.registros'));
    expect(deBeto.rows).toHaveLength(0);
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
    const vac = await enviar(caio, fa, [{ tabela: 'lancamentos', gid: uuid(43), op: 'put', dados: { data: '2026-11-19', tipo: 'despesa', categoria: 'sanidade', valor: 240, loteId: uuid(2), origem: 'sanidade', criadoEm: 0 } }]);
    expect(vac[0].ok).toBe(true); // custo da vacina que ele aplicou
    const baixou = await s.rpc<{ tabela: string }[]>(caio, 'baixar_alteracoes', { f: fa, desde: 0 });
    expect(baixou.some((x) => x.tabela === 'vendas' || x.tabela === 'lancamentos')).toBe(false);
    expect(baixou.some((x) => x.tabela === 'pesagens')).toBe(true);
    const direto = await s.como(caio, () => s.pg.query<{ tabela: string }>(`select tabela from public.registros where tabela in ('vendas', 'lancamentos')`));
    expect(direto.rows).toHaveLength(0);
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
