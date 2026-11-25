import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, garantirIngredientesPadrao } from '../db';
import { avaliarFormula, calcularFormula, TIPOS } from '../nutricao';
import { fmtNum } from '../calc';
import { AvisoNutricao, Opcoes, Topo } from '../components/ui';
import { usePapel, useVeDinheiro } from '../nuvem/useNuvem';

export const rs = (v: number | null | undefined, casas = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });

export function Nutricao() {
  const [aba, setAba] = useState<'formulas' | 'ingredientes'>(() => (sessionStorageGet('abaNutricao') as any) || 'formulas');
  useEffect(() => { garantirIngredientesPadrao().catch(() => {}); }, []);
  useEffect(() => { sessionStorageSet('abaNutricao', aba); }, [aba]);
  const ingredientes = useLiveQuery(() => db.ingredientes.toArray());
  const veDinheiro = useVeDinheiro();
  const papel = usePapel();
  const podeMudar = papel !== undefined && papel !== 'vaqueiro' && papel !== 'consultor'; // fórmulas e ingredientes: dono e gerente
  const formulas = useLiveQuery(() => db.formulas.toArray());
  const usoPorFormula = useLiveQuery(async () => {
    const m: Record<number, number> = {};
    (await db.lotes.filter((l) => !l.encerrado && !!l.formulaId).toArray()).forEach((l) => { m[l.formulaId!] = (m[l.formulaId!] ?? 0) + 1; });
    return m;
  });

  return (
    <>
      <Topo titulo="Nutrição" voltar />
      <main>
        <AvisoNutricao />
        <Opcoes valor={aba} aoMudar={setAba} opcoes={[{ valor: 'formulas', rotulo: `Fórmulas (${formulas?.length ?? 0})` }, { valor: 'ingredientes', rotulo: `Ingredientes (${ingredientes?.length ?? 0})` }]} />
        <div style={{ height: 14 }} />
        {aba === 'formulas' && (
          <>
            {podeMudar && <Link to="/nutricao/formula/nova" className="btn largo" style={{ marginBottom: 14 }}>+ Nova fórmula</Link>}
            {veDinheiro && <Link to="/simular?aba=comparar" className="btn sec largo" style={{ marginBottom: 14 }} data-testid="nutComparar">🔍 Comparar produtos: qual vale mais a pena</Link>}
            {formulas?.length === 0 && <div className="dica">Monte aqui suas dietas e suplementos: RIP, TIP, creep, proteinado, proteico energético, confinamento. O app calcula PB, NDT, Ca, P e o custo por kg e avisa o que estiver fora da faixa.</div>}
            {formulas?.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((f) => {
              const r = calcularFormula(f.itens, ingredientes ?? []);
              const al = avaliarFormula(f.tipo, r, f.consumoPctPV);
              const pior = al.find((a) => a.nivel === 'ruim') ? 'ruim' : al.find((a) => a.nivel === 'atencao') ? 'atencao' : 'bom';
              const base = TIPOS[f.tipo].base === 'ms' ? r.ms : r.mn;
              return (
                <Link key={f.id} to={`/nutricao/formula/${f.id}`} className="cartao">
                  <div className="linha-lote"><h3>{f.nome}</h3>{veDinheiro && <b>{rs(r.custoKg)}/kg</b>}</div>
                  <div style={{ marginBottom: 6 }}>
                    <span className="etiqueta">{TIPOS[f.tipo].nome.split(' (')[0]}</span>
                    <span className={`etiqueta ${pior === 'bom' ? '' : pior}`}>{pior === 'bom' ? 'Dentro da faixa' : pior === 'ruim' ? 'Fora da faixa' : 'Atenção'}</span>
                    {usoPorFormula?.[f.id!] ? <span className="etiqueta">{usoPorFormula[f.id!]} lote(s)</span> : null}
                  </div>
                  <div className="mudo">PB {fmtNum(base.pb)}% · NDT {fmtNum(base.ndt)}% · Ca:P {r.caP == null ? '—' : fmtNum(r.caP)}:1</div>
                </Link>
              );
            })}
          </>
        )}
        {aba === 'ingredientes' && (
          <>
            {podeMudar && <Link to="/nutricao/ingrediente/novo" className="btn largo" style={{ marginBottom: 14 }}>+ Novo ingrediente</Link>}
            <div className="dica">Valores na matéria natural, como no rótulo. Ajuste o preço que você paga e, para núcleos e sais, copie a composição do rótulo.
              {podeMudar && <> Tem o saco do produto? Em <b>+ Novo ingrediente</b>, tire uma foto da tabela do rótulo e o app preenche.</>}</div>
            <div className="cartao rolagem">
              <table className="tab">
                <thead><tr><th>Ingrediente</th><th className="n">PB%</th><th className="n">NDT%</th>{veDinheiro && <th className="n">R$/kg</th>}</tr></thead>
                <tbody>
                  {ingredientes?.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((i) => (
                    <tr key={i.id}>
                      <td><Link to={`/nutricao/ingrediente/${i.id}`} style={{ color: 'inherit', fontWeight: 600 }}>{i.nome}</Link></td>
                      <td className="n">{fmtNum(i.pb)}</td><td className="n">{fmtNum(i.ndt)}</td>{veDinheiro && <td className="n">{fmtNum(i.preco, 2)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function sessionStorageGet(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } }
