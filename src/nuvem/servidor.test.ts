// Testes do servidor: rodam as migrações reais do Supabase num Postgres em memória e tentam
// furar a segurança do jeito que um app adulterado faria (chamando a API direto).
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarSqlEsquemas } from './gerarSql';
import { subirServidor, type Servidor } from './servidorTeste';

// As regras geradas ficam num bloco "-- GERADO por ..." dentro da migração MAIS NOVA que tiver esse bloco
// (as antigas já rodaram no Supabase e não mudam). Tabela nova: crie a migração nova com uma cópia do bloco
// e rode `npm run gerar-sql`, que reescreve só o bloco dela.
const PASTA = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const MARCA = '-- GERADO por src/nuvem/gerarSql.ts';
const FIM = 'refs = excluded.refs;\n';
function blocoGerado(): { arq: string; texto: string; ini: number; fim: number } {
  for (const n of readdirSync(PASTA).filter((x) => x.endsWith('.sql')).sort().reverse()) {
    const texto = readFileSync(join(PASTA, n), 'utf8');
    const ini = texto.indexOf(MARCA);
    if (ini >= 0) return { arq: join(PASTA, n), texto, ini, fim: texto.indexOf(FIM, ini) + FIM.length };
  }
  throw new Error('Nenhuma migração com as regras geradas.');
}
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string; versao?: number; dados?: Record<string, unknown> }[];

describe('SQL das regras', () => {
  it('está igual ao gerado a partir de src/validar.ts', () => {
    const novo = gerarSqlEsquemas();
    let b = blocoGerado();
    if (process.env.ATUALIZAR_SQL) { writeFileSync(b.arq, b.texto.slice(0, b.ini) + novo + b.texto.slice(b.fim)); b = blocoGerado(); }
    expect(b.texto.slice(b.ini, b.fim)).toBe(novo);
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
    await s.pg.query(`select public.definir_plano($1, 'pro', 3)`, [fa]); // equipe maior nos testes
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

  it('lote passa de RIP para TIP com o histórico de fases', async () => {
    const fases = [{ data: '2026-10-01', de: 'rip', para: 'tip', pesoMedio: 372, dieta: 'RIP fêmeas', extra: 'x' }];
    const r = await enviar(ana, fa, [
      { tabela: 'lotes', gid: uuid(27), op: 'put', dados: { ...lote(27, 1).dados, fase: 'tip', fases } },
      { tabela: 'lotes', gid: uuid(28), op: 'put', dados: { ...lote(28, 1).dados, fase: 'rip', fases: [{ data: '2026-10-01', de: 'rip', para: 'hacker' }] } },
    ]);
    expect(r.map((x) => x.ok)).toEqual([true, false]);
    expect(r[0].dados!.fases).toEqual([{ data: '2026-10-01', de: 'rip', para: 'tip', pesoMedio: 372, dieta: 'RIP fêmeas' }]);
    expect(r[1].erro).toMatch(/não permitido/);
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
      { tabela: 'lotes', gid: uuid(2), op: 'put', dados: { ...lote(2, 1).dados, qtdCabecas: 31, fase: 'tip', fases: [{ data: '2026-10-01', de: 'recria', para: 'tip' }] } },
      { tabela: 'lancamentos', gid: uuid(42), op: 'put', dados: { data: '2026-09-01', tipo: 'despesa', categoria: 'outros', valor: 10, origem: 'manual', criadoEm: 0 } },
      { tabela: 'lancamentos', gid: uuid(31), op: 'del' },
      { tabela: 'lotes', gid: uuid(2), op: 'del' },
      { tabela: 'config', gid: 'precoArroba', op: 'put', dados: { chave: 'precoArroba', valor: 1 } },
    ]);
    expect(nao.map((x) => x.ok)).toEqual([false, false, false, false, false, false, false]); // vaqueiro não muda a fase do lote
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
    await expect(s.rpc(null, 'pode_usar_foto', { f: fa })).rejects.toThrow();
    await expect(s.rpc(sem, 'pode_usar_foto', { f: fa })).rejects.toThrow('Ligue o celular');
    for (let i = 0; i < 30; i++) expect(await s.rpc(ana, 'pode_usar_foto', { f: fa })).toBe(149 - i);
    await expect(s.rpc(ana, 'pode_usar_foto', { f: fa })).rejects.toThrow('Muitas tentativas');
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
    await s.pg.query(`select public.definir_plano($1, 'pro', 3)`, [f]);
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

  it('A1: conta com e-mail ainda não confirmado fica bloqueada', async () => {
    const intruso = await s.novoUsuario('vitima@x');
    await s.pg.query(`update auth.users set email_confirmed_at = null, encrypted_password = '$2a$10$abc' where id = $1`, [intruso]);
    await expect(s.rpc(intruso, 'criar_fazenda', { p_nome: 'X' })).rejects.toThrow('Confirme seu e-mail');
    expect(await s.rpc<unknown[]>(intruso, 'minhas_fazendas', {})).toHaveLength(0);
    expect(await s.rpc<boolean>(intruso, 'tenho_senha', {})).toBe(false);
    // mesmo se já estivesse numa equipe, o papel some
    await s.pg.query(`insert into public.membros (fazenda_id, usuario_id, papel) values ($1, $2, 'gerente')`, [f, intruso]);
    await expect(s.rpc(intruso, 'baixar_alteracoes', { f, desde: 0 })).rejects.toThrow();
    const fz = await s.como(intruso, () => s.pg.query('select id from public.fazendas'));
    expect(fz.rows).toHaveLength(0);
    await s.pg.query(`delete from public.membros where usuario_id = $1`, [intruso]);
  });

  it('A1: senha posta antes de confirmar o e-mail é apagada quando o dono do e-mail confirma', async () => {
    const id = await s.novoUsuario('dono-do-email@x');
    // alguém cria a conta com senha usando o e-mail de outra pessoa (fica sem confirmar)
    await s.pg.query(`update auth.users set email_confirmed_at = null, encrypted_password = '$2a$10$senha-do-intruso' where id = $1`, [id]);
    // o dono do e-mail abre o link: o e-mail é confirmado e a senha do intruso some
    await s.pg.query(`update auth.users set email_confirmed_at = now() where id = $1`, [id]);
    const r = await s.pg.query<{ p: string }>(`select encrypted_password as p from auth.users where id = $1`, [id]);
    expect(r.rows[0].p).toBe('');
    expect(await s.rpc<boolean>(id, 'tenho_senha', {})).toBe(false);
    // depois de confirmado, a senha que ele cadastra vale e ele usa o app normalmente
    await s.pg.query(`update auth.users set encrypted_password = '$2a$10$senha-do-dono' where id = $1`, [id]);
    expect(await s.rpc<boolean>(id, 'tenho_senha', {})).toBe(true);
    const nova = await s.rpc<string>(id, 'criar_fazenda', { p_nome: 'Fazenda do dono', meu_nome: 'Dono' });
    expect(nova).toBeTruthy();
    // trocar a senha depois (esqueci a senha) também vale
    await s.pg.query(`update auth.users set encrypted_password = '$2a$10$outra' where id = $1`, [id]);
    expect((await s.pg.query<{ p: string }>(`select encrypted_password as p from auth.users where id = $1`, [id])).rows[0].p).toBe('$2a$10$outra');
  });

  it('tenho_senha só responde sobre a própria conta e não abre para quem não entrou', async () => {
    await expect(s.rpc(null, 'tenho_senha', {})).rejects.toThrow();
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
    await expect(s.rpc(dono, 'pode_usar_foto', { f })).rejects.toThrow('limite de hoje');
  });
});

// Limite de pessoas por plano: Básico e Pro têm quem assina + 1; cada pessoa a mais é paga. Tudo conferido no banco.
describe('servidor: limite de pessoas por plano', () => {
  let s: Servidor;
  let n = 0;
  const nova = () => s.novoUsuario(`p${++n}@x`);
  const convidar = (dono: string, f: string, papel = 'vaqueiro') => s.rpc<string>(dono, 'criar_convite', { f, p_papel: papel });
  const entrar = async (dono: string, f: string, papel = 'vaqueiro') => { const u = await nova(); await s.rpc(u, 'aceitar_convite', { p_codigo: await convidar(dono, f, papel) }); return u; };
  const plano = (u: string, f: string) => s.rpc<{ plano: string; limite: number; pessoas: number; convites_abertos: number; eu_pausado: boolean }[]>(u, 'plano_da_fazenda', { f }).then((r) => r[0]);
  const definir = (f: string, p: string, extras = 0) => s.pg.query(`select public.definir_plano($1, $2, $3)`, [f, p, extras]);
  const fazenda = async (nome: string, p = 'basico', extras = 0) => { const dono = await nova(); const f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: nome, meu_nome: 'Dono' }); await definir(f, p, extras); return { dono, f }; };

  beforeAll(async () => { s = await subirServidor(); }, 30000);

  it('fazenda nova é Básico: quem assina + 1; o código seguinte nem é gerado', async () => {
    const dono = await nova();
    const f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: 'Básica' });
    expect(await plano(dono, f)).toMatchObject({ plano: 'basico', limite: 2, pessoas: 1, convites_abertos: 0, eu_pausado: false });
    const c = await convidar(dono, f);
    await expect(convidar(dono, f)).rejects.toThrow('Sem vaga'); // o convite em aberto ocupa a vaga
    await s.rpc(await nova(), 'aceitar_convite', { p_codigo: c });
    expect((await plano(dono, f)).pessoas).toBe(2);
    await expect(convidar(dono, f)).rejects.toThrow('Sem vaga');
  });

  it('cada pessoa extra contratada abre uma vaga, no Básico e no Pro', async () => {
    for (const p of ['basico', 'pro']) {
      const { dono, f } = await fazenda('Extra ' + p, p);
      await entrar(dono, f);
      await expect(convidar(dono, f)).rejects.toThrow('Sem vaga');
      await definir(f, p, 2);
      await entrar(dono, f); await entrar(dono, f);
      expect(await plano(dono, f)).toMatchObject({ plano: p, limite: 4, pessoas: 4 });
      await expect(convidar(dono, f)).rejects.toThrow('Sem vaga');
    }
  });

  it('a trava do banco segura mesmo com códigos gerados antes de o plano diminuir', async () => {
    const { dono, f } = await fazenda('Diminuiu', 'pro', 1);
    const cods = [await convidar(dono, f), await convidar(dono, f)];
    await definir(f, 'pro');
    const [a, b] = [await nova(), await nova()];
    expect(await s.rpc(a, 'aceitar_convite', { p_codigo: cods[0] })).toBe(f);
    await expect(s.rpc(b, 'aceitar_convite', { p_codigo: cods[1] })).rejects.toThrow('equipe desta fazenda está completa');
    // o código não foi gasto: serve quando abrir vaga
    await s.rpc(dono, 'remover_membro', { f, usuario: a });
    expect(await s.rpc(b, 'aceitar_convite', { p_codigo: cods[1] })).toBe(f);
  });

  it('a trava vale até para gravação direta no banco (qualquer caminho)', async () => {
    const { f } = await fazenda('Direta');
    const ins = async () => s.pg.query(`insert into public.membros (fazenda_id, usuario_id, papel) values ($1, $2, 'vaqueiro')`, [f, await nova()]);
    await ins();
    expect(String(await ins().catch((x) => x))).toMatch(/completa/);
  });

  it('o app não muda o próprio plano', async () => {
    const dono = await nova();
    const f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: 'Esperta' });
    const tentativas = [
      `update public.fazendas set plano = 'pro', usuarios_extras = 48`,
      `select public.definir_plano('${f}', 'pro', 48)`,
      `select public.bf_reaplicar_limite('${f}')`,
      `update public.membros set bloqueado = false`,
    ];
    for (const sql of tentativas) {
      const e = await s.como(dono, () => s.pg.query(sql).then(() => null, (x) => x));
      expect(String(e), sql).toMatch(/permission denied|row-level security/);
    }
    expect((await plano(dono, f)).plano).toBe('basico');
    await expect(definir(f, 'ouro')).rejects.toThrow('desconhecido');
    await expect(definir(f, 'pro', 49)).rejects.toThrow('0 a 48');
  });

  it('plano diminuiu: quem passou do limite fica pausado (sem baixar, enviar nem foto) até abrir vaga', async () => {
    const { dono, f } = await fazenda('Venceu', 'pro', 3);
    const [v1, v2, v3] = [await entrar(dono, f), await entrar(dono, f), await entrar(dono, f)];
    await definir(f, 'pro', 0);
    // dono e o primeiro a entrar continuam; os outros dois pausam
    expect(await s.rpc<unknown[]>(v1, 'baixar_alteracoes', { f, desde: 0 })).toBeDefined();
    await expect(s.rpc(v2, 'baixar_alteracoes', { f, desde: 0 })).rejects.toThrow('não faz parte');
    await expect(s.rpc(v3, 'enviar_alteracoes', { f, ops: [] })).rejects.toThrow('não faz parte');
    const fz = await s.como(v2, () => s.pg.query('select id from public.fazendas'));
    expect(fz.rows).toHaveLength(0);
    expect(await plano(v2, f)).toMatchObject({ eu_pausado: true, limite: 2, pessoas: 4 });
    expect((await s.rpc<{ bloqueado: boolean }[]>(v2, 'minhas_fazendas', {}))[0].bloqueado).toBe(true);
    const eq = await s.rpc<{ usuario_id: string; bloqueado: boolean }[]>(dono, 'equipe', { f });
    expect(eq.filter((x) => x.bloqueado).map((x) => x.usuario_id).sort()).toEqual([v2, v3].sort());
    // pausado sai sozinho; o dono tira o v1: o v2 volta
    await s.rpc(v3, 'remover_membro', { f, usuario: v3 });
    await s.rpc(dono, 'remover_membro', { f, usuario: v1 });
    expect(await plano(v2, f)).toMatchObject({ eu_pausado: false, pessoas: 2 });
    expect(await s.rpc<unknown[]>(v2, 'baixar_alteracoes', { f, desde: 0 })).toBeDefined();
  });

  it('pausado não usa a leitura por foto', async () => {
    const { dono, f } = await fazenda('Foto', 'pro', 1);
    const [a, b] = [await entrar(dono, f), await entrar(dono, f)];
    await definir(f, 'pro', 0);
    await expect(s.rpc(b, 'pode_usar_foto', { f })).rejects.toThrow('Ligue o celular');
    expect(await s.rpc(a, 'pode_usar_foto', { f })).toBe(149);
  });

  it('o dono nunca fica pausado, nem quando outro é promovido a dono', async () => {
    const { dono, f } = await fazenda('Donos', 'pro', 1);
    const [a, b] = [await entrar(dono, f, 'gerente'), await entrar(dono, f, 'gerente')];
    await definir(f, 'pro', 0); // b pausa
    await s.rpc(dono, 'mudar_papel', { f, usuario: b, p_papel: 'dono' }); // b passa à frente de a
    const eq = await s.rpc<{ usuario_id: string; bloqueado: boolean }[]>(dono, 'equipe', { f });
    expect(eq.find((x) => x.usuario_id === b)!.bloqueado).toBe(false);
    expect(eq.find((x) => x.usuario_id === a)!.bloqueado).toBe(true);
    expect(eq.find((x) => x.usuario_id === dono)!.bloqueado).toBe(false);
  });

  it('quem não é da fazenda não vê o plano dela', async () => {
    const { f } = await fazenda('Fechada');
    await expect(plano(await nova(), f)).rejects.toThrow('não faz parte');
  });
});

// Leitura por foto conforme o plano: Básico sem foto; Pro com 150 por mês por fazenda.
describe('servidor: leitura por foto por plano', () => {
  let s: Servidor;
  let n = 0;
  const nova = () => s.novoUsuario(`f${++n}@x`);
  const fazenda = async (plano: string) => {
    const dono = await nova();
    const f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: 'F' + n });
    await s.pg.query(`select public.definir_plano($1, $2, 3)`, [f, plano]);
    return { dono, f };
  };
  const foto = (u: string, f: string) => s.rpc<number>(u, 'pode_usar_foto', { f });
  const usadas = (f: string, total: number) => s.pg.query(`insert into public.limites (usuario_id, tipo, janela, contagem)
    values ($1, 'foto_mes', public.bf_inicio_mes(), $2) on conflict (usuario_id, tipo, janela) do update set contagem = excluded.contagem`, [f, total]);

  beforeAll(async () => { s = await subirServidor(); }, 30000);

  it('Básico não usa a leitura por foto', async () => {
    const { dono, f } = await fazenda('basico');
    await expect(foto(dono, f)).rejects.toThrow('plano Pro');
    const p = await s.rpc<{ fotos_limite: number }[]>(dono, 'plano_da_fazenda', { f });
    expect(p[0].fotos_limite).toBe(0);
  });

  it('Pro: 150 por mês na fazenda, somando todas as pessoas; a recusa não gasta cota', async () => {
    const { dono, f } = await fazenda('pro');
    const c = await s.rpc<string>(dono, 'criar_convite', { f, p_papel: 'vaqueiro' });
    const vaq = await nova();
    await s.rpc(vaq, 'aceitar_convite', { p_codigo: c });
    expect(await foto(dono, f)).toBe(149);
    expect(await foto(vaq, f)).toBe(148);
    await usadas(f, 149);
    expect(await foto(vaq, f)).toBe(0);
    await expect(foto(dono, f)).rejects.toThrow('150 leituras');
    await expect(foto(vaq, f)).rejects.toThrow('150 leituras');
    const p = await s.rpc<{ fotos_usadas: number; fotos_limite: number }[]>(dono, 'plano_da_fazenda', { f });
    expect(p[0]).toMatchObject({ fotos_usadas: 150, fotos_limite: 150 }); // as recusas não contaram
    // pacote extra: o servidor aumenta a cota
    await s.pg.query(`select public.definir_cota_foto($1, 250)`, [f]);
    expect(await foto(dono, f)).toBe(99);
  });

  it('não dá para gastar a cota de outra fazenda nem usar a de uma fazenda Pro alheia', async () => {
    const pro = await fazenda('pro');
    const bas = await fazenda('basico');
    await expect(foto(bas.dono, pro.f)).rejects.toThrow('Ligue o celular');
    const p = await s.rpc<{ fotos_usadas: number }[]>(pro.dono, 'plano_da_fazenda', { f: pro.f });
    expect(p[0].fotos_usadas).toBe(0);
  });

  it('o app não muda a própria cota', async () => {
    const { dono, f } = await fazenda('pro');
    for (const sql of [`select public.definir_cota_foto('${f}', 99999)`, `update public.fazendas set cota_foto_mes = 99999`, `delete from public.limites`]) {
      const e = await s.como(dono, () => s.pg.query(sql).then(() => null, (x) => x));
      expect(String(e), sql).toMatch(/permission denied|row-level security/);
    }
  });

  it('o mês vira no horário de Brasília', async () => {
    const r = await s.pg.query<{ ok: boolean }>(`select public.bf_inicio_mes() = (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') ok`);
    expect(r.rows[0].ok).toBe(true);
  });
});

// Funcionários com salário: o vaqueiro não vê; só o dono liga à conta do app; ninguém mexe no próprio salário.
describe('servidor: funcionários e salários', () => {
  let s: Servidor;
  let n = 0;
  let dono: string, gerente: string, vaq: string, cons: string, estranho: string, f: string, outra: string;
  const nova = () => s.novoUsuario(`func${++n}@x`);
  const enviar = (u: string, fz: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f: fz, ops });
  const func = (k: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'funcionarios', gid: uuid(900 + k), op: 'put',
    dados: { nome: 'Func ' + k, funcao: 'Vaqueiro', salario: 2400, encargos: 800, admissao: '2026-09-01', criadoEm: 0, ...extra },
  });
  const entrar = async (papel: string, nome: string) => {
    const u = await nova();
    await s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(dono, 'criar_convite', { f, p_papel: papel }), meu_nome: nome });
    return u;
  };

  beforeAll(async () => {
    s = await subirServidor();
    dono = await nova();
    f = await s.rpc<string>(dono, 'criar_fazenda', { p_nome: 'Canaã', meu_nome: 'Dono' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 3)`, [f]);
    gerente = await entrar('gerente', 'Gerente');
    vaq = await entrar('vaqueiro', 'Vaqueiro');
    cons = await entrar('consultor', 'Consultor');
    estranho = await nova();
    outra = await s.rpc<string>(estranho, 'criar_fazenda', { p_nome: 'Outra', meu_nome: 'Estranho' });
  }, 30000);

  it('dono cadastra com salário; os campos são conferidos como no celular', async () => {
    const r = await enviar(dono, f, [
      func(1),
      func(2, { salario: -5 }),
      func(3, { nome: '' }),
      func(4, { admissao: '2026-02-30' }),
      func(5, { usuarioId: 'nao-e-conta' }),
    ]);
    expect(r.map((x) => x.ok)).toEqual([true, false, false, false, false]);
    expect(r[0].dados).toEqual({ nome: 'Func 1', funcao: 'Vaqueiro', salario: 2400, encargos: 800, admissao: '2026-09-01', criadoEm: 0 });
    expect(r[1].erro).toMatch(/fora do limite/);
    expect(r[4].erro).toMatch(/não faz parte da equipe/);
  });

  it('o vaqueiro não recebe nem grava funcionários (nem os salários)', async () => {
    const baixou = await s.rpc<{ tabela: string; dados: unknown }[]>(vaq, 'baixar_alteracoes', { f, desde: 0 });
    expect(baixou.some((x) => x.tabela === 'funcionarios')).toBe(false);
    expect(JSON.stringify(baixou)).not.toMatch(/salario|2400/);
    const r = await enviar(vaq, f, [func(10), { tabela: 'funcionarios', gid: uuid(901), op: 'del' }]);
    expect(r.map((x) => x.ok)).toEqual([false, false]);
    const direto = await s.como(vaq, () => s.pg.query(`select dados from public.registros where tabela = 'funcionarios'`).catch((e) => e));
    expect(String(direto)).toMatch(/permission denied/);
  });

  it('consultor vê, mas não grava', async () => {
    const baixou = await s.rpc<{ tabela: string }[]>(cons, 'baixar_alteracoes', { f, desde: 0 });
    expect(baixou.some((x) => x.tabela === 'funcionarios')).toBe(true);
    await expect(enviar(cons, f, [func(11)])).rejects.toThrow('Consultor');
  });

  it('outra fazenda não vê os funcionários', async () => {
    await expect(s.rpc(estranho, 'baixar_alteracoes', { f, desde: 0 })).rejects.toThrow('não faz parte');
    const r = await s.rpc<{ tabela: string }[]>(estranho, 'baixar_alteracoes', { f: outra, desde: 0 });
    expect(r.some((x) => x.tabela === 'funcionarios')).toBe(false);
  });

  it('só o dono liga a conta do app, e só de quem é da equipe e uma vez', async () => {
    // gerente cadastra e muda salário de outro funcionário, mas não liga conta
    const g = await enviar(gerente, f, [func(20), func(20, { salario: 2600 }), func(21, { usuarioId: vaq })]);
    expect(g.map((x) => x.ok)).toEqual([true, true, false]);
    expect(g[2].erro).toMatch(/Só o dono liga/);
    // dono liga: conta de fora da fazenda não serve
    const d = await enviar(dono, f, [func(20, { salario: 2600, usuarioId: estranho }), func(20, { salario: 2600, usuarioId: vaq }), func(22, { usuarioId: vaq })]);
    expect(d.map((x) => x.ok)).toEqual([false, true, false]);
    expect(d[0].erro).toMatch(/não faz parte da equipe/);
    expect(d[2].erro).toMatch(/já está ligada a outro funcionário/);
    // gerente não desliga nem troca a conta de quem já está ligado
    const g2 = await enviar(gerente, f, [func(20, { salario: 2700 }), func(20, { salario: 2700, usuarioId: vaq }), { tabela: 'funcionarios', gid: uuid(920), op: 'del' }]);
    expect(g2.map((x) => x.ok)).toEqual([false, true, false]);
    expect(g2[2].erro).toMatch(/Só o dono apaga/);
  });

  it('ninguém além do dono mexe no próprio cadastro (nem aumenta o próprio salário)', async () => {
    expect((await enviar(dono, f, [func(30, { funcao: 'Gerente', salario: 5000, usuarioId: gerente })]))[0].ok).toBe(true);
    const r = await enviar(gerente, f, [func(30, { funcao: 'Gerente', salario: 9000, usuarioId: gerente }), { tabela: 'funcionarios', gid: uuid(930), op: 'del' }]);
    expect(r.map((x) => x.ok)).toEqual([false, false]);
    expect(r[0].erro).toMatch(/próprio cadastro/);
    expect((await enviar(dono, f, [func(30, { funcao: 'Gerente', salario: 5500, usuarioId: gerente })]))[0].ok).toBe(true);
  });

  it('toda mudança de funcionário fica na auditoria do dono, com o salário de antes e de depois', async () => {
    const aud = await s.como(dono, () => s.pg.query<{ acao: string; antes: { salario?: number } | null; depois: { salario?: number } | null }>(
      `select acao, antes, depois from public.auditoria where tabela = 'funcionarios' and gid = $1 order by id`, [uuid(930)]));
    expect(aud.rows.map((x) => [x.acao, x.antes?.salario ?? null, x.depois?.salario ?? null])).toEqual([['gravar', null, 5000], ['gravar', 5000, 5500]]);
    const doGerente = await s.como(gerente, () => s.pg.query(`select * from public.auditoria`));
    expect(doGerente.rows).toHaveLength(0);
  });

  it('apagar e recriar o mesmo funcionário funciona; apagar libera a conta para outro cadastro', async () => {
    expect((await enviar(dono, f, [{ tabela: 'funcionarios', gid: uuid(920), op: 'del' }]))[0].ok).toBe(true);
    expect((await enviar(dono, f, [func(22, { usuarioId: vaq })]))[0].ok).toBe(true);
  });
});
