import { useState } from 'react';
import { Link } from 'react-router-dom';
import { desfazerFornecimento, registrarFornecimento } from '../db';
import { useEscala, type LinhaEscala } from '../hooks';
import { fmtData, fmtNum, hojeISO, somaDias } from '../calc';
import { AvisoNutricao, CampoNumero, EntradaData, num, Topo, useAviso } from '../components/ui';
import { useApagar } from '../components/Apagar';
import { rs } from './Nutricao';
import { useVeDinheiro } from '../nuvem/useNuvem';

export function Trato() {
  const [data, setData] = useState(hojeISO());
  const escala = useEscala(data);
  const comDieta = escala?.filter((l) => l.formula) ?? [];
  const semDieta = escala?.filter((l) => !l.formula) ?? [];
  const feitos = comDieta.filter((l) => l.fornecimento).length;

  // Total por mistura (o que o vaqueiro precisa levar)
  const porMistura = new Map<string, number>();
  comDieta.forEach((l) => porMistura.set(l.formula!.nome, (porMistura.get(l.formula!.nome) ?? 0) + l.kgTotal));

  return (
    <>
      <Topo titulo="Trato do dia" />
      <main>
        <AvisoNutricao />
        <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 48px', gap: 8, marginBottom: 14 }}>
          <button className="btn sec pequeno" aria-label="Dia anterior" onClick={() => setData((d) => somaDias(d, -1))}>‹</button>
          <EntradaData valor={data} aoMudar={(v) => v && setData(v)} aria-label="Data do trato" rotuloVoz="data do trato" />
          <button className="btn sec pequeno" aria-label="Próximo dia" onClick={() => setData((d) => somaDias(d, 1))}>›</button>
        </div>

        {comDieta.length > 0 && (
          <div className="cartao">
            <div className="linha-lote"><b>{data === hojeISO() ? 'Hoje' : fmtData(data)}</b><span className={`etiqueta ${feitos === comDieta.length ? '' : 'atencao'}`}>{feitos} de {comDieta.length} feitos</span></div>
            {[...porMistura].map(([nome, kg]) => <div key={nome} className="linha-lote"><span>{nome}</span><b>{fmtNum(kg, 0)} kg</b></div>)}
          </div>
        )}

        {comDieta.map((l) => <CartaoTrato key={`${l.lote.id}-${data}`} linha={l} data={data} />)}

        {escala && comDieta.length === 0 && (
          <div className="dica">Nenhum lote com dieta definida. Crie a fórmula em <Link to="/nutricao">Nutrição</Link> e escolha a dieta em cada lote (Editar lote).</div>
        )}
        {semDieta.length > 0 && (
          <>
            <h2>Sem dieta definida</h2>
            {semDieta.map((l) => (
              <Link key={l.lote.id} to={`/lotes/${l.lote.id}/editar`} className="cartao linha-lote"><span>{l.lote.nome}</span><span className="mudo">definir dieta ›</span></Link>
            ))}
          </>
        )}
      </main>
    </>
  );
}

function CartaoTrato({ linha: l, data }: { linha: LinhaEscala; data: string }) {
  const aviso = useAviso();
  const apagarComDesfazer = useApagar();
  const [kg, setKg] = useState(l.kgTotal ? fmtNum(l.kgTotal, 1).replace(/\./g, '') : '');
  const [ocupado, setOcupado] = useState(false);
  const feito = !!l.fornecimento;
  const veDinheiro = useVeDinheiro();

  const marcar = async () => {
    setOcupado(true);
    try {
      if (feito) {
        await apagarComDesfazer(() => desfazerFornecimento(l.fornecimento!.id!), `Trato do ${l.lote.nome} desmarcado. O estoque voltou.`);
      } else {
        const kgReal = num(kg);
        if (kgReal == null || kgReal < 0) { aviso('Informe quantos kg foram fornecidos.', true); return; }
        if (!l.pesoRef) { aviso('Pese o lote antes, para o app saber quanto dar.', true); return; }
        await registrarFornecimento({ loteId: l.lote.id!, data, kgFornecido: kgReal, kgPrevisto: Math.round(l.kgTotal * 100) / 100, cabecas: l.lote.qtdCabecas, pesoRef: Math.round(l.pesoRef * 10) / 10 });
        aviso(`Trato do ${l.lote.nome} marcado.`);
      }
    } catch (e) { aviso((e as Error).message, true); }
    finally { setOcupado(false); }
  };

  return (
    <div className="cartao" style={feito ? { borderColor: 'var(--ok)', background: 'var(--ok-claro)' } : undefined}>
      <div className="linha-lote"><h3>{l.lote.nome}</h3><span className="num">{l.lote.qtdCabecas} cab</span></div>
      <p className="mudo">{l.formula!.nome} · {fmtNum(l.consumoPctPV * 100, 2)}% do PV · peso {l.pesoRef ? `${fmtNum(l.pesoRef, 0)} kg (estimado)` : 'sem pesagem'}</p>
      <div className="grade" style={{ marginBottom: 10 }}>
        <div><div className="mudo">Por cabeça</div><b>{fmtNum(l.kgCab, 2)} kg</b></div>
        {veDinheiro && <div><div className="mudo">Custo do dia</div><b>{rs(feito ? l.fornecimento!.custo : l.custoPrevisto)}</b></div>}
      </div>
      {feito ? (
        <p><b>Fornecido: {fmtNum(l.fornecimento!.kgFornecido, 1)} kg</b>{Math.abs(l.fornecimento!.kgFornecido - l.fornecimento!.kgPrevisto) > 0.5 ? <span className="mudo"> (previsto {fmtNum(l.fornecimento!.kgPrevisto, 1)} kg)</span> : null}</p>
      ) : (
        <CampoNumero rotulo="Total para o lote" unidade="kg" valor={kg} aoMudar={setKg} rotuloAcessivel={`kg para ${l.lote.nome}`} />
      )}
      <button className={`btn largo ${feito ? 'sec' : ''}`} onClick={marcar} disabled={ocupado} role="checkbox" aria-checked={feito} aria-label={`Trato ${l.lote.nome}`}>
        <span style={{ fontSize: 24 }}>{feito ? '☑' : '☐'}</span> {feito ? 'Fornecido (tocar para desfazer)' : 'Marcar como fornecido'}
      </button>
    </div>
  );
}
