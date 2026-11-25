// Sanidade: carência para abate, próximas doses e lembretes do calendário.
import { diasEntre, somaDias } from './calc';

export const TIPOS_SANIDADE = {
  vacina: 'Vacina',
  vermifugo: 'Vermífugo',
  carrapaticida: 'Carrapaticida / mosca',
  antibiotico: 'Antibiótico / medicamento',
  vitamina: 'Vitamina / mineral injetável',
  exame: 'Exame / teste',
  outro: 'Outro',
} as const;
export type TipoSanidade = keyof typeof TIPOS_SANIDADE;

export interface EventoSan { loteId?: number | null; data: string; feito: boolean; produto: string; tipo: TipoSanidade; carenciaDias?: number | null }
export interface LembreteSan { titulo: string; mes: number; dia: number; antecedenciaDias: number }

/** Data a partir da qual o lote pode ir para o abate (maior fim de carência das aplicações feitas). */
export function liberacaoAbate(eventos: EventoSan[], loteId: number): { data: string; produto: string } | null {
  let melhor: { data: string; produto: string } | null = null;
  for (const e of eventos) {
    if (e.loteId !== loteId || !e.feito || !e.carenciaDias) continue;
    const fim = somaDias(e.data, e.carenciaDias);
    if (!melhor || fim > melhor.data) melhor = { data: fim, produto: e.produto };
  }
  return melhor;
}

export function emCarencia(eventos: EventoSan[], loteId: number, dia: string): { data: string; produto: string } | null {
  const l = liberacaoAbate(eventos, loteId);
  return l && l.data > dia ? l : null;
}

/** Próxima ocorrência de um lembrete anual a partir de hoje. */
export function proximaData(l: LembreteSan, hoje: string): string {
  const ano = Number(hoje.slice(0, 4));
  const fmt = (a: number) => {
    const ultimo = new Date(Date.UTC(a, l.mes, 0)).getUTCDate();
    return `${a}-${String(l.mes).padStart(2, '0')}-${String(Math.min(l.dia, ultimo)).padStart(2, '0')}`;
  };
  const esteAno = fmt(ano);
  return esteAno >= hoje ? esteAno : fmt(ano + 1);
}

export interface Pendencia { nivel: 'ruim' | 'atencao'; titulo: string; texto: string; data: string }

export function pendenciasSanidade(eventos: (EventoSan & { nomeLote?: string })[], lembretes: LembreteSan[], hoje: string, janela = 7): Pendencia[] {
  const out: Pendencia[] = [];
  for (const e of eventos) {
    if (e.feito) continue;
    const d = diasEntre(hoje, e.data);
    if (d < 0) out.push({ nivel: 'ruim', titulo: `${TIPOS_SANIDADE[e.tipo]} atrasado${e.nomeLote ? `: ${e.nomeLote}` : ''}`, texto: `${e.produto} estava marcado para ${e.data.split('-').reverse().join('/')} (${-d} dia(s) de atraso).`, data: e.data });
    else if (d <= janela) out.push({ nivel: 'atencao', titulo: `${TIPOS_SANIDADE[e.tipo]}${e.nomeLote ? `: ${e.nomeLote}` : ''} ${d === 0 ? 'hoje' : `em ${d} dia(s)`}`, texto: `${e.produto} em ${e.data.split('-').reverse().join('/')}.`, data: e.data });
  }
  for (const l of lembretes) {
    const p = proximaData(l, hoje);
    const d = diasEntre(hoje, p);
    if (d <= l.antecedenciaDias) out.push({ nivel: d <= 3 ? 'ruim' : 'atencao', titulo: l.titulo, texto: `Prazo em ${p.split('-').reverse().join('/')}${d === 0 ? ' (hoje)' : ` (faltam ${d} dias)`}.`, data: p });
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/** Lembretes de partida. As datas mudam por estado: o produtor confere com a agência de defesa agropecuária. */
export const LEMBRETES_PADRAO: (LembreteSan & { obs: string })[] = [
  { titulo: 'Atualização / declaração do rebanho (1º semestre)', mes: 5, dia: 31, antecedenciaDias: 30, obs: 'Confira o prazo da agência de defesa do seu estado.' },
  { titulo: 'Atualização / declaração do rebanho (2º semestre)', mes: 11, dia: 30, antecedenciaDias: 30, obs: 'Confira o prazo da agência de defesa do seu estado.' },
  { titulo: 'Comprovar vacinação de brucelose (fêmeas de 3 a 8 meses)', mes: 6, dia: 30, antecedenciaDias: 20, obs: 'Exigida pelo programa nacional; confira o calendário do seu estado.' },
];

/**
 * Aplicações de lotes e grupos de manejo ainda ativos, com o nome de onde foram (lote, grupo da Cria ou animal).
 */
export function eventosSanidadeAtivos<E extends EventoSan & { grupoId?: number | null; animalId?: number | null }>(
  eventos: E[], lotes: { id?: number; nome: string; encerrado?: boolean }[], grupos: { id?: number; nome: string; encerrado?: boolean }[],
  animais: { id?: number; brinco: string; grupoId?: number | null }[] = [],
): (E & { nomeLote?: string })[] {
  const lote = new Map(lotes.map((l) => [l.id!, l]));
  const grupo = new Map(grupos.map((g) => [g.id!, g]));
  const animal = new Map(animais.map((a) => [a.id!, a]));
  const out: (E & { nomeLote?: string })[] = [];
  for (const e of eventos) {
    if (e.loteId) { const l = lote.get(e.loteId); if (l && !l.encerrado) out.push({ ...e, nomeLote: l.nome }); continue; }
    const a = e.animalId ? animal.get(e.animalId) : undefined;
    const g = grupo.get(e.grupoId ?? a?.grupoId ?? -1);
    if (g?.encerrado) continue;
    if (a) out.push({ ...e, nomeLote: `animal ${a.brinco}` });
    else if (g) out.push({ ...e, nomeLote: g.nome });
  }
  return out;
}
