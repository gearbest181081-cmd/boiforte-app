import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { NOMES_TABELA } from '../nuvem/nomes';
import {
  aceitarConvite, apagarMinhaConta, confirmarCodigo, criarConvite, criarFazenda, equipe, minhasFazendas, mudarPapel, nuvemConfigurada, pedirCodigo,
  removerMembro, sair, usuarioAtual, type Membro, type MinhaFazenda,
} from '../nuvem/cliente';
import { PAPEIS, type Papel } from '../nuvem/esquema';
import { desligarFazenda, ligarFazenda, temDadosLocais, tentarDeNovo } from '../nuvem/sinc';
import { sincronizarAgora, useEstadoNuvem } from '../nuvem/useNuvem';
import { linkWhatsApp } from '../exportar';
import { CampoTexto, Topo, useAviso } from '../components/ui';

export function Nuvem() {
  const [usuario, setUsuario] = useState<{ id: string; email: string } | null | undefined>(undefined);
  const est = useEstadoNuvem();
  const recarregar = useCallback(() => { usuarioAtual().then(setUsuario).catch(() => setUsuario(null)); }, []);
  useEffect(recarregar, [recarregar]);

  let corpo;
  if (!nuvemConfigurada()) {
    corpo = (
      <div className="cartao">
        <h3>Nuvem ainda não ligada</h3>
        <p className="mudo">Esta versão do app ainda não está ligada a um servidor. Tudo continua funcionando no celular, sem internet.</p>
      </div>
    );
  } else if (usuario === undefined || !est) corpo = null;
  else if (!usuario) corpo = <Entrar aoEntrar={recarregar} />;
  else if (!est.fazenda) corpo = <Escolher email={usuario.email} aoSair={recarregar} />;
  else corpo = <Ligado aoSair={recarregar} />;

  return (
    <>
      <Topo titulo="Nuvem e equipe" voltar />
      <main>
        <p className="mudo">Com a nuvem, os dados ficam guardados fora do celular e a equipe (gerente, vaqueiro, consultor) lança e vê tudo junto. Sem sinal, o app continua funcionando e manda depois.</p>
        {corpo}
      </main>
    </>
  );
}

function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const aviso = useAviso();
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const pedir = async () => {
    setOcupado(true);
    try { await pedirCodigo(email); setEnviado(true); aviso('Código enviado. Olhe seu e-mail.'); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const confirmar = async () => {
    setOcupado(true);
    try { await confirmarCodigo(email, codigo); aoEntrar(); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  return (
    <div className="cartao">
      <h3>Entrar</h3>
      <p className="mudo">Sem senha: mandamos um código de 6 números para o seu e-mail.</p>
      <label className="campo"><span>Seu e-mail</span><input name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={enviado} /></label>
      {!enviado ? <button className="btn largo" disabled={ocupado} onClick={pedir}>Mandar código</button> : (
        <>
          <label className="campo"><span>Código que chegou no e-mail</span><input name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="botoes">
            <button className="btn" disabled={ocupado} onClick={confirmar}>Entrar</button>
            <button className="btn sec" onClick={() => { setEnviado(false); setCodigo(''); }}>Trocar e-mail</button>
          </div>
        </>
      )}
    </div>
  );
}

function Escolher({ email, aoSair }: { email: string; aoSair: () => void }) {
  const aviso = useAviso();
  const [lista, setLista] = useState<MinhaFazenda[] | null>(null);
  const [nome, setNome] = useState(() => { try { return localStorage.getItem('boiforte-meu-nome') ?? ''; } catch { return ''; } });
  const [cod, setCod] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const props = useLiveQuery(() => db.propriedades.toArray());
  const [nomeFaz, setNomeFaz] = useState('');
  useEffect(() => { minhasFazendas().then(setLista).catch((e) => { setLista([]); aviso((e as Error).message, true); }); }, [aviso]);
  const guardarNome = () => { try { localStorage.setItem('boiforte-meu-nome', nome.trim()); } catch { /* sem armazenamento */ } };

  const usar = async (f: MinhaFazenda) => {
    if (await temDadosLocais() && !window.confirm(`Os dados que estão neste celular serão APAGADOS e trocados pelos da fazenda "${f.nome}" na nuvem. Faça uma cópia antes se precisar. Continuar?`)) return;
    setOcupado(true);
    try { await ligarFazenda({ id: f.fazenda_id, nome: f.nome, papel: f.papel }, 'baixar'); await sincronizarAgora(); aviso('Pronto: dados da fazenda baixados.'); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const criar = async () => {
    const n = (nomeFaz || props?.[0]?.nome || '').trim();
    if (!n) return aviso('Dê um nome para a fazenda.', true);
    setOcupado(true);
    try {
      guardarNome();
      const id = await criarFazenda(n, nome.trim());
      await ligarFazenda({ id, nome: n, papel: 'dono' }, 'enviar');
      const r = await sincronizarAgora();
      aviso(r && r.erros.length ? `Fazenda criada. ${r.erros.length} registro(s) não subiram: veja abaixo.` : 'Fazenda criada e dados enviados.');
    } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const entrarComCodigo = async () => {
    if (!cod.trim()) return aviso('Digite o código do convite.', true);
    if (await temDadosLocais() && !window.confirm('Os dados que estão neste celular serão APAGADOS e trocados pelos da fazenda do convite. Continuar?')) return;
    setOcupado(true);
    try {
      guardarNome();
      const id = await aceitarConvite(cod, nome.trim());
      const f = (await minhasFazendas()).find((x) => x.fazenda_id === id)!;
      await ligarFazenda({ id, nome: f.nome, papel: f.papel }, 'baixar');
      await sincronizarAgora();
      aviso(`Você entrou na fazenda ${f.nome} como ${PAPEIS[f.papel].nome.toLowerCase()}.`);
    } catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };

  return (
    <>
      <div className="cartao">
        <p style={{ margin: 0 }}>Entrou como <b>{email}</b></p>
        <CampoTexto rotulo="Seu nome (para a equipe)" valor={nome} aoMudar={setNome} nome="meuNome" />
      </div>
      {lista && lista.length > 0 && (
        <>
          <h2>Suas fazendas na nuvem</h2>
          {lista.map((f) => (
            <div key={f.fazenda_id} className="cartao linha-lote">
              <span>{f.nome}<div className="mudo">{PAPEIS[f.papel].nome}</div></span>
              <button className="btn pequeno" disabled={ocupado} onClick={() => usar(f)}>Usar neste celular</button>
            </div>
          ))}
        </>
      )}
      <h2>Recebeu um convite?</h2>
      <div className="cartao">
        <label className="campo"><span>Código do convite</span><input name="convite" autoCapitalize="characters" maxLength={14} value={cod} onChange={(e) => setCod(e.target.value.toUpperCase())} /></label>
        <button className="btn largo" disabled={ocupado} onClick={entrarComCodigo}>Entrar na equipe</button>
      </div>
      <h2>Ou crie a sua</h2>
      <div className="cartao">
        <p className="mudo">Os dados que já estão neste celular sobem para a nuvem e você vira o dono.</p>
        <CampoTexto rotulo="Nome da fazenda" valor={nomeFaz || props?.[0]?.nome || ''} aoMudar={setNomeFaz} nome="nomeFazendaNuvem" />
        <button className="btn largo" disabled={ocupado} onClick={criar}>Criar fazenda na nuvem</button>
      </div>
      <button className="btn sec largo" onClick={async () => { await sair(); aoSair(); }}>Sair da conta</button>
      <ApagarConta aoSair={aoSair} />
    </>
  );
}

function Ligado({ aoSair }: { aoSair: () => void }) {
  const nav = useNavigate();
  const aviso = useAviso();
  const est = useEstadoNuvem();
  const [ocupado, setOcupado] = useState(false);
  if (!est?.fazenda) return null;
  const f = est.fazenda;
  const agora = async () => {
    setOcupado(true);
    try { const r = await sincronizarAgora(); aviso(r ? `Enviados ${r.enviados}, recebidos ${r.recebidos}.` : 'Entre na conta para sincronizar.'); }
    catch (e) { aviso((e as Error).message, true); } finally { setOcupado(false); }
  };
  const desligar = async () => {
    if (!window.confirm(est.pendentes ? `Ainda há ${est.pendentes} alteração(ões) que não subiram e serão perdidas na nuvem. Desligar mesmo assim?` : 'Desligar este celular da nuvem? Os dados continuam no celular.')) return;
    await desligarFazenda();
    aoSair();
  };
  const tudoSalvo = est.pendentes === 0 && est.erros.length === 0;
  return (
    <>
      <div className={`alerta ${est.falha ? 'atencao' : tudoSalvo ? 'bom' : 'atencao'}`} data-testid="statusNuvem">
        <span className="ic">{tudoSalvo && !est.falha ? '☁️' : '⏳'}</span>
        <div>
          <b>{f.nome} · {PAPEIS[f.papel].nome}</b>
          {est.rodando ? 'Sincronizando…' : tudoSalvo ? 'Tudo salvo na nuvem.' : est.pendentes ? `${est.pendentes} alteração(ões) esperando internet.` : ''}
          {est.ultima ? ` Última vez: ${new Date(est.ultima).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}
          {est.falha ? ` ${est.falha}` : ''}
        </div>
      </div>
      <button className="btn largo" disabled={ocupado} onClick={agora}>Sincronizar agora</button>
      {est.erros.length > 0 && (
        <div className="cartao">
          <h3>O servidor recusou {est.erros.length} registro(s)</h3>
          {est.erros.slice(0, 8).map((e, i) => <p key={i} className="mudo" style={{ margin: '4px 0' }}>{NOMES_TABELA[e.tabela] ?? e.tabela}: {e.erro}</p>)}
          <button className="btn sec pequeno" onClick={async () => { await tentarDeNovo(); agora(); }}>Tentar de novo</button>
        </div>
      )}
      <Equipe fazendaId={f.id} souDono={f.papel === 'dono'} />
      <button className="btn largo" style={{ marginTop: 16 }} onClick={() => nav('/', { replace: true })}>Concluir e voltar ao início</button>
      <div className="botoes" style={{ marginTop: 16 }}>
        <button className="btn sec" onClick={desligar}>Desligar este celular</button>
        <button className="btn sec" onClick={async () => { await sair(); aoSair(); }}>Sair da conta</button>
      </div>
      <ApagarConta aoSair={aoSair} />
    </>
  );
}

function ApagarConta({ aoSair }: { aoSair: () => void }) {
  const aviso = useAviso();
  const apagar = async () => {
    const t = window.prompt('Isto apaga sua conta e as fazendas na nuvem que são só suas. Os dados deste celular continuam aqui. Para confirmar, escreva APAGAR');
    if (t == null) return;
    if (t.trim().toUpperCase() !== 'APAGAR') return aviso('Não apaguei: escreva APAGAR para confirmar.', true);
    try { await apagarMinhaConta(); await desligarFazenda(); aviso('Conta apagada.'); aoSair(); } catch (e) { aviso((e as Error).message, true); }
  };
  return <p style={{ marginTop: 24, textAlign: 'center' }}><button className="btn perigo pequeno" onClick={apagar}>Apagar minha conta</button></p>;
}

function Equipe({ fazendaId, souDono }: { fazendaId: string; souDono: boolean }) {
  const aviso = useAviso();
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [papel, setPapel] = useState<Papel>('vaqueiro');
  const [codigo, setCodigo] = useState<string | null>(null);
  const carregar = useCallback(() => { equipe(fazendaId).then(setLista).catch(() => setLista(null)); }, [fazendaId]);
  useEffect(carregar, [carregar]);
  const convidar = async () => {
    try { setCodigo(await criarConvite(fazendaId, papel)); } catch (e) { aviso((e as Error).message, true); }
  };
  const mudar = async (m: Membro, p: Papel) => {
    try { await mudarPapel(fazendaId, m.usuario_id, p); carregar(); } catch (e) { aviso((e as Error).message, true); }
  };
  const tirar = async (m: Membro) => {
    if (!window.confirm(`Tirar ${m.nome || 'esta pessoa'} da equipe? Ela deixa de ver e lançar os dados da fazenda.`)) return;
    try { await removerMembro(fazendaId, m.usuario_id); carregar(); } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <>
      <h2>Equipe</h2>
      {lista === null && <p className="mudo">A equipe aparece quando houver internet.</p>}
      {lista?.map((m) => (
        <div key={m.usuario_id} className="cartao">
          <div className="linha-lote"><b>{m.nome || 'Sem nome'}{m.eu ? ' (você)' : ''}</b><span className="etiqueta">{PAPEIS[m.papel].nome}</span></div>
          {souDono && !m.eu && (
            <div className="botoes" style={{ margin: '8px 0 0' }}>
              <select aria-label={`Papel de ${m.nome}`} value={m.papel} onChange={(e) => mudar(m, e.target.value as Papel)}>
                {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
              </select>
              <button className="btn perigo pequeno" onClick={() => tirar(m)}>Tirar</button>
            </div>
          )}
        </div>
      ))}
      {souDono && (
        <div className="cartao">
          <h3>Chamar alguém</h3>
          <label className="campo"><span>Papel</span>
            <select name="papelConvite" value={papel} onChange={(e) => { setPapel(e.target.value as Papel); setCodigo(null); }}>
              {(['gerente', 'vaqueiro', 'consultor'] as Papel[]).map((p) => <option key={p} value={p}>{PAPEIS[p].nome}</option>)}
            </select>
          </label>
          <p className="mudo">{PAPEIS[papel].texto}</p>
          {!codigo ? <button className="btn largo" onClick={convidar}>Gerar código de convite</button> : (
            <>
              <p style={{ fontSize: 30, letterSpacing: 4, textAlign: 'center', fontWeight: 700, margin: '8px 0' }} data-testid="codigoConvite">{codigo}</p>
              <p className="mudo">Vale por 7 dias e para uma pessoa só. Ela instala o BoiForte, entra com o e-mail e digita o código em Mais › Nuvem e equipe.</p>
              <a className="btn largo" target="_blank" rel="noopener noreferrer" href={linkWhatsApp(`Convite para a equipe da fazenda no BoiForte (${PAPEIS[papel].nome.toLowerCase()}). Código: ${codigo}\nAbra o app, vá em Mais > Nuvem e equipe e digite o código.`)}>Mandar no WhatsApp</a>
            </>
          )}
        </div>
      )}
    </>
  );
}
