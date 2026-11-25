// Anotações e tarefas da ronda: o funcionário anota o que precisa ser corrigido (cerca, água, cocho...),
// com foto e o lugar (módulo e piquete). Tudo é gravado no celular primeiro e funciona sem sinal.
// O registro da anotação vai para a nuvem pela sincronização normal; as fotos vão para o Storage do
// Supabase, numa pasta por fazenda ("<fazenda>/<foto>.jpg"), e só quem é da fazenda abre (regras no servidor).
import { db, naLixeira, novoGid, type Anotacao, type CategoriaAnotacao, type FotoLocal } from './db';
import { ErroValidacao, MAX_FOTOS_ANOTACAO, RE_GID } from './validar';
import { hojeISO } from './calc';

export { MAX_FOTOS_ANOTACAO };

export const CATEGORIAS: Record<CategoriaAnotacao, { nome: string; icone: string }> = {
  cerca: { nome: 'Cerca', icone: '🪵' },
  agua: { nome: 'Água', icone: '💧' },
  cocho: { nome: 'Cocho', icone: '🪣' },
  pasto: { nome: 'Pasto', icone: '🌱' },
  animal: { nome: 'Animal', icone: '🐂' },
  estrutura: { nome: 'Curral e casa', icone: '🏚️' },
  outro: { nome: 'Outro', icone: '📝' },
};

/** Lado maior da foto guardada. Basta para ver o problema e deixa a foto com uns 100 a 300 KB. */
export const LADO_FOTO = 1280;
/** O Storage recusa arquivo maior que isto (o mesmo limite está no balde, no servidor). */
export const MAX_BYTES_FOTO = 1024 * 1024;

/** Diminui a foto no próprio celular (JPEG). Baixa a qualidade até caber no limite. */
export async function comprimirFoto(arquivo: Blob, lado = LADO_FOTO): Promise<ArrayBuffer> {
  const bmp = await createImageBitmap(arquivo);
  const f = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * f)); c.height = Math.max(1, Math.round(bmp.height * f));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  for (const q of [0.72, 0.6, 0.45, 0.3]) {
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', q));
    if (b && b.size <= MAX_BYTES_FOTO * 0.8) return b.arrayBuffer();
  }
  throw new ErroValidacao('Não consegui diminuir esta foto. Tente tirar outra.');
}

// ---------- gravar no celular ----------

export type DadosAnotacao = Pick<Anotacao, 'texto' | 'categoria' | 'moduloId' | 'piqueteId' | 'urgente'> & { data?: string };

/** Foto nova tirada na tela: ainda não está em lugar nenhum. */
export interface FotoNova { id: string; dados: ArrayBuffer }

/**
 * Cria ou altera uma anotação. fotos = ids que ficam (antigos e novos, na ordem); novas = bytes das fotos novas.
 * Foto tirada da anotação é marcada para apagar da nuvem.
 */
export async function salvarAnotacao(d: DadosAnotacao, fotos: string[], novas: FotoNova[], id?: number, autor?: { nome?: string; id?: string }): Promise<number> {
  const texto = d.texto?.trim();
  if (!texto) throw new ErroValidacao('Escreva ou fale o que precisa ser feito.');
  if (fotos.length > MAX_FOTOS_ANOTACAO) throw new ErroValidacao(`No máximo ${MAX_FOTOS_ANOTACAO} fotos por anotação.`);
  if (fotos.some((f) => !RE_GID.test(f))) throw new ErroValidacao('Foto inválida.');
  const em = Date.now();
  return db.transaction('rw', db.anotacoes, db.fotosAnotacao, db.piquetes, async () => {
    // piquete escolhido manda no módulo (não deixa ficar um piquete de outro módulo)
    let moduloId = d.moduloId ?? null;
    if (d.piqueteId) {
      const p = await db.piquetes.get(d.piqueteId);
      if (!p) throw new ErroValidacao('Piquete não encontrado.');
      moduloId = p.moduloId;
    }
    const base = { texto, categoria: d.categoria, moduloId, piqueteId: d.piqueteId ?? null, urgente: !!d.urgente, fotos: fotos.map((foto) => ({ foto })) };
    let aid: number;
    let antes: string[] = [];
    if (id) {
      const a = await db.anotacoes.get(id);
      if (!a) throw new ErroValidacao('Anotação não encontrada.');
      antes = (a.fotos ?? []).map((x) => x.foto);
      await db.anotacoes.update(id, { ...base, ...(d.data ? { data: d.data } : {}) });
      aid = id;
    } else {
      aid = await db.anotacoes.add({ ...base, data: d.data ?? hojeISO(), feita: false, autor: autor?.nome || undefined, autorId: autor?.id || undefined, criadoEm: em });
    }
    for (const n of novas) if (fotos.includes(n.id)) await db.fotosAnotacao.put({ id: n.id, dados: n.dados, estado: 'enviar', em });
    await marcarParaApagar(antes.filter((f) => !fotos.includes(f)), em);
    return aid;
  });
}

/** Marca como feita (ou volta para "a fazer"). */
export async function marcarFeita(id: number, feita: boolean, quem?: string) {
  await db.anotacoes.update(id, feita ? { feita: true, feitaEm: hojeISO(), feitaPor: quem || undefined } : { feita: false, feitaEm: undefined, feitaPor: undefined });
}

/** Apaga a anotação mandando para a lixeira. As fotos ficam guardadas (no celular e na nuvem) para ela poder voltar. */
export async function excluirAnotacao(id: number) {
  return naLixeira(() => db.anotacoes.delete(id));
}

/** Foto que nunca subiu some na hora; a que já está na nuvem fica marcada para apagar lá. */
async function marcarParaApagar(ids: string[], em: number) {
  for (const f of ids) {
    const l = await db.fotosAnotacao.get(f);
    if (l?.estado === 'enviar') await db.fotosAnotacao.delete(f);
    else await db.fotosAnotacao.put({ id: f, estado: 'apagar', em });
  }
}

export const novaFotoId = novoGid;

// ---------- fotos com a nuvem ----------

/** Onde as fotos ficam na nuvem. Erros com "tipo" para a fila saber o que fazer. */
export interface ArmazemFotos {
  enviar(caminho: string, dados: ArrayBuffer): Promise<void>;
  baixar(caminho: string): Promise<ArrayBuffer>;
  apagar(caminho: string): Promise<void>;
}
export type TipoErroFoto = 'existe' | 'nao_existe' | 'proibido' | 'rede' | 'outro';
export class ErroFoto extends Error {
  constructor(public tipo: TipoErroFoto, msg: string) { super(msg); this.name = 'ErroFoto'; }
}

/** Caminho no Storage. ext: "jpg" (fotos) ou o formato do áudio do pasto (webm, ogg, m4a). */
export const caminhoFoto = (fazenda: string, foto: string, ext: string = 'jpg') => `${fazenda}/${foto}.${ext}`;
export const MIME_EXT: Record<string, string> = { jpg: 'image/jpeg', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

export interface RelatorioFotos { enviadas: number; apagadas: number; baixadas: number; erros: string[] }

/** Quantas fotos da fila tentar por rodada (o resto vai na próxima). */
const POR_RODADA = 40;

/**
 * Envia as fotos novas, apaga as marcadas e baixa as fotos das anotações em aberto que ainda não estão
 * no celular (para ver no pasto sem sinal). Para no primeiro erro de rede.
 */
export async function sincronizarFotos(a: ArmazemFotos, fazenda: string, podeEnviar: boolean): Promise<RelatorioFotos> {
  const rel: RelatorioFotos = { enviadas: 0, apagadas: 0, baixadas: 0, erros: [] };
  const rede = (e: unknown) => e instanceof ErroFoto && e.tipo === 'rede';
  if (podeEnviar) {
    for (const f of (await db.fotosAnotacao.where('estado').equals('enviar').toArray()).slice(0, POR_RODADA)) {
      if (!f.dados) { await db.fotosAnotacao.delete(f.id); continue; }
      try {
        await a.enviar(caminhoFoto(fazenda, f.id, f.ext), f.dados);
      } catch (e) {
        if (rede(e)) return rel;
        if (!(e instanceof ErroFoto && e.tipo === 'existe')) { // já estava lá: conta como enviada
          await db.fotosAnotacao.update(f.id, { erro: (e as Error).message });
          rel.erros.push((e as Error).message);
          continue;
        }
      }
      await db.transaction('rw', db.fotosAnotacao, async () => {
        const atual = await db.fotosAnotacao.get(f.id);
        if (atual?.estado === 'enviar') await db.fotosAnotacao.update(f.id, { estado: 'ok', erro: undefined });
      });
      rel.enviadas++;
    }
    for (const f of (await db.fotosAnotacao.where('estado').equals('apagar').toArray()).slice(0, POR_RODADA)) {
      try { await a.apagar(caminhoFoto(fazenda, f.id, f.ext)); }
      catch (e) {
        if (rede(e)) return rel;
        // sem permissão (foto de outra pessoa) ou já não existe: não adianta tentar de novo
        if (!(e instanceof ErroFoto && (e.tipo === 'proibido' || e.tipo === 'nao_existe'))) { rel.erros.push((e as Error).message); continue; }
      }
      await db.transaction('rw', db.fotosAnotacao, async () => {
        if ((await db.fotosAnotacao.get(f.id))?.estado === 'apagar') await db.fotosAnotacao.delete(f.id);
      });
      rel.apagadas++;
    }
  }
  // Baixa as fotos das anotações em aberto que faltam no celular.
  const abertas = await db.anotacoes.filter((x) => !x.feita).toArray();
  const ids = [...new Set(abertas.flatMap((x) => (x.fotos ?? []).map((f) => f.foto)))];
  const tem = new Set((await db.fotosAnotacao.bulkGet(ids)).filter((x) => x?.dados).map((x) => x!.id));
  for (const id of ids.filter((x) => !tem.has(x)).slice(0, POR_RODADA)) {
    try { await guardarBaixada(id, await a.baixar(caminhoFoto(fazenda, id))); rel.baixadas++; }
    catch (e) { if (rede(e)) return rel; /* ainda não subiu (outro celular sem sinal): tenta depois */ }
  }
  return rel;
}

async function guardarBaixada(id: string, dados: ArrayBuffer) {
  await db.transaction('rw', db.fotosAnotacao, async () => {
    const atual = await db.fotosAnotacao.get(id);
    if (!atual) await db.fotosAnotacao.put({ id, dados, estado: 'ok', em: Date.now() });
  });
}

/** Lê uma foto: do celular, ou baixa da nuvem (e guarda) se tiver como. */
export async function lerFoto(id: string, baixar?: (id: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer | null> {
  const l = await db.fotosAnotacao.get(id);
  if (l?.dados) return l.dados;
  if (!baixar || l?.estado === 'apagar') return null;
  const dados = await baixar(id);
  await guardarBaixada(id, dados);
  return dados;
}

/** Libera espaço: tira do celular as fotos já guardadas na nuvem de anotações feitas há mais de N dias. */
export async function limparFotosAntigas(dias = 30, hoje = hojeISO()) {
  const limite = new Date(Date.parse(hoje + 'T12:00:00Z') - dias * 86400000).toISOString().slice(0, 10);
  const velhas = await db.anotacoes.filter((x) => !!x.feita && (x.feitaEm ?? x.data) < limite).toArray();
  const ids = velhas.flatMap((x) => (x.fotos ?? []).map((f) => f.foto));
  await db.transaction('rw', db.fotosAnotacao, async () => {
    for (const f of await db.fotosAnotacao.bulkGet(ids)) if (f?.estado === 'ok') await db.fotosAnotacao.delete(f.id);
  });
}

/** Resumo para a tela inicial. */
export async function contarAnotacoes(): Promise<{ abertas: number; urgentes: number }> {
  const abertas = await db.anotacoes.filter((x) => !x.feita).toArray();
  return { abertas: abertas.length, urgentes: abertas.filter((x) => x.urgente).length };
}

export type { FotoLocal };
