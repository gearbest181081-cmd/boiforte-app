// O que a sincronização precisa saber de cada tabela: ordem de envio e referências entre registros.
// O mesmo mapa é usado no servidor (gerado em supabase/migrations) para conferir que uma referência
// aponta para um registro que existe na MESMA fazenda.

/** Ordem de envio: quem é referenciado vai antes de quem referencia. */
export const ORDEM_SINC = [
  'propriedades', 'modulos', 'piquetes', 'ingredientes', 'formulas', 'lotes', 'grupos', 'animais', 'pesagens', 'estacoes', 'reproducao', 'pesosCria', 'desmamas',
  'batidas', 'fornecimentos', 'movimentos', 'sanidade', 'vendas', 'lancamentos', 'custosFixos', 'funcionarios', 'lembretes', 'anotacoes', 'ocupacoes', 'ndvi', 'config',
] as const;
export type TabelaSinc = (typeof ORDEM_SINC)[number];

/** Referência fixa (campo → tabela) ou que depende de outro campo (ex.: movimentos.refId conforme a origem). */
export type Alvo = string | { porCampo: string; mapa: Record<string, string> };
export interface Referencias { campos: Record<string, Alvo>; listas?: Record<string, Record<string, Alvo>> }

export const REFERENCIAS: Record<string, Referencias> = {
  propriedades: { campos: {} },
  modulos: { campos: { propriedadeId: 'propriedades' } },
  piquetes: { campos: { moduloId: 'modulos' } },
  lotes: { campos: { propriedadeId: 'propriedades', piqueteId: 'piquetes', formulaId: 'formulas' } },
  animais: { campos: { loteId: 'lotes', grupoId: 'grupos', maeId: 'animais', paiId: 'animais', formulaCreepId: 'formulas' } },
  pesagens: { campos: { loteId: 'lotes' }, listas: { pesos: { animalId: 'animais' } } },
  ingredientes: { campos: {} },
  formulas: { campos: {}, listas: { itens: { ingredienteId: 'ingredientes' } } },
  movimentos: { campos: { ingredienteId: 'ingredientes', formulaId: 'formulas', refId: { porCampo: 'origem', mapa: { batida: 'batidas', fornecimento: 'fornecimentos' } } } },
  batidas: { campos: { formulaId: 'formulas' }, listas: { itens: { ingredienteId: 'ingredientes' } } },
  fornecimentos: { campos: { loteId: 'lotes', formulaId: 'formulas' } },
  config: { campos: {} },
  lancamentos: { campos: { loteId: 'lotes', grupoId: 'grupos', refId: { porCampo: 'origem', mapa: { compra_lote: 'lotes', sanidade: 'sanidade' } } } },
  custosFixos: { campos: {} },
  vendas: { campos: { loteId: 'lotes' } },
  sanidade: { campos: { loteId: 'lotes', grupoId: 'grupos', animalId: 'animais' } },
  lembretes: { campos: {} },
  funcionarios: { campos: {} }, // usuarioId é o id da conta (não é registro): o servidor confere que é da equipe
  anotacoes: { campos: { moduloId: 'modulos', piqueteId: 'piquetes' } },
  grupos: { campos: { propriedadeId: 'propriedades', piqueteId: 'piquetes' } },
  estacoes: { campos: {} },
  reproducao: { campos: { matrizId: 'animais', touroId: 'animais', estacaoId: 'estacoes', bezerroId: 'animais' } },
  pesosCria: { campos: { animalId: 'animais' } },
  desmamas: { campos: { grupoId: 'grupos', loteId: 'lotes', loteFemeasId: 'lotes' }, listas: { itens: { animalId: 'animais', grupoId: 'grupos' } } },
  // ocupanteId: lote (recria/engorda) ou grupo de manejo (cria), conforme "tipo"
  ocupacoes: { campos: { piqueteId: 'piquetes', ocupanteId: { porCampo: 'tipo', mapa: { lote: 'lotes', grupo: 'grupos' } } } },
  ndvi: { campos: { piqueteId: 'piquetes' } },
};

export function alvoDe(alvo: Alvo, registro: Record<string, unknown>): string | null {
  if (typeof alvo === 'string') return alvo;
  const v = registro[alvo.porCampo];
  return typeof v === 'string' ? alvo.mapa[v] ?? null : null;
}

/** Papéis da equipe. O servidor é quem decide; o app só esconde o que a pessoa não pode usar. */
export type Papel = 'dono' | 'gerente' | 'vaqueiro' | 'consultor';
export const PAPEIS: Record<Papel, { nome: string; texto: string }> = {
  dono: { nome: 'Dono', texto: 'Vê e muda tudo, chama e tira pessoas da equipe.' },
  gerente: { nome: 'Gerente', texto: 'Vê e muda tudo, menos a equipe.' },
  vaqueiro: { nome: 'Vaqueiro', texto: 'Pesa, dá o trato e lança vacina. Não vê o dinheiro.' },
  consultor: { nome: 'Consultor', texto: 'Só olha. Bom para o técnico ou o contador.' },
};

/** O que cada papel pode e não pode fazer, em palavras simples (a regra de verdade fica no servidor). */
export const PERMISSOES: Record<Papel, { pode: string[]; naoPode: string[] }> = {
  dono: {
    pode: ['Ver e mudar tudo', 'Chamar e tirar pessoas da equipe', 'Mudar o que cada um pode fazer'],
    naoPode: [],
  },
  gerente: {
    pode: ['Tudo o que o vaqueiro faz', 'Ver e lançar o dinheiro: compras, vendas e custos', 'Cadastrar funcionários e salários', 'Mudar lotes, pastos, fórmulas e estoque'],
    naoPode: ['Chamar ou tirar pessoas da equipe do app'],
  },
  vaqueiro: {
    pode: ['Pesar os animais', 'Lançar o trato no cocho', 'Lançar vacina e remédio', 'Fazer anotações e tarefas da ronda', 'Mudar o gado de piquete, com foto e áudio do capim', 'Na Cria: lançar nascimento, cobertura, diagnóstico e parto'],
    naoPode: ['Ver dinheiro, preços, custos e salários', 'Mudar fórmulas da ração e configurações', 'Chamar ou tirar pessoas da equipe'],
  },
  consultor: {
    pode: ['Ver tudo, inclusive o dinheiro e os salários', 'Tirar relatórios'],
    naoPode: ['Lançar ou mudar qualquer coisa', 'Chamar ou tirar pessoas da equipe'],
  },
};

/** Texto do convite mandado no WhatsApp, com o passo a passo para quem recebe. */
export function mensagemConvite(papel: Papel, codigo: string, fazenda?: string): string {
  return `Você foi chamado para a equipe${fazenda ? (/^fazenda\b/i.test(fazenda.trim()) ? ` da ${fazenda.trim()}` : ` da fazenda ${fazenda.trim()}`) : ''} no BoiForte como ${PAPEIS[papel].nome.toLowerCase()}.\n\n`
    + `Seu código: ${codigo}\n\n`
    + `1. Abra o app BoiForte (ou instale)\n2. Entre com o seu e-mail\n3. Vá em Mais > Nuvem e equipe\n4. Digite o código e toque em "Entrar na equipe"\n\nO código vale 7 dias e só para você.`;
}

/** Tabelas que o vaqueiro pode ver e gravar (o resto, principalmente o dinheiro e os salários dos funcionários, fica de fora). */
export const VAQUEIRO_LE = ['propriedades', 'modulos', 'piquetes', 'lotes', 'animais', 'pesagens', 'ingredientes', 'formulas', 'movimentos', 'batidas', 'fornecimentos', 'sanidade', 'lembretes', 'config', 'anotacoes', 'ocupacoes', 'ndvi',
  'grupos', 'estacoes', 'reproducao', 'pesosCria', 'desmamas'] as const;
// lotes: só a quantidade de cabeças (pesagem por brinco) e o piquete; lancamentos: só o custo de vacina (origem sanidade).
export const VAQUEIRO_GRAVA = ['animais', 'pesagens', 'fornecimentos', 'movimentos', 'sanidade', 'lotes', 'lancamentos', 'anotacoes', 'ocupacoes', 'reproducao', 'pesosCria'] as const;
// Cria: o vaqueiro lança nascimento (animais), cobertura/diagnóstico/parto (reproducao) e pesagem dos bezerros (pesosCria).
// Grupos, estação de monta e desmama (que cria lote) ficam com dono e gerente.
