// Balança por Bluetooth (experimental). Funciona no Chrome do Android com indicadores que mandam o peso
// em texto por um módulo serial BLE (Nordic UART ou HM-10/FFE0). Cada marca tem seu jeito: por isso o
// leitor é tolerante e só aceita o peso depois de estabilizar.

export const SERVICOS = {
  uart: { servico: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', leitura: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  hm10: { servico: 0xffe0, leitura: 0xffe1 },
} as const;

/** Tira o peso (kg) de uma linha que a balança mandou, como "ST,GS,+  352.5kg" ou "W:0352". */
export function lerLinhaBalanca(linha: string): number | null {
  const s = linha.replace(/\s+/g, '');
  if (!s || /^-/.test(s.replace(/^[A-Z,:]+/i, ''))) return null; // negativo = tara/erro
  const m = s.match(/(\d{1,4}(?:[.,]\d{1,3})?)(?:kg)?(?!.*\d)/i);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) && v >= 0 && v <= 3000 ? v : null;
}

/**
 * Junta os pedaços que chegam, separa em linhas e avisa um peso só quando ele fica parado
 * (3 leituras iguais). Para avisar o próximo, a balança precisa voltar perto de zero (o animal saiu).
 */
export class LeitorBalanca {
  private resto = '';
  private iguais = 0;
  private ultimo: number | null = null;
  private avisado = false;
  constructor(private aoPesar: (kg: number) => void, private iguaisPara = 3, private minimo = 20) {}
  receber(pedaco: string) {
    this.resto += pedaco;
    const linhas = this.resto.split(/[\r\n]+/);
    this.resto = linhas.pop() ?? '';
    if (this.resto.length > 200) this.resto = '';
    for (const l of linhas) this.valor(lerLinhaBalanca(l));
  }
  private valor(v: number | null) {
    if (v == null) return;
    if (v < this.minimo) { this.avisado = false; this.iguais = 0; this.ultimo = v; return; }
    this.iguais = v === this.ultimo ? this.iguais + 1 : 1;
    this.ultimo = v;
    if (!this.avisado && this.iguais >= this.iguaisPara) { this.avisado = true; this.aoPesar(v); }
  }
}

export const temBluetooth = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

type Caracteristica = { startNotifications(): Promise<unknown>; addEventListener(t: string, f: (e: Event) => void): void; value?: DataView };
type Dispositivo = { name?: string; gatt?: { connect(): Promise<{ getPrimaryService(s: string | number): Promise<{ getCharacteristic(c: string | number): Promise<Caracteristica> }>; disconnect(): void }> }; addEventListener(t: string, f: () => void): void };

/** Liga na balança e chama aoPesar a cada peso estável. Devolve uma função para desligar. */
export async function ligarBalanca(aoPesar: (kg: number) => void, aoCair: () => void): Promise<{ nome: string; desligar: () => void }> {
  const bt = (navigator as unknown as { bluetooth: { requestDevice(o: unknown): Promise<Dispositivo> } }).bluetooth;
  const disp = await bt.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICOS.uart.servico, SERVICOS.hm10.servico] });
  const gatt = await disp.gatt!.connect();
  let carac: Caracteristica | null = null;
  for (const s of Object.values(SERVICOS)) {
    try { carac = await (await gatt.getPrimaryService(s.servico)).getCharacteristic(s.leitura); break; } catch { /* tenta o próximo */ }
  }
  if (!carac) { gatt.disconnect(); throw new Error('Esta balança não mandou o peso de um jeito que o app entende.'); }
  const leitor = new LeitorBalanca(aoPesar);
  const dec = new TextDecoder();
  carac.addEventListener('characteristicvaluechanged', (e) => {
    const v = (e.target as unknown as Caracteristica).value;
    if (v) leitor.receber(dec.decode(v));
  });
  await carac.startNotifications();
  disp.addEventListener('gattserverdisconnected', aoCair);
  return { nome: disp.name || 'Balança', desligar: () => gatt.disconnect() };
}
