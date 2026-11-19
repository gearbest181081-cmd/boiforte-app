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

export interface PesagemFalada {
  brinco: string;
  peso: number;
}

/** Lê "brinco 12 peso 320" ou "animal 45, 318 quilos" ou "12 320". */
export function lerPesagemFalada(texto: string): PesagemFalada | null {
  const s = semAcento(texto).replace(/[^a-z0-9,. ]/g, ' ').replace(/\s+/g, ' ').trim();
  let m = s.match(/(?:brinco|animal|numero|boi|vaca|novilha|bezerro|garrote)\s+(\S+(?:\s+\S+)*?)\s+(?:peso|pesando|pesou|com)\s+(.+)$/);
  if (m) {
    const brinco = lerNumeroFalado(m[1]);
    const peso = lerNumeroFalado(m[2]);
    if (peso != null && peso > 0) return { brinco: brinco != null ? String(brinco) : m[1].toUpperCase(), peso };
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
