import { useLiveQuery } from 'dexie-react-hooks';
import { db, pontosDoLote, type Lote, type Pesagem } from './db';
import { projetar, resumo, type Projecao, type Resumo } from './calc';
import { alertasDoLote, type Alerta } from './alertas';
import { hojeISO } from './calc';

export interface LoteInfo {
  lote: Lote;
  pesagens: Pesagem[];
  resumo: Resumo;
  projecao: Projecao | null;
  alertas: Alerta[];
}

export function montarInfo(lote: Lote, pesagens: Pesagem[], hoje = hojeISO()): LoteInfo {
  const pontos = pontosDoLote(pesagens);
  return {
    lote,
    pesagens,
    resumo: resumo(pontos),
    projecao: lote.pesoAlvo ? projetar(pontos, lote.pesoAlvo, lote.gmdMeta) : null,
    alertas: alertasDoLote(lote, pontos, hoje),
  };
}

/** Todos os lotes com seus indicadores calculados, atualizando sozinho. */
export function useLotesInfo(incluirEncerrados = false): LoteInfo[] | undefined {
  return useLiveQuery(async () => {
    const lotes = await db.lotes.toArray();
    const pes = await db.pesagens.toArray();
    return lotes
      .filter((l) => incluirEncerrados || !l.encerrado)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }))
      .map((l) => montarInfo(l, pes.filter((p) => p.loteId === l.id)));
  }, [incluirEncerrados]);
}
