import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, excluirFormula, garantirIngredientesPadrao, lerConfig } from '../db';
import { avaliarFormula, batida, calcularFormula, custoArrobaNutricao, kgCabDia, TIPOS, type TipoFormula } from '../nutricao';
import { fmtNum } from '../calc';
import { CampoEscolha, CampoNumero, CampoTexto, Entrada, Escolha, num, Opcoes, Topo, useAviso } from '../components/ui';
import { rs } from './Nutricao';
import { avaliarNutrientes } from '../faixas';
import { GradeNutrientes } from '../components/Nutrientes';
import { useVeDinheiro } from '../nuvem/useNuvem';

type Linha = { ingredienteId: number; qtd: string };
const br = (x: number, c = 2) => x.toLocaleString('pt-BR', { maximumFractionDigits: c });

export function FormulaForm() {
  const { id } = useParams();
  const editando = id != null && id !== 'nova';
  const veDinheiro = useVeDinheiro();
  const nav = useNavigate();
  const aviso = useAviso();
  useEffect(() => { garantirIngredientesPadrao().catch(() => {}); }, []);
  const ingredientes = useLiveQuery(() => db.ingredientes.toArray());
  const config = useLiveQuery(() => lerConfig());
  const [nome, setNome] = useState('');
  const [busca] = useSearchParams();
  const tipoInicial = (!editando && busca.get('tipo') && busca.get('tipo')! in TIPOS ? busca.get('tipo') : 'rip') as TipoFormula; // ?tipo=tip ao vir de "Mudar de fase"
  const [tipo, setTipo] = useState<TipoFormula>(tipoInicial);
  const [unidade, setUnidade] = useState<'pct' | 'kg'>('kg');
  const [modo, setModo] = useState<'direto' | 'batida'>('batida');
  const [consumo, setConsumo] = useState(br(TIPOS[tipoInicial].consumoPctPV * 100, 3));
  const [linhas, setLinhas] = useState<Linha[]>([{ ingredienteId: 0, qtd: '' }]);
  const [obs, setObs] = useState('');
  const [pesoRef, setPesoRef] = useState('250');
  const [gmdRef, setGmdRef] = useState('0,75');
  const [kgBatida, setKgBatida] = useState('1000');

  useEffect(() => {
    if (!editando) return;
    db.formulas.get(Number(id)).then((f) => {
      if (!f) return;
      setNome(f.nome); setTipo(f.tipo); setUnidade(f.unidade); setModo(f.modo); setObs(f.obs ?? '');
      setConsumo(br(f.consumoPctPV * 100, 3));
      setLinhas(f.itens.map((i) => ({ ingredienteId: i.ingredienteId, qtd: br(i.qtd, 4) })));
    });
  }, [editando, id]);

  const itens = linhas.map((l) => ({ ingredienteId: l.ingredienteId, qtd: num(l.qtd) ?? 0 })).filter((i) => i.ingredienteId > 0);
  const r = useMemo(() => calcularFormula(itens, ingredientes ?? []), [JSON.stringify(itens), ingredientes]); // eslint-disable-line react-hooks/exhaustive-deps
  const perfil = TIPOS[tipo];
  const consumoFrac = (num(consumo) ?? 0) / 100;
  const alertas = avaliarFormula(tipo, r, consumoFrac);
  const nutrientes = avaliarNutrientes(tipo, r, consumoFrac);
  const kgDia = kgCabDia(num(pesoRef) ?? 0, consumoFrac);
  const diaria = kgDia * r.custoKg;
  const custoArroba = custoArrobaNutricao(diaria, num(gmdRef), config?.rendimento);
  const somaPct = unidade === 'pct' ? itens.reduce((s, i) => s + i.qtd, 0) : null;

  const trocarTipo = (t: TipoFormula) => { setTipo(t); setConsumo(br(TIPOS[t].consumoPctPV * 100, 3)); };
  const setLinha = (i: number, k: keyof Linha, v: string | number) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const salvar = async () => {
    if (!nome.trim()) return aviso('Dê um nome à fórmula. Ex.: "RIP recria fêmeas".', true);
    if (!itens.some((i) => i.qtd > 0)) return aviso('Coloque ao menos um ingrediente com quantidade.', true);
    if (somaPct != null && Math.abs(somaPct - 100) > 0.05) return aviso(`A soma das porcentagens deu ${br(somaPct)}%. Precisa fechar 100%.`, true);
    if (!(consumoFrac > 0)) return aviso('Informe o consumo em % do peso vivo.', true);
    const ids = itens.map((i) => i.ingredienteId);
    if (new Set(ids).size !== ids.length) return aviso('Tem ingrediente repetido. Junte numa linha só.', true);
    const dados = { nome: nome.trim(), tipo, unidade, modo, consumoPctPV: consumoFrac, itens: itens.filter((i) => i.qtd > 0), obs: obs.trim() || undefined };
    try {
      if (editando) await db.formulas.update(Number(id), dados);
      else await db.formulas.add({ ...dados, criadoEm: Date.now() });
      aviso('Fórmula salva na biblioteca.');
      nav('/nutricao', { replace: true });
    } catch (e) { aviso((e as Error).message, true); }
  };
  const duplicar = async () => {
    const novo = await db.formulas.add({ nome: `${nome} (cópia)`.slice(0, 80), tipo, unidade, modo, consumoPctPV: consumoFrac, itens: itens.filter((i) => i.qtd > 0), obs: obs || undefined, criadoEm: Date.now() });
    aviso('Cópia criada.');
    nav(`/nutricao/formula/${novo}`, { replace: true });
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar a fórmula "${nome}"?`)) return;
    try { await excluirFormula(Number(id)); aviso('Fórmula apagada.'); nav('/nutricao', { replace: true }); } catch (e) { aviso((e as Error).message, true); }
  };

  const ingsOrdenados = (ingredientes ?? []).slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <>
      <Topo titulo={editando ? nome || 'Fórmula' : 'Nova fórmula'} voltar />
      <main>
        <CampoTexto rotulo="Nome da fórmula" valor={nome} aoMudar={setNome} nome="formulaNome" />
        <CampoEscolha rotulo="Tipo" nome="tipo" valor={tipo} aoMudar={(v) => trocarTipo(v as TipoFormula)} dica={perfil.descricao}>
          {(Object.keys(TIPOS) as TipoFormula[]).map((t) => <option key={t} value={t}>{TIPOS[t].nome}</option>)}
        </CampoEscolha>
        <div className="campo"><span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Montar em</span>
          <Opcoes valor={unidade} aoMudar={setUnidade} opcoes={[{ valor: 'kg', rotulo: 'kg', dica: 'ex.: 575 kg de milho' }, { valor: 'pct', rotulo: '%', dica: 'precisa fechar 100%' }]} />
        </div>

        <div className="cartao">
          <div className="linha-lote" style={{ marginBottom: 8 }}><b>Ingredientes</b>{somaPct != null && <span className={Math.abs(somaPct - 100) > 0.05 ? 'etiqueta ruim' : 'etiqueta'}>{br(somaPct)}%</span>}</div>
          {linhas.map((l, i) => {
            const inc = r.inclusao.find((x) => x.ingredienteId === l.ingredienteId);
            return (
              <div key={i} className="linha-ingrediente">
                <Escolha aria-label={`Ingrediente ${i + 1}`} rotuloVoz={`ingrediente ${i + 1}`} valor={l.ingredienteId} aoMudar={(v) => setLinha(i, 'ingredienteId', Number(v))} style={{ fontSize: 16 }}>
                  <option value={0}>Escolha…</option>
                  {ingsOrdenados.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                </Escolha>
                <button className="remover" aria-label="Remover ingrediente" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ ingredienteId: 0, qtd: '' }]))}>×</button>
                <Entrada voz="numero" aria-label={`Quantidade ${i + 1}`} rotuloVoz={`quantidade ${i + 1}`} valor={l.qtd} placeholder={unidade === 'kg' ? 'kg' : '%'} unidade={unidade === 'kg' ? 'kg' : '%'} aoMudar={(v) => setLinha(i, 'qtd', v)} />
                {unidade === 'kg' && inc && <small className="mudo">{br(inc.pct, 1)}% da mistura</small>}
              </div>
            );
          })}
          <button className="btn sec pequeno" onClick={() => setLinhas((ls) => [...ls, { ingredienteId: 0, qtd: '' }])}>+ Ingrediente</button>
        </div>

        <h2>Resultado</h2>
        <p className="mudo" style={{ fontSize: 15 }}>
          Embaixo de cada número está a <b>faixa adequada</b> para {perfil.nome.split(' (')[0]}{perfil.base === 'mn' && tipo !== 'outro' ? ` com consumo de ${br(consumoFrac * 100, 3)}% do peso vivo` : ''}.
          {perfil.base === 'mn' && tipo !== 'outro' ? ' Mudou o consumo, a faixa dos minerais muda junto.' : ''}
        </p>
        <GradeNutrientes avaliacao={nutrientes} extra={veDinheiro && (
          <div className="indicador"><div className="rotulo">Custo</div><div className="valor" data-testid="custoKg">{rs(r.custoKg, 3)}<small>/kg</small></div></div>
        )} />
        <p className="mudo" style={{ marginTop: 8 }}>
          {perfil.base === 'ms' ? `Na matéria seca. Na matéria natural: PB ${fmtNum(r.mn.pb)}%, NDT ${fmtNum(r.mn.ndt)}%. MS da dieta ${fmtNum(r.mn.ms)}%.` : `Na matéria natural. Na matéria seca: PB ${fmtNum(r.ms.pb)}%, NDT ${fmtNum(r.ms.ndt)}%.`}
          {r.ureiaPct > 0 ? ` Ureia: ${fmtNum(r.ureiaPct)}%.` : ''}
        </p>
        <div style={{ marginTop: 10 }}>
          {alertas.map((a, i) => (
            <div key={i} className={`alerta ${a.nivel}`}>
              <span className="ic">{a.nivel === 'ruim' ? '⚠️' : a.nivel === 'atencao' ? '🔔' : '✅'}</span>
              <div><b>{a.texto}</b>{a.risco}</div>
            </div>
          ))}
          <p className="mudo" style={{ fontSize: 14 }}>
            Faixas de referência: PB, NDT e Ca:P de mercado; Ca, P, cobre e manganês pela exigência do NASEM 2016 e do BR-CORTE, descontando o que o pasto costuma dar (Embrapa);
            fibra pelos rótulos comuns. Confirme com o seu nutricionista.
          </p>
        </div>

        <h2>Consumo e custo</h2>
        <CampoNumero rotulo="Consumo" valor={consumo} aoMudar={setConsumo} unidade="% PV" nome="consumo" dica="Em % do peso vivo por dia. Ex.: 0,1 para proteinado, 0,3 para proteico energético." />
        <div className="cartao">
          <div className="grade">
            <CampoNumero rotulo="Peso do animal" valor={pesoRef} aoMudar={setPesoRef} unidade="kg" pesoVivo />
            <CampoNumero rotulo="GMD esperado" valor={gmdRef} aoMudar={setGmdRef} unidade="kg/d" />
          </div>
          <div className="grade">
            <div><div className="mudo">Consumo por cabeça</div><b>{fmtNum(kgDia, 3)} kg/dia</b></div>
            {veDinheiro && <>
            <div><div className="mudo">Diária por cabeça</div><b data-testid="diaria">{rs(diaria)}</b></div>
            <div><div className="mudo">Custo da @ produzida (só nutrição)</div><b data-testid="custoArroba">{rs(custoArroba)}</b></div>
            <div><div className="mudo">Preço da @ ({rs(config?.precoArroba, 0)})</div>
              <b style={{ color: custoArroba != null && config && custoArroba > config.precoArroba ? 'var(--alerta)' : 'var(--ok)' }}>
                {custoArroba == null || !config ? '—' : custoArroba > config.precoArroba ? 'Nutrição custa mais que a @' : `Sobra ${rs(config.precoArroba - custoArroba)} por @`}
              </b>
            </div>
            </>}
          </div>
        </div>

        <h2>Batida</h2>
        <div className="campo">
          <Opcoes valor={modo} aoMudar={setModo} opcoes={[
            { valor: 'batida', rotulo: 'Bato antes', dica: 'mistura vai para o estoque' },
            { valor: 'direto', rotulo: 'Mistura no trato', dica: 'desconta os ingredientes' },
          ]} />
        </div>
        <CampoNumero rotulo="Calcular uma batida de" valor={kgBatida} aoMudar={setKgBatida} unidade="kg" />
        {r.totalKg > 0 && (
          <div className="cartao rolagem">
            <table className="tab">
              <thead><tr><th>Ingrediente</th><th className="n">kg</th>{veDinheiro && <th className="n">R$</th>}</tr></thead>
              <tbody>
                {batida(r, num(kgBatida) ?? 0).map((b) => {
                  const g = ingredientes?.find((x) => x.id === b.ingredienteId);
                  return <tr key={b.ingredienteId}><td>{g?.nome ?? '?'}</td><td className="n">{br(b.kg, 1)}</td>{veDinheiro && <td className="n">{rs(b.kg * (g?.preco ?? 0))}</td>}</tr>;
                })}
                <tr><td><b>Total</b></td><td className="n"><b>{br(num(kgBatida) ?? 0, 1)}</b></td>{veDinheiro && <td className="n"><b>{rs((num(kgBatida) ?? 0) * r.custoKg)}</b></td>}</tr>
              </tbody>
            </table>
          </div>
        )}

        <CampoTexto rotulo="Observações" valor={obs} aoMudar={setObs} nome="formulaObs" multilinha />
        <button className="btn largo" onClick={salvar}>Salvar fórmula</button>
        {editando && (
          <div className="botoes">
            <button className="btn sec pequeno" onClick={duplicar}>Duplicar</button>
            <button className="btn perigo pequeno" onClick={apagar}>Apagar</button>
          </div>
        )}
      </main>
    </>
  );
}
