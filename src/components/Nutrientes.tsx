// Resultado de nutrientes com a faixa adequada logo abaixo de cada um.
import type { ReactNode } from 'react';
import { fmtValor, nivelStatus, ROTULO_STATUS, textoFaixa, type AvaliacaoNut } from '../faixas';

const ICONE: Record<string, string> = { bom: '✅', atencao: '🔔', ruim: '⚠️' };
const ICONE_STATUS: Partial<Record<string, string>> = { incompleto: '❔' };

export function CelulaNutriente({ a }: { a: AvaliacaoNut }) {
  const nivel = nivelStatus(a.status, a.critico);
  const [num, un] = a.valor == null ? ['—', ''] : splitValor(fmtValor(a.valor, a.unidade));
  return (
    <div className={`indicador nut ${nivel}`} data-testid={`nut-${a.chave}`}>
      <div className="rotulo">{a.curto}{a.base === 'ms' && a.chave !== 'caP' ? ' (MS)' : ''}</div>
      <div className="valor">{num}<small>{un}</small></div>
      <div className="faixa">{a.faixa ? <>Faixa: <b>{textoFaixa(a.faixa)}</b></> : 'Sem faixa para este tipo'}</div>
      {a.status === 'sem_dado'
        ? <div className="faixa">Não informado no rótulo</div>
        : nivel && <span className={`etiqueta ${nivel === 'bom' ? '' : nivel}`}>{ICONE_STATUS[a.status] ?? ICONE[nivel]} {ROTULO_STATUS[a.status]}</span>}
      {a.semDado && a.status !== 'sem_dado' ? <div className="faixa">Falta o dado em {a.semDado} ingrediente{a.semDado > 1 ? 's' : ''}{a.status === 'incompleto' ? ': copie do rótulo' : ''}</div> : null}
    </div>
  );
}

function splitValor(t: string): [string, string] {
  if (t.endsWith(' mg/kg')) return [t.slice(0, -6), ' mg/kg'];
  if (t.endsWith('%')) return [t.slice(0, -1), '%'];
  if (t.endsWith(':1')) return [t.slice(0, -2), ':1'];
  return [t, ''];
}

export function GradeNutrientes({ avaliacao, extra }: { avaliacao: AvaliacaoNut[]; extra?: ReactNode }) {
  return (
    <div className="grade nutrientes">
      {avaliacao.map((a) => <CelulaNutriente key={a.chave} a={a} />)}
      {extra}
    </div>
  );
}
