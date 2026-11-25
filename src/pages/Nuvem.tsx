import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db';
import { NOMES_TABELA } from '../nuvem/nomes';
import {
  aceitarConvite, apagarMinhaConta, cancelarConvite, convitesPendentes, criarConvite, criarFazenda, equipe, minhasFazendas, mudarPapel, nuvemConfigurada,
  NOME_PLANO, planoDaFazenda, PRECO_PESSOA_EXTRA, removerMembro, sair, type ConvitePendente, type Membro, type MinhaFazenda, type PlanoFazenda,
} from '../nuvem/cliente';
import { mensagemConvite, PAPEIS, type Papel } from '../nuvem/esquema';
import { Permissoes } from '../components/Permissoes';
import { desligarFazenda, ligarFazenda, temDadosLocais, tentarDeNovo } from '../nuvem/sinc';
import { sincronizarAgora, useEstadoNuvem } from '../nuvem/useNuvem';
import { linkWhatsApp } from '../exportar';
import { CampoEscolha, CampoTexto, Topo, useAviso } from '../components/ui';
import { Entrar } from '../components/Entrar';
import { marcarDono, useSessao } from '../nuvem/sessao';

export function Nuvem() {
  // Quem entrou vem da sessão guardada no celular (a tela de entrada do app já pediu o e-mail).
  const { conta: usuario } = useSessao();
  const est = useEstadoNuvem();
  const recarregar = useCallback(() => {}, []);

  let corpo;
  if (!nuvemConfigurada()) {
    corpo = (
      <div className="cartao">
        <h3>Nuvem ainda não ligada</h3>
        <p className="mudo">Esta versão do app ainda não está ligada a um servidor. Tudo continua funcionando no celular, sem internet.</p>
      </div>
    );
  } else if (!est) corpo = null;
  else if (!usuario) corpo = <Entrar />;
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
              <span>{f.nome}<div className="mudo">{PAPEIS[f.papel].nome}{f.bloqueado ? ' · pausado: a equipe passou do limite do plano. Fale com o dono.' : ''}</div></span>
              <button className="btn pequeno" disabled={ocupado || f.bloqueado} onClick={() => usar(f)}>Usar neste celular</button>
            </div>
          ))}
        </>
      )}
      <h2>Recebeu um convite?</h2>
      <div className="cartao">
        <CampoTexto rotulo="Código do convite" nome="convite" formato="codigo" maxLength={14} valor={cod} aoMudar={(v) => setCod(v.toUpperCase())} />
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
      <Equipe fazendaId={f.id} nomeFazenda={f.nome} souDono={f.papel === 'dono'} />
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
    try { await apagarMinhaConta(); await desligarFazenda(); marcarDono(null); aviso('Conta apagada.'); aoSair(); } catch (e) { aviso((e as Error).message, true); }
  };
  return <p style={{ marginTop: 24, textAlign: 'center' }}><button className="btn perigo pequeno" onClick={apagar}>Apagar minha conta</button></p>;
}

function Equipe({ fazendaId, nomeFazenda, souDono }: { fazendaId: string; nomeFazenda: string; souDono: boolean }) {
  const aviso = useAviso();
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [papel, setPapel] = useState<Papel>('vaqueiro');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [mandou, setMandou] = useState(false);
  const [pendentes, setPendentes] = useState<ConvitePendente[]>([]);
  const [plano, setPlano] = useState<PlanoFazenda | null>(null);
  const carregar = useCallback(() => {
    planoDaFazenda(fazendaId).then(setPlano).catch(() => setPlano(null));
    equipe(fazendaId).then(setLista).catch(() => setLista(null));
    if (souDono) convitesPendentes(fazendaId).then(setPendentes).catch(() => setPendentes([]));
  }, [fazendaId, souDono]);
  useEffect(carregar, [carregar]);
  const convidar = async () => {
    try { setCodigo(await criarConvite(fazendaId, papel)); setMandou(false); carregar(); } catch (e) { aviso((e as Error).message, true); }
  };
  const outro = () => { setCodigo(null); setMandou(false); };
  const cancelar = async (c: ConvitePendente) => {
    if (!window.confirm(`Cancelar o convite ${c.codigo}? Quem tiver o código não vai conseguir entrar.`)) return;
    try {
      await cancelarConvite(fazendaId, c.codigo);
      if (codigo === c.codigo) outro();
      aviso('Convite cancelado.');
      carregar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  const vagas = plano ? Math.max(0, plano.limite - plano.pessoas - plano.convites_abertos) : null;
  const semVaga = vagas === 0;
  const mudar = async (m: Membro, p: Papel) => {
    if (p === m.papel) return;
    if (p === 'dono' && !window.confirm(`Dar a ${m.nome || 'esta pessoa'} o papel de DONO? Ela vai poder chamar e tirar pessoas da equipe, inclusive mudar o que cada um faz.`)) return;
    try { await mudarPapel(fazendaId, m.usuario_id, p); carregar(); aviso(`Pronto: agora ${m.nome || 'ela'} é ${PAPEIS[p].nome.toLowerCase()}.`); } catch (e) { aviso((e as Error).message, true); }
  };
  const tirar = async (m: Membro) => {
    if (!window.confirm(`Tirar ${m.nome || 'esta pessoa'} da equipe? Ela deixa de ver e lançar os dados da fazenda.`)) return;
    try { await removerMembro(fazendaId, m.usuario_id); carregar(); } catch (e) { aviso((e as Error).message, true); }
  };
  const msg = codigo ? mensagemConvite(papel, codigo, nomeFazenda) : '';
  return (
    <>
      <h2>Equipe</h2>
      {plano && (
        <p className="mudo" data-testid="planoEquipe">
          Plano {NOME_PLANO[plano.plano] ?? plano.plano}: {plano.pessoas} de {plano.limite} pessoas
          {souDono && plano.convites_abertos > 0 ? ` (e ${plano.convites_abertos} convite(s) esperando a pessoa entrar)` : ''}.
          {souDono && vagas != null ? (vagas === 1 ? ' Sobra 1 vaga.' : vagas > 1 ? ` Sobram ${vagas} vagas.` : ' Não sobra vaga.') : ''}
          {plano.plano === 'pro' && plano.fotos_limite != null ? ` Leitura por foto: ${plano.fotos_usadas ?? 0} de ${plano.fotos_limite} neste mês.` : plano.plano === 'basico' ? ' A leitura por foto é do plano Pro.' : ''}
        </p>
      )}
      {plano?.eu_pausado && (
        <div className="alerta atencao"><span className="ic">⏸️</span><div><b>Seu acesso está pausado.</b> A equipe passou do limite do plano da fazenda. Peça ao dono para liberar uma vaga ou aumentar o plano. Os dados deste celular continuam aqui.</div></div>
      )}

      {souDono && (
        <div className="cartao" data-testid="liberarAcesso">
          <h3>Liberar acesso para um funcionário</h3>
          <p className="mudo" style={{ marginTop: 0 }}>São 3 passos. O funcionário usa o celular dele, com o e-mail dele, e só vê o que você liberar.</p>
          <ol className="passos">
            <li className={codigo ? 'feito' : ''}>
              <b>O que ele vai poder fazer?</b>
              <CampoEscolha rotulo="Papel do funcionário" nome="papelConvite" valor={papel} aoMudar={(v) => { setPapel(v as Papel); outro(); }}>
                {(['vaqueiro', 'gerente', 'consultor'] as Papel[]).map((p) => <option key={p} value={p}>{PAPEIS[p].nome}</option>)}
              </CampoEscolha>
              <Permissoes papel={papel} />
            </li>
            <li className={codigo ? 'feito' : ''}>
              <b>Gere o código de entrada</b>
              {!codigo && semVaga ? (
                <div className="alerta atencao" data-testid="semVaga"><span className="ic">👥</span><div><b>Sem vaga na equipe.</b> O plano {NOME_PLANO[plano!.plano]} permite {plano!.limite} pessoas, contando você e os convites esperando. Cancele um convite, tire alguém da lista abaixo ou aumente o plano (cada pessoa a mais custa {PRECO_PESSOA_EXTRA} por mês).</div></div>
              ) : !codigo ? (
                <button className="btn largo" onClick={convidar}>Gerar código para {PAPEIS[papel].nome.toLowerCase()}</button>
              ) : (
                <>
                  <p className="codigo-convite" data-testid="codigoConvite">{codigo}</p>
                  <p className="mudo" style={{ margin: 0 }}>Código de {PAPEIS[papel].nome.toLowerCase()}. Vale por 7 dias e para uma pessoa só.</p>
                </>
              )}
            </li>
            <li className={mandou ? 'feito' : codigo ? '' : 'espera'}>
              <b>Mande o código para ele</b>
              {codigo ? (
                <>
                  <a className="btn largo" target="_blank" rel="noopener noreferrer" href={linkWhatsApp(msg)} onClick={() => setMandou(true)}>Mandar no WhatsApp</a>
                  <p className="mudo">A mensagem já vai com o passo a passo. Ele abre o BoiForte, entra com o e-mail dele, toca em <b>Menu › Nuvem e equipe</b> e digita o código. Quando ele entrar, o nome dele aparece em "Quem está na equipe" e o acesso já está liberado.</p>
                  <button className="btn sec pequeno" onClick={outro}>Chamar outra pessoa</button>
                </>
              ) : <p className="mudo" style={{ margin: 0 }}>Depois de gerar o código, mande pelo WhatsApp ou leia para ele.</p>}
            </li>
          </ol>
        </div>
      )}

      {souDono && pendentes.length > 0 && (
        <div className="cartao" data-testid="convitesPendentes">
          <h3>Esperando entrar</h3>
          <p className="mudo" style={{ marginTop: 0 }}>Códigos que você gerou e ninguém usou ainda. Cada um ocupa uma vaga até ser usado, cancelado ou vencer.</p>
          {pendentes.map((c) => (
            <div key={c.codigo} className="linha-lote" style={{ margin: '6px 0' }}>
              <span><b style={{ letterSpacing: 2, whiteSpace: 'nowrap' }}>{c.codigo}</b><div className="mudo">{PAPEIS[c.papel].nome} · vale até {new Date(c.expira_em).toLocaleDateString('pt-BR')}</div></span>
              <span className="botoes" style={{ margin: 0, flexWrap: 'nowrap' }}>
                <a className="btn sec pequeno" target="_blank" rel="noopener noreferrer" href={linkWhatsApp(mensagemConvite(c.papel, c.codigo, nomeFazenda))}>Reenviar</a>
                <button className="btn perigo pequeno" onClick={() => cancelar(c)}>Cancelar</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <h3>Quem está na equipe</h3>
      {lista === null && !plano?.eu_pausado && <p className="mudo">A equipe aparece quando houver internet.</p>}
      {lista?.map((m) => (
        <div key={m.usuario_id} className="cartao">
          <div className="linha-lote"><b>{m.nome || 'Sem nome'}{m.eu ? ' (você)' : ''}</b><span className={`etiqueta${m.bloqueado ? ' atencao' : ''}`}>{PAPEIS[m.papel].nome}{m.bloqueado ? ' · pausado' : ''}</span></div>
          <p className="mudo" style={{ margin: '4px 0 0' }}>{PAPEIS[m.papel].texto}</p>
          {m.bloqueado && <p className="mudo" style={{ margin: '4px 0 0' }}>Pausado: a equipe passou do limite do plano. Tire alguém ou aumente o plano para liberar.</p>}
          {souDono && !m.eu && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontWeight: 700, cursor: 'pointer', minHeight: 32 }}>Mudar o que pode fazer ou tirar da equipe</summary>
              <CampoEscolha rotulo={`Papel de ${m.nome || 'sem nome'}`} nome={`papel-${m.usuario_id}`} valor={m.papel} aoMudar={(v) => mudar(m, v as Papel)}>
                {(['vaqueiro', 'gerente', 'consultor', 'dono'] as Papel[]).map((k) => <option key={k} value={k}>{PAPEIS[k].nome}</option>)}
              </CampoEscolha>
              <Permissoes papel={m.papel} />
              <button className="btn perigo pequeno" onClick={() => tirar(m)}>Tirar da equipe</button>
            </details>
          )}
        </div>
      ))}
      {souDono && lista && lista.length > 0 && (
        <p className="mudo">Para guardar o salário e o telefone de quem trabalha na fazenda, use <Link to="/funcionarios">Menu › Funcionários e salários</Link>.</p>
      )}
    </>
  );
}
