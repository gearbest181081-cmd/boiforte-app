import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useTudo } from '../hooks';
import { CRITERIOS, montarRelatorio, type Criterio } from '../relatorios';
import { compartilharArquivo, fmtNumeroCelula, gerarPdf, gerarXlsx, linkWhatsApp, type Celula } from '../exportar';
import { hojeISO } from '../calc';
import { CampoEscolha, Opcoes, Topo, useAviso } from '../components/ui';
import { periodoDatas, type Periodo } from './Financeiro';

const fmt = (c: Celula) => (c == null ? '—' : typeof c === 'number' ? fmtNumeroCelula(c) : c);

export function Relatorios() {
  const tudo = useTudo();
  const props = useLiveQuery(() => db.propriedades.toArray());
  const aviso = useAviso();
  const [periodo, setPeriodo] = useState<Periodo>('ano');
  const [criterio, setCriterio] = useState<Criterio>('gmd');
  const [encerrados, setEncerrados] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const rel = useMemo(() => {
    if (!tudo) return null;
    let [de, ate] = periodoDatas(periodo);
    if (periodo === 'tudo') de = [...tudo.lotes.map((l) => l.dataEntrada), ...tudo.lancamentos.map((l) => l.data)].sort()[0] ?? ate;
    return montarRelatorio(tudo, { de, ate, criterio, incluirEncerrados: encerrados, nomeFazenda: props?.length === 1 ? props[0].nome : undefined });
  }, [tudo, periodo, criterio, encerrados, props]);
  if (!rel) return <Topo titulo="Relatórios" voltar />;

  const base = `boiforte-relatorio-${hojeISO()}`;
  const exportar = async (tipo: 'pdf' | 'xlsx') => {
    setOcupado(true);
    try {
      const bytes = tipo === 'pdf' ? gerarPdf(rel.titulo, rel.subtitulo, rel.tabelas) : gerarXlsx(rel.tabelas);
      const mime = tipo === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const r = await compartilharArquivo(bytes, `${base}.${tipo}`, mime, rel.titulo);
      if (r === 'baixado') aviso('Arquivo salvo em Downloads. Para mandar no WhatsApp, anexe pelo clipe 📎.');
    } catch (e) { aviso('Não consegui gerar o arquivo: ' + (e as Error).message, true); }
    finally { setOcupado(false); }
  };

  return (
    <>
      <Topo titulo="Relatórios" voltar />
      <main>
        <div className="cartao">
          <h3>Enviar relatório</h3>
          <p className="mudo">O PDF é bom para mostrar e mandar no WhatsApp. O Excel é para quem quer mexer nos números.</p>
          <div className="botoes">
            <button className="btn" disabled={ocupado} onClick={() => exportar('pdf')}>PDF</button>
            <button className="btn sec" disabled={ocupado} onClick={() => exportar('xlsx')}>Excel</button>
          </div>
          <a className="btn sec largo" href={linkWhatsApp(rel.resumoTexto)} target="_blank" rel="noopener noreferrer">Mandar resumo no WhatsApp</a>
        </div>

        <h2>Período do caixa</h2>
        <Opcoes valor={periodo} aoMudar={setPeriodo} opcoes={[{ valor: 'mes', rotulo: 'Este mês' }, { valor: 'ano', rotulo: 'Este ano' }, { valor: 'safra', rotulo: 'Safra (jul–jun)' }, { valor: 'tudo', rotulo: 'Tudo' }]} />
        <h2>Ranking</h2>
        <CampoEscolha rotulo="Ordenar lotes por" nome="criterio" valor={criterio} aoMudar={(v) => setCriterio(v as Criterio)}>
          {Object.entries(CRITERIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </CampoEscolha>
        <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={encerrados} onChange={(e) => setEncerrados(e.target.checked)} style={{ width: 24, height: 24 }} />
          <span>Incluir lotes já vendidos</span>
        </label>

        {rel.tabelas.map((t) => (
          <section key={t.titulo}>
            <h2>{t.titulo}</h2>
            <div className="cartao rolagem">
              <table className="tab">
                <thead><tr>{t.cabecalho.map((c, i) => <th key={i} className={i ? 'n' : ''}>{c}</th>)}</tr></thead>
                <tbody>
                  {t.linhas.length === 0 && <tr><td colSpan={t.cabecalho.length} className="mudo">Sem dados.</td></tr>}
                  {t.linhas.map((l, r) => <tr key={r}>{l.map((c, i) => <td key={i} className={i ? 'n' : ''}>{fmt(c)}</td>)}</tr>)}
                </tbody>
              </table>
              {t.nota && <p className="mudo" style={{ fontSize: 13, marginTop: 8 }}>{t.nota}</p>}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
