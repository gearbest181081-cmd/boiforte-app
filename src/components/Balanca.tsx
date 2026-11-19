import { useEffect, useRef, useState } from 'react';
import { ligarBalanca, temBluetooth } from '../balanca';

/** Liga numa balança Bluetooth. Cada peso parado entra sozinho na próxima linha. */
export function BotaoBalanca({ aoPesar, aoErro }: { aoPesar: (kg: number) => void; aoErro: (m: string) => void }) {
  const [ligada, setLigada] = useState<string | null>(null);
  const [ligando, setLigando] = useState(false);
  const desligar = useRef<() => void>();
  const pesar = useRef(aoPesar);
  pesar.current = aoPesar;
  useEffect(() => () => desligar.current?.(), []);
  if (!temBluetooth()) return null;
  const ligar = async () => {
    setLigando(true);
    try {
      const b = await ligarBalanca((kg) => pesar.current(kg), () => { setLigada(null); aoErro('A balança desligou.'); });
      desligar.current = b.desligar;
      setLigada(b.nome);
    } catch (e) {
      const m = (e as Error).message;
      if (!/cancel/i.test(m) && (e as Error).name !== 'NotFoundError') aoErro(/bluetooth/i.test(m) ? 'Não consegui ligar na balança. Ligue o Bluetooth e tente de novo.' : m);
    } finally { setLigando(false); }
  };
  if (ligada) return (
    <div className="alerta bom" data-testid="balancaLigada"><span className="ic">⚖️</span><div><b>{ligada} ligada</b>Suba o animal e espere o peso parar.
      <button className="btn sec pequeno" style={{ marginTop: 8 }} onClick={() => { desligar.current?.(); setLigada(null); }}>Desligar balança</button></div></div>
  );
  return <button className="btn sec largo" disabled={ligando} onClick={ligar}>{ligando ? 'Procurando a balança…' : 'Ligar balança Bluetooth (teste)'}</button>;
}
