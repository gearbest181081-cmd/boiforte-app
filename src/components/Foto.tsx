// Botão "ler pela foto": tira/escolhe a foto, diminui no próprio celular e manda para o servidor ler.
// A leitura acontece no servidor: precisa da nuvem ligada e de internet. Com "sempre", o botão aparece
// mesmo sem nuvem e explica o que falta.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lerFoto, nuvemConfigurada } from '../nuvem/cliente';
import { useEstadoNuvem } from '../nuvem/useNuvem';
import { AvisoIA, useOnline } from './ui';
import type { TipoFoto } from '../../supabase/functions/_shared/foto';

/** Diminui a foto para no máximo 1600 px e devolve JPEG em base64 (sem o prefixo data:). */
export async function prepararFoto(arquivo: File, lado = 1600): Promise<string> {
  const bmp = await createImageBitmap(arquivo);
  const f = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export function BotaoFoto<T>({ tipo, rotulo, aoLer, aoErro, sempre }: {
  tipo: TipoFoto; rotulo: string; aoLer: (r: T) => void; aoErro: (m: string) => void; sempre?: boolean;
}) {
  const nav = useNavigate();
  const [explicar, setExplicar] = useState(false);
  const est = useEstadoNuvem();
  const online = useOnline();
  const ref = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const ligada = nuvemConfigurada() && !!est?.fazenda;
  const oQue = tipo === 'rotulo' ? 'os valores do rótulo' : 'o peso que aparece na balança';
  if (!ligada) {
    if (!sempre || est === undefined) return null;
    return (
      <>
        <button className="btn sec largo" onClick={() => setExplicar(true)}>{rotulo}</button>
        {explicar && (
          <div className="alerta atencao" data-testid="fotoPrecisaNuvem"><span className="ic">☁️</span><div>
            <b>A leitura por foto usa a internet</b>
            {nuvemConfigurada() ? `Ligue este celular a uma fazenda na nuvem (plano Pro) para usar. Enquanto isso, digite ${oQue}.` : `Ela ainda não está ligada nesta versão do app. Por enquanto, digite ${oQue}.`}
            {nuvemConfigurada() && <button className="btn sec pequeno" style={{ marginTop: 8 }} onClick={() => nav('/nuvem')}>Ligar a nuvem</button>}
          </div></div>
        )}
      </>
    );
  }
  const escolheu = async (a?: File) => {
    if (!a) return;
    setLendo(true);
    try { aoLer(await lerFoto<T>(est!.fazenda!.id, tipo, await prepararFoto(a), 'image/jpeg')); }
    catch (e) { aoErro((e as Error).message); }
    finally { setLendo(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => escolheu(e.target.files?.[0])} />
      <button className="btn sec largo" disabled={lendo || !online} onClick={() => ref.current?.click()}>
        {lendo ? 'Lendo a foto…' : online ? rotulo : `${rotulo} (precisa de internet)`}
      </button>
      <AvisoIA />
    </>
  );
}
