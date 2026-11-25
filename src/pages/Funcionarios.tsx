// Funcionários da fazenda: quem trabalha, a função e o salário (que entra no custo da fazenda e da @ produzida).
// Cada funcionário pode, se quiser, usar o app: aqui o dono chama para a equipe da nuvem e escolhe o papel.
// Lembrete de segurança: esconder botões aqui é só para a tela ficar simples. Quem decide quem vê e grava
// é o servidor (o vaqueiro nem recebe esta tabela; ver supabase/migrations/20261123160000_funcionarios.sql).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, excluirRegistro, type Funcionario } from '../db';
import { custoMensalFuncionario, folhaAtiva } from '../financeiro';
import { fmtData, hojeISO } from '../calc';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, num, Topo, useAviso } from '../components/ui';
import { useApagar, VAI_PARA_LIXEIRA } from '../components/Apagar';
import { rs } from './Nutricao';
import { criarConvite, equipe, mudarPapel, NOME_PLANO, planoDaFazenda, PRECO_PESSOA_EXTRA, removerMembro, type Membro, type PlanoFazenda } from '../nuvem/cliente';
import { mensagemConvite, PAPEIS, type Papel } from '../nuvem/esquema';
import { Permissoes } from '../components/Permissoes';
import { useEstadoNuvem, usePapel } from '../nuvem/useNuvem';
import { useSessao } from '../nuvem/sessao';
import { linkWhatsApp } from '../exportar';

export const FUNCOES = ['Vaqueiro', 'Gerente', 'Tratorista', 'Campeiro', 'Retireiro', 'Serviços gerais', 'Cozinheira'];
/** 13º (1/12) + férias com 1/3 (1/12 × 4/3), por mês, sobre o salário. */
export const PCT_13_FERIAS = 1 / 12 + (1 / 12) * (4 / 3);

const ativo = (f: Funcionario, hoje: string) => !f.saida || f.saida >= hoje;

/** Equipe da nuvem (precisa de internet). null = ainda carregando ou sem sinal. */
function useEquipe(fazendaId?: string) {
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [plano, setPlano] = useState<PlanoFazenda | null>(null);
  const [falhou, setFalhou] = useState(false);
  const carregar = useCallback(() => {
    if (!fazendaId) return;
    equipe(fazendaId).then((l) => { setLista(l); setFalhou(false); }).catch(() => { setLista(null); setFalhou(true); });
    planoDaFazenda(fazendaId).then(setPlano).catch(() => setPlano(null));
  }, [fazendaId]);
  useEffect(carregar, [carregar]);
  return { lista, plano, falhou, carregar };
}

export function Funcionarios() {
  const papel = usePapel();
  const funcs = useLiveQuery(() => db.funcionarios.toArray());
  const est = useEstadoNuvem();
  const { lista } = useEquipe(est?.fazenda?.id);
  const hoje = hojeISO();
  const podeMudar = papel === null || papel === 'dono' || papel === 'gerente';
  if (papel === 'vaqueiro') {
    return (
      <>
        <Topo titulo="Funcionários" />
        <main><div className="dica">Só o dono, o gerente e o consultor veem os funcionários e os salários.</div></main>
      </>
    );
  }
  const ordenados = [...(funcs ?? [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const ativos = ordenados.filter((f) => ativo(f, hoje));
  const sairam = ordenados.filter((f) => !ativo(f, hoje));
  const total = folhaAtiva(funcs ?? [], hoje);
  const membro = (f: Funcionario) => (f.usuarioId ? lista?.find((m) => m.usuario_id === f.usuarioId) : undefined);
  return (
    <>
      <Topo titulo="Funcionários" />
      <main>
        <div className="dica">Cadastre quem trabalha na fazenda. O salário entra sozinho no custo da fazenda e no custo da @ produzida, dividido entre os lotes pelas cabeças, dia a dia. Não lance o salário de novo em Dinheiro.</div>
        {funcs && funcs.length > 0 && (
          <p data-testid="folhaTotal"><b>Folha deste mês: {rs(total)}</b> <span className="mudo">({ativos.length} {ativos.length === 1 ? 'pessoa' : 'pessoas'}, com encargos)</span></p>
        )}
        {ativos.map((f) => <CartaoFuncionario key={f.id} f={f} membro={membro(f)} nuvem={!!est?.fazenda} />)}
        {podeMudar && <Link to="/funcionarios/novo" className="btn largo" style={{ margin: '12px 0' }}>+ Cadastrar funcionário</Link>}
        {sairam.length > 0 && (
          <>
            <h2>Já saíram</h2>
            {sairam.map((f) => <CartaoFuncionario key={f.id} f={f} membro={membro(f)} nuvem={!!est?.fazenda} />)}
          </>
        )}
      </main>
    </>
  );
}

function CartaoFuncionario({ f, membro, nuvem }: { f: Funcionario; membro?: Membro; nuvem: boolean }) {
  const acesso = !nuvem ? null : f.usuarioId ? (membro ? `Usa o app: ${PAPEIS[membro.papel].nome}${membro.bloqueado ? ' (pausado)' : ''}` : 'Usa o app') : 'Não usa o app';
  return (
    <Link to={`/funcionarios/${f.id}`} className="cartao linha-lote" style={{ textDecoration: 'none', color: 'inherit', display: 'flex' }} data-testid="cartaoFuncionario">
      <div>
        <b>{f.nome}</b>
        <div className="mudo">{f.funcao} · {f.saida ? `de ${fmtData(f.admissao)} até ${fmtData(f.saida)}` : `desde ${fmtData(f.admissao)}`}</div>
        {acesso && <div className="mudo">{acesso}</div>}
      </div>
      <div style={{ textAlign: 'right' }}><b>{rs(custoMensalFuncionario(f))}</b><div className="mudo">por mês</div></div>
    </Link>
  );
}

export function FuncionarioForm() {
  const { id } = useParams();
  const novo = id === 'novo';
  const f = useLiveQuery(async (): Promise<Funcionario | null> => (novo ? null : (await db.funcionarios.get(Number(id))) ?? null), [id]);
  if (!novo && f === undefined) return null;
  return <Formulario key={id} f={f ?? null} />;
}

function Formulario({ f }: { f: Funcionario | null }) {
  const aviso = useAviso();
  const apagarComDesfazer = useApagar();
  const nav = useNavigate();
  const papel = usePapel();
  const { conta } = useSessao();
  const est = useEstadoNuvem();
  const fazendaId = est?.fazenda?.id;
  const souDono = papel === null || papel === 'dono';
  // Ninguém (além do dono) muda o próprio cadastro: o servidor recusa, então a tela já avisa.
  const meuCadastro = !!f?.usuarioId && f.usuarioId === conta?.id;
  const podeMudar = (papel === null || papel === 'dono' || papel === 'gerente') && !(meuCadastro && !souDono);

  const [nome, setNome] = useState(f?.nome ?? '');
  const [funcao, setFuncao] = useState(f?.funcao ?? '');
  const [salario, setSalario] = useState(f ? String(f.salario).replace('.', ',') : '');
  const [encargos, setEncargos] = useState(f?.encargos != null ? String(f.encargos).replace('.', ',') : '');
  const [admissao, setAdmissao] = useState(f?.admissao ?? hojeISO());
  const [saida, setSaida] = useState(f?.saida ?? '');
  const [telefone, setTelefone] = useState(f?.telefone ?? '');
  const [obs, setObs] = useState(f?.obs ?? '');
  const [usuarioId, setUsuarioId] = useState<string>(f?.usuarioId ?? '');

  const custo = (num(salario) ?? 0) + (num(encargos) ?? 0);
  const calc13 = () => {
    const s = num(salario);
    if (!s) return aviso('Informe o salário primeiro.', true);
    setEncargos(String(Math.round(s * PCT_13_FERIAS * 100) / 100).replace('.', ','));
  };

  // Volta para a lista sem deixar o formulário no histórico (o "voltar" da lista leva para onde a pessoa estava).
  const voltarLista = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/funcionarios', { replace: true }));

  const salvar = async () => {
    const s = num(salario), e = encargos.trim() ? num(encargos) : 0;
    if (!nome.trim()) return aviso('Informe o nome.', true);
    if (!funcao.trim()) return aviso('Informe a função. Ex.: vaqueiro.', true);
    if (s == null || s < 0) return aviso('Informe o salário por mês.', true);
    if (e == null || e < 0) return aviso('Confira os outros gastos por mês.', true);
    if (saida && saida < admissao) return aviso('A saída não pode ser antes da entrada.', true);
    const dados = {
      nome: nome.trim(), funcao: funcao.trim(), salario: s, encargos: e || undefined, admissao, saida: saida || null,
      telefone: telefone.trim() || undefined, obs: obs.trim() || undefined, usuarioId: usuarioId || null,
    };
    try {
      if (f) await db.funcionarios.update(f.id!, dados);
      else await db.funcionarios.add({ ...dados, criadoEm: Date.now() });
      aviso(f ? 'Funcionário salvo.' : 'Funcionário cadastrado. O salário já entra nos custos.');
      voltarLista();
    } catch (err) { aviso((err as Error).message, true); }
  };

  const apagar = async () => {
    if (!f || !window.confirm(`Apagar o cadastro de ${f.nome}? O salário dele sai das contas (inclusive dos meses passados). Se ele só saiu da fazenda, use "Saiu da fazenda". ${VAI_PARA_LIXEIRA}`)) return;
    if (await apagarComDesfazer(() => excluirRegistro('funcionarios', f.id!), `Cadastro de ${f.nome} apagado.`)) voltarLista();
  };

  return (
    <>
      <Topo titulo={f ? f.nome : 'Novo funcionário'} />
      <main>
        {meuCadastro && !souDono && <div className="dica">Este é o seu cadastro. Só o dono da fazenda muda o seu salário e a sua função.</div>}
        {papel === 'consultor' && <div className="dica">Consultor só olha: quem muda os funcionários é o dono ou o gerente.</div>}
        <fieldset disabled={!podeMudar} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="cartao">
            <CampoTexto rotulo="Nome" valor={nome} aoMudar={setNome} nome="funcNome" />
            <CampoTexto rotulo="Função" valor={funcao} aoMudar={setFuncao} nome="funcFuncao" />
            <div className="botoes" style={{ flexWrap: 'wrap', marginTop: 0 }}>
              {FUNCOES.map((x) => (
                <button key={x} type="button" className={`btn pequeno ${funcao === x ? '' : 'sec'}`} onClick={() => setFuncao(x)}>{x}</button>
              ))}
            </div>
          </div>
          <div className="cartao">
            <h3>Quanto custa por mês</h3>
            <CampoNumero rotulo="Salário por mês" valor={salario} aoMudar={setSalario} unidade="R$" nome="funcSalario" />
            <CampoNumero rotulo="Outros gastos por mês" valor={encargos} aoMudar={setEncargos} unidade="R$" nome="funcEncargos"
              dica="13º, férias, FGTS, INSS, comida, moradia. Se não souber, deixe vazio." />
            <button type="button" className="btn sec pequeno" onClick={calc13}>Somar 13º e férias (19,4% do salário)</button>
            <p style={{ marginBottom: 0 }}><b data-testid="funcCusto">Total: {rs(custo)} por mês</b></p>
          </div>
          <div className="cartao">
            <CampoData rotulo="Começou a trabalhar em" valor={admissao} aoMudar={setAdmissao} nome="funcAdmissao" />
            {(f || saida) && (
              <CampoData rotulo="Saiu da fazenda em (vazio = ainda trabalha)" valor={saida ?? ''} aoMudar={setSaida} nome="funcSaida" />
            )}
            <CampoTexto rotulo="Telefone / WhatsApp" valor={telefone} aoMudar={(v) => setTelefone(v.replace(/[^\d()+\s-]/g, '').slice(0, 20))} nome="funcTelefone" formato="digitos" inputMode="tel" />
            <CampoTexto rotulo="Observação" valor={obs} aoMudar={setObs} nome="funcObs" multilinha />
          </div>
        </fieldset>

        <AcessoApp f={f} fazendaId={fazendaId} souDono={souDono && papel === 'dono'} usuarioId={usuarioId} setUsuarioId={setUsuarioId}
          nome={nome} telefone={telefone} />

        {podeMudar && (
          <>
            <button className="btn largo" onClick={salvar}>Salvar</button>
            {f && !f.saida && (
              <button className="btn sec largo" style={{ marginTop: 10 }} onClick={() => { setSaida(hojeISO()); aviso('Data de saída preenchida com hoje. Confira e toque em Salvar.'); }}>Saiu da fazenda</button>
            )}
            {f && <p style={{ textAlign: 'center', marginTop: 16 }}><button className="btn perigo pequeno" onClick={apagar}>Apagar cadastro</button></p>}
          </>
        )}
      </main>
    </>
  );
}

/** Ligação do funcionário com a equipe do app (nuvem). Só o dono liga, chama e muda o papel. */
function AcessoApp({ f, fazendaId, souDono, usuarioId, setUsuarioId, nome, telefone }: {
  f: Funcionario | null; fazendaId?: string; souDono: boolean; usuarioId: string; setUsuarioId: (v: string) => void; nome: string; telefone: string;
}) {
  const aviso = useAviso();
  const { lista, plano, falhou, carregar } = useEquipe(fazendaId);
  const outros = useLiveQuery(() => db.funcionarios.filter((x) => x.id !== f?.id && !!x.usuarioId).toArray(), [f?.id]);
  const [papelConv, setPapelConv] = useState<Papel>('vaqueiro');
  const [codigo, setCodigo] = useState<string | null>(null);
  const ligado = lista?.find((m) => m.usuario_id === usuarioId);
  const livres = useMemo(() => {
    const usados = new Set((outros ?? []).map((x) => x.usuarioId));
    const n = nome.trim().toLowerCase();
    return (lista ?? []).filter((m) => !usados.has(m.usuario_id))
      .sort((a, b) => Number(b.nome.trim().toLowerCase() === n) - Number(a.nome.trim().toLowerCase() === n) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [lista, outros, nome]);

  if (!fazendaId) {
    return (
      <div className="cartao" data-testid="acessoApp">
        <h3>Usar o app</h3>
        <p className="mudo" style={{ margin: 0 }}>Para o funcionário lançar pesagens e o trato no celular dele, ligue a fazenda na nuvem em <Link to="/nuvem">Mais › Nuvem e equipe</Link>. Depois volte aqui para chamar ele.</p>
      </div>
    );
  }

  const semVaga = !!plano && plano.pessoas + plano.convites_abertos >= plano.limite;
  const convidar = async () => {
    try { setCodigo(await criarConvite(fazendaId, papelConv)); carregar(); } catch (e) { aviso((e as Error).message, true); }
  };
  const mudar = async (p: Papel) => {
    if (!ligado) return;
    try { await mudarPapel(fazendaId, ligado.usuario_id, p); carregar(); aviso(`Agora ${ligado.nome || 'ele'} é ${PAPEIS[p].nome.toLowerCase()} no app.`); }
    catch (e) { aviso((e as Error).message, true); }
  };
  const tirar = async () => {
    if (!ligado || !window.confirm(`Tirar o acesso de ${ligado.nome || 'esta pessoa'} ao app? Ela deixa de ver e lançar os dados da fazenda. O cadastro de funcionário continua.`)) return;
    try {
      await removerMembro(fazendaId, ligado.usuario_id);
      setUsuarioId('');
      if (f) await db.funcionarios.update(f.id!, { usuarioId: null });
      carregar();
      aviso('Acesso tirado.');
    } catch (e) { aviso((e as Error).message, true); }
  };
  const fone = telefone.replace(/\D/g, '');
  const msg = (c: string) => mensagemConvite(papelConv, c);
  const whats = (c: string) => (fone.length >= 10 ? `https://wa.me/${fone.length <= 11 ? '55' + fone : fone}?text=${encodeURIComponent(msg(c))}` : linkWhatsApp(msg(c)));

  return (
    <div className="cartao" data-testid="acessoApp">
      <h3>Usar o app</h3>
      {lista === null && (falhou ? <p className="mudo">A equipe aparece quando houver internet.</p> : <p className="mudo">Carregando a equipe…</p>)}
      {lista && usuarioId && (
        ligado ? (
          <>
            <p style={{ marginTop: 0 }}>Usa o app como <b>{ligado.nome || 'sem nome'}</b>{ligado.eu ? ' (você)' : ''}.{ligado.bloqueado ? ' Está pausado: a equipe passou do limite do plano.' : ''}</p>
            {souDono && !ligado.eu ? (
              <>
                <CampoEscolha rotulo="Papel no app" nome="funcPapel" valor={ligado.papel} aoMudar={(v) => mudar(v as Papel)}>
                  {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
                </CampoEscolha>
                <Permissoes papel={ligado.papel} />
                <button className="btn perigo pequeno" onClick={tirar}>Tirar o acesso ao app</button>
              </>
            ) : <p className="mudo">Papel: {PAPEIS[ligado.papel].nome}. {PAPEIS[ligado.papel].texto}</p>}
          </>
        ) : (
          <>
            <p className="mudo">A conta ligada a este funcionário não está mais na equipe.</p>
            {souDono && <button className="btn sec pequeno" onClick={() => setUsuarioId('')}>Desligar a conta (depois toque em Salvar)</button>}
          </>
        )
      )}
      {lista && !usuarioId && !souDono && <p className="mudo" style={{ margin: 0 }}>Não usa o app. Só o dono chama pessoas para a equipe.</p>}
      {lista && !usuarioId && souDono && (
        <>
          {livres.length > 0 && (
            <CampoEscolha rotulo="Ele já entrou na equipe do app?" nome="funcConta" valor=""
              aoMudar={(v) => { if (v) { setUsuarioId(v); aviso('Conta escolhida. Toque em Salvar.'); } }}>
              <option value="">Escolha o nome dele…</option>
              {livres.map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nome || 'Sem nome'} · {PAPEIS[m.papel].nome}{m.eu ? ' (você)' : ''}</option>)}
            </CampoEscolha>
          )}
          <p className="mudo">Para chamar para o app, escolha o papel e mande o código para o celular dele. Quando ele entrar, volte aqui e escolha o nome dele acima.</p>
          <CampoEscolha rotulo="Papel no app" nome="funcPapelConvite" valor={papelConv} aoMudar={(v) => { setPapelConv(v as Papel); setCodigo(null); }}>
            {(['vaqueiro', 'gerente', 'consultor'] as Papel[]).map((p) => <option key={p} value={p}>{PAPEIS[p].nome}</option>)}
          </CampoEscolha>
          <Permissoes papel={papelConv} />
          {plano && (
            <p className="mudo" data-testid="vagasPlano">Plano {NOME_PLANO[plano.plano] ?? plano.plano}: {plano.pessoas} de {plano.limite} pessoas{plano.convites_abertos ? ` e ${plano.convites_abertos} convite(s) em aberto` : ''}. Cada pessoa a mais custa {PRECO_PESSOA_EXTRA} por mês.</p>
          )}
          {!codigo && semVaga ? (
            <p className="mudo"><b>Sem vaga na equipe.</b> Cancele um convite ou tire alguém em <Link to="/nuvem">Nuvem e equipe</Link>, ou aumente o plano.</p>
          ) : !codigo ? <button className="btn largo" onClick={convidar}>Gerar código de convite</button> : (
            <>
              <p style={{ fontSize: 30, letterSpacing: 4, textAlign: 'center', fontWeight: 700, margin: '8px 0' }} data-testid="codigoConviteFunc">{codigo}</p>
              <p className="mudo">Vale por 7 dias e para uma pessoa só.</p>
              <a className="btn largo" target="_blank" rel="noopener noreferrer" href={whats(codigo)}>Mandar no WhatsApp{fone.length >= 10 ? ' dele' : ''}</a>
            </>
          )}
        </>
      )}
    </div>
  );
}
