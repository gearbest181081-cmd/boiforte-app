// Menu com todas as funções do app, separadas por assunto, com busca por palavra (falada ou escrita).
// REGRA: toda tela principal nova entra aqui. O teste src/menu.test.ts confere com as rotas do App.tsx.
import type { Papel } from './nuvem/esquema';

export type SecaoMenu = 'dia' | 'rebanho' | 'racao' | 'dinheiro' | 'dados';

export const SECOES: { id: SecaoMenu; titulo: string }[] = [
  { id: 'dia', titulo: 'Dia a dia' },
  { id: 'rebanho', titulo: 'Gado e pasto' },
  { id: 'racao', titulo: 'Ração e estoque' },
  { id: 'dinheiro', titulo: 'Dinheiro' },
  { id: 'dados', titulo: 'Conta, equipe e dados' },
];

/**
 * Quem vê o item. O servidor é quem decide o que cada um pode gravar; aqui só some o que a pessoa não consegue usar.
 * - todos: qualquer um
 * - lanca: quem lança coisas (o consultor só olha)
 * - dinheiro: quem vê dinheiro (o vaqueiro não vê)
 * - gerencia: quem lança e vê dinheiro (dono, gerente ou celular sem nuvem)
 */
export type Acesso = 'todos' | 'lanca' | 'dinheiro' | 'gerencia';

export interface ItemMenu {
  id: string;
  /** Desenho grande, fácil de reconhecer sem ler. */
  icone: string;
  titulo: string;
  /** Nome curto para o botão do Início. */
  curto?: string;
  /** O que a função faz, em palavras simples. */
  descricao: string;
  /** Endereço da tela (pode ter ?aba=… para abrir direto na parte certa). */
  para: string;
  /** Assunto em que aparece no menu. Sem assunto, só aparece na busca e nos atalhos do Início. */
  secao?: SecaoMenu;
  /** Outras palavras que a pessoa pode falar ou escrever para achar (sem acento). */
  palavras: string;
  acesso?: Acesso;
  /** Em vez de abrir uma tela, abre o quadro da conta (canto de cima). Só aparece para quem entrou com e-mail. */
  acao?: 'perfil';
}

export const ITENS_MENU: ItemMenu[] = [
  // ---------- Dia a dia ----------
  { id: 'pesar', icone: '⚖️', titulo: 'Pesar o gado', curto: 'Pesar gado', descricao: 'Peso médio, um a um, por brinco ou pela foto da balança', para: '/pesar', secao: 'dia', acesso: 'lanca',
    palavras: 'pesar pesagem peso balanca brinco gmd ganho foto' },
  { id: 'trato', icone: '🪣', titulo: 'Trato do dia', curto: 'Trato', descricao: 'Quanto pôr no cocho de cada lote e marcar o que já foi dado', para: '/trato', secao: 'dia', acesso: 'lanca',
    palavras: 'trato cocho racao suplemento fornecer fornecimento comida alimentar tratar' },
  { id: 'vacina', icone: '💉', titulo: 'Lançar vacina ou remédio', curto: 'Vacina ou remédio', descricao: 'Escolha o lote e registre a aplicação ou agende a próxima dose', para: '/lotes?escolher=saude', secao: 'dia', acesso: 'lanca',
    palavras: 'vacina vacinar remedio vermifugo carrapato carrapaticida mosca bicheira aplicacao aplicar injecao medicamento saude dose' },
  { id: 'mover', icone: '🐂', titulo: 'Mudar o gado de piquete', curto: 'Mudar de piquete', descricao: 'Tirar de um piquete e pôr em outro, com a altura do capim', para: '/pasto/mover', secao: 'dia', acesso: 'lanca',
    palavras: 'mudar trocar rodar mover passar piquete pasto rodizio tirar' },
  { id: 'anotacoes', icone: '📝', titulo: 'Anotações e tarefas', descricao: 'O que precisa corrigir na fazenda, com foto e lugar', para: '/anotacoes', secao: 'dia',
    palavras: 'anotacao anotar tarefa ronda cerca bebedouro cocho problema corrigir conserto foto lembrar' },
  { id: 'anotar', icone: '✏️', titulo: 'Anotar um problema', curto: 'Anotar problema', descricao: 'Cerca caída, bebedouro, bicho doente: anote com foto', para: '/anotacoes/nova', acesso: 'lanca',
    palavras: 'anotar anotacao nova tarefa problema cerca bebedouro doente foto ronda' },
  { id: 'venda', icone: '💰', titulo: 'Vender ou lançar morte', curto: 'Venda ou morte', descricao: 'Escolha o lote e lance a saída dos animais', para: '/lotes?escolher=venda', secao: 'dia', acesso: 'gerencia',
    palavras: 'vender venda vendi morte morreu morreram baixa saida abate frigorifico boi gordo' },

  // ---------- Gado e pasto ----------
  { id: 'lotes', icone: '🐮', titulo: 'Lotes', descricao: 'Todos os lotes, com peso, ganho e previsão de saída', para: '/lotes', secao: 'rebanho',
    palavras: 'lote gado rebanho boi bois novilha bezerro cabeca animal encerrar encerrado editar' },
  { id: 'novoLote', icone: '➕', titulo: 'Cadastrar lote novo', curto: 'Novo lote', descricao: 'Gado que chegou, foi comprado ou separado', para: '/lotes/novo', secao: 'rebanho', acesso: 'gerencia',
    palavras: 'novo lote cadastrar comprar comprei compra chegou entrada separar' },
  { id: 'relatorioPesagem', icone: '📄', titulo: 'Relatório de pesagem', curto: 'Relatório de pesagem', descricao: 'Escolha o lote: PDF, Excel ou resumo no WhatsApp', para: '/lotes?escolher=relatorio', secao: 'rebanho',
    palavras: 'relatorio pesagem pdf excel whatsapp mandar enviar compartilhar imprimir curva' },
  { id: 'fase', icone: '🔁', titulo: 'Passar lote para outra fase', descricao: 'Ex.: da RIP para a TIP, guardando o histórico', para: '/lotes?escolher=fase', acesso: 'gerencia',
    palavras: 'fase rip tip passar mudar recria engorda confinamento terminacao' },
  { id: 'pasto', icone: '🌱', titulo: 'Pasto e piquetes', curto: 'Pasto', descricao: 'Lotação, descanso dos piquetes e satélite (NDVI)', para: '/pasto', secao: 'rebanho',
    palavras: 'pasto piquete capim lotacao ua hectare ndvi satelite descanso verde modulo' },
  { id: 'sanidade', icone: '🩺', titulo: 'Sanidade', curto: 'Sanidade', descricao: 'Vacinas marcadas, carência para abate e prazos do ano', para: '/sanidade', secao: 'rebanho',
    palavras: 'sanidade calendario carencia vacina agenda brucelose aftosa declaracao rebanho prazo lembrete' },
  { id: 'fazenda', icone: '🏡', titulo: 'Fazenda, módulos e piquetes', descricao: 'Cadastrar e mudar a fazenda, os módulos (retiros) e os piquetes', para: '/fazenda', secao: 'rebanho',
    palavras: 'fazenda propriedade modulo retiro piquete area hectare cadastro cadastrar municipio nome' },

  // ---------- Ração e estoque ----------
  { id: 'nutricao', icone: '🌽', titulo: 'Fórmulas de ração', descricao: 'Monte a ração ou o suplemento e veja proteína, energia e custo', para: '/nutricao', secao: 'racao',
    palavras: 'nutricao formula racao dieta suplemento proteinado sal mineral ingrediente rip tip creep confinamento proteina' },
  { id: 'estoque', icone: '📦', titulo: 'Estoque', descricao: 'Compra de insumo, bater ração e quanto ainda tem', para: '/estoque', secao: 'racao',
    palavras: 'estoque insumo milho soja comprar compra saco bater batida mistura saldo acabando' },
  { id: 'rotulo', icone: '📷', titulo: 'Cadastrar produto pela foto', descricao: 'Tire foto da tabela do rótulo e o app preenche', para: '/nutricao/ingrediente/novo', secao: 'racao', acesso: 'gerencia',
    palavras: 'foto rotulo tabela nutricional produto ingrediente cadastrar novo saco embalagem' },
  { id: 'comparar', icone: '🔍', titulo: 'Comparar dois produtos', descricao: 'Qual suplemento vale mais a pena pelo preço', para: '/simular?aba=comparar', secao: 'racao', acesso: 'dinheiro',
    palavras: 'comparar produto suplemento proteinado melhor preco custo beneficio rotulo marca' },

  // ---------- Dinheiro ----------
  { id: 'financeiro', icone: '💵', titulo: 'Dinheiro da fazenda', curto: 'Dinheiro', descricao: 'Resultado do ano, entradas e saídas do caixa', para: '/financeiro', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'dinheiro financeiro caixa fluxo dre resultado lucro prejuizo receita despesa balanco' },
  { id: 'lancar', icone: '🧾', titulo: 'Lançar despesa ou receita', descricao: 'Conta de luz, combustível, conserto, venda de outra coisa', para: '/financeiro?aba=lancamentos&acao=novo', secao: 'dinheiro', acesso: 'gerencia',
    palavras: 'lancar lancamento despesa receita gasto gastei conta pagar paguei luz energia combustivel diesel conserto nota' },
  { id: 'compraLote', icone: '🛒', titulo: 'Lançar compra de gado', descricao: 'Preço, comissão, frete e GTA do lote comprado', para: '/lotes?escolher=compra', secao: 'dinheiro', acesso: 'gerencia',
    palavras: 'compra comprei comprar gado lote preco comissao frete gta nota bezerro boi magro' },
  { id: 'fixos', icone: '📅', titulo: 'Custos fixos do mês', descricao: 'Arrendamento, energia e outros que se repetem todo mês', para: '/financeiro?aba=fixos', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'custo fixo arrendamento aluguel mensal mes energia internet' },
  { id: 'funcionarios', icone: '👷', titulo: 'Funcionários e salários', descricao: 'Quem trabalha na fazenda e quanto custa por mês', para: '/funcionarios', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'funcionario salario folha pagamento vaqueiro peao empregado decimo terceiro ferias' },
  { id: 'relatorios', icone: '📊', titulo: 'Relatórios', curto: 'Relatórios', descricao: 'Desempenho e resultado dos lotes em PDF, Excel e WhatsApp', para: '/relatorios', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'relatorio pdf excel planilha whatsapp imprimir mandar desempenho resultado contador' },
  { id: 'simular', icone: '🧮', titulo: 'Simulações', descricao: 'Faça a conta antes de decidir: GMD, segurar o lote, comprar gado', para: '/simular', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'simular simulacao conta calcular decidir segurar comprar gmd travar travada arroba' },
  { id: 'mercado', icone: '🏷️', titulo: 'Preço da arroba', descricao: 'Preço da @ e rendimento de carcaça usados nas contas', para: '/mais?ver=mercado', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'preco arroba mercado cotacao rendimento carcaca boi gordo valor' },
  { id: 'juros', icone: '📈', titulo: 'Juros e comissão de venda', descricao: 'Quanto o dinheiro renderia aplicado e a comissão de sempre', para: '/mais?ver=juros', secao: 'dinheiro', acesso: 'dinheiro',
    palavras: 'juros comissao oportunidade aplicado aplicacao taxa banco' },

  // ---------- Conta, equipe e dados ----------
  { id: 'nuvem', icone: '☁️', titulo: 'Nuvem e equipe', descricao: 'Guardar os dados fora do celular e chamar a equipe para o app', para: '/nuvem', secao: 'dados',
    palavras: 'nuvem equipe internet sincronizar convite codigo acesso funcionario vaqueiro gerente consultor conta entrar' },
  { id: 'conta', icone: '👤', titulo: 'Minha conta', descricao: 'Trocar a senha ou sair da conta', para: '/nuvem', acao: 'perfil', secao: 'dados',
    palavras: 'conta senha trocar sair email perfil' },
  { id: 'copia', icone: '💾', titulo: 'Cópia de segurança', descricao: 'Guardar tudo num arquivo ou trazer de volta', para: '/mais?ver=copia', secao: 'dados',
    palavras: 'copia backup seguranca salvar arquivo restaurar recuperar trocar celular guardar' },
  { id: 'instalar', icone: '📲', titulo: 'Instalar no celular', descricao: 'Pôr o BoiForte na tela inicial e abrir sem internet', para: '/mais?ver=instalar', secao: 'dados',
    palavras: 'instalar tela inicial icone atalho baixar app aplicativo' },
  { id: 'exemplo', icone: '🧪', titulo: 'Ver um exemplo pronto', descricao: 'Fazenda de exemplo para conhecer o app', para: '/mais?ver=exemplo', secao: 'dados',
    palavras: 'exemplo conhecer testar demonstracao treinar aprender' },
  { id: 'voz', icone: '🎤', titulo: 'Como escrever falando', descricao: 'Toque no microfone verde de qualquer campo e fale', para: '/mais?ver=voz', secao: 'dados',
    palavras: 'falar voz microfone ditar escrever audio fala' },
];

export function podeVer(acesso: Acesso | undefined, papel: Papel | null | undefined): boolean {
  switch (acesso ?? 'todos') {
    case 'lanca': return papel !== 'consultor';
    case 'dinheiro': return papel !== 'vaqueiro';
    case 'gerencia': return papel !== 'vaqueiro' && papel !== 'consultor';
    default: return true;
  }
}

/** Itens que esta pessoa vê (o "Minha conta" só para quem entrou com e-mail). */
export function itensVisiveis(papel: Papel | null | undefined, comConta = false, itens = ITENS_MENU): ItemMenu[] {
  return itens.filter((i) => podeVer(i.acesso, papel) && (i.acao !== 'perfil' || comConta));
}

/** "/mais?ver=mercado" → "mercado": ajuste que fica mais abaixo na própria tela do Menu (cartão com id "aj-mercado"). */
export function ajusteDoMenu(para: string): string | null {
  const m = /^\/mais\?ver=([\w-]+)$/.exec(para);
  return m ? m[1] : null;
}

// ---------- Busca ----------
/** Sem acento, minúsculo, só letras e números. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/@/g, ' arroba ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Tira o plural, para "vacinas" achar "vacina" e "anotações" achar "anotação". */
function raiz(p: string): string {
  if (p.length <= 3) return p;
  if (p.endsWith('coes')) return p.slice(0, -4) + 'cao';
  if (p.endsWith('oes') || p.endsWith('aes')) return p.slice(0, -3) + 'ao';
  if (p.endsWith('ais')) return p.slice(0, -3) + 'al';
  if (p.endsWith('eis')) return p.slice(0, -3) + 'el';
  if (p.endsWith('ns')) return p.slice(0, -2) + 'm';
  if (p.endsWith('res') || p.endsWith('zes')) return p.slice(0, -2);
  if (p.endsWith('s')) return p.slice(0, -1);
  return p;
}

/** Palavras que não ajudam a achar a função ("quero", "uma", "onde"…). */
const SEM_SENTIDO = new Set(('a o as os um uma uns umas de da do das dos e em no na nos nas para pra pro com sem por que eu meu minha meus minhas '
  + 'quero queria preciso fazer faco ver onde como tem ter esta isso esse essa aqui ali la me se ou ao aos app tela mais menos '
  + 'quanto quantos quanta quantas qual quais tudo todo todos toda todas').split(' ').map(raiz));

const palavrasDe = (t: string) => normalizar(t).split(' ').filter(Boolean).map(raiz);

/**
 * Procura no menu pelo que a pessoa falou ou escreveu ("quero lançar uma vacina", "salário", "vend").
 * Vale mais a palavra no título; depois nas palavras de busca; depois na explicação. Começo de palavra também conta.
 */
export function procurarNoMenu(texto: string, itens = ITENS_MENU): ItemMenu[] {
  const pedidas = [...new Set(palavrasDe(texto).filter((p) => !SEM_SENTIDO.has(p) && p.length >= 2))];
  if (!pedidas.length) return [];
  const notas = itens.map((item, ordem) => {
    const campos = [palavrasDe(item.titulo + ' ' + (item.curto ?? '')), palavrasDe(item.palavras), palavrasDe(item.descricao)];
    const pesos = [6, 4, 2];
    let pontos = 0, achadas = 0;
    for (const p of pedidas) {
      let melhor = 0;
      campos.forEach((ps, c) => {
        if (ps.includes(p)) melhor = Math.max(melhor, pesos[c]);
        else if (p.length >= 3 && ps.some((x) => x.startsWith(p))) melhor = Math.max(melhor, pesos[c] - 1);
      });
      if (melhor) { pontos += melhor; achadas++; }
    }
    return { item, ordem, pontos, achadas };
  });
  return notas.filter((n) => n.pontos > 0)
    .sort((a, b) => b.achadas - a.achadas || b.pontos - a.pontos || a.ordem - b.ordem)
    .map((n) => n.item);
}

// ---------- Escolher o lote antes da ação ----------
export type Escolha = 'saude' | 'venda' | 'compra' | 'relatorio' | 'fase';

/** Ações do menu que precisam de um lote: a lista de lotes abre para escolher e cada lote leva direto para a ação. */
export const ESCOLHER_LOTE: Record<Escolha, { titulo: string; texto: string; acesso: Acesso; para: (loteId: number) => string }> = {
  saude: { titulo: 'Vacina ou remédio', texto: 'Toque no lote que recebeu a vacina ou o remédio.', acesso: 'lanca', para: (id) => `/lotes/${id}?aba=saude` },
  venda: { titulo: 'Venda ou morte', texto: 'Toque no lote de onde saíram os animais.', acesso: 'gerencia', para: (id) => `/lotes/${id}?aba=dinheiro&acao=venda` },
  compra: { titulo: 'Compra de gado', texto: 'Toque no lote que foi comprado. Se ele ainda não está na lista, cadastre o lote primeiro.', acesso: 'gerencia', para: (id) => `/lotes/${id}?aba=dinheiro&acao=compra` },
  relatorio: { titulo: 'Relatório de pesagem', texto: 'Toque no lote para ver e mandar o relatório da pesagem.', acesso: 'todos', para: (id) => `/lotes/${id}/relatorio` },
  fase: { titulo: 'Passar para outra fase', texto: 'Toque no lote que vai mudar de fase (ex.: da RIP para a TIP).', acesso: 'gerencia', para: (id) => `/lotes/${id}/fase` },
};

export function escolhaValida(v: string | null): Escolha | null {
  return v && Object.keys(ESCOLHER_LOTE).includes(v) ? (v as Escolha) : null;
}

// ---------- Atalhos do Início ----------
/** Ordem de importância: o Início mostra os 6 primeiros que a pessoa pode usar. */
const PRIORIDADE_INICIO = ['pesar', 'vacina', 'mover', 'venda', 'anotar', 'novoLote', 'trato', 'pasto', 'relatorioPesagem', 'financeiro', 'relatorios', 'sanidade', 'lotes'];

export function atalhosDoInicio(papel: Papel | null | undefined, quantos = 6): ItemMenu[] {
  return PRIORIDADE_INICIO.map((id) => ITENS_MENU.find((i) => i.id === id)!)
    .filter((i) => podeVer(i.acesso, papel))
    .slice(0, quantos);
}
