// Cria: gravações no banco do celular (grupos, animais, reprodução, pesagens e desmama).
import { db, type Animal, type Desmama, type EventoReprodutivo, type Grupo } from './db';
import { ErroValidacao } from './validar';
import { diasEntre, hojeISO } from './calc';
import { ativoCria, proximaVersao, resumoPacote, type ItemDesmama } from './cria';
import type { Fase } from './db';

/** Piquete livre: não pode ter lote ativo nem outro grupo de manejo ativo. */
export async function piqueteOcupado(piqueteId: number, menosGrupo?: number): Promise<string | null> {
  const lote = await db.lotes.where('piqueteId').equals(piqueteId).filter((l) => !l.encerrado).first();
  if (lote) return `o lote ${lote.nome}`;
  const g = await db.grupos.where('piqueteId').equals(piqueteId).filter((x) => !x.encerrado && x.id !== menosGrupo).first();
  return g ? `o grupo ${g.nome}` : null;
}

export async function salvarGrupo(d: Omit<Grupo, 'id' | 'criadoEm'>, id?: number): Promise<number> {
  if (d.piqueteId) {
    const ocupado = await piqueteOcupado(d.piqueteId, id);
    if (ocupado) throw new ErroValidacao(`Esse piquete já está com ${ocupado}. Um piquete recebe um lote ou grupo de cada vez.`);
  }
  if (id) { await db.grupos.update(id, d); return id; }
  return db.grupos.add({ ...d, criadoEm: Date.now() });
}

export async function excluirGrupo(id: number) {
  const n = await db.animais.where('grupoId').equals(id).filter((a) => ativoCria(a)).count();
  if (n) throw new ErroValidacao(`O grupo ainda tem ${n} animal(is). Mude-os de grupo antes de apagar.`);
  await db.grupos.delete(id);
}

/** Brinco (ou chip) já usado por outro animal ativo? */
async function brincoRepetido(a: Partial<Animal>, id?: number): Promise<string | null> {
  const iguais = await db.animais.where('brinco').equals(a.brinco!.trim()).filter((x) => x.id !== id && x.ativo && !x.saida).toArray();
  if (iguais.length) return `O brinco ${a.brinco} já é de outro animal.`;
  if (a.chip) {
    const c = await db.animais.filter((x) => x.id !== id && x.ativo && !x.saida && x.chip === a.chip).first();
    if (c) return `O chip ${a.chip} já é do animal ${c.brinco}.`;
  }
  return null;
}

/** Cadastra ou altera um animal da Cria. Touro pode ir por lote (qtd > 1, sem brinco de cada um). */
export async function salvarAnimalCria(d: Omit<Animal, 'id' | 'criadoEm'>, id?: number): Promise<number> {
  if (!d.grupoId) throw new ErroValidacao('Escolha o grupo de manejo.');
  if (!d.brinco?.trim()) throw new ErroValidacao(d.qtd && d.qtd > 1 ? 'Dê um nome ao lote de touros (ex.: "Touros Nelore").' : 'Informe o brinco ou a identificação.');
  if ((d.qtd ?? 1) > 1 && d.categoria !== 'touro') throw new ErroValidacao('Só touro pode ser lançado por lote. Matriz e bezerro são lançados um a um.');
  if (d.sisbov && !/^\d{15}$/.test(d.sisbov)) throw new ErroValidacao('O código SISBOV tem 15 números.');
  if (d.nascimento && d.nascimento > hojeISO()) throw new ErroValidacao('A data de nascimento não pode ser no futuro.');
  if (d.maeId && d.maeId === id) throw new ErroValidacao('O animal não pode ser mãe dele mesmo.');
  if ((d.qtd ?? 1) === 1) { const r = await brincoRepetido(d, id); if (r) throw new ErroValidacao(r); }
  if (d.maeId) {
    const m = await db.animais.get(d.maeId);
    if (!m || m.sexo === 'macho') throw new ErroValidacao('A mãe escolhida não é uma fêmea cadastrada.');
    if (d.nascimento && m.nascimento && diasEntre(m.nascimento, d.nascimento) < 540) throw new ErroValidacao('A mãe era nova demais nessa data. Confira a mãe e o nascimento.');
  }
  if (d.paiId) {
    const p = await db.animais.get(d.paiId);
    if (!p || p.sexo === 'femea') throw new ErroValidacao('O pai escolhido não é um touro cadastrado.');
  }
  const dados = { ...d, brinco: d.brinco.trim(), loteId: null };
  if (id) { await db.animais.update(id, dados); return id; }
  return db.animais.add({ ...dados, criadoEm: Date.now() } as Animal);
}

/** Tira o animal do rebanho (venda, descarte, morte). Fica no histórico. */
export async function darSaida(id: number, data: string, motivo: NonNullable<Animal['motivoSaida']>, obs?: string) {
  await db.animais.update(id, { saida: data, motivoSaida: motivo, ativo: false, ...(obs ? { obs } : {}) });
}

export async function salvarEvento(e: Omit<EventoReprodutivo, 'id' | 'criadoEm'>, id?: number): Promise<number> {
  const m = await db.animais.get(e.matrizId);
  if (!m || m.sexo === 'macho') throw new ErroValidacao('Escolha a vaca ou novilha.');
  if (e.data > hojeISO() && e.tipo !== 'monta') throw new ErroValidacao('A data não pode ser no futuro.');
  if (e.tipo === 'diagnostico' && !e.resultado) throw new ErroValidacao('Diga se a vaca está prenhe ou vazia.');
  if (id) { await db.reproducao.update(id, e); return id; }
  return db.reproducao.add({ ...e, criadoEm: Date.now() });
}

/** Lança a mesma cobertura (monta ou IA) para várias vacas de uma vez. */
export async function coberturaEmMassa(matrizes: number[], base: Omit<EventoReprodutivo, 'id' | 'criadoEm' | 'matrizId'>) {
  if (!matrizes.length) throw new ErroValidacao('Marque as vacas.');
  await db.transaction('rw', db.reproducao, async () => {
    for (const matrizId of matrizes) await db.reproducao.add({ ...base, matrizId, criadoEm: Date.now() });
  });
}

/**
 * Parto: cadastra o bezerro já com a mãe (e o pai, se souber) e registra o parto na ficha da vaca.
 * Natimorto: registra o parto sem criar bezerro.
 */
export async function registrarParto(p: {
  matrizId: number; data: string; partoTipo: 'normal' | 'assistido' | 'natimorto'; obs?: string;
  bezerro?: { brinco: string; sexo: 'macho' | 'femea'; pesoNascer?: number | null; raca?: string; chip?: string; paiId?: number | null; paiTexto?: string; grupoId?: number | null; creep?: boolean; foto?: string };
}): Promise<{ eventoId: number; bezerroId?: number }> {
  const m = await db.animais.get(p.matrizId);
  if (!m) throw new ErroValidacao('Vaca não encontrada.');
  if (p.data > hojeISO()) throw new ErroValidacao('A data do parto não pode ser no futuro.');
  return db.transaction('rw', db.animais, db.reproducao, async () => {
    let bezerroId: number | undefined;
    if (p.partoTipo !== 'natimorto') {
      if (!p.bezerro) throw new ErroValidacao('Preencha os dados do bezerro.');
      bezerroId = await salvarAnimalCria({
        ...p.bezerro, grupoId: p.bezerro.grupoId ?? m.grupoId, categoria: 'bezerro', nascimento: p.data, maeId: p.matrizId, ativo: true, raca: p.bezerro.raca || m.raca,
      });
    }
    const eventoId = await db.reproducao.add({ matrizId: p.matrizId, data: p.data, tipo: 'parto', partoTipo: p.partoTipo, bezerroId: bezerroId ?? null, obs: p.obs, criadoEm: Date.now() });
    // a novilha que pariu vira matriz
    if (m.categoria === 'novilha') await db.animais.update(p.matrizId, { categoria: 'matriz', entrada: m.entrada ?? p.data });
    return { eventoId, bezerroId };
  });
}

/** Pesagem da Cria: vários animais de uma vez (balança, foto ou voz). */
export async function pesarCria(data: string, itens: { animalId: number; peso: number }[], obs?: string) {
  const validos = itens.filter((i) => i.peso > 0);
  if (!validos.length) throw new ErroValidacao('Nenhum peso lançado.');
  await db.transaction('rw', db.pesosCria, async () => {
    for (const i of validos) {
      const ja = await db.pesosCria.where('animalId').equals(i.animalId).filter((p) => p.data === data).first();
      if (ja) await db.pesosCria.update(ja.id!, { peso: i.peso, obs });
      else await db.pesosCria.add({ animalId: i.animalId, data, peso: i.peso, obs, criadoEm: Date.now() });
    }
  });
}

export interface PedidoDesmama {
  data: string; grupoId?: number | null; fase: 'recria' | 'rip'; propriedadeId: number;
  itens: ItemDesmama[];
  separarSexos: boolean; // um lote de machos e outro de fêmeas
  nomeLote: string; grupoReposicaoId?: number | null; // para onde vão as fêmeas retidas como novilhas
  piqueteId?: number | null; obs?: string;
}

/**
 * Desmama: congela o pacote (pesos, sexo e idade de cada bezerro, com número de versão no ano) e cria o lote
 * de Recria ou RIP com o peso médio ponderado. Cada bezerro continua o mesmo animal (mesmo brinco, mãe e pai),
 * só sai do grupo da Cria e entra no lote, com a pesagem da desmama como a primeira pesagem do lote.
 * Fêmeas marcadas como "reposição" ficam na Cria como novilhas.
 */
export async function desmamar(p: PedidoDesmama): Promise<{ desmamaId: number; lotes: number[] }> {
  if (!p.itens.length) throw new ErroValidacao('Marque os bezerros e informe o peso de cada um.');
  if (p.itens.some((i) => !(i.peso >= 20 && i.peso <= 600))) throw new ErroValidacao('Tem bezerro sem peso ou com peso fora do normal (20 a 600 kg).');
  if (p.data > hojeISO()) throw new ErroValidacao('A data da desmama não pode ser no futuro.');
  const reposicao = p.itens.filter((i) => i.destino === 'reposicao');
  if (reposicao.some((i) => i.sexo !== 'femea')) throw new ErroValidacao('Só fêmea fica como novilha de reposição.');
  if (reposicao.length && !p.grupoReposicaoId) throw new ErroValidacao('Escolha o grupo das novilhas de reposição.');
  if (p.piqueteId) { const o = await piqueteOcupado(p.piqueteId); if (o) throw new ErroValidacao(`Esse piquete já está com ${o}.`); }
  const paraLote = p.itens.filter((i) => i.destino === 'lote');
  return db.transaction('rw', [db.animais, db.lotes, db.pesagens, db.desmamas, db.pesosCria, db.grupos], async () => {
    const animais = await db.animais.bulkGet(p.itens.map((i) => i.animalId));
    if (animais.some((a) => !a || !ativoCria(a))) throw new ErroValidacao('Um dos bezerros já saiu da Cria. Atualize a tela.');
    const grupos: { fase: Fase; nome: string; sexo: 'macho' | 'femea' | 'misto'; itens: ItemDesmama[] }[] = [];
    if (p.separarSexos) {
      const m = paraLote.filter((i) => i.sexo === 'macho'), f = paraLote.filter((i) => i.sexo === 'femea');
      if (m.length) grupos.push({ fase: p.fase, nome: `${p.nomeLote} machos`, sexo: 'macho', itens: m });
      if (f.length) grupos.push({ fase: p.fase, nome: `${p.nomeLote} fêmeas`, sexo: 'femea', itens: f });
    } else if (paraLote.length) {
      const sexos = new Set(paraLote.map((i) => i.sexo));
      grupos.push({ fase: p.fase, nome: p.nomeLote, sexo: sexos.size === 1 ? [...sexos][0] : 'misto', itens: paraLote });
    }
    const loteIds: number[] = [];
    for (const g of grupos) {
      const r = resumoPacote(g.itens);
      const loteId = await db.lotes.add({
        propriedadeId: p.propriedadeId, piqueteId: loteIds.length ? null : p.piqueteId ?? null, nome: g.nome, fase: g.fase, sexo: g.sexo, controle: 'individual',
        qtdCabecas: g.itens.length, dataEntrada: p.data, obs: `Desmama de ${g.itens.length} bezerros, peso médio ponderado ${r.pesoMedio.toFixed(1).replace('.', ',')} kg.`, criadoEm: Date.now(),
      });
      for (const i of g.itens) await db.animais.update(i.animalId, { loteId, grupoId: null });
      await db.pesagens.add({ loteId, data: p.data, tipo: 'individual', pesoMedio: Math.round(r.pesoMedio * 10) / 10, qtdPesada: g.itens.length, pesos: g.itens.map((i) => ({ animalId: i.animalId, peso: i.peso })), obs: 'Desmama', criadoEm: Date.now() });
      loteIds.push(loteId);
    }
    for (const i of reposicao) await db.animais.update(i.animalId, { grupoId: p.grupoReposicaoId!, categoria: 'novilha', entrada: p.data });
    // peso da desmama também fica na curva do bezerro (nascimento → desmama)
    for (const i of p.itens) {
      const ja = await db.pesosCria.where('animalId').equals(i.animalId).filter((x) => x.data === p.data).first();
      if (!ja) await db.pesosCria.add({ animalId: i.animalId, data: p.data, peso: i.peso, obs: 'Desmama', criadoEm: Date.now() });
    }
    const ano = Number(p.data.slice(0, 4));
    const itens = p.itens.map((i) => ({ ...i, grupoId: animais.find((a) => a!.id === i.animalId)?.grupoId ?? null }));
    const r = resumoPacote(p.itens, (id) => animais.find((a) => a!.id === id)?.pesoNascer ?? undefined);
    const desmamaId = await db.desmamas.add({
      data: p.data, ano, versao: proximaVersao(await db.desmamas.toArray(), ano), grupoId: p.grupoId ?? null,
      loteId: loteIds[0] ?? null, loteFemeasId: loteIds[1] ?? null, fase: p.fase, itens,
      cabecas: r.cabecas, kgTotal: Math.round(r.kgTotal * 10) / 10, pesoMedio: Math.round(r.pesoMedio * 10) / 10,
      p205Medio: r.p205Medio == null ? null : Math.round(r.p205Medio * 10) / 10, obs: p.obs, criadoEm: Date.now(),
    } as Desmama);
    return { desmamaId, lotes: loteIds };
  });
}

/**
 * Desfaz uma desmama (lançada errada): os bezerros voltam para o grupo de origem e o lote criado é apagado.
 * Só enquanto o lote não teve outra pesagem, venda ou trato.
 */
export async function desfazerDesmama(id: number) {
  const d = await db.desmamas.get(id);
  if (!d) throw new ErroValidacao('Desmama não encontrada.');
  const lotes = [d.loteId, d.loteFemeasId].filter((x): x is number => !!x);
  for (const l of lotes) {
    const pes = await db.pesagens.where('loteId').equals(l).count();
    const outros = (await db.vendas.where('loteId').equals(l).count()) + (await db.fornecimentos.where('loteId').equals(l).count());
    if (pes > 1 || outros) throw new ErroValidacao('O lote da desmama já tem pesagem, trato ou venda. Não dá mais para desfazer.');
  }
  await db.transaction('rw', [db.animais, db.lotes, db.pesagens, db.desmamas, db.pesosCria], async () => {
    for (const it of d.itens) {
      await db.animais.update(it.animalId, { loteId: null, grupoId: it.grupoId ?? d.grupoId ?? null, categoria: 'bezerro' });
      await db.pesosCria.where('animalId').equals(it.animalId).filter((x) => x.data === d.data && x.obs === 'Desmama').delete();
    }
    for (const l of lotes) { await db.pesagens.where('loteId').equals(l).delete(); await db.lotes.delete(l); }
    await db.desmamas.delete(id);
  });
}
