// Tela "Mudar de fase": o lote termina uma fase (ex.: RIP) e passa para a próxima (ex.: TIP).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FASES, pontosDoLote, type Fase } from '../db';
import { diasEntre, fmtData, fmtKg, hojeISO, pesoEstimado, resumo } from '../calc';
import { TIPOS } from '../nutricao';
import { CampoData, CampoEscolha, CampoNumero, num, Opcoes, Topo, useAviso } from '../components/ui';
import { DIETA_DA_FASE, GMD_SUGERIDO, mudarFase, nomeCurtoFase, PESO_ALVO_SUGERIDO, PROXIMA_FASE, usaPesoAlvo } from '../fases';
import { usePapel } from '../nuvem/useNuvem';

const virgula = (n: number) => String(n).replace('.', ',');

export function MudarFase() {
  const { id } = useParams();
  const loteId = Number(id);
  const nav = useNavigate();
  const aviso = useAviso();
  const papel = usePapel();
  const dados = useLiveQuery(async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) return null;
    const pesagens = await db.pesagens.where('loteId').equals(loteId).toArray();
    const formulas = await db.formulas.toArray();
    return { lote, pontos: pontosDoLote(pesagens), formulas };
  }, [loteId]);

  const [f, setF] = useState({ para: 'tip' as Fase, data: hojeISO(), peso: '', formulaId: 0, pesoAlvo: '', gmdMeta: '' });
  const [pronto, setPronto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));

  const dietaSugerida = (para: Fase, atual: number) => {
    const tipo = DIETA_DA_FASE[para];
    const achada = tipo ? dados?.formulas.find((x) => x.tipo === tipo) : undefined;
    return achada?.id ?? (tipo ? 0 : atual);
  };
  const escolherFase = (para: Fase) => setF((x) => ({
    ...x, para, formulaId: dietaSugerida(para, dados?.lote?.formulaId ?? 0),
    pesoAlvo: usaPesoAlvo(para) ? String(PESO_ALVO_SUGERIDO[para]) : '', gmdMeta: virgula(GMD_SUGERIDO[para]),
  }));

  // Primeira vez: sugere a próxima fase (RIP → TIP), a dieta que combina e as metas da fase.
  useEffect(() => {
    if (pronto || !dados?.lote) return;
    escolherFase(PROXIMA_FASE[dados.lote.fase]);
    setPronto(true);
  }, [dados, pronto]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordenadas = useMemo(() => {
    const tipo = DIETA_DA_FASE[f.para];
    return [...(dados?.formulas ?? [])].sort((a, b) => Number(b.tipo === tipo) - Number(a.tipo === tipo) || a.nome.localeCompare(b.nome));
  }, [dados, f.para]);

  if (dados === undefined) return <Topo titulo="Mudar de fase" voltar />;
  if (dados === null) return (<><Topo titulo="Mudar de fase" voltar /><main><p>Lote não encontrado.</p></main></>);
  const { lote, pontos, formulas } = dados;

  if (papel === 'vaqueiro' || papel === 'consultor') {
    return (<><Topo titulo="Mudar de fase" voltar /><main><p>Só o dono ou o gerente da fazenda pode mudar a fase do lote.</p></main></>);
  }
  if (lote.encerrado) {
    return (<><Topo titulo="Mudar de fase" voltar /><main><p>Este lote está encerrado. Reabra o lote para mudar a fase.</p></main></>);
  }

  const r = resumo(pontos);
  const inicioFase = lote.fases?.length ? lote.fases[lote.fases.length - 1].data : lote.dataEntrada;
  const diasNaFase = diasEntre(inicioFase, hojeISO());
  const estimado = pesoEstimado(pontos, f.data, lote.gmdMeta);
  const dietaAtual = formulas.find((x) => x.id === lote.formulaId);
  const dietaNova = formulas.find((x) => x.id === f.formulaId);
  const tipoSugerido = DIETA_DA_FASE[f.para];
  const temDietaDaFase = !!tipoSugerido && formulas.some((x) => x.tipo === tipoSugerido);
  const nomePara = nomeCurtoFase(f.para);

  const salvar = async () => {
    if (salvando) return;
    const peso = num(f.peso);
    if (f.peso.trim() && !(peso && peso > 0)) return aviso('O peso médio não ficou certo. Fale ou digite de novo, em kg.', true);
    setSalvando(true);
    try {
      await mudarFase(loteId, { data: f.data, para: f.para, formulaId: f.formulaId || null, pesoAlvo: usaPesoAlvo(f.para) ? num(f.pesoAlvo) : null, gmdMeta: num(f.gmdMeta), pesoMedio: lote.controle === 'lote' ? peso : null });
      aviso(`Pronto! O lote agora está em ${nomePara}.`);
      nav(`/lotes/${loteId}`, { replace: true });
    } catch (e) {
      aviso((e as Error).message, true);
      setSalvando(false);
    }
  };

  return (
    <>
      <Topo titulo="Mudar de fase" voltar />
      <main>
        <div className="cartao">
          <b>{lote.nome}</b>
          <p style={{ margin: '6px 0 0' }}>
            Está em <b>{nomeCurtoFase(lote.fase)}</b> desde {fmtData(inicioFase)} ({diasNaFase} dias).
            {r.pesoAtual != null && <> Último peso médio: <b>{fmtKg(r.pesoAtual)}</b> em {fmtData(r.dataUltima)}.</>}
            {dietaAtual && <> Dieta: {dietaAtual.nome}.</>}
          </p>
        </div>

        <div className="campo"><span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Passar para qual fase?</span>
          <Opcoes valor={f.para} aoMudar={escolherFase}
            opcoes={(Object.keys(FASES) as Fase[]).filter((k) => k !== lote.fase).map((k) => ({ valor: k, rotulo: nomeCurtoFase(k) }))} />
        </div>

        <CampoData rotulo="Data da mudança" valor={f.data} aoMudar={set('data')} nome="dataMudanca" dica="Dia em que o lote começou a nova fase." />

        {lote.controle === 'lote' ? (
          <CampoNumero rotulo="Peso médio no dia (opcional)" valor={f.peso} aoMudar={set('peso')} unidade="kg" nome="pesoMudanca"
            dica={`Se pesou o lote, informe: vira uma pesagem. Em branco, o app usa a estimativa${estimado ? ` (${fmtKg(estimado)})` : ''}.`} />
        ) : (
          <div className="dica">Lote controlado por cabeça: se for pesar na troca, faça a <Link to={`/pesar/${loteId}`}>pesagem por brinco</Link> antes. O app usa o último peso para marcar o fim da fase.</div>
        )}

        <CampoEscolha rotulo={`Dieta da ${nomePara}`} nome="formulaNova" valor={f.formulaId} aoMudar={(v) => set('formulaId')(Number(v))}
          dica={tipoSugerido && !temDietaDaFase
            ? <>Você ainda não tem fórmula de {TIPOS[tipoSugerido].nome.split(' (')[0]}. <Link to={`/nutricao/formula/nova?tipo=${tipoSugerido}`}>Criar fórmula</Link> e depois volte aqui.</>
            : 'O trato do dia passa a usar esta dieta a partir da mudança.'}>
          <option value={0}>Nenhuma (só pasto e sal)</option>
          {ordenadas.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.tipo === tipoSugerido ? ' ★' : ''}</option>)}
        </CampoEscolha>

        {usaPesoAlvo(f.para) && (
          <CampoNumero rotulo="Novo peso alvo" valor={f.pesoAlvo} aoMudar={set('pesoAlvo')} unidade="kg" pesoVivo nome="pesoAlvoNovo" dica={`Sugestão para ${nomePara}. Pode mudar.`} />
        )}
        <CampoNumero rotulo="Novo GMD esperado" valor={f.gmdMeta} aoMudar={set('gmdMeta')} unidade="kg/dia" nome="gmdMetaNovo" dica="O app avisa quando o lote ficar 10% abaixo." />

        <div className="cartao">
          <b>O que vai acontecer</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            <li>O lote passa de <b>{nomeCurtoFase(lote.fase)}</b> para <b>{nomePara}</b> em {fmtData(f.data)}.</li>
            <li>Dieta: {dietaAtual?.nome ?? 'nenhuma'} → <b>{dietaNova?.nome ?? 'nenhuma'}</b>.</li>
            <li>Pesagens, trato, custos e vendas continuam no mesmo lote.</li>
            <li>A {nomeCurtoFase(lote.fase)} fica guardada no histórico, com o ganho de peso de cada fase.</li>
          </ul>
        </div>

        <button className="btn largo" onClick={salvar} disabled={salvando}>Passar lote para {nomePara}</button>
      </main>
    </>
  );
}
