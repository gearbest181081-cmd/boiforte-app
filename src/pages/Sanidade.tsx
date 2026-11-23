import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { concluirEventoSanitario, db, excluirEventoSanitario, garantirLembretesPadrao, salvarEventoSanitario, type Lote } from '../db';
import { emCarencia, pendenciasSanidade, proximaData, TIPOS_SANIDADE, type TipoSanidade } from '../sanidade';
import { fmtData, hojeISO } from '../calc';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';
import { rs } from './Nutricao';

/** Aba "Saúde" dentro do lote. */
export function LoteSanidade({ lote }: { lote: Lote }) {
  const eventos = useLiveQuery(() => db.sanidade.where('loteId').equals(lote.id!).toArray(), [lote.id]);
  const [novo, setNovo] = useState(false);
  const aviso = useAviso();
  if (!eventos) return null;
  const hoje = hojeISO();
  const car = emCarencia(eventos, lote.id!, hoje);
  const agendados = eventos.filter((e) => !e.feito).sort((a, b) => a.data.localeCompare(b.data));
  const feitos = eventos.filter((e) => e.feito).sort((a, b) => b.data.localeCompare(a.data));
  return (
    <>
      {car ? (
        <div className="alerta ruim"><span className="ic">⛔</span><div><b>Em carência até {fmtData(car.data)}</b>Por causa de {car.produto}. Não mande para o abate antes dessa data.</div></div>
      ) : <div className="alerta bom"><span className="ic">✅</span><div><b>Sem carência</b>Nenhum produto aplicado impede o abate hoje.</div></div>}
      {novo ? <FormEvento loteId={lote.id!} qtd={lote.qtdCabecas} aoTerminar={() => setNovo(false)} /> : <button className="btn largo" style={{ marginBottom: 14 }} onClick={() => setNovo(true)}>+ Aplicação ou agendamento</button>}
      {agendados.length > 0 && <h2>Agendado</h2>}
      {agendados.map((e) => (
        <div key={e.id} className="cartao">
          <div className="linha-lote"><b>{e.produto}</b><span className={`etiqueta ${e.data < hoje ? 'ruim' : 'atencao'}`}>{e.data < hoje ? 'atrasado' : fmtData(e.data)}</span></div>
          <p className="mudo">{TIPOS_SANIDADE[e.tipo]}{e.dose ? ` · ${e.dose}` : ''}{e.repetirDias ? ` · repete a cada ${e.repetirDias} dias` : ''}</p>
          <div className="botoes" style={{ margin: 0 }}>
            <button className="btn pequeno" onClick={async () => { await concluirEventoSanitario(e.id!, hoje); aviso(e.repetirDias ? 'Feito. A próxima dose já ficou agendada.' : 'Marcado como feito.'); }}>Feito hoje</button>
            <button className="btn perigo pequeno" onClick={async () => { if (window.confirm('Apagar este agendamento?')) await excluirEventoSanitario(e.id!); }}>Apagar</button>
          </div>
        </div>
      ))}
      <h2>Histórico</h2>
      {feitos.length === 0 && <p className="mudo">Nenhuma aplicação registrada.</p>}
      {feitos.length > 0 && (
        <div className="cartao rolagem">
          <table className="tab">
            <thead><tr><th>Data</th><th>Produto</th><th className="n">Carência</th><th /></tr></thead>
            <tbody>
              {feitos.map((e) => (
                <tr key={e.id}>
                  <td>{fmtData(e.data)}</td>
                  <td>{e.produto}<div className="mudo" style={{ fontSize: 13 }}>{TIPOS_SANIDADE[e.tipo]}{e.custo ? ` · ${rs(e.custo)}` : ''}</div></td>
                  <td className="n">{e.carenciaDias ? `${e.carenciaDias} d` : '—'}</td>
                  <td><button className="remover" aria-label="Apagar aplicação" onClick={async () => { if (window.confirm('Apagar esta aplicação?')) await excluirEventoSanitario(e.id!); }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FormEvento({ loteId, qtd, aoTerminar }: { loteId: number; qtd: number; aoTerminar: () => void }) {
  const aviso = useAviso();
  const [feito, setFeito] = useState<'feito' | 'agendar'>('feito');
  const [tipo, setTipo] = useState<TipoSanidade>('vacina');
  const [produto, setProduto] = useState('');
  const [dose, setDose] = useState('');
  const [data, setData] = useState(hojeISO());
  const [custo, setCusto] = useState('');
  const [carencia, setCarencia] = useState('');
  const [repetir, setRepetir] = useState('');
  const salvar = async () => {
    if (!produto.trim()) return aviso('Informe o produto.', true);
    try {
      await salvarEventoSanitario({
        loteId, data, feito: feito === 'feito', tipo, produto: produto.trim(), dose: dose.trim() || undefined, qtdAnimais: qtd,
        custo: num(custo) ?? undefined, carenciaDias: num(carencia) != null ? Math.round(num(carencia)!) : undefined, repetirDias: num(repetir) ? Math.round(num(repetir)!) : undefined,
      });
      if (feito === 'feito' && num(repetir)) {
        await salvarEventoSanitario({ loteId, data: new Date(new Date(data + 'T12:00:00Z').getTime() + Math.round(num(repetir)!) * 86400000).toISOString().slice(0, 10), feito: false, tipo, produto: produto.trim(), dose: dose.trim() || undefined, qtdAnimais: qtd, custo: num(custo) ?? undefined, carenciaDias: num(carencia) != null ? Math.round(num(carencia)!) : undefined, repetirDias: Math.round(num(repetir)!) });
      }
      aviso(feito === 'feito' ? 'Aplicação registrada.' : 'Agendado.');
      aoTerminar();
    } catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <div className="cartao">
      <Opcoes valor={feito} aoMudar={setFeito} opcoes={[{ valor: 'feito', rotulo: 'Já apliquei' }, { valor: 'agendar', rotulo: 'Agendar' }]} />
      <div style={{ height: 12 }} />
      <CampoEscolha rotulo="Tipo" nome="sanTipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoSanidade)}>
        {Object.entries(TIPOS_SANIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </CampoEscolha>
      <CampoTexto rotulo="Produto" valor={produto} aoMudar={setProduto} nome="sanProduto" />
      <CampoTexto rotulo="Dose (opcional)" valor={dose} aoMudar={setDose} nome="sanDose" />
      <CampoData rotulo={feito === 'feito' ? 'Data da aplicação' : 'Data marcada'} valor={data} aoMudar={setData} nome="sanData" />
      <CampoNumero rotulo="Custo total" valor={custo} aoMudar={setCusto} unidade="R$" nome="sanCusto" dica="Entra como despesa de sanidade do lote." />
      <CampoNumero rotulo="Carência para abate" valor={carencia} aoMudar={setCarencia} unidade="dias" nome="sanCarencia" dica="Está na bula. O app avisa até quando não pode abater." />
      <CampoNumero rotulo="Repetir a cada" valor={repetir} aoMudar={setRepetir} unidade="dias" nome="sanRepetir" dica="Ex.: reforço em 30 dias, vermífugo a cada 90. Deixe vazio se não repete." />
      <div className="botoes"><button className="btn" onClick={salvar}>Salvar</button><button className="btn sec" onClick={aoTerminar}>Cancelar</button></div>
    </div>
  );
}

/** Tela geral de sanidade: agenda de todos os lotes e lembretes do calendário. */
export function Sanidade() {
  useEffect(() => { garantirLembretesPadrao().catch(() => {}); }, []);
  const dados = useLiveQuery(async () => ({ eventos: await db.sanidade.toArray(), lotes: await db.lotes.toArray(), lembretes: await db.lembretes.toArray() }));
  const aviso = useAviso();
  const [titulo, setTitulo] = useState('');
  const [mes, setMes] = useState('5');
  const [dia, setDia] = useState('31');
  if (!dados) return <Topo titulo="Sanidade" voltar />;
  const hoje = hojeISO();
  const nomes = new Map(dados.lotes.map((l) => [l.id!, l.nome]));
  const ativos = new Set(dados.lotes.filter((l) => !l.encerrado).map((l) => l.id!));
  const pend = pendenciasSanidade(dados.eventos.filter((e) => ativos.has(e.loteId)).map((e) => ({ ...e, nomeLote: nomes.get(e.loteId) })), [], hoje, 30);
  const carencias = dados.lotes.filter((l) => !l.encerrado).map((l) => ({ l, c: emCarencia(dados.eventos, l.id!, hoje) })).filter((x) => x.c);
  const addLembrete = async () => {
    if (!titulo.trim()) return aviso('Escreva o lembrete.', true);
    try { await db.lembretes.add({ titulo: titulo.trim(), mes: Number(mes), dia: Number(dia), antecedenciaDias: 15, criadoEm: Date.now() }); setTitulo(''); }
    catch (e) { aviso((e as Error).message, true); }
  };
  return (
    <>
      <Topo titulo="Sanidade" voltar />
      <main>
        <h2>Próximos 30 dias</h2>
        {pend.length === 0 && <p className="mudo">Nada agendado. As aplicações se agendam dentro de cada lote, na aba Saúde.</p>}
        {pend.map((p, i) => <div key={i} className={`alerta ${p.nivel}`}><span className="ic">{p.nivel === 'ruim' ? '⚠️' : '💉'}</span><div><b>{p.titulo}</b>{p.texto}</div></div>)}
        {carencias.length > 0 && <h2>Lotes em carência</h2>}
        {carencias.map(({ l, c }) => <div key={l.id} className="cartao linha-lote"><span>{l.nome}<div className="mudo">{c!.produto}</div></span><b>até {fmtData(c!.data)}</b></div>)}

        <h2>Calendário do ano</h2>
        <div className="dica">Prazos de declaração do rebanho e campanhas mudam de estado para estado. Confira com a agência de defesa agropecuária e ajuste aqui.</div>
        {dados.lembretes.map((l) => (
          <div key={l.id} className="cartao linha-lote">
            <span>{l.titulo}<div className="mudo">próximo: {fmtData(proximaData(l, hoje))}{l.obs ? ` · ${l.obs}` : ''}</div></span>
            <button className="remover" aria-label="Apagar lembrete" onClick={() => db.lembretes.delete(l.id!)}>×</button>
          </div>
        ))}
        <div className="cartao">
          <h3>Novo lembrete anual</h3>
          <CampoTexto rotulo="Lembrete" valor={titulo} aoMudar={setTitulo} nome="lembTitulo" />
          <div className="grade">
            <CampoNumero rotulo="Dia" valor={dia} aoMudar={(v) => setDia(v.replace(/\D/g, '').slice(0, 2))} nome="lembDia" />
            <CampoEscolha rotulo="Mês" valor={mes} aoMudar={setMes} nome="lembMes">
              {['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </CampoEscolha>
          </div>
          <button className="btn sec largo" onClick={addLembrete}>Adicionar lembrete</button>
        </div>
      </main>
    </>
  );
}
