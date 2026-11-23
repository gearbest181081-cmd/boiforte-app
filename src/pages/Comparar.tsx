// Simulação › Comparar produtos: fórmulas da biblioteca ou dois produtos pela foto do rótulo (ou digitados).
// Nada aqui é salvo.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, garantirIngredientesPadrao } from '../db';
import { calcularFormula, TIPOS, type TipoFormula } from '../nutricao';
import { compararProdutos, NUTRIENTE_CHAVE, produtoAvulso, type ProdutoComp, type ResultadoComp } from '../comparar';
import { fmtValor, nivelStatus, ROTULO_STATUS } from '../faixas';
import { fmtNum } from '../calc';
import { CampoEscolha, CampoNumero, CampoTexto, num, Opcoes, useAviso } from '../components/ui';
import { BotaoFoto } from '../components/Foto';
import { CATEGORIAS } from './IngredienteForm';
import { rs } from './Nutricao';
import type { LeituraRotulo } from '../../supabase/functions/_shared/foto';

const br = (x: number | null | undefined, c = 3) => (x == null || !Number.isFinite(x) ? '' : String(+x.toFixed(c)).replace('.', ','));
const TIPOS_LISTA = (Object.keys(TIPOS) as TipoFormula[]);

export function SimComparar() {
  const [modo, setModo] = useState<'biblioteca' | 'foto'>('biblioteca');
  const [peso, setPeso] = useState('300');
  const [cab, setCab] = useState('1');
  const pesoKg = num(peso) ?? 0;
  const cabecas = Math.max(1, Math.round(num(cab) ?? 1));
  return (
    <>
      <div className="cartao">
        <h3>Qual produto vale mais a pena?</h3>
        <p className="mudo">Compare fórmulas que você já cadastrou ou dois produtos pela foto da tabela nutricional.</p>
        <Opcoes valor={modo} aoMudar={setModo} opcoes={[
          { valor: 'biblioteca', rotulo: 'Minhas fórmulas', dica: 'da Nutrição' },
          { valor: 'foto', rotulo: 'Dois rótulos', dica: 'foto ou digitando' },
        ]} />
        <div className="grade" style={{ marginTop: 12 }}>
          <CampoNumero rotulo="Peso do animal" valor={peso} aoMudar={setPeso} unidade="kg" nome="cmpPeso" />
          <CampoNumero rotulo="Cabeças" valor={cab} aoMudar={setCab} nome="cmpCab" />
        </div>
      </div>
      {modo === 'biblioteca' ? <DaBiblioteca pesoKg={pesoKg} cabecas={cabecas} /> : <PorRotulo pesoKg={pesoKg} cabecas={cabecas} />}
    </>
  );
}

function DaBiblioteca({ pesoKg, cabecas }: { pesoKg: number; cabecas: number }) {
  useEffect(() => { garantirIngredientesPadrao().catch(() => {}); }, []);
  const formulas = useLiveQuery(() => db.formulas.toArray());
  const ingredientes = useLiveQuery(() => db.ingredientes.toArray());
  const [sel, setSel] = useState<number[]>([]);
  if (!formulas || !ingredientes) return null;
  if (formulas.length < 2) return <div className="dica">Cadastre pelo menos duas fórmulas em Nutrição para comparar. Ou use “Dois rótulos”.</div>;
  const lista = formulas.slice().sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const alternar = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const produtos: ProdutoComp[] = sel.map((id) => formulas.find((f) => f.id === id)).filter((f) => !!f)
    .map((f) => ({ nome: f!.nome, tipo: f!.tipo, consumoPctPV: f!.consumoPctPV, r: calcularFormula(f!.itens, ingredientes) }));
  return (
    <>
      <div className="cartao">
        <b>Escolha de 2 a 4 fórmulas</b>
        <p className="mudo" style={{ fontSize: 14 }}>O ideal é comparar do mesmo tipo (ex.: dois proteinados).</p>
        {lista.map((f) => (
          <label key={f.id} className="campo" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <input type="checkbox" name="cmpFormula" checked={sel.includes(f.id!)} onChange={() => alternar(f.id!)} style={{ width: 28, minHeight: 28 }} />
            <span style={{ margin: 0 }}>{f.nome} <span className="etiqueta">{TIPOS[f.tipo].nome.split(' (')[0]}</span></span>
          </label>
        ))}
      </div>
      {produtos.length >= 2 ? <Resultado res={compararProdutos(produtos, pesoKg, cabecas)} cabecas={cabecas} /> : <p className="mudo">Marque pelo menos duas fórmulas.</p>}
    </>
  );
}

type Campos = Record<'nome' | 'preco' | 'consumo' | 'ms' | 'pb' | 'ndt' | 'ca' | 'p' | 'fb' | 'cobre' | 'manganes' | 'ureiaTeor', string>;
interface Rotulo { v: Campos; tipo: TipoFormula; consumoRotulo: string | null; lido: boolean }
const novo = (): Rotulo => ({ v: { nome: '', preco: '', consumo: '', ms: '90', pb: '', ndt: '', ca: '', p: '', fb: '', cobre: '', manganes: '', ureiaTeor: '' }, tipo: 'proteinado', consumoRotulo: null, lido: false });

function PorRotulo({ pesoKg, cabecas }: { pesoKg: number; cabecas: number }) {
  const [prods, setProds] = useState<Rotulo[]>([novo(), novo()]);
  const muda = (i: number, p: Partial<Rotulo>) => setProds((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const produtos: ProdutoComp[] = [];
  const faltando: string[] = [];
  prods.forEach((x, i) => {
    const nome = x.v.nome.trim() || `Produto ${i + 1}`;
    const preco = num(x.v.preco), consumo = (num(x.v.consumo) ?? TIPOS[x.tipo].consumoPctPV * 100) / 100;
    if (!(preco! > 0)) faltando.push(`o preço do ${nome}`);
    const n = (k: keyof Campos) => num(x.v[k]) ?? undefined;
    produtos.push(produtoAvulso(nome, x.tipo, consumo, {
      ms: n('ms') ?? 90, pb: n('pb') ?? 0, ndt: n('ndt') ?? 0, ca: n('ca') ?? 0, p: n('p') ?? 0,
      fb: n('fb'), cobre: n('cobre'), manganes: n('manganes'), ureiaTeor: n('ureiaTeor'), preco: preco ?? 0,
    }, (['pb', 'ndt', 'ca', 'p'] as const).filter((k) => n(k) == null)));
  });
  return (
    <>
      {prods.map((x, i) => <CartaoRotulo key={i} i={i} x={x} pesoKg={pesoKg} muda={(p) => muda(i, p)} />)}
      {faltando.length ? <p className="mudo">Falta {faltando.join(' e ')}.</p> : <Resultado res={compararProdutos(produtos, pesoKg, cabecas)} cabecas={cabecas} />}
    </>
  );
}

function CartaoRotulo({ i, x, pesoKg, muda }: { i: number; x: Rotulo; pesoKg: number; muda: (p: Partial<Rotulo>) => void }) {
  const aviso = useAviso();
  const set = (k: keyof Campos) => (val: string) => muda({ v: { ...x.v, [k]: val } });
  const leu = (r: LeituraRotulo) => {
    if (!r.legivel) return aviso('Não deu para ler a tabela. Tente uma foto mais perto, reta e com luz.', true);
    const v = { ...x.v };
    if (r.nome) v.nome = r.nome;
    for (const k of ['ms', 'pb', 'ndt', 'ca', 'p', 'fb', 'cobre', 'manganes', 'ureiaTeor'] as const) if (r[k] != null) v[k] = br(r[k]);
    if (r.consumoPctPV != null) v.consumo = br(r.consumoPctPV * 100);
    const pronto = CATEGORIAS.find((c) => c.valor === r.categoria)?.pronto;
    muda({ v, tipo: pronto ?? x.tipo, consumoRotulo: r.consumo, lido: true });
  };
  const consumoFrac = (num(x.v.consumo) ?? TIPOS[x.tipo].consumoPctPV * 100) / 100;
  return (
    <div className="cartao" data-testid={`rotulo${i + 1}`}>
      <h3>Produto {i + 1}</h3>
      <BotaoFoto<LeituraRotulo> tipo="rotulo" rotulo="📷 Foto da tabela nutricional" sempre aoLer={leu} aoErro={(m) => aviso(m, true)} />
      {x.lido && <div className="alerta atencao" style={{ marginTop: 8 }}><span className="ic">📷</span><div><b>Lido da foto.</b>Confira os números com o rótulo.{x.consumoRotulo ? ` Consumo no rótulo: ${x.consumoRotulo}.` : ''}</div></div>}
      <CampoTexto rotulo="Nome" valor={x.v.nome} aoMudar={set('nome')} nome={`cmpNome${i}`} />
      <CampoEscolha rotulo="Tipo" nome={`cmpTipo${i}`} valor={x.tipo} aoMudar={(t) => muda({ tipo: t as TipoFormula })}>
        {TIPOS_LISTA.map((t) => <option key={t} value={t}>{TIPOS[t].nome}</option>)}
      </CampoEscolha>
      <div className="grade">
        <CampoNumero rotulo="Preço por kg" valor={x.v.preco} aoMudar={set('preco')} unidade="R$" nome={`cmpPreco${i}`} dica="Preço do saco ÷ kg do saco" />
        <CampoNumero rotulo="Consumo" valor={x.v.consumo} aoMudar={set('consumo')} unidade="% PV" nome={`cmpConsumo${i}`}
          dica={`${x.v.consumo ? '' : `Vazio = ${br(TIPOS[x.tipo].consumoPctPV * 100)}%. `}${fmtNum(pesoKg * consumoFrac * 1000, 0)} g/cab/dia`} />
      </div>
      <details open={!x.lido}>
        <summary style={{ fontWeight: 600, margin: '6px 0 10px', cursor: 'pointer' }}>Níveis de garantia (do rótulo)</summary>
        <div className="grade">
          <CampoNumero rotulo="Proteína (PB)" valor={x.v.pb} aoMudar={set('pb')} unidade="%" nome={`cmpPb${i}`} />
          <CampoNumero rotulo="NDT" valor={x.v.ndt} aoMudar={set('ndt')} unidade="%" nome={`cmpNdt${i}`} />
          <CampoNumero rotulo="Cálcio" valor={x.v.ca} aoMudar={set('ca')} unidade="%" nome={`cmpCa${i}`} />
          <CampoNumero rotulo="Fósforo" valor={x.v.p} aoMudar={set('p')} unidade="%" nome={`cmpP${i}`} />
          <CampoNumero rotulo="Fibra bruta" valor={x.v.fb} aoMudar={set('fb')} unidade="%" nome={`cmpFb${i}`} />
          <CampoNumero rotulo="Ureia contida" valor={x.v.ureiaTeor} aoMudar={set('ureiaTeor')} unidade="%" nome={`cmpUreia${i}`} />
          <CampoNumero rotulo="Cobre" valor={x.v.cobre} aoMudar={set('cobre')} unidade="mg/kg" nome={`cmpCu${i}`} />
          <CampoNumero rotulo="Manganês" valor={x.v.manganes} aoMudar={set('manganes')} unidade="mg/kg" nome={`cmpMn${i}`} />
        </div>
        <CampoNumero rotulo="Matéria seca" valor={x.v.ms} aoMudar={set('ms')} unidade="%" nome={`cmpMs${i}`} dica="100 menos a umidade do rótulo" />
      </details>
    </div>
  );
}

const ICONE: Record<string, string> = { bom: '✅', atencao: '🔔', ruim: '⚠️' };

function Resultado({ res, cabecas }: { res: ResultadoComp; cabecas: number }) {
  const { linhas, melhorTipo, melhorCusto } = res;
  const mt = melhorTipo != null ? linhas[melhorTipo] : null;
  const mc = melhorCusto != null ? linhas[melhorCusto] : null;
  const chaveNome = NUTRIENTE_CHAVE[linhas[0].tipo].nome;
  return (
    <>
      <h2>Resultado</h2>
      {!res.mesmoTipo && (
        <div className="alerta atencao"><span className="ic">🔔</span><div><b>Os produtos são de tipos diferentes.</b>Cada um foi conferido com a faixa do seu tipo. O custo-benefício compara o gasto por cabeça por dia.</div></div>
      )}
      {mt && (
        <div className={`alerta ${mt.criticos ? 'atencao' : 'bom'}`} data-testid="melhorTipo">
          <span className="ic">🏆</span>
          <div><b>Mais adequado{res.mesmoTipo ? ` para ${TIPOS[mt.tipo].nome.split(' (')[0]}` : ' ao seu tipo'}: {mt.nome}</b>
            {mt.pontos === 0 ? (mt.avaliacao.some((x) => x.status === 'sem_dado') ? 'Nenhum item fora da faixa entre os que o rótulo informa.' : 'Todos os itens dentro da faixa.') : `${mt.criticos ? `${mt.criticos} item(ns) crítico(s) e ` : ''}${mt.atencao} item(ns) um pouco fora da faixa, o menor número entre os produtos.`}
          </div>
        </div>
      )}
      {mc && (
        <div className={`alerta ${mc.criticos ? 'atencao' : 'bom'}`} data-testid="melhorCusto">
          <span className="ic">💰</span>
          <div><b>Melhor custo-benefício: {mc.nome}</b>
            {res.criterioCusto === 'nutriente'
              ? `Cada kg de ${chaveNome} sai por ${rs(mc.chave.custoKg)}, o mais barato. Gasto de ${rs(mc.custoDia)} por cabeça por dia.`
              : `Gasto de ${rs(mc.custoDia)} por cabeça por dia, o menor.`}
            {mc.criticos ? ' Atenção: todos os produtos têm algum item crítico.' : ''}
          </div>
        </div>
      )}
      {linhas.some((l) => l.criticos) && (
        <div className="alerta ruim"><span className="ic">⚠️</span><div><b>Itens críticos</b>
          {linhas.filter((l) => l.criticos).map((l) => `${l.nome}: ${[...l.avaliacao.filter((a) => a.critico).map((a) => `${a.curto} ${ROTULO_STATUS[a.status].toLowerCase()}`), ...(l.ureiaAcima ? ['ureia acima do limite'] : [])].join(', ')}`).join('. ')}.
        </div></div>
      )}
      <div className="cartao rolagem">
        <table className="tab comparar" data-testid="tabelaComparar">
          <thead><tr><th></th>{linhas.map((l, i) => <th key={i} className="n">{l.nome}{i === melhorTipo ? ' 🏆' : ''}{i === melhorCusto ? ' 💰' : ''}</th>)}</tr></thead>
          <tbody>
            <tr><td>Tipo</td>{linhas.map((l, i) => <td key={i} className="n">{TIPOS[l.tipo].nome.split(' (')[0]}</td>)}</tr>
            <tr><td>Preço</td>{linhas.map((l, i) => <td key={i} className="n">{rs(l.custoKg)}/kg</td>)}</tr>
            <tr><td>Consumo</td>{linhas.map((l, i) => <td key={i} className="n">{fmtNum(l.gDia, 0)} g/cab/dia</td>)}</tr>
            <tr><td><b>Gasto por cabeça/dia</b></td>{linhas.map((l, i) => <td key={i} className="n"><b>{rs(l.custoDia)}</b></td>)}</tr>
            <tr><td>Gasto em 30 dias{cabecas > 1 ? ` (${cabecas} cab)` : ''}</td>{linhas.map((l, i) => <td key={i} className="n">{rs(l.custoMes, 0)}</td>)}</tr>
            <tr><td>R$ por kg de {res.mesmoTipo ? chaveNome : 'nutriente principal'}</td>{linhas.map((l, i) => <td key={i} className="n">{rs(l.chave.custoKg)}</td>)}</tr>
            {linhas[0].avaliacao.map((a0, k) => (
              <tr key={a0.chave}>
                <td>{a0.curto}</td>
                {linhas.map((l, i) => {
                  const a = l.avaliacao[k];
                  const nivel = nivelStatus(a.status, a.critico);
                  return <td key={i} className="n">{a.valor == null ? '—' : fmtValor(a.valor, a.unidade)}{nivel && <> {ICONE[nivel]}</>}</td>;
                })}
              </tr>
            ))}
            <tr><td>Itens fora da faixa</td>{linhas.map((l, i) => <td key={i} className="n">{l.criticos + l.atencao}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="mudo" style={{ fontSize: 14 }}>✅ dentro da faixa · 🔔 um pouco fora · ⚠️ crítico. As faixas dos minerais dependem do consumo de cada produto. Confirme com o seu nutricionista.</p>
    </>
  );
}
