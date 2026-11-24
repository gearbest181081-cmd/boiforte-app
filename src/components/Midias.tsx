// Fotos e áudio do pasto (entrada e saída dos animais): tirar foto, gravar áudio e ver/ouvir depois.
// Os arquivos ficam no celular e sobem para a nuvem junto com as fotos das anotações.
import { useEffect, useRef, useState } from 'react';
import { caminhoFoto, comprimirFoto, lerFoto, MIME_EXT, novaFotoId } from '../anotacoes';
import { armazemNuvem, nuvemConfigurada } from '../nuvem/cliente';
import { useEstadoNuvem } from '../nuvem/useNuvem';
import type { ExtMidia, Midia } from '../db';
import type { MidiaNova } from '../pasto';
import { MAX_MIDIAS } from '../validar';
import { useAviso, useOnline } from './ui';

/** Áudio até 60 s: com voz comprimida (~32 kbit/s) fica perto de 250 KB, abaixo do limite de 1 MB da nuvem. */
export const SEGUNDOS_AUDIO = 60;

function formatoAudio(): { mime: string; ext: ExtMidia } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const [mime, ext] of [['audio/webm;codecs=opus', 'webm'], ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'm4a'], ['audio/webm', 'webm']] as const) {
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext };
  }
  return null;
}

type Nova = MidiaNova & { url: string };

/** Captura de fotos e de um áudio. Devolve a lista nova a cada mudança. */
export function CapturaMidias({ rotulo, aoMudar }: { rotulo: string; aoMudar: (m: MidiaNova[]) => void }) {
  const aviso = useAviso();
  const camera = useRef<HTMLInputElement>(null);
  const [lista, setLista] = useState<Nova[]>([]);
  const [gravando, setGravando] = useState<{ rec: MediaRecorder; inicio: number } | null>(null);
  const [seg, setSeg] = useState(0);
  const [preparando, setPreparando] = useState(false);
  const mudar = (n: Nova[]) => { setLista(n); aoMudar(n.map(({ id, ext, dados }) => ({ id, ext, dados }))); };
  const cheia = lista.length >= MAX_MIDIAS;

  useEffect(() => () => lista.forEach((x) => URL.revokeObjectURL(x.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - gravando.inicio) / 1000);
      setSeg(s);
      if (s >= SEGUNDOS_AUDIO && gravando.rec.state === 'recording') gravando.rec.stop();
    }, 250);
    return () => clearInterval(t);
  }, [gravando]);

  const foto = async (arqs: FileList | null) => {
    if (!arqs?.length || cheia) return;
    setPreparando(true);
    try {
      const dados = await comprimirFoto(arqs[0]);
      mudar([...lista, { id: novaFotoId(), ext: 'jpg', dados, url: URL.createObjectURL(new Blob([dados], { type: 'image/jpeg' })) }]);
    } catch (e) { aviso((e as Error).message || 'Não consegui abrir esta foto.', true); }
    finally { setPreparando(false); if (camera.current) camera.current.value = ''; }
  };

  const gravar = async () => {
    const fmt = formatoAudio();
    if (!fmt || !navigator.mediaDevices?.getUserMedia) return aviso('Este celular não grava áudio pelo app. Use o microfone do campo de texto.', true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: fmt.mime, audioBitsPerSecond: 32000 });
      const partes: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(null); setSeg(0);
        const blob = new Blob(partes, { type: MIME_EXT[fmt.ext] });
        if (blob.size > 1024 * 1024 * 0.95) return aviso('O áudio ficou grande demais. Grave um mais curto.', true);
        if (blob.size < 200) return;
        mudar([...listaRef.current, { id: novaFotoId(), ext: fmt.ext, dados: await blob.arrayBuffer(), url: URL.createObjectURL(blob) }]);
      };
      rec.start(1000);
      setGravando({ rec, inicio: Date.now() });
    } catch {
      aviso('Não deu para usar o microfone. Libere o microfone para o app nas configurações do celular.', true);
    }
  };
  const listaRef = useRef(lista);
  listaRef.current = lista;

  const tirar = (id: string) => {
    const sai = lista.find((x) => x.id === id);
    if (sai) URL.revokeObjectURL(sai.url);
    mudar(lista.filter((x) => x.id !== id));
  };

  return (
    <div className="campo">
      <span className="rotulo-campo">{rotulo} ({lista.length} de {MAX_MIDIAS})</span>
      {lista.length > 0 && (
        <div className="fotos-grade">
          {lista.map((m) => (
            <div key={m.id} className="foto-com-x">
              {m.ext === 'jpg'
                ? <div className="foto-mini grande"><img src={m.url} alt="Foto do capim" /></div>
                : <audio controls src={m.url} style={{ width: 220 }} aria-label="Áudio gravado" />}
              <button type="button" className="foto-x" aria-label="Tirar" onClick={() => tirar(m.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      {!cheia && (
        <div className="botoes" style={{ marginTop: 8 }}>
          <button type="button" className="btn sec" disabled={preparando || !!gravando} onClick={() => camera.current?.click()}>{preparando ? 'Preparando…' : '📷 Foto do capim'}</button>
          {gravando
            ? <button type="button" className="btn perigo" onClick={() => gravando.rec.stop()}>⏹ Parar ({SEGUNDOS_AUDIO - seg}s)</button>
            : <button type="button" className="btn sec" onClick={gravar}>🎙️ Gravar áudio</button>}
        </div>
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="fotoPasto" onChange={(e) => foto(e.target.files)} />
    </div>
  );
}

/** Mostra fotos e toca áudios já gravados (do celular ou, com sinal, da nuvem). */
export function VerMidias({ midias }: { midias?: Midia[] }) {
  if (!midias?.length) return null;
  return (
    <div className="fotos-grade" style={{ marginTop: 6 }}>
      {midias.map((m) => <UmaMidia key={m.arq} m={m} />)}
    </div>
  );
}

function UmaMidia({ m }: { m: Midia }) {
  const est = useEstadoNuvem();
  const online = useOnline();
  const fazenda = est?.fazenda?.id;
  const [url, setUrl] = useState<string>();
  const [falta, setFalta] = useState(false);
  useEffect(() => {
    let u: string | undefined; let fim = false;
    const baixar = fazenda && online && nuvemConfigurada() ? (f: string) => armazemNuvem.baixar(caminhoFoto(fazenda, f, m.ext)) : undefined;
    lerFoto(m.arq, baixar).then((d) => {
      if (fim) return;
      if (!d) return setFalta(true);
      u = URL.createObjectURL(new Blob([d], { type: MIME_EXT[m.ext] }));
      setUrl(u);
    }).catch(() => { if (!fim) setFalta(true); });
    return () => { fim = true; if (u) URL.revokeObjectURL(u); };
  }, [m.arq, m.ext, fazenda, online]);
  if (!url) return <div className="foto-mini vazia">{falta ? (m.ext === 'jpg' ? '📷' : '🎙️') : '…'}</div>;
  return m.ext === 'jpg'
    ? <a className="foto-mini" href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto do capim" /></a>
    : <audio controls src={url} style={{ width: 220 }} aria-label="Áudio do pasto" />;
}
