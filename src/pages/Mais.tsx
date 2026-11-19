import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, exportarBackup, importarBackup, lerArquivoBackup, lerConfig, lerConfigFin, TABELAS } from '../db';
import { carregarExemplo } from '../exemplo';
import { CampoNumero, num, Topo, useAviso } from '../components/ui';

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
      const bk = lerArquivoBackup(await f.text());
      if (!window.confirm('Isto vai SUBSTITUIR tudo o que está no celular pelos dados da cópia. Continuar?')) return;
      await importarBackup(bk);
      aviso('Cópia restaurada.');
      nav('/');
    } catch (e) {
      aviso((e as Error).name === 'ErroValidacao' ? (e as Error).message : 'Não consegui ler este arquivo.', true);
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
        <div className="grade" style={{ marginBottom: 12 }}>
          <Link to="/fazenda" className="btn sec">Fazenda</Link>
          <Link to="/nutricao" className="btn sec">Nutrição</Link>
          <Link to="/estoque" className="btn sec">Estoque</Link>
          <Link to="/financeiro" className="btn sec">Dinheiro</Link>
          <Link to="/sanidade" className="btn sec">Sanidade</Link>
          <Link to="/relatorios" className="btn sec">Relatórios</Link>
          <Link to="/simular" className="btn sec">E se…</Link>
          <Link to="/lotes" className="btn sec">Lotes</Link>
        </div>
        <Mercado />
        <ConfigFinanceira />
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
          <p className="mudo">BoiForte versão 0.3. Rebanho e pesagens, nutrição e estoque, financeiro, sanidade, relatórios e simulações. Próxima etapa: nuvem, vários usuários e cotações automáticas.</p>
          <button className="btn perigo pequeno" onClick={apagarTudo}>Apagar todos os dados</button>
        </div>
      </main>
    </>
  );
}

function Mercado() {
  const aviso = useAviso();
  const cfg = useLiveQuery(() => lerConfig());
  const [arroba, setArroba] = useState<string | null>(null);
  const [rend, setRend] = useState<string | null>(null);
  if (!cfg) return null;
  const vA = arroba ?? String(cfg.precoArroba).replace('.', ',');
  const vR = rend ?? String(+(cfg.rendimento * 100).toFixed(2)).replace('.', ',');
  const salvar = async () => {
    const a = num(vA), r = num(vR);
    if (!a || a <= 0) return aviso('Informe o preço da arroba.', true);
    if (!r || r < 40 || r > 65) return aviso('Rendimento de carcaça costuma ficar entre 48% e 56%.', true);
    await db.config.bulkPut([{ chave: 'precoArroba', valor: a }, { chave: 'rendimento', valor: r / 100 }]);
    setArroba(null); setRend(null);
    aviso('Valores de mercado salvos.');
  };
  return (
    <div className="cartao">
      <h3>Mercado</h3>
      <p className="mudo">Usados no custo da @ produzida. A cotação automática chega na Etapa 4.</p>
      <div className="grade">
        <CampoNumero rotulo="Preço da @" valor={vA} aoMudar={setArroba} unidade="R$" nome="precoArroba" />
        <CampoNumero rotulo="Rendimento de carcaça" valor={vR} aoMudar={setRend} unidade="%" nome="rendimento" />
      </div>
      <button className="btn sec pequeno" onClick={salvar}>Salvar</button>
    </div>
  );
}

function ConfigFinanceira() {
  const aviso = useAviso();
  const cfg = useLiveQuery(() => lerConfigFin());
  const [op, setOp] = useState<string | null>(null);
  const [com, setCom] = useState<string | null>(null);
  if (!cfg) return null;
  const vO = op ?? String(+(cfg.oportunidadeMes * 100).toFixed(3)).replace('.', ',');
  const vC = com ?? String(+(cfg.comissaoVenda * 100).toFixed(3)).replace('.', ',');
  const salvar = async () => {
    const o = num(vO), c = num(vC);
    if (o == null || o < 0 || o > 10) return aviso('O custo do dinheiro fica entre 0% e 10% ao mês.', true);
    if (c == null || c < 0 || c > 20) return aviso('A comissão fica entre 0% e 20%.', true);
    await db.config.bulkPut([{ chave: 'oportunidadeMes', valor: o / 100 }, { chave: 'comissaoVenda', valor: c / 100 }]);
    setOp(null); setCom(null);
    aviso('Valores salvos.');
  };
  return (
    <div className="cartao">
      <h3>Dinheiro</h3>
      <p className="mudo">O custo do dinheiro é quanto ele renderia aplicado (entra no resultado dos lotes). A comissão é o padrão das vendas.</p>
      <div className="grade">
        <CampoNumero rotulo="Custo do dinheiro" valor={vO} aoMudar={setOp} unidade="% ao mês" nome="oportunidadeMes" />
        <CampoNumero rotulo="Comissão de venda" valor={vC} aoMudar={setCom} unidade="%" nome="comissaoVenda" />
      </div>
      <button className="btn sec pequeno" onClick={salvar}>Salvar</button>
    </div>
  );
}
