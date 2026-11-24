// Rastreabilidade como argumento comercial: o que a fazenda já tem em dia (CAR, ITR, CCIR, GTA, PNIB,
// geolocalização para a União Europeia) e a ficha do lote para mostrar ao comprador ou ao frigorífico.
import { fmtData, fmtNum } from './calc';
import { areaHa, EUDR_DATA_CORTE, EUDR_HA_SO_PONTO, fmtCoord, pareceBrasil, pontoValido, semFechamento } from './geo';
import type { Animal, EventoSanitario, Gta, Lancamento, Lote, Pesagem, Propriedade, Venda } from './db';
import { dataCel, type Bloco, type Tabela } from './exportar';
import { TIPOS_SANIDADE } from './sanidade';

export const FINALIDADES_GTA = { abate: 'Abate', engorda: 'Engorda', recria: 'Recria', reproducao: 'Reprodução', exposicao: 'Exposição / leilão', outra: 'Outra' } as const;
export const SITUACOES_CAR = { ativo: 'Ativo', pendente: 'Pendente', suspenso: 'Suspenso', cancelado: 'Cancelado' } as const;

/** Campos de identificação do animal criados pela Cria (chip e código oficial PNIB/SISBOV). */
export type AnimalId = Animal & { sisbov?: string; chip?: string; nascimento?: string; loteId?: number | null };

// ---------- Conferência dos números dos documentos (só aviso; o produtor pode salvar mesmo assim) ----------

/** Recibo do CAR: "UF-1234567-" + 32 letras/números (às vezes com pontos). */
export function limparCar(v: string): string {
  return v.toUpperCase().replace(/[\s.]/g, '');
}
export function carValido(v: string): boolean {
  return /^[A-Z]{2}-\d{7}-[0-9A-F]{32}$/.test(limparCar(v));
}
/** CIB (antigo NIRF), número do imóvel na Receita: 8 dígitos (ex.: 1.234.567-8). */
export function cibValido(v: string): boolean {
  return /^\d{8}$/.test(v.replace(/[\s.-]/g, ''));
}
export function fmtCib(v: string): string {
  const d = v.replace(/\D/g, '');
  return d.length === 8 ? `${d[0]}.${d.slice(1, 4)}.${d.slice(4, 7)}-${d[7]}` : v;
}
/** Código oficial do animal (PNIB / SISBOV): 15 números. */
export function sisbovValido(v: string): boolean {
  return /^\d{15}$/.test(v.replace(/[\s.-]/g, ''));
}

/** A declaração do ITR (DITR) vence no fim de setembro. Até lá, vale a do ano passado. */
export function anoItrEsperado(hoje: string): number {
  const ano = Number(hoje.slice(0, 4));
  return hoje.slice(5) > '09-30' ? ano : ano - 1;
}

// ---------- Lista do que está em dia ----------

export type Nivel = 'bom' | 'atencao' | 'ruim';
export interface ItemRastro { chave: string; titulo: string; nivel: Nivel; texto: string; onde: 'documentos' | 'gta' | 'animais' | 'sanidade' }

export interface DadosRastro {
  prop: Propriedade; propsTotal: number; lotes: Lote[]; animais: AnimalId[]; gtas: Gta[]; vendas: Venda[];
  lancamentos: Lancamento[]; sanidade: EventoSanitario[]; hoje: string;
}

export const cabecasGta = (g: Pick<Gta, 'machos' | 'femeas'>) => (g.machos || 0) + (g.femeas || 0);

/** Animais da fazenda: os dos lotes dela; os sem lote (Cria) contam quando só há uma fazenda. */
export function animaisDaFazenda(d: Pick<DadosRastro, 'prop' | 'propsTotal' | 'lotes' | 'animais'>): AnimalId[] {
  const ids = new Set(d.lotes.filter((l) => l.propriedadeId === d.prop.id).map((l) => l.id!));
  return d.animais.filter((a) => a.ativo !== false && (a.loteId != null ? ids.has(a.loteId) : d.propsTotal === 1));
}

/** Lotes comprados (têm lançamento de compra) e ainda sem GTA de entrada. */
export function lotesSemGtaEntrada(lotes: Lote[], gtas: Gta[], lancamentos: Lancamento[]): Lote[] {
  const comprados = new Set(lancamentos.filter((l) => l.origem === 'compra_lote' && l.loteId != null).map((l) => l.loteId!));
  return lotes.filter((l) => comprados.has(l.id!) && !gtas.some((g) => g.sentido === 'entrada' && g.loteId === l.id));
}

/** Lotes que venderam mais cabeças do que as GTAs de saída lançadas cobrem. */
export function vendasSemGta(lotes: Lote[], gtas: Gta[], vendas: Venda[]): { lote: Lote; vendidas: number; comGta: number }[] {
  const out: { lote: Lote; vendidas: number; comGta: number }[] = [];
  for (const l of lotes) {
    const vendidas = vendas.filter((v) => v.loteId === l.id && v.tipo === 'venda').reduce((s, v) => s + v.cabecas, 0);
    if (!vendidas) continue;
    const comGta = gtas.filter((g) => g.sentido === 'saida' && g.loteId === l.id).reduce((s, g) => s + cabecasGta(g), 0);
    if (comGta < vendidas) out.push({ lote: l, vendidas, comGta });
  }
  return out;
}

export function conferirRastreabilidade(d: DadosRastro): ItemRastro[] {
  const p = d.prop;
  const itens: ItemRastro[] = [];
  const lotes = d.lotes.filter((l) => l.propriedadeId === p.id);
  const gtas = d.gtas.filter((g) => g.propriedadeId === p.id);

  // 1. Localização (EUDR)
  const sede = pontoValido({ lat: p.lat ?? undefined, lon: p.lon ?? undefined }) ? { lat: p.lat!, lon: p.lon! } : null;
  itens.push(sede
    ? { chave: 'sede', titulo: 'Localização da sede', nivel: pareceBrasil(sede) ? 'bom' : 'atencao', texto: pareceBrasil(sede) ? `${fmtCoord(sede.lat, 'lat')}, ${fmtCoord(sede.lon, 'lon')}` : 'O ponto está fora do Brasil. Confira o sinal de menos (sul e oeste são negativos).', onde: 'documentos' }
    : { chave: 'sede', titulo: 'Localização da sede', nivel: 'ruim', texto: 'Marque no GPS, parado na sede da fazenda.', onde: 'documentos' });
  const contorno = semFechamento(p.contorno ?? []);
  const area = contorno.length >= 3 ? areaHa(contorno) : 0;
  const precisaContorno = !(p.areaHa != null && p.areaHa > 0 && p.areaHa <= EUDR_HA_SO_PONTO);
  itens.push(contorno.length >= 3
    ? { chave: 'contorno', titulo: 'Contorno da fazenda (divisa)', nivel: 'bom', texto: `${contorno.length} pontos, ${fmtNum(area, 1)} ha. Pronto para o arquivo da União Europeia.`, onde: 'documentos' }
    : { chave: 'contorno', titulo: 'Contorno da fazenda (divisa)', nivel: precisaContorno ? 'ruim' : 'atencao', texto: precisaContorno ? 'A União Europeia pede o desenho da divisa. Traga o arquivo do CAR (KML) ou ande pela divisa marcando pontos.' : 'Até 4 ha basta o ponto da sede, mas o contorno valoriza.', onde: 'documentos' });
  itens.push(p.semDesmate
    ? { chave: 'desmate', titulo: 'Sem desmatamento depois de 2020', nivel: 'bom', texto: `Declarado pelo produtor (corte da União Europeia: ${fmtData(EUDR_DATA_CORTE)}).`, onde: 'documentos' }
    : { chave: 'desmate', titulo: 'Sem desmatamento depois de 2020', nivel: 'atencao', texto: `O comprador europeu exige área sem desmatamento depois de ${fmtData(EUDR_DATA_CORTE)}. Marque a declaração se for o seu caso.`, onde: 'documentos' });

  // 2. Documentos da terra
  if (!p.car) itens.push({ chave: 'car', titulo: 'CAR (Cadastro Ambiental Rural)', nivel: 'ruim', texto: 'Informe o número do recibo do CAR. Frigoríficos e bancos pedem.', onde: 'documentos' });
  else if (p.carSituacao && p.carSituacao !== 'ativo') itens.push({ chave: 'car', titulo: 'CAR (Cadastro Ambiental Rural)', nivel: 'ruim', texto: `Situação: ${SITUACOES_CAR[p.carSituacao].toLowerCase()}. Frigoríficos costumam bloquear compra de CAR ${p.carSituacao === 'pendente' ? 'pendente' : 'irregular'}.`, onde: 'documentos' });
  else itens.push({ chave: 'car', titulo: 'CAR (Cadastro Ambiental Rural)', nivel: carValido(p.car) ? 'bom' : 'atencao', texto: carValido(p.car) ? `${limparCar(p.car)}${p.carSituacao ? '' : ' (informe a situação)'}` : 'O número não parece um recibo do CAR (UF-código do município-32 letras e números). Confira.', onde: 'documentos' });

  const esperado = anoItrEsperado(d.hoje);
  if (!p.cib) itens.push({ chave: 'itr', titulo: 'ITR (imposto da terra)', nivel: 'ruim', texto: 'Informe o CIB (número do imóvel na Receita) e o último ano em que a declaração foi entregue.', onde: 'documentos' });
  else if (!p.itrAno || p.itrAno < esperado) itens.push({ chave: 'itr', titulo: 'ITR (imposto da terra)', nivel: 'ruim', texto: `Falta a declaração de ${esperado}${p.itrAno ? ` (a última informada é de ${p.itrAno})` : ''}. O prazo é o fim de setembro.`, onde: 'documentos' });
  else itens.push({ chave: 'itr', titulo: 'ITR (imposto da terra)', nivel: 'bom', texto: `CIB ${fmtCib(p.cib)}, declaração de ${p.itrAno} entregue.`, onde: 'documentos' });

  const anoCcir = Number(d.hoje.slice(0, 4)) - 1;
  itens.push(p.ccir && p.ccirAno && p.ccirAno >= anoCcir
    ? { chave: 'ccir', titulo: 'CCIR (INCRA)', nivel: 'bom', texto: `${p.ccir}, pago em ${p.ccirAno}.`, onde: 'documentos' }
    : { chave: 'ccir', titulo: 'CCIR (INCRA)', nivel: 'atencao', texto: p.ccir ? 'Informe o ano do último CCIR pago.' : 'Informe o número do CCIR do INCRA (pedido em venda, financiamento e cartório).', onde: 'documentos' });

  itens.push(p.codEstab
    ? { chave: 'codEstab', titulo: 'Código do estabelecimento', nivel: 'bom', texto: `${p.codEstab} (órgão de defesa${p.uf ? ` de ${p.uf}` : ''}).`, onde: 'documentos' }
    : { chave: 'codEstab', titulo: 'Código do estabelecimento', nivel: 'atencao', texto: 'Número da fazenda no órgão de defesa do estado (sai na GTA). Usado no PNIB.', onde: 'documentos' });

  // 3. Animais (PNIB)
  const animais = animaisDaFazenda({ ...d, lotes });
  const comCodigo = animais.filter((a) => a.sisbov && sisbovValido(a.sisbov)).length;
  const cabecas = lotes.filter((l) => !l.encerrado).reduce((s, l) => s + l.qtdCabecas, 0);
  if (!animais.length) itens.push({ chave: 'pnib', titulo: 'Identificação dos animais (PNIB)', nivel: 'atencao', texto: `Nenhum animal com brinco cadastrado${cabecas ? ` (${cabecas} cabeças só por lote)` : ''}. O PNIB vai exigir brinco oficial em todo o rebanho até 2032: quem começa antes vende melhor.`, onde: 'animais' });
  else {
    const pct = comCodigo / animais.length;
    itens.push({ chave: 'pnib', titulo: 'Identificação dos animais (PNIB)', nivel: pct >= 0.95 ? 'bom' : pct >= 0.5 ? 'atencao' : 'ruim', texto: `${comCodigo} de ${animais.length} animais com código oficial de 15 números (${Math.round(pct * 100)}%).`, onde: 'animais' });
  }

  // 4. GTAs
  const semEntrada = lotesSemGtaEntrada(lotes, gtas, d.lancamentos);
  itens.push(semEntrada.length
    ? { chave: 'gtaEntrada', titulo: 'GTA de entrada dos lotes comprados', nivel: 'ruim', texto: `Falta a GTA de: ${semEntrada.slice(0, 4).map((l) => l.nome).join(', ')}${semEntrada.length > 4 ? ` e mais ${semEntrada.length - 4}` : ''}.`, onde: 'gta' }
    : { chave: 'gtaEntrada', titulo: 'GTA de entrada dos lotes comprados', nivel: 'bom', texto: gtas.some((g) => g.sentido === 'entrada') ? 'Todos os lotes comprados têm a GTA de origem.' : 'Nenhum lote comprado lançado.', onde: 'gta' });
  const semSaida = vendasSemGta(lotes, gtas, d.vendas);
  itens.push(semSaida.length
    ? { chave: 'gtaSaida', titulo: 'GTA de saída das vendas', nivel: 'ruim', texto: semSaida.slice(0, 3).map((s) => `${s.lote.nome}: ${s.vendidas} vendidas, ${s.comGta} com GTA`).join('; ') + '.', onde: 'gta' }
    : { chave: 'gtaSaida', titulo: 'GTA de saída das vendas', nivel: 'bom', texto: 'Toda venda lançada tem GTA de saída.', onde: 'gta' });

  // 5. Sanidade registrada
  const ativos = lotes.filter((l) => !l.encerrado);
  if (ativos.length) {
    const umAno = `${Number(d.hoje.slice(0, 4)) - 1}${d.hoje.slice(4)}`;
    const comHistorico = ativos.filter((l) => d.sanidade.some((e) => e.loteId === l.id && e.feito && e.data >= umAno)).length;
    itens.push({ chave: 'sanidade', titulo: 'Vacinas e remédios lançados', nivel: comHistorico === ativos.length ? 'bom' : comHistorico ? 'atencao' : 'ruim', texto: `${comHistorico} de ${ativos.length} lotes com aplicação lançada nos últimos 12 meses.`, onde: 'sanidade' });
  }
  return itens;
}

/** Nota de 0 a 100: em dia vale 1, atenção vale meio. */
export function notaRastreabilidade(itens: ItemRastro[]): number {
  if (!itens.length) return 0;
  return Math.round((itens.reduce((s, i) => s + (i.nivel === 'bom' ? 1 : i.nivel === 'atencao' ? 0.5 : 0), 0) / itens.length) * 100);
}

// ---------- Ficha do lote para o comprador ----------

export interface DadosFicha {
  prop: Propriedade; lote: Lote; animais: AnimalId[]; gtas: Gta[]; pesagens: Pesagem[]; sanidade: EventoSanitario[]; hoje: string;
}

export function fichaLote(d: DadosFicha): { titulo: string; subtitulo: string; blocos: Bloco[]; nomeArquivo: string; resumo: string } {
  const { prop: p, lote } = d;
  const contorno = semFechamento(p.contorno ?? []);
  const sede = p.lat != null && p.lon != null ? `${fmtCoord(p.lat, 'lat')}, ${fmtCoord(p.lon, 'lon')}` : 'não informada';
  const gtas = d.gtas.filter((g) => g.loteId === lote.id).sort((a, b) => a.emissao.localeCompare(b.emissao));
  const san = d.sanidade.filter((e) => e.loteId === lote.id && e.feito).sort((a, b) => a.data.localeCompare(b.data));
  const pes = d.pesagens.filter((x) => x.loteId === lote.id).sort((a, b) => a.data.localeCompare(b.data));
  const animais = d.animais.filter((a) => a.loteId === lote.id).sort((a, b) => a.brinco.localeCompare(b.brinco, 'pt-BR', { numeric: true }));
  const comCodigo = animais.filter((a) => a.sisbov && sisbovValido(a.sisbov)).length;

  const blocos: Bloco[] = [
    {
      tipo: 'indicadores', titulo: 'Origem', itens: [
        { rotulo: 'Fazenda', valor: p.nome, sub: [p.municipio, p.uf].filter(Boolean).join(' / ') || undefined },
        { rotulo: 'CAR', valor: p.car ? (p.carSituacao ? SITUACOES_CAR[p.carSituacao] : 'Informado') : 'Não informado', ruim: !p.car || (!!p.carSituacao && p.carSituacao !== 'ativo') },
        { rotulo: 'Geolocalização', valor: contorno.length >= 3 ? `${fmtNum(areaHa(contorno), 1)} ha` : p.lat != null ? 'Só a sede' : 'Não informada', sub: contorno.length >= 3 ? 'contorno da divisa' : undefined, ruim: contorno.length < 3 },
        { rotulo: 'Desmatamento após 2020', valor: p.semDesmate ? 'Não (declarado)' : 'Não declarado', ruim: !p.semDesmate },
      ],
    },
    {
      titulo: 'Documentos da fazenda', cabecalho: ['Documento', 'Número / situação'], larguras: [1, 2],
      linhas: [
        ['Produtor', p.produtor ?? ''],
        ['Sede (GPS)', sede],
        ['CAR', p.car ? `${limparCar(p.car)}${p.carSituacao ? ` (${SITUACOES_CAR[p.carSituacao].toLowerCase()})` : ''}` : ''],
        ['CIB / NIRF (ITR)', p.cib ? `${fmtCib(p.cib)}${p.itrAno ? ` · ITR ${p.itrAno} entregue` : ''}` : ''],
        ['CCIR (INCRA)', p.ccir ? `${p.ccir}${p.ccirAno ? ` · pago em ${p.ccirAno}` : ''}` : ''],
        ['Código do estabelecimento', p.codEstab ?? ''],
        ['Inscrição estadual', p.ie ?? ''],
      ],
    },
    {
      tipo: 'indicadores', titulo: 'Lote', itens: [
        { rotulo: 'Lote', valor: lote.nome, sub: `desde ${fmtData(lote.dataEntrada)}` },
        { rotulo: 'Cabeças', valor: String(lote.qtdCabecas) },
        { rotulo: 'Com código oficial', valor: animais.length ? `${comCodigo} de ${animais.length}` : 'Controle por lote', ruim: animais.length > 0 && comCodigo < animais.length },
        { rotulo: 'GTAs', valor: String(gtas.length) },
      ],
    },
  ];
  blocos.push({
    titulo: 'GTAs (trânsito)', cabecalho: ['Emissão', 'Sentido', 'GTA', 'Cabeças', 'Finalidade', 'Origem / destino'], larguras: [1.1, 0.9, 1.3, 0.8, 1, 2.2],
    linhas: gtas.length ? gtas.map((g) => [dataCel(g.emissao), g.sentido === 'entrada' ? 'Entrada' : 'Saída', `${g.uf ? `${g.uf} ` : ''}${g.serie ? `${g.serie}-` : ''}${g.numero}`, cabecasGta(g),
      g.finalidade ? FINALIDADES_GTA[g.finalidade] : '', [g.outroNome, [g.outroMunicipio, g.outroUf].filter(Boolean).join('/')].filter(Boolean).join(' · ')]) : [['', 'Nenhuma GTA lançada', '', '', '', '']],
  });
  blocos.push({
    titulo: 'Vacinas e remédios', cabecalho: ['Data', 'Tipo', 'Produto', 'Animais', 'Carência'], larguras: [1, 1, 2, 0.8, 0.9],
    linhas: san.length ? san.map((e) => [dataCel(e.data), TIPOS_SANIDADE[e.tipo], e.produto, e.qtdAnimais ?? '', e.carenciaDias ? `${e.carenciaDias} dias` : '']) : [['', 'Nada lançado', '', '', '']],
  });
  if (pes.length) blocos.push({ titulo: 'Pesagens', cabecalho: ['Data', 'Peso médio (kg)', 'Pesados'], linhas: pes.map((x) => [dataCel(x.data), Math.round(x.pesoMedio * 10) / 10, x.qtdPesada]) });
  if (animais.length) {
    blocos.push({
      titulo: 'Animais', cabecalho: ['Brinco', 'Código oficial (PNIB/SISBOV)', 'Chip', 'Sexo', 'Raça', 'Nascimento'], larguras: [0.9, 1.8, 1.3, 0.8, 1, 1],
      linhas: animais.map((a) => [a.brinco, a.sisbov ?? '', a.chip ?? '', a.sexo === 'macho' ? 'M' : a.sexo === 'femea' ? 'F' : '', a.raca ?? '', a.nascimento ? dataCel(a.nascimento) : '']),
    } as Tabela);
  }
  blocos.push({ tipo: 'texto', texto: `Ficha gerada pelo BoiForte em ${fmtData(d.hoje)} com os dados lançados pelo produtor. Os documentos originais (GTA, CAR, ITR, CCIR) ficam com o produtor e podem ser conferidos nos órgãos oficiais.` });

  const nomeArquivo = `rastreabilidade-${lote.nome}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').toLowerCase();
  const resumo = [
    `*Rastreabilidade · ${lote.nome}* (${lote.qtdCabecas} cab.)`,
    `Fazenda ${p.nome}${p.municipio ? `, ${p.municipio}${p.uf ? `/${p.uf}` : ''}` : ''}`,
    `CAR: ${p.car ? (p.carSituacao ? SITUACOES_CAR[p.carSituacao].toLowerCase() : 'informado') : 'não informado'} · Geolocalização: ${contorno.length >= 3 ? 'contorno da divisa' : p.lat != null ? 'sede' : 'não informada'}`,
    p.semDesmate ? `Sem desmatamento depois de ${fmtData(EUDR_DATA_CORTE)} (declarado)` : '',
    `GTAs: ${gtas.length} · Vacinas/remédios: ${san.length}${animais.length ? ` · ${comCodigo}/${animais.length} com código oficial` : ''}`,
  ].filter(Boolean).join('\n');
  return { titulo: `Rastreabilidade · ${lote.nome}`, subtitulo: `${p.nome} · ${fmtData(d.hoje)}`, blocos, nomeArquivo, resumo };
}
