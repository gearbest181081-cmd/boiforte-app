import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, exportarBackup, importarBackup, lerArquivoBackup, lerConfig, lerConfigFin, TABELAS } from '../db';
import { carregarExemplo } from '../exemplo';
import { desligarFazenda, fazendaLigada } from '../nuvem/sinc';
import { useEstadoNuvem, usePapel } from '../nuvem/useNuvem';
import { CampoNumero, mostrarDicaMicDeNovo, num, Topo, useAviso } from '../components/ui';

export function Mais() {
  const aviso = useAviso();
  const nav = useNavigate();
  const arquivo = useRef<HTMLInputElement>(null);
  const [instalar, setInstalar] = useState<any>(null);
  const [instalado, setInstalado] = useState(false);
  const [espaco, setEspaco] = useState<string>('');
  const nuvem = useEstadoNuvem();
  const papel = usePapel();
  const veDinheiro = papel !== 'vaqueiro';

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
      if (await fazendaLigada()) return aviso('Este celular está ligado à nuvem. Desligue em Nuvem e equipe antes de restaurar uma cópia.', true);
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
    if (await fazendaLigada()) return aviso('O exemplo é só para conhecer o app. Desligue da nuvem antes, para ele não ir para a fazenda.', true);
    await carregarExemplo();
    aviso('Exemplo carregado.');
    nav('/');
  };

  const apagarTudo = async () => {
    const ligada = await fazendaLigada();
    if (!window.confirm(ligada ? 'Apagar os dados SÓ deste celular? Na nuvem continuam guardados, e o celular é desligado da fazenda.' : 'Apagar TODOS os dados do BoiForte deste celular? Faça uma cópia antes.')) return;
    await desligarFazenda();
    await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => { for (const t of TABELAS) await db.table(t).clear(); });
    await db.pendentes.clear();
    await db.fotosAnotacao.clear();
    aviso('Dados apagados.');
    nav('/');
  };

  return (
    <>
      <Topo titulo="Mais" />
      <main>
        <Link to="/nuvem" className={`alerta ${nuvem?.fazenda ? (nuvem.pendentes || nuvem.erros.length ? 'atencao' : 'bom') : 'atencao'}`} style={{ textDecoration: 'none' }}>
          <span className="ic">☁️</span>
          <div><b>Nuvem e equipe</b>{nuvem?.fazenda ? (nuvem.pendentes ? `${nuvem.pendentes} alteração(ões) para enviar.` : nuvem.erros.length ? 'Há registros recusados. Toque para ver.' : `Ligado à ${nuvem.fazenda.nome}.`) : 'Guarde os dados fora do celular e trabalhe com a equipe.'}</div>
        </Link>
        <div className="grade" style={{ marginBottom: 12 }}>
          <Link to="/anotacoes" className="btn sec">Anotações e tarefas</Link>
          <Link to="/fazenda" className="btn sec">Fazenda</Link>
          <Link to="/nutricao" className="btn sec">Nutrição</Link>
          <Link to="/estoque" className="btn sec">Estoque</Link>
          {veDinheiro && <Link to="/financeiro" className="btn sec">Dinheiro</Link>}
          {veDinheiro && <Link to="/funcionarios" className="btn sec">Funcionários</Link>}
          <Link to="/sanidade" className="btn sec">Sanidade</Link>
          {veDinheiro && <Link to="/relatorios" className="btn sec">Relatórios</Link>}
          {veDinheiro && <Link to="/simular" className="btn sec">Simulação</Link>}
          <Link to="/cotacoes" className="btn sec">Cotações</Link>
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
          <summary>Como escrever falando</summary>
          <p style={{ marginTop: 10 }}>Todo campo de escrever tem um microfone verde ao lado. Toque nele, espere ficar vermelho e fale. Exemplos:</p>
          <ul style={{ paddingLeft: 20, marginTop: 0 }}>
            <li>Números: “trezentos e vinte e meio”.</li>
            <li>Datas: “hoje”, “ontem”, “15 de março”.</li>
            <li>Listas: fale o nome da opção, como “milho”.</li>
            <li>Pesagem por brinco: “brinco doze peso trezentos e dezoito”.</li>
          </ul>
          <p className="mudo">Em muitos celulares a voz precisa de internet. Sem sinal, digite: o app salva do mesmo jeito.</p>
          <button className="btn sec largo" onClick={() => { mostrarDicaMicDeNovo(); aviso('Pronto. A explicação aparece de novo nas próximas 3 vezes que você tocar no microfone.'); }}>Ver a explicação do microfone de novo</button>
        </details>

        <div className="cartao">
          <h3>Sobre</h3>
          <p className="mudo">BoiForte versão 0.4. Rebanho e pesagens, nutrição e estoque, financeiro, sanidade, relatórios, simulações, nuvem com equipe, cotações, leitura por foto e balança Bluetooth.</p>
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
      <p className="mudo">Usados no custo da @ produzida. Veja a cotação do dia em <Link to="/cotacoes">Cotações</Link>.</p>
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
