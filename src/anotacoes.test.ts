// Anotações e tarefas no celular: gravação, fila das fotos e sincronização entre dois celulares.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { BoiForteDB, db, usarBanco } from './db';
import {
  caminhoFoto, contarAnotacoes, ErroFoto, excluirAnotacao, lerFoto, limparFotosAntigas, marcarFeita, novaFotoId, salvarAnotacao,
  sincronizarFotos, type ArmazemFotos,
} from './anotacoes';
import { restaurar } from './lixeira';
import { ligarFazenda, sincronizar, type Transporte } from './nuvem/sinc';
import { subirServidor, type Servidor } from './nuvem/servidorTeste';

const bytes = (n: number) => new Uint8Array([n, n, n]).buffer;

/** Storage de mentira: guarda num mapa, pode ficar "sem sinal" ou recusar. */
function armazem() {
  const arquivos = new Map<string, ArrayBuffer>();
  const a = {
    arquivos, semSinal: false, proibido: new Set<string>(),
    async enviar(c: string, d: ArrayBuffer) {
      if (a.semSinal) throw new ErroFoto('rede', 'Sem internet agora.');
      if (arquivos.has(c)) throw new ErroFoto('existe', 'já existe');
      arquivos.set(c, d);
    },
    async baixar(c: string) {
      if (a.semSinal) throw new ErroFoto('rede', 'Sem internet agora.');
      const d = arquivos.get(c);
      if (!d) throw new ErroFoto('nao_existe', 'não achei');
      return d;
    },
    async apagar(c: string) {
      if (a.semSinal) throw new ErroFoto('rede', 'Sem internet agora.');
      if (a.proibido.has(c)) throw new ErroFoto('proibido', 'não pode');
      if (!arquivos.delete(c)) throw new ErroFoto('nao_existe', 'não achei');
    },
  };
  return a satisfies ArmazemFotos & Record<string, unknown>;
}

async function fazendaBasica() {
  const p = await db.propriedades.add({ nome: 'Boa Vista', criadoEm: 0 });
  const m1 = await db.modulos.add({ propriedadeId: p, nome: 'Retiro de cima', criadoEm: 0 });
  const m2 = await db.modulos.add({ propriedadeId: p, nome: 'Retiro de baixo', criadoEm: 0 });
  const q = await db.piquetes.add({ moduloId: m2, nome: 'Piquete 3', criadoEm: 0 });
  return { p, m1, m2, q };
}

describe('anotações no celular', () => {
  let n = 0;
  beforeEach(() => { usarBanco(new BoiForteDB('anot' + ++n)); });

  it('atualiza um banco antigo (versão 3) sem perder nada', async () => {
    const velho = new Dexie('velho3');
    velho.version(1).stores({ propriedades: '++id, nome', modulos: '++id, propriedadeId', piquetes: '++id, moduloId', lotes: '++id, propriedadeId, piqueteId, encerrado', animais: '++id, loteId, brinco', pesagens: '++id, loteId, data' });
    velho.version(2).stores({ lotes: '++id, propriedadeId, piqueteId, encerrado, formulaId', ingredientes: '++id, nome', formulas: '++id, tipo', movimentos: '++id, ingredienteId, formulaId, data, [origem+refId]', batidas: '++id, formulaId, data', fornecimentos: '++id, loteId, data, [loteId+data], formulaId', config: 'chave' });
    velho.version(3).stores({ lancamentos: '++id, data, loteId, categoria, [origem+refId]', custosFixos: '++id', vendas: '++id, loteId, data', sanidade: '++id, loteId, data, feito', lembretes: '++id' });
    await velho.open();
    await velho.table('propriedades').add({ nome: 'X', criadoEm: 0 });
    velho.close();
    const novo = new BoiForteDB('velho3');
    expect((await novo.propriedades.toArray())[0].gid).toMatch(/^[0-9a-f-]{36}$/);
    expect(await novo.anotacoes.count()).toBe(0);
    novo.close();
  });

  it('grava com texto, lugar e fotos; o piquete manda no módulo', async () => {
    const { m1, m2, q } = await fazendaBasica();
    await expect(salvarAnotacao({ texto: '   ' }, [], [])).rejects.toThrow('Escreva ou fale');
    const f1 = novaFotoId(), f2 = novaFotoId();
    const id = await salvarAnotacao({ texto: ' Cerca caída ', categoria: 'cerca', moduloId: m1, piqueteId: q, urgente: true }, [f1, f2], [{ id: f1, dados: bytes(1) }, { id: f2, dados: bytes(2) }], undefined, { nome: 'Vito', id: 'abc' });
    const a = (await db.anotacoes.get(id))!;
    expect(a).toMatchObject({ texto: 'Cerca caída', categoria: 'cerca', moduloId: m2, piqueteId: q, urgente: true, feita: false, autor: 'Vito', fotos: [{ foto: f1 }, { foto: f2 }] });
    expect(a.gid).toBeTruthy();
    expect(await db.fotosAnotacao.count()).toBe(2);
    expect((await db.fotosAnotacao.get(f1))?.estado).toBe('enviar');
    expect(await db.pendentes.get(['anotacoes', id])).toBeTruthy(); // vai para a nuvem
    expect(await contarAnotacoes()).toEqual({ abertas: 1, urgentes: 1 });
    await marcarFeita(id, true, 'Vera');
    expect(await db.anotacoes.get(id)).toMatchObject({ feita: true, feitaPor: 'Vera' });
    expect(await contarAnotacoes()).toEqual({ abertas: 0, urgentes: 0 });
    await marcarFeita(id, false);
    const r = (await db.anotacoes.get(id))!;
    expect(r.feita).toBe(false);
    expect(r.feitaEm).toBeUndefined();
    expect(r.feitaPor).toBeUndefined();
  });

  it('no máximo 4 fotos, e só ids no formato certo', async () => {
    const ids = [1, 2, 3, 4, 5].map(() => novaFotoId());
    await expect(salvarAnotacao({ texto: 'x' }, ids, [])).rejects.toThrow('No máximo 4');
    await expect(salvarAnotacao({ texto: 'x' }, ['../x'], [])).rejects.toThrow('Foto inválida');
  });

  it('tirar foto da anotação: some na hora se nunca subiu; se já subiu, fica marcada para apagar da nuvem. Apagar a anotação guarda as fotos', async () => {
    const f1 = novaFotoId(), f2 = novaFotoId();
    const id = await salvarAnotacao({ texto: 'Bebedouro' }, [f1, f2], [{ id: f1, dados: bytes(1) }, { id: f2, dados: bytes(2) }]);
    await db.fotosAnotacao.update(f2, { estado: 'ok' }); // f2 já foi para a nuvem
    await salvarAnotacao({ texto: 'Bebedouro vazando' }, [], [], id);
    expect(await db.fotosAnotacao.get(f1)).toBeUndefined();
    expect(await db.fotosAnotacao.get(f2)).toMatchObject({ estado: 'apagar' });
    expect((await db.fotosAnotacao.get(f2))?.dados).toBeUndefined();
    const f3 = novaFotoId();
    await salvarAnotacao({ texto: 'Bebedouro vazando' }, [f3], [{ id: f3, dados: bytes(3) }], id);
    const pacote = await excluirAnotacao(id);
    expect(await db.anotacoes.count()).toBe(0);
    // a anotação foi para a lixeira: a foto fica (no celular e na fila para subir) e volta junto
    expect(await db.fotosAnotacao.get(f3)).toMatchObject({ estado: 'enviar' });
    await restaurar(pacote!);
    expect(await db.anotacoes.get(id)).toMatchObject({ texto: 'Bebedouro vazando', fotos: [{ foto: f3 }] });
  });

  it('fila das fotos: envia, apaga e baixa as que faltam; sem sinal para e tenta depois', async () => {
    const a = armazem();
    const F = 'fazenda-1';
    const f1 = novaFotoId(), f2 = novaFotoId(), f3 = novaFotoId();
    await salvarAnotacao({ texto: 'A' }, [f1, f2], [{ id: f1, dados: bytes(1) }, { id: f2, dados: bytes(2) }]);
    a.semSinal = true;
    expect(await sincronizarFotos(a, F, true)).toMatchObject({ enviadas: 0 });
    expect(await db.fotosAnotacao.where('estado').equals('enviar').count()).toBe(2);
    a.semSinal = false;
    a.arquivos.set(caminhoFoto(F, f2), bytes(2)); // f2 já tinha subido (o celular caiu antes de saber)
    expect(await sincronizarFotos(a, F, true)).toMatchObject({ enviadas: 2, erros: [] });
    expect(await db.fotosAnotacao.where('estado').equals('ok').count()).toBe(2);
    // outra pessoa anotou com foto f3 (chegou pela sincronização, sem a foto)
    a.arquivos.set(caminhoFoto(F, f3), bytes(3));
    await db.anotacoes.add({ texto: 'B', data: '2026-11-23', feita: false, fotos: [{ foto: f3 }], criadoEm: 0 });
    expect(await sincronizarFotos(a, F, true)).toMatchObject({ baixadas: 1 });
    expect(new Uint8Array((await lerFoto(f3))!)).toEqual(new Uint8Array(bytes(3)));
    // tirar as fotos da anotação: somem da nuvem e do celular; sem permissão também sai da fila
    const id = (await db.anotacoes.toArray()).find((x) => x.texto === 'A');
    a.proibido.add(caminhoFoto(F, f2));
    await salvarAnotacao({ texto: 'A' }, [], [], id!.id!);
    expect(await sincronizarFotos(a, F, true)).toMatchObject({ apagadas: 2 });
    expect(a.arquivos.has(caminhoFoto(F, f1))).toBe(false);
    expect(await db.fotosAnotacao.count()).toBe(1);
    // apagar a anotação (lixeira) não apaga a foto da nuvem
    await excluirAnotacao((await db.anotacoes.toArray()).find((x) => x.texto === 'B')!.id!);
    expect(await sincronizarFotos(a, F, true)).toMatchObject({ apagadas: 0 });
    expect(a.arquivos.has(caminhoFoto(F, f3))).toBe(true);
  });

  it('consultor não envia nem apaga, só baixa', async () => {
    const a = armazem();
    const f1 = novaFotoId();
    await salvarAnotacao({ texto: 'A' }, [f1], [{ id: f1, dados: bytes(1) }]);
    expect(await sincronizarFotos(a, 'f', false)).toMatchObject({ enviadas: 0 });
    expect(a.arquivos.size).toBe(0);
  });

  it('lerFoto baixa na hora quando não tem no celular', async () => {
    const f = novaFotoId();
    expect(await lerFoto(f)).toBeNull();
    expect(new Uint8Array((await lerFoto(f, async () => bytes(7)))!)[0]).toBe(7);
    expect(await db.fotosAnotacao.get(f)).toMatchObject({ estado: 'ok' });
  });

  it('libera espaço: tira do celular as fotos (já na nuvem) de anotações feitas há mais de 30 dias', async () => {
    const velha = novaFotoId(), nova = novaFotoId(), naoSubiu = novaFotoId();
    const a = await salvarAnotacao({ texto: 'velha' }, [velha, naoSubiu], [{ id: velha, dados: bytes(1) }, { id: naoSubiu, dados: bytes(3) }]);
    const b = await salvarAnotacao({ texto: 'nova' }, [nova], [{ id: nova, dados: bytes(2) }]);
    await db.fotosAnotacao.bulkUpdate([{ key: velha, changes: { estado: 'ok' } }, { key: nova, changes: { estado: 'ok' } }]);
    await db.anotacoes.update(a, { feita: true, feitaEm: '2026-09-01' });
    await db.anotacoes.update(b, { feita: true, feitaEm: '2026-11-20' });
    await limparFotosAntigas(30, '2026-11-23');
    expect(await db.fotosAnotacao.get(velha)).toBeUndefined();
    expect(await db.fotosAnotacao.get(naoSubiu)).toBeTruthy(); // ainda não subiu: não pode perder
    expect(await db.fotosAnotacao.get(nova)).toBeTruthy();
  });

  it('ligar à nuvem: "baixar" limpa as fotos do celular; "enviar" manda todas para a fazenda nova', async () => {
    const f1 = novaFotoId(), f2 = novaFotoId();
    await salvarAnotacao({ texto: 'A' }, [f1], [{ id: f1, dados: bytes(1) }]);
    await db.fotosAnotacao.update(f1, { estado: 'ok' });
    await db.fotosAnotacao.put({ id: f2, estado: 'apagar', em: 0 });
    await ligarFazenda({ id: 'f', nome: 'F', papel: 'dono' }, 'enviar');
    expect(await db.fotosAnotacao.toArray()).toEqual([expect.objectContaining({ id: f1, estado: 'enviar' })]);
    await ligarFazenda({ id: 'f', nome: 'F', papel: 'dono' }, 'baixar');
    expect(await db.fotosAnotacao.count()).toBe(0);
  });
});

describe('anotações entre dois celulares (servidor de verdade)', () => {
  let s: Servidor;
  let ana: string, vito: string;
  let A: BoiForteDB, B: BoiForteDB;
  const tr = (uid: string): Transporte => ({
    enviar: (f, ops) => s.rpc(uid, 'enviar_alteracoes', { f, ops }),
    baixar: (f, desde, limite) => s.rpc(uid, 'baixar_alteracoes', { f, desde, limite }),
  });

  beforeAll(async () => {
    s = await subirServidor();
    ana = await s.novoUsuario('ana@x'); vito = await s.novoUsuario('vito@x');
    A = new BoiForteDB('ponteA'); B = new BoiForteDB('ponteB');
  }, 30000);

  it('o vaqueiro anota no pasto, o dono recebe com lugar, foto e o nome de quem anotou', async () => {
    const f = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    usarBanco(A);
    const { q } = await fazendaBasica();
    await ligarFazenda({ id: f, nome: 'Boa Vista', papel: 'dono' }, 'enviar');
    expect((await sincronizar(tr(ana))).erros).toEqual([]);

    await s.rpc(vito, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f, p_papel: 'vaqueiro' }), meu_nome: 'Vito' });
    usarBanco(B);
    await ligarFazenda({ id: f, nome: 'Boa Vista', papel: 'vaqueiro' }, 'baixar');
    await sincronizar(tr(vito));
    const piqB = (await db.piquetes.toArray())[0];
    const foto = novaFotoId();
    await salvarAnotacao({ texto: 'Cocho quebrado', categoria: 'cocho', piqueteId: piqB.id, urgente: true }, [foto], [{ id: foto, dados: bytes(9) }], undefined, { nome: 'vito' });
    const nuvem = armazem();
    expect((await sincronizar(tr(vito))).erros).toEqual([]);
    expect(await sincronizarFotos(nuvem, f, true)).toMatchObject({ enviadas: 1 });
    expect((await db.anotacoes.toArray())[0]).toMatchObject({ autor: 'Vito' }); // o nome que vale é o da equipe

    usarBanco(A);
    await sincronizar(tr(ana));
    const a = (await db.anotacoes.toArray())[0];
    const piqA = await db.piquetes.get(a.piqueteId!);
    expect(piqA?.id).toBe(q);
    expect(await db.modulos.get(a.moduloId!)).toMatchObject({ nome: 'Retiro de baixo' });
    expect(a).toMatchObject({ texto: 'Cocho quebrado', autor: 'Vito', urgente: true, feita: false });
    expect(await sincronizarFotos(nuvem, f, true)).toMatchObject({ baixadas: 1 });
    expect(new Uint8Array((await lerFoto(foto))!)[0]).toBe(9);

    // o dono resolve; o vaqueiro vê quem resolveu
    await marcarFeita(a.id!, true, 'Ana');
    await sincronizar(tr(ana));
    usarBanco(B);
    await sincronizar(tr(vito));
    expect((await db.anotacoes.toArray())[0]).toMatchObject({ feita: true, feitaPor: 'Ana' });
  }, 30000);
});
