import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, exportarBackup, importarBackup, TABELAS } from '../db';
import { carregarExemplo } from '../exemplo';
import { Topo, useAviso } from '../components/ui';

export function Mais() {
  const aviso = useAviso();
  const nav = useNavigate();
  const arquivo = useRef<HTMLInputElement>(null);
  const [instalar, setInstalar] = useState<any>(null);
  const [instalado, setInstalado] = useState(false);
  const [espaco, setEspaco] = useState<string>('');

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstalar(e); };
    window.addEventListener('beforeinstallprompt', h);
    setInstalado(window.matchMedia?.('(display-mode: standalone)').matches ?? false);
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setEspaco(`${(e.usage / 1024 / 1024).toFixed(1).replace('.', ',')} MB usados`);
    }).catch(() => {});
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const baixar = async () => {
    const bk = await exportarBackup();
    const nome = `boiforte-copia-${bk.geradoEm.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(bk)], { type: 'application/json' });
    const file = new File([blob], nome, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Cópia do BoiForte' }); return; } catch { /* cancelou: baixa */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    aviso('Cópia salva em Downloads.');
  };

  const restaurar = async (f: File) => {
    try {
      const bk = JSON.parse(await f.text());
      if (!window.confirm('Isto vai SUBSTITUIR tudo o que está no celular pelos dados da cópia. Continuar?')) return;
      await importarBackup(bk);
      aviso('Cópia restaurada.');
      nav('/');
    } catch (e) {
      aviso((e as Error).message.includes('BoiForte') ? (e as Error).message : 'Não consegui ler este arquivo.', true);
    }
  };

  const exemplo = async () => {
    await carregarExemplo();
    aviso('Exemplo carregado.');
    nav('/');
  };

  const apagarTudo = async () => {
    if (!window.confirm('Apagar TODOS os dados do BoiForte deste celular? Faça uma cópia antes.')) return;
    await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => { for (const t of TABELAS) await db.table(t).clear(); });
    aviso('Dados apagados.');
    nav('/');
  };

  return (
    <>
      <Topo titulo="Mais" />
      <main>
        {!instalado && (
          <div className="cartao">
            <h3>Instalar no celular</h3>
            <p className="mudo">Coloca o BoiForte na tela inicial e abre sem internet.</p>
            {instalar ? (
              <button className="btn largo" onClick={async () => { instalar.prompt(); await instalar.userChoice; setInstalar(null); }}>Instalar BoiForte</button>
            ) : (
              <p style={{ fontSize: 16 }}>No Android (Chrome): menu <b>⋮</b> → <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.<br />No iPhone (Safari): botão <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>
            )}
          </div>
        )}

        <div className="cartao">
          <h3>Cópia de segurança</h3>
          <p className="mudo">Os dados ficam só neste celular. Faça uma cópia toda semana e mande para o seu WhatsApp ou e-mail. {espaco}</p>
          <div className="botoes">
            <button className="btn" onClick={baixar}>Fazer cópia</button>
            <button className="btn sec" onClick={() => arquivo.current?.click()}>Restaurar cópia</button>
          </div>
          <input ref={arquivo} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) restaurar(f); e.target.value = ''; }} />
        </div>

        <div className="cartao">
          <h3>Conhecer o app</h3>
          <p className="mudo">Carrega uma fazenda de exemplo com dois lotes (um pelo peso médio e outro por brinco), para você ver os gráficos e avisos.</p>
          <button className="btn sec largo" onClick={exemplo}>Carregar exemplo</button>
        </div>

        <details className="cartao">
          <summary>Como usar a voz</summary>
          <p style={{ marginTop: 10 }}>Toque no microfone ao lado de qualquer número e fale, por exemplo: “trezentos e vinte e meio”. Na pesagem por brinco, fale “brinco doze peso trezentos e dezoito”.</p>
          <p className="mudo">Em muitos celulares a voz precisa de internet. Sem sinal, digite: o app salva do mesmo jeito.</p>
        </details>

        <div className="cartao">
          <h3>Sobre</h3>
          <p className="mudo">BoiForte versão 0.1 (Etapa 1: rebanho, pesagens, GMD e projeção). Próximas etapas: nutrição e fornecimento, estoque, financeiro, sanidade e relatórios.</p>
          <button className="btn perigo pequeno" onClick={apagarTudo}>Apagar todos os dados</button>
        </div>
      </main>
    </>
  );
}
