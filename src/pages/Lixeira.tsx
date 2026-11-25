// Lixeira: tudo o que foi apagado fica guardado aqui e volta com um toque, junto com o que foi apagado com ele.
// Com a nuvem, a lixeira é a da fazenda (a mesma em todos os celulares da equipe).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { dependencias, listarLixeira, motivoNaoRestaura, restaurar, voltarCopiaInteira, type PacoteLixeira } from '../lixeira';
import { useEstadoNuvem, usePapel } from '../nuvem/useNuvem';
import { CampoTexto, Topo, useAviso } from '../components/ui';

const POR_VEZ = 30;
const quando = (ms: number) => {
  const d = new Date(ms);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Lixeira() {
  const aviso = useAviso();
  const nav = useNavigate();
  const papel = usePapel();
  const nuvem = useEstadoNuvem();
  const ligado = !!nuvem?.fazenda;
  const lista = useLiveQuery(() => listarLixeira());
  const [busca, setBusca] = useState('');
  const [quantos, setQuantos] = useState(POR_VEZ);
  const [ajustes, setAjustes] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const achados = useMemo(() => {
    const b = semAcento(busca.trim());
    return (lista ?? []).filter((p) => !b || semAcento(`${p.titulo} ${p.detalhe} ${p.por ?? ''}`).includes(b));
  }, [lista, busca]);

  const voltar = async (p: PacoteLixeira) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      if (p.copia) {
        if (!window.confirm('Isto troca o que está no celular agora por esta cópia. O que está agora não se perde: fica guardado numa cópia aqui na Lixeira. Continuar?')) return;
        await voltarCopiaInteira(p.pacote);
        aviso('Pronto, a cópia voltou.');
        nav('/');
        return;
      }
      const junto = await dependencias(p.pacote);
      if (junto.length && !window.confirm(`Para "${p.titulo}" voltar, isto também precisa voltar:\n\n${junto.map((j) => `• ${j.titulo}`).join('\n')}\n\nTrazer tudo de volta?`)) return;
      const r = await restaurar(p.pacote, { papel, ligado });
      setAjustes(r.avisos);
      aviso(r.pacotes > 1 ? `Pronto, voltou: ${p.titulo} e mais ${r.pacotes - 1}.` : `Pronto, voltou: ${p.titulo}.`);
    } catch (e) {
      aviso((e as Error).message, true);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Topo titulo="Lixeira" />
      <main>
        <div className="dica">
          Tudo o que é apagado fica guardado aqui. Toque em <b>Restaurar</b> para trazer de volta, junto com o que foi apagado com ele.
          {ligado && ' A lixeira é a mesma em todos os celulares da equipe.'}
        </div>
        {ajustes.length > 0 && (
          <div className="alerta atencao" role="status">
            <span className="ic" aria-hidden="true">ℹ️</span>
            <div><b>Voltou, com estes ajustes:</b>{ajustes.map((a, i) => <div key={i}>{a}</div>)}</div>
          </div>
        )}
        {(lista?.length ?? 0) > 5 && (
          <CampoTexto rotulo="Procurar na lixeira" valor={busca} aoMudar={(v) => { setBusca(v); setQuantos(POR_VEZ); }} nome="buscaLixeira" placeholder="Ex.: Nelore, pesagem, vacina" />
        )}
        {lista?.length === 0 && (
          <div className="vazio">
            <div className="grande" aria-hidden="true">🗑️</div>
            <p className="mudo">A lixeira está vazia. Se alguma coisa for apagada sem querer, ela aparece aqui e dá para trazer de volta.</p>
          </div>
        )}
        {!!lista?.length && !achados.length && <p className="mudo">Nada na lixeira com “{busca}”.</p>}
        {achados.slice(0, quantos).map((p) => {
          const motivo = motivoNaoRestaura(p.linhas, papel, ligado);
          return (
            <div key={p.pacote} className="cartao item-lixeira" data-testid="item-lixeira">
              <div className="item-lixeira-topo">
                <span className="item-lixeira-ic" aria-hidden="true">{p.icone}</span>
                <span>
                  <b>{p.titulo}</b>
                  <span className="mudo">{p.copia ? 'Guardada' : 'Apagado'} em {quando(p.em)}{p.por ? ` por ${p.por}` : ''}</span>
                  {p.detalhe && <span className="mudo">{p.detalhe}</span>}
                </span>
              </div>
              {motivo ? <p className="mudo" style={{ margin: '10px 0 0' }}>{motivo}</p> : (
                <button className="btn sec pequeno largo" style={{ marginTop: 10 }} disabled={ocupado} onClick={() => voltar(p)}>
                  {p.copia ? 'Voltar esta cópia' : '↩ Restaurar'}
                </button>
              )}
            </div>
          );
        })}
        {achados.length > quantos && (
          <button className="btn sec largo" onClick={() => setQuantos((q) => q + POR_VEZ)}>Mostrar mais ({achados.length - quantos})</button>
        )}
      </main>
    </>
  );
}
