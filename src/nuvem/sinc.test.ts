// Dois ou três "celulares" (bancos locais separados) sincronizando com o servidor de verdade (migrações do Supabase em PGlite).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { BoiForteDB, usarBanco, db, TABELAS, registrarPesagemIndividual, registrarSaida, excluirEventoSanitario, registrarFornecimento, salvarEventoSanitario } from '../db';
import { carregarExemplo } from '../exemplo';
import { subirServidor, type Servidor } from './servidorTeste';
import { ligarFazenda, sincronizar, temDadosLocais, type Transporte, type FazendaNuvem } from './sinc';
import { atualizarModulo, atualizarPiquete, novoPiquete, usoDaArea } from '../pasto';

let s: Servidor;
const transporte = (uid: string): Transporte => ({
  enviar: (f, ops) => s.rpc(uid, 'enviar_alteracoes', { f, ops }),
  baixar: (f, desde, limite) => s.rpc(uid, 'baixar_alteracoes', { f, desde, limite }),
});
const fora: Transporte = { enviar: () => Promise.reject(new Error('sem internet')), baixar: () => Promise.reject(new Error('sem internet')) };

async function contar(b: BoiForteDB) {
  usarBanco(b);
  const out: Record<string, number> = {};
  for (const t of TABELAS) out[t] = await db.table(t).count();
  return out;
}

describe('sincronização entre celulares', () => {
  let ana: string, gil: string, caio: string;
  let A: BoiForteDB, B: BoiForteDB, C: BoiForteDB;
  let faz: FazendaNuvem;

  beforeAll(async () => {
    s = await subirServidor();
    ana = await s.novoUsuario('ana@x'); gil = await s.novoUsuario('gil@x'); caio = await s.novoUsuario('caio@x');
    A = new BoiForteDB('sincA'); B = new BoiForteDB('sincB'); C = new BoiForteDB('sincC');
  }, 30000);

  it('a fazenda inteira do exemplo sobe sem nenhuma recusa do servidor', async () => {
    usarBanco(A);
    await carregarExemplo();
    const id = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Fazenda Exemplo' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 3)`, [id]); // equipe maior nos testes
    faz = { id, nome: 'Fazenda Exemplo', papel: 'dono' };
    await ligarFazenda(faz, 'enviar');
    const total = await db.pendentes.count();
    const r = await sincronizar(transporte(ana));
    expect(r.erros).toEqual([]);
    expect(r.enviados).toBe(total);
    expect(await db.pendentes.count()).toBe(0);
  }, 30000);

  it('outro celular entra na equipe e recebe tudo igual, com as ligações certas', async () => {
    const cod = await s.rpc<string>(ana, 'criar_convite', { f: faz.id, p_papel: 'gerente' });
    await s.rpc(gil, 'aceitar_convite', { p_codigo: cod });
    usarBanco(B);
    await ligarFazenda({ ...faz, papel: 'gerente' }, 'baixar');
    const r = await sincronizar(transporte(gil));
    expect(r.erros).toEqual([]);
    expect(await contar(B)).toEqual(await contar(A));
    // pesagens penduradas no lote certo, itens da fórmula no ingrediente certo
    for (const b of [A, B]) usarBanco(b);
    const resumo = async (b: BoiForteDB) => {
      usarBanco(b);
      const lotes = await db.lotes.toArray();
      const out: string[] = [];
      for (const l of lotes) out.push(`${l.nome}:${await db.pesagens.where('loteId').equals(l.id!).count()}:${(await db.formulas.get(l.formulaId!))?.nome}`);
      const f = await db.formulas.toArray();
      for (const x of f) for (const i of x.itens) out.push(`${x.nome}>${(await db.ingredientes.get(i.ingredienteId))?.nome}:${i.qtd}`);
      return out.sort();
    };
    expect(await resumo(B)).toEqual(await resumo(A));
  }, 30000);

  it('cada um lança no seu celular e os dois ficam iguais', async () => {
    usarBanco(B);
    const femeas = (await db.lotes.toArray()).find((l) => l.controle === 'individual')!;
    await registrarPesagemIndividual(femeas.id!, '2026-11-19', [{ brinco: '101', peso: 220 }, { brinco: '999', peso: 200 }]);
    usarBanco(A);
    const machos = (await db.lotes.toArray()).find((l) => l.controle === 'lote')!;
    await db.lotes.update(machos.id!, { nome: 'Machos renomeados' });
    await sincronizar(transporte(ana));
    usarBanco(B);
    await sincronizar(transporte(gil));
    usarBanco(A);
    await sincronizar(transporte(ana));
    expect(await contar(A)).toEqual(await contar(B));
    usarBanco(B);
    expect((await db.lotes.toArray()).some((l) => l.nome === 'Machos renomeados')).toBe(true);
    usarBanco(A);
    expect(await db.animais.where('brinco').equals('999').count()).toBe(1); // animal novo criado no outro celular
  }, 30000);

  it('apagado num celular some do outro', async () => {
    usarBanco(A);
    const ev = (await db.sanidade.toArray()).find((e) => e.custo)!;
    await excluirEventoSanitario(ev.id!);
    await sincronizar(transporte(ana));
    usarBanco(B);
    await sincronizar(transporte(gil));
    expect(await db.sanidade.where('gid').equals(ev.gid!).count()).toBe(0);
    expect(await contar(B)).toEqual(await contar(A));
  }, 30000);

  it('valor adulterado no celular volta corrigido pelo servidor', async () => {
    usarBanco(A);
    const lote = (await db.lotes.toArray()).find((l) => l.controle === 'lote')!;
    const vid = await registrarSaida(lote.id!, { data: '2026-11-19', tipo: 'venda', cabecas: 2, pesoMedio: 366, modo: 'arroba', preco: 320, rendimento: 0.5, comissaoPct: 0.02, frete: 0 });
    await db.vendas.update(vid as number, { valorLiquido: 999999 });
    await sincronizar(transporte(ana));
    expect((await db.vendas.get(vid as number))!.valorLiquido).toBe(7651.84); // 2 × 12,2 @ × 320 − 2%
  }, 30000);

  it('vaqueiro recebe só o que precisa e não consegue lançar venda', async () => {
    const cod = await s.rpc<string>(ana, 'criar_convite', { f: faz.id, p_papel: 'vaqueiro' });
    await s.rpc(caio, 'aceitar_convite', { p_codigo: cod });
    usarBanco(C);
    await ligarFazenda({ ...faz, papel: 'vaqueiro' }, 'baixar');
    const r = await sincronizar(transporte(caio));
    expect(r.erros).toEqual([]);
    const n = await contar(C);
    expect(n.lancamentos + n.vendas + n.custosFixos).toBe(0);
    expect(n.lotes).toBeGreaterThan(0);
    expect((await db.ingredientes.toArray()).every((i) => i.preco === 0)).toBe(true); // preços não chegam ao vaqueiro
    const lote = (await db.lotes.toArray()).find((l) => l.controle === 'lote' && !l.encerrado)!;
    await registrarFornecimento({ loteId: lote.id!, data: '2030-01-15', kgFornecido: 20, kgPrevisto: 20, cabecas: lote.qtdCabecas, pesoRef: 240 });
    await salvarEventoSanitario({ loteId: lote.id!, data: '2026-11-19', feito: true, tipo: 'vermifugo', produto: 'Ivermectina', qtdAnimais: 10, custo: 80 });
    await registrarSaida(lote.id!, { data: '2026-11-19', tipo: 'morte', cabecas: 1 });
    const r2 = await sincronizar(transporte(caio));
    expect(r2.erros.map((e) => e.tabela)).toEqual(['vendas']); // a baixa de cabeças no lote passa; a venda/morte, não
    // o trato e a vacina chegaram no dono
    usarBanco(A);
    await sincronizar(transporte(ana));
    expect((await db.sanidade.toArray()).filter((e) => e.produto === 'Ivermectina')).toHaveLength(1);
    expect((await db.lancamentos.toArray()).some((l) => l.origem === 'sanidade' && l.valor === 80)).toBe(true);
    // o celular do vaqueiro não tem os preços; o custo do trato foi calculado no servidor
    const trato = (await db.fornecimentos.toArray()).find((x) => x.data === '2030-01-15');
    expect(trato?.custo).toBeGreaterThan(0);
  }, 30000);

  it('sem internet nada se perde: fica na fila', async () => {
    usarBanco(A);
    await db.propriedades.add({ nome: 'Retiro novo', criadoEm: 0 });
    await expect(sincronizar(fora)).rejects.toThrow('sem internet');
    expect(await db.pendentes.count()).toBe(1);
    await sincronizar(transporte(ana));
    expect(await db.pendentes.count()).toBe(0);
    expect(await temDadosLocais()).toBe(true);
  }, 30000);

  it('área do módulo: diminuir o piquete e depois o módulo sobe sem recusa', async () => {
    usarBanco(A);
    const mod = (await db.modulos.toArray()).find((m) => m.nome === 'Retiro 1')!; // 50 ha; piquetes 15 + 20 + 15
    const pq = (await db.piquetes.where('moduloId').equals(mod.id!).toArray()).find((p) => p.areaHa === 20)!;
    await atualizarPiquete(pq.id!, { areaHa: 10 });
    await atualizarModulo(mod.id!, { areaHa: 40 });
    // o módulo sobe antes do piquete e o servidor recusa (ainda soma 50); depois que o piquete subiu, vai de novo
    const r = await sincronizar(transporte(ana));
    expect(r.erros).toEqual([]);
    expect(await db.pendentes.count()).toBe(0);
    usarBanco(B);
    await sincronizar(transporte(gil));
    expect((await db.modulos.where('gid').equals(mod.gid!).first())?.areaHa).toBe(40);
  }, 30000);

  it('dois celulares sem internet no mesmo módulo: o piquete que não coube volta recusado e dá para corrigir', async () => {
    usarBanco(A);
    const mod = (await db.modulos.toArray()).find((m) => m.nome === 'Retiro 1')!;
    await atualizarModulo(mod.id!, { areaHa: 50 }); // piquetes: 15 + 10 + 15 = 40
    await sincronizar(transporte(ana));
    usarBanco(B);
    await sincronizar(transporte(gil));
    const modB = (await db.modulos.where('gid').equals(mod.gid!).first())!;
    await novoPiquete({ moduloId: modB.id!, nome: 'Novo do Gil', areaHa: 8 }); // cabia no celular do Gil
    usarBanco(A);
    await novoPiquete({ moduloId: mod.id!, nome: 'Novo da Ana', areaHa: 6 });
    expect((await sincronizar(transporte(ana))).erros).toEqual([]); // a Ana subiu primeiro: 46 de 50
    usarBanco(B);
    const r = await sincronizar(transporte(gil));
    expect(r.erros).toEqual([{ tabela: 'piquetes', erro: 'Área do módulo: o módulo Retiro 1 tem 50 ha e os outros piquetes já usam 46 ha. O piquete Novo do Gil pode ter no máximo 4 ha.' }]);
    // no celular do Gil chegou o piquete da Ana: a soma passa e a tela avisa
    expect(usoDaArea(modB, await db.piquetes.where('moduloId').equals(modB.id!).toArray())).toMatchObject({ areaModulo: 50, usada: 54 });
    // diminuir sempre pode no celular; aí sobe
    const novo = (await db.piquetes.toArray()).find((p) => p.nome === 'Novo do Gil')!;
    await atualizarPiquete(novo.id!, { areaHa: 4 });
    expect((await sincronizar(transporte(gil))).erros).toEqual([]);
    expect(await db.pendentes.count()).toBe(0);
  }, 30000);
});
