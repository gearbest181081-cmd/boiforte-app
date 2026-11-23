// Relatório da pesagem (lote ou animal): abre sozinho depois de salvar uma pesagem e também pelo lote.
// PDF e Excel são gerados no próprio celular, sem internet; o envio usa o "compartilhar" do celular (WhatsApp).
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, lerConfig } from '../db';
import { fmtData, hojeISO } from '../calc';
import { montarRelatorioPesagem } from '../relatorioPesagem';
import { compartilharArquivo, fmtCelula, gerarPdf, gerarXlsx, linkWhatsApp, type Celula } from '../exportar';
import { GraficoCrescimento, GraficoGmd } from '../components/Grafico';
import { Indicador, Topo, useAviso } from '../components/ui';

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;
const fmt = (c: Celula) => (c == null || c === '' ? '—' : fmtCelula(c));

export function RelatorioPesagem() {
  const { id } = useParams();
  const loteId = Number(id);
  const [busca, setBusca] = useSearchParams();
  const aviso = useAviso();
  const [ocupado, setOcupado] = useState(false);
  const nova = busca.has('nova');
  const animalId = busca.get('animal') ? Number(busca.get('animal')) : null;

  const dados = useLiveQuery(async () => {
    const lote = await db.lotes.get(loteId);
    if (!lote) return null;
    const [pesagens, animais, prop, config] = await Promise.all([
      db.pesagens.where('loteId').equals(loteId).toArray(),
      db.animais.where('loteId').equals(loteId).toArray(),
      db.propriedades.get(lote.propriedadeId),
      lerConfig(),
    ]);
    return { lote, pesagens, animais, prop, config };
  }, [loteId]);

  const rel = useMemo(() => (dados ? montarRelatorioPesagem({
    lote: dados.lote, pesagens: dados.pesagens, animais: dados.animais, animalId,
    nomeFazenda: dados.prop?.nome, rendimento: dados.config.rendimento, hoje: hojeISO(),
  }) : null), [dados, animalId]);

  if (dados === undefined) return <Topo titulo="Relatório de pesagem" voltar />;
  if (dados === null || !rel) return (<><Topo titulo="Relatório de pesagem" voltar /><main><p>Não encontrei este lote ou animal.</p><Link to="/lotes" className="btn sec largo">Ver os lotes</Link></main></>);

  const { lote, animais, pesagens } = dados;
  const pesados = animais.filter((a) => pesagens.some((p) => p.pesos?.some((x) => x.animalId === a.id)))
    .sort((a, b) => a.brinco.localeCompare(b.brinco, 'pt-BR', { numeric: true }));
  const escolherAnimal = (v: string) => {
    const b = new URLSearchParams(busca);
    if (v) b.set('animal', v); else b.delete('animal');
    b.delete('nova');
    setBusca(b, { replace: true });
  };

  const enviar = async (tipo: 'pdf' | 'xlsx') => {
    setOcupado(true);
    try {
      const bytes = tipo === 'pdf' ? gerarPdf(rel.titulo, rel.subtitulo, rel.blocosPdf) : gerarXlsx(rel.tabelasXlsx);
      const r = await compartilharArquivo(bytes, `${rel.nomeArquivo}.${tipo}`, MIME[tipo], rel.titulo);
      if (r === 'baixado') aviso('Arquivo salvo em Downloads. Para mandar no WhatsApp, anexe pelo clipe 📎.');
    } catch (e) { aviso('Não consegui gerar o arquivo: ' + (e as Error).message, true); }
    finally { setOcupado(false); }
  };

  // Na tela, só as colunas que cabem no celular; o PDF e o Excel levam a tabela inteira.
  const ev = rel.evolucao;
  const cols = [0, 2, 3, 5].filter((i) => i < ev.cabecalho.length);
  const linhasTela = [...ev.linhas].reverse();

  return (
    <>
      <Topo titulo="Relatório de pesagem" voltar />
      <main>
        {nova && (
          <div className="alerta bom" data-testid="pesagemSalva"><span className="ic">✅</span><div><b>Pesagem salva no celular</b>Veja como o {animalId ? 'animal' : 'lote'} está ganhando peso e mande o relatório pelo WhatsApp.</div></div>
        )}
        <p className="mudo" style={{ marginTop: 0 }}>{lote.nome}{dados.prop ? ` · ${dados.prop.nome}` : ''}{rel.pontos.length ? ` · última pesagem ${fmtData(rel.pontos[rel.pontos.length - 1].data)}` : ''}</p>

        {pesados.length > 0 && (
          <label className="campo"><span>Relatório de</span>
            <select name="animal" value={animalId ?? ''} onChange={(e) => escolherAnimal(e.target.value)}>
              <option value="">Lote todo ({pesados.length} animais)</option>
              {pesados.map((a) => <option key={a.id} value={a.id}>Animal {a.brinco}</option>)}
            </select>
          </label>
        )}

        <div className="cartao">
          <h3 style={{ marginTop: 0 }}>Mandar o relatório</h3>
          <p className="mudo">Toque e escolha o WhatsApp. Funciona sem internet: a mensagem sai quando o sinal voltar.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn largo" disabled={ocupado || !rel.pontos.length} onClick={() => enviar('pdf')}>Enviar PDF (com gráficos)</button>
            <button className="btn sec largo" disabled={ocupado || !rel.pontos.length} onClick={() => enviar('xlsx')}>Enviar Excel</button>
            <a className="btn sec largo" href={linkWhatsApp(rel.resumoTexto)} target="_blank" rel="noopener noreferrer">Mandar resumo em texto no WhatsApp</a>
          </div>
        </div>

        {rel.alertas.map((a, i) => (
          <div key={i} className={`alerta ${a.nivel}`}>
            <span className="ic">{a.nivel === 'ruim' ? '⚠️' : a.nivel === 'atencao' ? '🔔' : '✅'}</span>
            <div><b>{a.titulo}</b>{a.texto}</div>
          </div>
        ))}

        {rel.indicadores.length ? (
          <div className="grade">
            {rel.indicadores.map((i) => (
              <Indicador key={i.rotulo} rotulo={i.rotulo} valor={<span style={{ color: i.ruim ? 'var(--alerta)' : undefined }}>{i.valor}</span>} sub={i.sub} />
            ))}
          </div>
        ) : <p className="mudo">Ainda não há pesagem {animalId ? 'deste animal' : 'neste lote'}.</p>}

        <h2>Curva de ganho de peso</h2>
        <div className="cartao">
          <GraficoCrescimento pontos={rel.pontos} gmdMeta={lote.gmdMeta} pesoAlvo={lote.pesoAlvo} projecao={rel.projecao} />
        </div>

        <h2>Ganho por dia em cada período</h2>
        <div className="cartao">
          <GraficoGmd periodos={rel.periodos} gmdMeta={lote.gmdMeta} />
        </div>

        <h2>Evolução do peso</h2>
        <div className="cartao rolagem">
          <table className="tab" data-testid="evolucao">
            <thead><tr>{cols.map((i, k) => <th key={i} className={k ? 'n' : ''}>{['Data', '', 'Peso', 'Ganho', '', 'GMD'][i] || ev.cabecalho[i]}</th>)}</tr></thead>
            <tbody>
              {linhasTela.length === 0 && <tr><td colSpan={cols.length} className="mudo">Sem dados.</td></tr>}
              {linhasTela.map((l, r) => <tr key={r}>{cols.map((i, k) => <td key={i} className={k ? 'n' : ''}>{fmt(l[i])}</td>)}</tr>)}
            </tbody>
          </table>
          <p className="mudo" style={{ fontSize: 13, marginTop: 8 }}>Peso e ganho em kg; GMD em kg por dia, desde a pesagem anterior. O PDF e o Excel têm todas as colunas.</p>
        </div>

        {rel.animais && rel.animais.linhas.length > 0 && (
          <>
            <h2>Animais</h2>
            <div className="cartao rolagem">
              <table className="tab">
                <thead><tr><th>Brinco</th><th className="n">Peso</th><th className="n">GMD</th><th className="n">Meta</th></tr></thead>
                <tbody>
                  {rel.animais.linhas.map((l, r) => {
                    const a = pesados.find((x) => l[0] === x.brinco || l[0] === `${x.brinco} (saiu)`);
                    const desv = typeof l[7] === 'number' ? l[7] : null;
                    return (
                      <tr key={r}>
                        <td>{a ? <button className="link" onClick={() => escolherAnimal(String(a.id))}><b>{fmt(l[0])}</b></button> : <b>{fmt(l[0])}</b>}</td>
                        <td className="n">{fmt(l[2])}</td>
                        <td className="n">{fmt(l[5])}</td>
                        <td className="n" style={{ color: desv != null && desv <= -10 ? 'var(--alerta)' : undefined }}>{desv == null ? '—' : `${desv > 0 ? '+' : ''}${fmtCelula(desv)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mudo" style={{ fontSize: 13, marginTop: 8 }}>{rel.animais.nota} Toque no brinco para ver o relatório do animal.</p>
            </div>
          </>
        )}

        <Link to={`/lotes/${lote.id}`} className="btn sec largo" style={{ marginTop: 16 }}>Ver o lote</Link>
      </main>
    </>
  );
}
