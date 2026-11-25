import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoiForteDB, usarBanco, db, criarLote, garantirIngredientesPadrao, registrarFornecimento, desfazerFornecimento, registrarBatida, desfazerBatida,
  registrarSaida, desfazerSaida, salvarEventoSanitario, excluirEventoSanitario, excluirLote, excluirPiquetes, excluirModulo, excluirPropriedade,
  excluirRegistro, excluirIngrediente, comprarInsumo, saldoIngrediente, guardarCopiaInteira, COPIA_INTEIRA, MAX_COPIAS, registrarCompraLote, TABELAS,
} from './db';
import {
  apagarTodosOsDados, contarLixeira, dependencias, listarLixeira, motivoNaoRestaura, restaurar, trocarPeloArquivo, voltarCopiaInteira,
} from './lixeira';
import { entrarNoPiquete, excluirOcupacao, quemEstaNoPiquete } from './pasto';
import { excluirAnotacao, salvarAnotacao } from './anotacoes';

let n = 0;
beforeEach(async () => { usarBanco(new BoiForteDB('lix-' + n++)); });

async function fazenda() {
  await garantirIngredientesPadrao();
  const ings = await db.ingredientes.toArray();
  const milho = ings.find((i) => i.nome.startsWith('Milho'))!.id!;
  const soja = ings.find((i) => i.nome.startsWith('Farelo de soja'))!.id!;
  const formulaId = await db.formulas.add({ nome: 'Proteinado', tipo: 'proteinado', unidade: 'kg', modo: 'direto', consumoPctPV: 0.002, itens: [{ ingredienteId: milho, qtd: 700 }, { ingredienteId: soja, qtd: 300 }], criadoEm: 0 });
  const pid = await db.propriedades.add({ nome: 'Boa Vista', criadoEm: 0 });
  const mod = await db.modulos.add({ propriedadeId: pid, nome: 'Módulo 1', criadoEm: 0 });
  const p1 = await db.piquetes.add({ moduloId: mod, nome: 'P1', areaHa: 5, criadoEm: 0 });
  const p2 = await db.piquetes.add({ moduloId: mod, nome: 'P2', areaHa: 5, criadoEm: 0 });
  const lote = await criarLote({ propriedadeId: pid, nome: 'Nelore 1', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 40, dataEntrada: '2026-10-01', formulaId }, 250);
  await db.pesagens.add({ loteId: lote, data: '2026-11-01', tipo: 'media', pesoMedio: 280, qtdPesada: 40, criadoEm: 0 });
  await salvarEventoSanitario({ loteId: lote, data: '2026-10-05', feito: true, tipo: 'vacina', produto: 'Aftosa', custo: 120 });
  await registrarFornecimento({ loteId: lote, data: '2026-11-10', kgFornecido: 80, kgPrevisto: 80, cabecas: 40, pesoRef: 280 });
  return { pid, mod, p1, p2, lote, formulaId, milho, soja };
}

const contagem = async () => Object.fromEntries(await Promise.all(
  ['propriedades', 'modulos', 'piquetes', 'lotes', 'pesagens', 'sanidade', 'lancamentos', 'fornecimentos', 'movimentos', 'ocupacoes'].map(async (t) => [t, await db.table(t).count()]),
));

describe('lixeira no celular', () => {
  it('apagar o lote manda tudo dele para a lixeira num pacote só, e restaurar devolve igual (mesmo id e gid)', async () => {
    const f = await fazenda();
    const antes = await contagem();
    const lote = await db.lotes.get(f.lote);
    const pesagens = await db.pesagens.where('loteId').equals(f.lote).toArray();
    const pacote = await excluirLote(f.lote);
    expect(pacote).toBeTruthy();
    expect(await db.lotes.count()).toBe(0);
    expect(await db.pesagens.count()).toBe(0);
    expect(await db.movimentos.count()).toBe(0);

    const lista = await listarLixeira();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ pacote, titulo: 'Lote Nelore 1', icone: '🐂' });
    expect(lista[0].detalhe).toBe('Junto: 2 pesagens, 1 trato, 2 movimentos de estoque, 1 vacina ou remédio e 1 lançamento de dinheiro.');
    // as referências ficam pelo gid (servem em qualquer celular da equipe)
    const pes = lista[0].linhas.find((a) => a.tabela === 'pesagens')!;
    expect(pes.dados.loteId).toBe(lote!.gid);
    expect(pes.idLocal).toBeTypeOf('number');
    expect(await contarLixeira()).toBe(1);

    const r = await restaurar(pacote!);
    expect(r).toMatchObject({ pacotes: 1, avisos: [] });
    expect(await contagem()).toEqual(antes);
    expect(await db.lotes.get(f.lote)).toEqual(lote);
    expect(await db.pesagens.where('loteId').equals(f.lote).toArray()).toEqual(pesagens);
    expect(await db.lixeira.count()).toBe(0);
    // o estoque volta junto com o trato
    expect(await saldoIngrediente(f.milho)).toBeCloseTo(-56, 6);
  });

  it('desfazer antes de sincronizar: o "apagar" que ia subir vira gravação normal', async () => {
    const f = await fazenda();
    await db.pendentes.clear();
    const pacote = await excluirLote(f.lote);
    const dels = await db.pendentes.toArray();
    expect(dels.every((p) => p.op === 'del' && p.lixeira === pacote)).toBe(true);
    await restaurar(pacote!);
    const depois = await db.pendentes.toArray();
    expect(depois.length).toBe(dels.length);
    expect(depois.every((p) => p.op === 'put')).toBe(true);
  });

  it('o que precisa de outra coisa da lixeira volta junto (a pesagem precisa do lote)', async () => {
    const f = await fazenda();
    const pesagem = (await db.pesagens.where('loteId').equals(f.lote).toArray())[1];
    const a = await excluirRegistro('pesagens', pesagem.id!);
    const b = await excluirLote(f.lote);
    expect((await dependencias(a!)).map((p) => p.pacote)).toEqual([b]);
    expect(await dependencias(b!)).toEqual([]);
    const lista = await listarLixeira();
    expect(lista.map((p) => p.titulo)).toEqual(['Lote Nelore 1', 'Pesagem do lote Nelore 1 em 01/11/2026 (280 kg)']);
    const r = await restaurar(a!);
    expect(r.pacotes).toBe(2);
    expect(await db.pesagens.get(pesagem.id!)).toEqual(pesagem);
    expect(await db.lotes.count()).toBe(1);
    expect(await db.lixeira.count()).toBe(0);
  });

  it('falta alguma coisa que não existe mais: não volta nada e explica', async () => {
    const f = await fazenda();
    const pesagem = (await db.pesagens.where('loteId').equals(f.lote).toArray())[1];
    const a = await excluirRegistro('pesagens', pesagem.id!);
    // o lote sumiu sem passar pela lixeira (versão antiga do app)
    await db.transaction('rw', db.tables, async () => { await db.lotes.delete(f.lote); });
    await expect(restaurar(a!)).rejects.toThrow('Não dá para voltar "Pesagem em 01/11/2026 (280 kg)": o lote que ele usava não existe mais.');
    expect(await db.lixeira.count()).toBe(1);
  });

  it('venda desfeita: restaurar tira as cabeças do lote de novo (e não deixa se o lote não tiver)', async () => {
    const f = await fazenda();
    const v = await registrarSaida(f.lote, { data: '2026-11-20', tipo: 'venda', cabecas: 15, pesoMedio: 450, modo: 'arroba', preco: 300 });
    expect((await db.lotes.get(f.lote))!.qtdCabecas).toBe(25);
    const pacote = await desfazerSaida(v);
    expect((await db.lotes.get(f.lote))!.qtdCabecas).toBe(40);
    expect((await listarLixeira())[0].titulo).toBe('Venda de 15 cabeças do lote Nelore 1 em 20/11/2026');
    await restaurar(pacote!);
    expect((await db.lotes.get(f.lote))!.qtdCabecas).toBe(25);
    expect(await db.vendas.get(v)).toBeTruthy();
    // de novo, mas agora o lote vendeu o resto antes de restaurar
    const p2 = await desfazerSaida(v);
    await registrarSaida(f.lote, { data: '2026-11-21', tipo: 'morte', cabecas: 30 });
    await expect(restaurar(p2!)).rejects.toThrow('o lote Nelore 1 tem 10 cabeças agora');
    // venda de todas as cabeças encerra o lote
    await registrarSaida(f.lote, { data: '2026-11-22', tipo: 'morte', cabecas: 10 });
    const v3 = (await db.vendas.toArray()).find((x) => x.cabecas === 10)!;
    const p3 = await desfazerSaida(v3.id!);
    expect((await db.lotes.get(f.lote))!.encerrado).toBe(false);
    await restaurar(p3!);
    expect(await db.lotes.get(f.lote)).toMatchObject({ qtdCabecas: 0, encerrado: true, dataSaida: '2026-11-22' });
  });

  it('trato desmarcado e marcado de novo no mesmo dia: o antigo não volta por cima', async () => {
    const f = await fazenda();
    const fid = (await db.fornecimentos.toArray())[0].id!;
    const pacote = await desfazerFornecimento(fid);
    expect((await listarLixeira())[0].titulo).toBe('Trato do lote Nelore 1 em 10/11/2026');
    expect((await listarLixeira())[0].detalhe).toBe(''); // o estoque do trato faz parte dele
    await registrarFornecimento({ loteId: f.lote, data: '2026-11-10', kgFornecido: 70, kgPrevisto: 70, cabecas: 40, pesoRef: 280 });
    await expect(restaurar(pacote!)).rejects.toThrow('já foi marcado de novo');
  });

  it('batida, vacina e ingrediente voltam com o que é deles', async () => {
    const f = await fazenda();
    await comprarInsumo(f.milho, '2026-11-01', 1000, 1200);
    await db.formulas.update(f.formulaId, { modo: 'batida' });
    const b = await registrarBatida(f.formulaId, '2026-11-05', 500);
    const pb = await desfazerBatida(b);
    expect((await listarLixeira())[0].titulo).toBe('Batida de 500 kg da Proteinado em 05/11/2026');
    await restaurar(pb!);
    expect(await saldoIngrediente(f.milho)).toBeCloseTo(1000 - 56 - 350, 6);
    const ev = (await db.sanidade.toArray())[0];
    const ps = await excluirEventoSanitario(ev.id!);
    const item = (await listarLixeira())[0];
    expect(item.titulo).toBe('Aftosa do lote Nelore 1 em 05/10/2026');
    expect(item.detalhe).toBe(''); // a despesa da vacina vai junto sem precisar dizer
    await restaurar(ps!);
    expect(await db.lancamentos.where('[origem+refId]').equals(['sanidade', ev.id!]).count()).toBe(1);
    const ureia = (await db.ingredientes.toArray()).find((i) => !['Milho', 'Farelo de soja'].some((x) => i.nome.startsWith(x)))!;
    const pi = await excluirIngrediente(ureia.id!);
    await restaurar(pi!);
    expect(await db.ingredientes.get(ureia.id!)).toEqual(ureia);
  });

  it('lote volta sem piquete se outro lote entrou no lugar; a entrada dele fecha no dia em que o outro entrou', async () => {
    const f = await fazenda();
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: f.lote, piqueteId: f.p1, data: '2026-11-01', cabecas: 40 });
    const pacote = await excluirLote(f.lote);
    const outro = await criarLote({ propriedadeId: f.pid, nome: 'Nelore 2', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 20, dataEntrada: '2026-11-15' });
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: outro, piqueteId: f.p1, data: '2026-11-15', cabecas: 20 });
    const r = await restaurar(pacote!);
    expect(r.avisos).toEqual([
      'Lote Nelore 1 voltou sem piquete: o piquete P1 agora tem o lote Nelore 2.',
      'Entrada do lote Nelore 1 no piquete P1 em 01/11/2026: voltou com a saída em 15/11/2026, porque depois disso o piquete ou os animais tiveram outra entrada.',
    ]);
    expect((await db.lotes.get(f.lote))!.piqueteId).toBeNull();
    expect((await quemEstaNoPiquete(f.p1))!.nome).toBe('Nelore 2');
    const ocs = await db.ocupacoes.where('[tipo+ocupanteId]').equals(['lote', f.lote]).toArray();
    expect(ocs.map((o) => [o.entrada, o.saida])).toEqual([['2026-11-01', '2026-11-15']]);
  });

  it('piquete apagado com o lote dentro: ao restaurar, o lote volta para o piquete', async () => {
    const f = await fazenda();
    await entrarNoPiquete({ tipo: 'lote', ocupanteId: f.lote, piqueteId: f.p1, data: '2026-11-01', cabecas: 40 });
    const pacote = await excluirPiquetes([f.p1]);
    expect((await db.lotes.get(f.lote))!.piqueteId).toBeNull();
    const item = (await listarLixeira())[0];
    expect(item).toMatchObject({ titulo: 'Piquete P1', detalhe: 'Junto: 1 entrada em piquete.' });
    const r = await restaurar(pacote!);
    expect(r.avisos).toEqual(['O lote Nelore 1 voltou para o piquete P1.']);
    expect((await db.lotes.get(f.lote))!.piqueteId).toBe(f.p1);
  });

  it('apagar uma entrada de piquete por engano e restaurar', async () => {
    const f = await fazenda();
    const o = await entrarNoPiquete({ tipo: 'lote', ocupanteId: f.lote, piqueteId: f.p2, data: '2026-11-01', cabecas: 40 });
    const pacote = await excluirOcupacao(o);
    expect((await listarLixeira())[0].titulo).toBe('Entrada do lote Nelore 1 no piquete P2 em 01/11/2026');
    await restaurar(pacote!);
    expect(await db.ocupacoes.get(o)).toMatchObject({ entrada: '2026-11-01', saida: null });
    expect((await db.lotes.get(f.lote))!.piqueteId).toBe(f.p2);
  });

  it('módulo e fazenda inteira voltam com tudo', async () => {
    const f = await fazenda();
    const antes = await contagem();
    const pm = await excluirModulo(f.mod);
    expect((await listarLixeira())[0]).toMatchObject({ titulo: 'Módulo Módulo 1', detalhe: 'Junto: 2 piquetes.' });
    await restaurar(pm!);
    const pf = await excluirPropriedade(f.pid);
    expect(await contagem()).toMatchObject({ propriedades: 0, lotes: 0, piquetes: 0, pesagens: 0 });
    const item = (await listarLixeira())[0];
    expect(item.titulo).toBe('Fazenda Boa Vista');
    expect(item.detalhe).toContain('1 módulo, 2 piquetes, 1 lote, 2 pesagens');
    await restaurar(pf!);
    expect(await contagem()).toEqual(antes);
    expect(await db.lixeira.count()).toBe(0);
  });

  it('anotação apagada volta sem o piquete, se o piquete também foi apagado', async () => {
    const f = await fazenda();
    const id = await salvarAnotacao({ texto: 'Cerca caída no fundo', piqueteId: f.p2 }, [], []);
    const pa = await excluirAnotacao(id);
    await excluirPiquetes([f.p2]);
    expect(await dependencias(pa!)).toEqual([]); // não traz o piquete junto
    const r = await restaurar(pa!);
    expect(r.avisos).toEqual(['Anotação: Cerca caída no fundo voltou sem o piquete, porque ele foi apagado.']);
    expect(await db.anotacoes.get(id)).toMatchObject({ texto: 'Cerca caída no fundo', moduloId: f.mod });
    expect((await db.anotacoes.get(id))!.piqueteId).toBeUndefined();
  });

  it('o app refazendo a compra ou a despesa da vacina não manda nada para a lixeira', async () => {
    const f = await fazenda();
    const compra = { data: '2026-10-01', precoCab: 2000, comissaoPct: 0.02, frete: 0, nfGta: 0 };
    const id1 = await registrarCompraLote(f.lote, compra);
    const gid1 = (await db.lancamentos.get(id1))!.gid;
    expect(await registrarCompraLote(f.lote, { ...compra, precoCab: 2100 })).toBe(id1); // o mesmo lançamento, atualizado
    expect(await db.lancamentos.get(id1)).toMatchObject({ gid: gid1, compraPreco: 2100 });
    expect(await db.lancamentos.where('[origem+refId]').equals(['compra_lote', f.lote]).count()).toBe(1);
    // vacina: muda o custo (a mesma despesa) e depois tira o custo (a despesa sai, mas não vai para a lixeira)
    const ev = (await db.sanidade.toArray())[0];
    const desp = (await db.lancamentos.where('[origem+refId]').equals(['sanidade', ev.id!]).first())!;
    const { id: _i, criadoEm: _c, gid: _g, ...resto } = ev;
    await salvarEventoSanitario({ ...resto, custo: 150 }, ev.id);
    expect(await db.lancamentos.get(desp.id!)).toMatchObject({ gid: desp.gid, valor: 150 });
    await salvarEventoSanitario({ ...resto, custo: 0 }, ev.id);
    expect(await db.lancamentos.get(desp.id!)).toBeUndefined();
    expect(await contarLixeira()).toBe(0);
    expect(await db.pendentes.get(['lancamentos', desp.id!])).toMatchObject({ op: 'del', lixeira: false }); // a nuvem também não põe na lixeira
  });

  it('a despesa da compra não volta em dobro', async () => {
    const f = await fazenda();
    const compra = { data: '2026-10-01', precoCab: 2000, comissaoPct: 0.02, frete: 0, nfGta: 0 };
    const id = await registrarCompraLote(f.lote, compra);
    const pac = await excluirRegistro('lancamentos', id);
    await registrarCompraLote(f.lote, compra); // lançada de novo
    await expect(restaurar(pac!)).rejects.toThrow('a compra desse lote já está lançada');
  });

  it('nenhuma tela apaga direto do banco: tudo passa pela lixeira', () => {
    // Só as tabelas de dados (as que sincronizam); fotos guardadas no celular e afins podem sair direto.
    const dados = new Set<string>(TABELAS);
    const ruins: string[] = [];
    for (const pasta of ['./pages/', './components/']) {
      const dir = fileURLToPath(new URL(pasta, import.meta.url));
      for (const n of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
        const t = readFileSync(join(dir, n), 'utf8');
        for (const m of t.matchAll(/db\.(table\([^)]*\)|\w+)\.(?:(?:delete|bulkDelete|clear)\(|where\([^)]*\)[^;\n]*\.delete\(\))/g)) {
          if (m[1].startsWith('table(') || dados.has(m[1])) ruins.push(`${n}: ${m[0]}`);
        }
      }
    }
    expect(ruins).toEqual([]);
  });

  it('quem pode restaurar (com a nuvem)', () => {
    const lote = [{ tabela: 'lotes', gid: 'g', pacote: 'p', dados: {}, em: 0 }];
    const vacina = [{ tabela: 'sanidade', gid: 'g', pacote: 'p', dados: {}, em: 0 }, { tabela: 'lancamentos', gid: 'h', pacote: 'p', dados: { origem: 'sanidade' }, em: 0 }];
    const salario = [{ tabela: 'funcionarios', gid: 'g', pacote: 'p', dados: { usuarioId: 'u' }, em: 0 }];
    expect(motivoNaoRestaura(lote, null, false)).toBeNull(); // sem nuvem, pode tudo
    expect(motivoNaoRestaura(lote, 'dono', true)).toBeNull();
    expect(motivoNaoRestaura(lote, 'gerente', true)).toBeNull();
    expect(motivoNaoRestaura(lote, 'vaqueiro', true)).toMatch(/dono ou o gerente/);
    expect(motivoNaoRestaura(vacina, 'vaqueiro', true)).toBeNull();
    expect(motivoNaoRestaura(vacina, 'consultor', true)).toMatch(/só olha/);
    expect(motivoNaoRestaura(salario, 'gerente', true)).toMatch(/Só o dono/);
    expect(motivoNaoRestaura([{ tabela: COPIA_INTEIRA, gid: 'g', pacote: 'p', dados: {}, em: 0 }], 'dono', true)).toMatch(/desligue/);
  });

  it('"Apagar todos os dados" guarda uma cópia inteira na lixeira (com as fotos), e ela volta', async () => {
    const f = await fazenda();
    const foto = '11111111-1111-4111-8111-111111111111';
    await salvarAnotacao({ texto: 'Bebedouro' }, [foto], [{ id: foto, dados: new Uint8Array([1, 2, 3]).buffer }]);
    const pp = await excluirRegistro('piquetes', f.p2);
    const antes = await contagem();
    await apagarTodosOsDados();
    expect(await db.lotes.count()).toBe(0);
    expect(await db.fotosAnotacao.count()).toBe(0);
    const lista = await listarLixeira();
    expect(lista).toHaveLength(1); // o piquete que estava na lixeira foi junto na cópia
    expect(lista[0]).toMatchObject({ icone: '📱', titulo: 'Tudo o que estava no celular antes de "Apagar todos os dados"' });
    expect(lista[0].detalhe).toMatch(/^1 fazenda, 1 módulo, 1 piquete, \d+ ingredientes, 1 fórmula e mais \d+ registros\.$/);
    await voltarCopiaInteira(lista[0].pacote);
    expect(await contagem()).toEqual(antes);
    expect(new Uint8Array((await db.fotosAnotacao.get(foto))!.dados!)).toEqual(new Uint8Array([1, 2, 3]));
    expect((await listarLixeira()).map((p) => p.pacote)).toEqual([pp]); // a lixeira de antes voltou também
  });

  it('restaurar um arquivo de cópia por cima guarda o que estava antes; guarda só as últimas cópias', async () => {
    await fazenda();
    const vazio = { app: 'BoiForte', versao: 2, geradoEm: '', dados: {} };
    await trocarPeloArquivo(vazio);
    expect(await db.lotes.count()).toBe(0);
    const [c] = await listarLixeira();
    expect(c.titulo).toBe('Tudo o que estava no celular antes de restaurar uma cópia');
    // celular vazio: não guarda cópia
    expect(await guardarCopiaInteira('apagar_tudo')).toBeNull();
    await voltarCopiaInteira(c.pacote);
    expect(await db.lotes.count()).toBe(1);
    for (let i = 0; i < MAX_COPIAS + 2; i++) await guardarCopiaInteira('apagar_tudo');
    expect(await db.lixeira.where('tabela').equals(COPIA_INTEIRA).count()).toBe(MAX_COPIAS);
    expect(await db.copias.count()).toBe(MAX_COPIAS);
  });
});
