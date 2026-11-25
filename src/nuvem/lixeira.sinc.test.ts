// Lixeira com a nuvem: apagado num celular aparece na lixeira dos outros, e restaurado em qualquer um volta para todos.
// Celulares = bancos locais separados; servidor = as migrações do Supabase em PGlite.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { BoiForteDB, usarBanco, db, excluirLote, desfazerFornecimento, registrarFornecimento } from '../db';
import { carregarExemplo } from '../exemplo';
import { listarLixeira, restaurar } from '../lixeira';
import { subirServidor, type Servidor } from './servidorTeste';
import { ligarFazenda, sincronizar, type Transporte, type FazendaNuvem } from './sinc';

let s: Servidor;
const transporte = (uid: string): Transporte => ({
  enviar: (f, ops) => s.rpc(uid, 'enviar_alteracoes', { f, ops }),
  baixar: (f, desde, limite) => s.rpc(uid, 'baixar_alteracoes', { f, desde, limite }),
});

describe('lixeira entre celulares', () => {
  let ana: string, gil: string, caio: string;
  let A: BoiForteDB, B: BoiForteDB, C: BoiForteDB;
  let faz: FazendaNuvem;
  let loteGid: string;

  const resumoLote = async (gid: string) => {
    const l = await db.lotes.where('gid').equals(gid).first();
    if (!l) return null;
    return { nome: l.nome, pesagens: await db.pesagens.where('loteId').equals(l.id!).count(), tratos: await db.fornecimentos.where('loteId').equals(l.id!).count() };
  };

  beforeAll(async () => {
    s = await subirServidor();
    [ana, gil, caio] = await Promise.all(['ana', 'gil', 'caio'].map((n) => s.novoUsuario(n + '@x')));
    A = new BoiForteDB('lxA'); B = new BoiForteDB('lxB'); C = new BoiForteDB('lxC');
    usarBanco(A);
    await carregarExemplo();
    const id = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Fazenda Exemplo', meu_nome: 'Ana' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 3)`, [id]);
    faz = { id, nome: 'Fazenda Exemplo', papel: 'dono' };
    await ligarFazenda(faz, 'enviar');
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);
    for (const [u, papel, nome, b] of [[gil, 'gerente', 'Gil', B], [caio, 'vaqueiro', 'Caio', C]] as const) {
      await s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: id, p_papel: papel }), meu_nome: nome });
      usarBanco(b);
      await ligarFazenda({ ...faz, papel }, 'baixar');
      expect((await sincronizar(transporte(u))).erros).toEqual([]);
    }
  }, 60000);

  it('apagado num celular vai para a lixeira de todos, com quem apagou', async () => {
    usarBanco(A);
    const lote = (await db.lotes.toArray()).find((l) => l.controle === 'lote' && !l.encerrado)!;
    loteGid = lote.gid!;
    const antes = await resumoLote(loteGid);
    expect(antes!.pesagens).toBeGreaterThan(0);
    await excluirLote(lote.id!);
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);

    usarBanco(B);
    expect((await sincronizar(transporte(gil))).erros).toEqual([]);
    expect(await resumoLote(loteGid)).toBeNull();
    const lx = await listarLixeira();
    expect(lx).toHaveLength(1);
    expect(lx[0]).toMatchObject({ titulo: `Lote ${lote.nome}`, por: 'Ana' });
    expect(lx[0].detalhe).toMatch(/pesage/);
    // a lixeira do celular de quem apagou continua igual (sem repetir)
    usarBanco(A);
    expect(await listarLixeira()).toHaveLength(1);
  }, 30000);

  it('restaurado no outro celular volta para todos (inclusive para quem apagou)', async () => {
    usarBanco(A);
    usarBanco(B);
    const [p] = await listarLixeira();
    const r = await restaurar(p.pacote, { papel: 'gerente', ligado: true });
    expect(r.registros).toBe(p.linhas.length);
    expect((await sincronizar(transporte(gil))).erros).toEqual([]);
    const noB = await resumoLote(loteGid);

    usarBanco(A);
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);
    expect(await resumoLote(loteGid)).toEqual(noB);
    expect(noB!.pesagens).toBeGreaterThan(0);
    expect(await listarLixeira()).toHaveLength(0);
    // o vaqueiro também recebe o lote de volta (e a lixeira dele esvazia)
    usarBanco(C);
    expect((await sincronizar(transporte(caio))).erros).toEqual([]);
    expect((await resumoLote(loteGid))?.pesagens).toBe(noB!.pesagens);
    expect(await listarLixeira()).toHaveLength(0);
  }, 30000);

  it('o vaqueiro desfaz um trato apagado e o custo continua o do servidor', async () => {
    usarBanco(A);
    const lote = (await db.lotes.where('gid').equals(loteGid).first())!;
    const fid = await registrarFornecimento({ loteId: lote.id!, data: '2030-02-01', kgFornecido: 20, kgPrevisto: 20, cabecas: lote.qtdCabecas, pesoRef: 240 });
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);
    const trato = (await db.fornecimentos.get(fid as number))!;
    expect(trato.custo).toBeGreaterThan(0);
    await desfazerFornecimento(trato.id!);
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);

    usarBanco(C);
    expect((await sincronizar(transporte(caio))).erros).toEqual([]);
    const lx = await listarLixeira();
    const p = lx.find((x) => x.linhas.some((l) => l.tabela === 'fornecimentos'))!;
    expect(p.linhas.find((l) => l.tabela === 'fornecimentos')!.dados.custo).toBe(0); // o vaqueiro não vê o custo
    await restaurar(p.pacote, { papel: 'vaqueiro', ligado: true });
    expect((await sincronizar(transporte(caio))).erros).toEqual([]);

    usarBanco(A);
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);
    const volta = await db.fornecimentos.where('gid').equals(trato.gid!).first();
    expect(volta?.custo).toBe(trato.custo);
  }, 30000);

  it('o vaqueiro não consegue restaurar um lote, nem com o app adulterado', async () => {
    usarBanco(A);
    const lote = (await db.lotes.where('gid').equals(loteGid).first())!;
    await excluirLote(lote.id!);
    expect((await sincronizar(transporte(ana))).erros).toEqual([]);
    usarBanco(C);
    expect((await sincronizar(transporte(caio))).erros).toEqual([]);
    const p = (await listarLixeira()).find((x) => x.linhas.some((l) => l.tabela === 'lotes'))!;
    await expect(restaurar(p.pacote, { papel: 'vaqueiro', ligado: true })).rejects.toThrow('Só o dono ou o gerente');
    // app adulterado: restaura sem conferir o papel; o servidor recusa e o lote continua apagado na nuvem
    await restaurar(p.pacote, {});
    const r = await sincronizar(transporte(caio));
    expect(r.erros.some((e) => e.tabela === 'lotes')).toBe(true);
    usarBanco(A);
    await sincronizar(transporte(ana));
    expect(await resumoLote(loteGid)).toBeNull();
  }, 30000);
});
