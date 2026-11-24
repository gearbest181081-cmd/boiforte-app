// Entrada por voz: reconhecimento (Web Speech API) e leitura de números falados em português.

const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400,
  quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Converte uma sequência de palavras numéricas (sem vírgula) em número. */
function palavrasParaInteiro(tokens: string[]): number | null {
  let total = 0;
  let atual = 0;
  let achou = false;
  for (const t of tokens) {
    if (t === 'e') continue;
    if (/^\d+$/.test(t)) { atual += Number(t); achou = true; continue; }
    if (t === 'mil') { total += (atual || 1) * 1000; atual = 0; achou = true; continue; }
    if (t in UNIDADES) { atual += UNIDADES[t]; achou = true; continue; }
    return null;
  }
  return achou ? total + atual : null;
}

const RUIDO = new Set(['quilos', 'quilo', 'kg', 'kgs', 'kilos', 'kilo', 'k', 'g', 'reais', 'real', 'r$', 'cabecas', 'cabeca', 'cab', 'dias', 'dia', 'por']);

/**
 * Lê um número dito em voz: "320", "320,5", "trezentos e vinte", "trezentos e vinte vírgula cinco",
 * "trezentos e vinte e meio", "1.250 quilos", "zero vírgula oitocentos".
 */
export function lerNumeroFalado(texto: string): number | null {
  if (!texto) return null;
  let s = semAcento(texto).trim();
  // Formatos com dígitos: "1.250,5" / "320,5" / "320.5" / "0,800"
  const dig = s.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/);
  const temPalavraNumero = s.split(/\s+/).some((w) => w in UNIDADES || w === 'mil' || w === 'virgula' || w === 'meio');
  if (dig && !temPalavraNumero) {
    let n = dig[0];
    if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.'); // 1.250,5
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, ''); // 1.250
    // senão "320.5" já está no formato certo
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }
  s = s.replace(/[^a-z0-9,. ]/g, ' ').replace(/,/g, ' virgula ').replace(/\s+/g, ' ').trim();
  const tokens = s.split(' ').filter((t) => t && !RUIDO.has(t));
  const iV = tokens.findIndex((t) => t === 'virgula' || t === 'ponto');
  let meio = false;
  if (tokens.length >= 2 && tokens[tokens.length - 1] === 'meio') { meio = true; tokens.pop(); if (tokens[tokens.length - 1] === 'e') tokens.pop(); }
  if (iV >= 0) {
    const inteiro = palavrasParaInteiro(tokens.slice(0, iV));
    const decTokens = tokens.slice(iV + 1);
    if (inteiro == null || !decTokens.length) return null;
    // Decimais podem vir como dígitos ditos um a um ("cinco zero") ou um número ("oitocentos").
    let decStr: string;
    const todosDigitos = decTokens.every((t) => (t in UNIDADES && UNIDADES[t] < 10) || /^\d$/.test(t));
    if (todosDigitos && decTokens.length > 1) {
      decStr = decTokens.map((t) => (/^\d$/.test(t) ? t : String(UNIDADES[t]))).join('');
    } else {
      const d = palavrasParaInteiro(decTokens);
      if (d == null) return null;
      decStr = decTokens.length === 1 && /^\d+$/.test(decTokens[0]) ? decTokens[0] : String(d);
    }
    return Number(`${inteiro}.${decStr}`);
  }
  const n = palavrasParaInteiro(tokens);
  if (n == null) return null;
  return meio ? n + 0.5 : n;
}

// ---------- Peso falado em arroba ----------

/** Arroba de peso vivo: 15 kg de animal vivo ("bezerro de 12 arrobas" = 180 kg). A arroba de carcaça, usada no preço, é outra conta (ver rendimento). */
export const KG_POR_ARROBA_VIVA = 15;

export type PesoFalado =
  | { kg: number; arrobas?: number }
  /** Falou em arroba, mas não deu para entender o número. */
  | { erro: 'arroba' };

const TEM_ARROBA = /\barrobas?\b/;

/**
 * Lê um peso falado. Em kg ("trezentos e vinte", "320 quilos") ou em arroba de peso vivo
 * ("15 arrobas", "quinze arrobas e meia", "18 @ e 10 quilos", "doze arrobas de peso vivo").
 * Arroba vira kg com 15 kg por arroba.
 */
export function lerPesoFalado(texto: string): PesoFalado | null {
  if (!texto) return null;
  const s = semAcento(texto).replace(/@/g, ' arroba ').replace(/\s+/g, ' ').trim();
  if (!TEM_ARROBA.test(s)) {
    const n = lerNumeroFalado(texto);
    return n == null ? null : { kg: n };
  }
  const limpo = s.replace(/\b(de )?peso vivo\b/g, ' ').replace(/\bvivas?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const m = limpo.match(/^(.*?)\s*\barrobas?\b\s*(.*)$/);
  if (!m) return { erro: 'arroba' };
  let arrobas = lerNumeroFalado(m[1].trim());
  if (arrobas == null || arrobas <= 0) return { erro: 'arroba' };
  let resto = m[2].replace(/^e\s+/, '').trim();
  let kgExtra = 0;
  if (/^(meia|meio)$/.test(resto)) { arrobas += 0.5; resto = ''; }
  if (resto) {
    const k = lerNumeroFalado(resto);
    if (k == null || TEM_ARROBA.test(resto)) return { erro: 'arroba' };
    kgExtra = k;
  }
  const kg = Math.round((arrobas * KG_POR_ARROBA_VIVA + kgExtra) * 100) / 100;
  return { kg, arrobas };
}

/** Das alternativas do reconhecimento ("a|b|c"), pega o primeiro peso entendido; se só achou arroba sem número, devolve o erro. */
export function melhorPeso(alternativas: string): PesoFalado | null {
  let erro: PesoFalado | null = null;
  for (const t of alternativas.split('|')) {
    const r = lerPesoFalado(t);
    if (r && 'kg' in r) return r;
    if (r) erro = r;
  }
  return erro;
}

/** Frase curta para mostrar a conversão: "15 @ de peso vivo = 225 kg". */
export function explicarArroba(arrobas: number, kg: number): string {
  const f = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
  return `${f(arrobas)} @ de peso vivo × ${KG_POR_ARROBA_VIVA} kg = ${f(kg)} kg`;
}

export const AVISO_PESO_EM_KG = 'Este peso é em kg, não em arroba. Fale em quilos, por exemplo: "trezentos e vinte".';

export interface PesagemFalada {
  brinco: string;
  peso: number;
  /** Quando foi falado em arroba de peso vivo (o peso já vem convertido em kg). */
  arrobas?: number;
}

/** Resultado de lerPesagemFalada quando falou arroba e não deu para converter. */
export const PESAGEM_ARROBA_SEM_NUMERO = 'arroba' as const;

/** Lê "brinco 12 peso 320" ou "animal 45, 318 quilos" ou "12 320" ou "brinco 12 peso 18 arrobas". */
export function lerPesagemFalada(texto: string): PesagemFalada | typeof PESAGEM_ARROBA_SEM_NUMERO | null {
  const s = semAcento(texto).replace(/@/g, ' arroba ').replace(/[^a-z0-9,. ]/g, ' ').replace(/\s+/g, ' ').trim();
  let m = s.match(/(?:brinco|animal|numero|boi|vaca|novilha|bezerro|garrote)\s+(\S+(?:\s+\S+)*?)\s+(?:peso|pesando|pesou|com)\s+(.+)$/);
  if (m) {
    const brinco = lerNumeroFalado(m[1]);
    const p = lerPesoFalado(m[2]);
    if (p && 'erro' in p) return PESAGEM_ARROBA_SEM_NUMERO;
    if (p && p.kg > 0) return { brinco: brinco != null ? String(brinco) : m[1].toUpperCase(), peso: p.kg, ...(p.arrobas != null ? { arrobas: p.arrobas } : {}) };
  }
  m = s.match(/^(?:brinco|animal|numero)?\s*(\d+)\s+(\d+(?:[.,]\d+)?)(?:\s*(?:quilos|kg|kilos))?$/);
  if (m) return { brinco: m[1], peso: Number(m[2].replace(',', '.')) };
  return null;
}

// ---------- Reconhecimento de voz do navegador ----------

type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

export function vozDisponivel(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

/** Escuta uma frase e devolve o texto. Rejeita com mensagem amigável em português. */
export function ouvir(): { promessa: Promise<string>; parar: () => void } {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    return { promessa: Promise.reject(new Error('Este celular não tem reconhecimento de voz. Digite o valor.')), parar: () => {} };
  }
  const rec: Rec = new Ctor();
  rec.lang = 'pt-BR';
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  let feito = false;
  const promessa = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      feito = true;
      const alt = e.results?.[0];
      const textos: string[] = [];
      for (let i = 0; alt && i < alt.length; i++) textos.push(alt[i].transcript);
      resolve(textos.join('|'));
    };
    rec.onerror = (e: any) => {
      feito = true;
      const motivo = e?.error;
      if (motivo === 'not-allowed' || motivo === 'service-not-allowed') reject(new Error('Libere o microfone para o BoiForte nas configurações do celular.'));
      else if (motivo === 'network') reject(new Error('Sem internet o reconhecimento de voz não funciona neste celular. Digite o valor.'));
      else if (motivo === 'no-speech') reject(new Error('Não ouvi nada. Toque no microfone e fale de novo.'));
      else reject(new Error('Não entendi. Tente de novo ou digite.'));
    };
    rec.onend = () => { if (!feito) reject(new Error('Não ouvi nada. Toque no microfone e fale de novo.')); };
  });
  try { rec.start(); } catch { /* já estava ouvindo */ }
  return { promessa, parar: () => rec.stop() };
}

/** Das alternativas devolvidas pelo reconhecimento ("a|b|c"), pega a primeira que vira número. */
export function melhorNumero(alternativas: string): number | null {
  for (const t of alternativas.split('|')) {
    const n = lerNumeroFalado(t);
    if (n != null) return n;
  }
  return null;
}

// ---------- Texto, datas e escolhas faladas ----------

export type FormatoTexto = 'texto' | 'email' | 'codigo' | 'digitos';

function digitosFalados(s: string): string {
  return s.split(/\s+/).map((t) => (/^\d+$/.test(t) ? t : t in UNIDADES && UNIDADES[t] < 100 ? String(UNIDADES[t]) : '')).join('');
}

/** Ajusta o que foi falado ao tipo do campo: texto livre, e-mail ("joao arroba gmail ponto com"), código ou só números. */
export function textoFalado(alternativas: string, formato: FormatoTexto = 'texto'): string {
  const t = (alternativas.split('|')[0] ?? '').trim();
  if (formato === 'texto') return t.charAt(0).toUpperCase() + t.slice(1);
  const s = semAcento(t);
  if (formato === 'email') {
    return s.replace(/\s*\barroba\b\s*/g, '@').replace(/\s*\bponto\b\s*/g, '.').replace(/\s*\b(traco|hifen)\b\s*/g, '-')
      .replace(/\s*\b(underline|sublinhado)\b\s*/g, '_').replace(/\s+/g, '');
  }
  if (formato === 'digitos') return digitosFalados(s.replace(/[^a-z0-9 ]/g, ' '));
  // código: letras e números juntos, em maiúsculas
  return s.replace(/\s*\b(traco|hifen)\b\s*/g, '-').split(/\s+/)
    .map((w) => (w in UNIDADES && UNIDADES[w] < 10 ? String(UNIDADES[w]) : w)).join('').toUpperCase();
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function isoValida(a: number, m: number, d: number): string | null {
  if (!Number.isInteger(a) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (a < 100) a += 2000;
  if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1) return null;
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (d > ult) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

function numeroOuPrimeiro(s: string): number | null {
  const t = s.replace(/\bdia\b/g, ' ').trim();
  if (/^(primeiro|1o|1º)$/.test(t)) return 1;
  return lerNumeroFalado(t);
}

/**
 * Lê uma data falada e devolve no formato AAAA-MM-DD.
 * Entende: "hoje", "ontem", "anteontem", "amanhã", "daqui a 30 dias", "há 5 dias", "15 de março",
 * "primeiro de abril de 2026", "dia 15", "15/03", "15/03/2026", "15 do 3".
 */
export function lerDataFalada(texto: string, hoje: string): string | null {
  const s = semAcento(texto).replace(/[^a-z0-9/ .-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const [ah, mh] = hoje.split('-').map(Number);
  if (/\banteontem\b/.test(s)) return somarDias(hoje, -2);
  if (/\bontem\b/.test(s)) return somarDias(hoje, -1);
  if (/\bdepois de amanha\b/.test(s)) return somarDias(hoje, 2);
  if (/\bamanha\b/.test(s)) return somarDias(hoje, 1);
  if (/\bhoje\b/.test(s)) return hoje;
  let m = s.match(/^(?:daqui a|daqui|dentro de|em)\s+(.+?)\s+(dias?|semanas?)$/);
  if (m) { const n = lerNumeroFalado(m[1]); if (n != null) return somarDias(hoje, Math.round(n * (m[2].startsWith('semana') ? 7 : 1))); }
  m = s.match(/^(?:ha|faz)\s+(.+?)\s+(dias?|semanas?)(?: atras)?$/) ?? s.match(/^(.+?)\s+(dias?|semanas?) atras$/);
  if (m) { const n = lerNumeroFalado(m[1]); if (n != null) return somarDias(hoje, -Math.round(n * (m[2].startsWith('semana') ? 7 : 1))); }
  m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?/);
  if (m) return isoValida(m[3] ? Number(m[3]) : ah, Number(m[2]), Number(m[1]));
  // "15 de março (de 2026)"
  const iMes = MESES.findIndex((nome) => new RegExp(`\\b${nome}\\b`).test(s));
  if (iMes >= 0) {
    const [antes, depois] = s.split(MESES[iMes]);
    const d = numeroOuPrimeiro(antes.replace(/\bde\s*$/, '').trim());
    const anoTxt = depois.replace(/^\s*de\s*/, '').trim();
    const a = anoTxt ? lerNumeroFalado(anoTxt) : ah;
    if (d == null || a == null) return null;
    return isoValida(a, iMes + 1, d);
  }
  // "15 do 3 (de 2026)"
  m = s.match(/^(?:dia\s+)?(.+?)\s+do\s+(.+?)(?:\s+de\s+(.+))?$/);
  if (m) {
    const d = numeroOuPrimeiro(m[1]), mes = lerNumeroFalado(m[2]), a = m[3] ? lerNumeroFalado(m[3]) : ah;
    if (d != null && mes != null && a != null) return isoValida(a, mes, d);
  }
  // "dia 15": este mês
  m = s.match(/^dia\s+(.+)$/);
  if (m) { const d = numeroOuPrimeiro(m[1]); if (d != null) return isoValida(ah, mh, d); }
  return null;
}

/** Das alternativas faladas, a primeira que vira data. */
export function melhorData(alternativas: string, hoje: string): string | null {
  for (const t of alternativas.split('|')) {
    const d = lerDataFalada(t, hoje);
    if (d) return d;
  }
  return null;
}

const PALAVRAS_VAZIAS = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'e', 'para', 'pra', 'com', 'no', 'na', 'quero', 'escolher', 'escolhe', 'opcao', 'cab']);

function palavras(s: string): string[] {
  return semAcento(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((t) => t && !PALAVRAS_VAZIAS.has(t))
    .map((t) => (t in UNIDADES ? String(UNIDADES[t]) : t));
}

/**
 * Escolhe numa lista a opção que mais parece com o que foi falado.
 * Ex.: "milho" → "Milho moído"; "lote cinco" → "Lote 5 (40 cab)". Devolve o valor da opção ou null.
 */
export function escolherOpcaoFalada(alternativas: string, opcoes: { valor: string; texto: string }[]): string | null {
  let melhor: { valor: string; nota: number } | null = null;
  for (const alt of alternativas.split('|')) {
    const fala = palavras(alt);
    if (!fala.length) continue;
    const frase = fala.join(' ');
    for (const o of opcoes) {
      const op = palavras(o.texto);
      if (!op.length) continue;
      const opFrase = op.join(' ');
      let nota: number;
      if (opFrase === frase) nota = 100;
      else if (` ${opFrase} `.includes(` ${frase} `)) nota = 80 + 10 * (fala.length / op.length);
      else if (` ${frase} `.includes(` ${opFrase} `)) nota = 70;
      else {
        const bate = (t: string) => op.some((w) => w === t || (t.length >= 4 && (w.startsWith(t) || t.startsWith(w)) && w.length >= 4));
        const acertos = fala.filter(bate).length;
        if (!acertos) continue;
        nota = 50 * (acertos / fala.length) + 10 * (acertos / op.length);
      }
      if (!melhor || nota > melhor.nota) melhor = { valor: o.valor, nota };
    }
  }
  return melhor && melhor.nota >= 30 ? melhor.valor : null;
}
