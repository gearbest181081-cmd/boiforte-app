import { diaNum, fmtData, type PontoPeso, type Projecao } from '../calc';

/** Curva de crescimento: peso real, linha da meta e projeção até o peso alvo. */
export function GraficoCrescimento({ pontos, gmdMeta, pesoAlvo, projecao }: {
  pontos: PontoPeso[]; gmdMeta?: number | null; pesoAlvo?: number | null; projecao?: Projecao | null;
}) {
  if (pontos.length === 0) return <p className="mudo">Sem pesagens ainda.</p>;
  const W = 340, H = 220, m = { e: 42, d: 12, t: 12, b: 30 };
  const x0 = diaNum(pontos[0].data);
  const ult = pontos[pontos.length - 1];
  let xFim = diaNum(ult.data);
  const proj = projecao && !projecao.jaAtingiu && projecao.diasFaltando <= 730 ? projecao : null;
  if (proj) xFim = Math.max(xFim, diaNum(proj.dataPrevista));
  if (xFim === x0) xFim = x0 + 30;

  const pesos = pontos.map((p) => p.peso);
  if (pesoAlvo) pesos.push(pesoAlvo);
  const bruto = { min: Math.min(...pesos), max: Math.max(...pesos) };
  const folga = Math.max(10, (bruto.max - bruto.min) * 0.1);
  const passo = [5, 10, 20, 25, 50, 100, 200].find((p) => p * 4 >= bruto.max - bruto.min + 2 * folga) ?? 250;
  const yMin = Math.max(0, Math.floor((bruto.min - folga) / passo) * passo);
  const yMax = yMin + Math.ceil((bruto.max + folga - yMin) / passo) * passo;

  const sx = (d: number) => m.e + ((d - x0) / (xFim - x0)) * (W - m.e - m.d);
  const sy = (p: number) => H - m.b - ((p - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const linhaReal = pontos.map((p, i) => `${i ? 'L' : 'M'}${sx(diaNum(p.data)).toFixed(1)},${sy(p.peso).toFixed(1)}`).join(' ');

  const ys: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += passo) ys.push(v);
  let meta = gmdMeta && gmdMeta > 0 ? { x1: x0, y1: pontos[0].peso, x2: xFim, y2: pontos[0].peso + gmdMeta * (xFim - x0) } : null;
  if (meta && meta.y2 > yMax) meta = { ...meta, x2: x0 + (yMax - meta.y1) / gmdMeta!, y2: yMax };

  return (
    <figure style={{ margin: 0 }}>
      <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de crescimento do lote">
        {ys.map((v) => (
          <g key={v}>
            <line x1={m.e} x2={W - m.d} y1={sy(v)} y2={sy(v)} stroke="var(--borda)" strokeWidth={1} />
            <text x={m.e - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--texto-2)">{Math.round(v)}</text>
          </g>
        ))}
        <text x={m.e} y={H - 8} fontSize="11" fill="var(--texto-2)">{fmtData(pontos[0].data).slice(0, 5)}</text>
        <text x={W - m.d} y={H - 8} fontSize="11" fill="var(--texto-2)" textAnchor="end">
          {fmtData(proj ? proj.dataPrevista : ult.data)}
        </text>
        {pesoAlvo ? (
          <g>
            <line x1={m.e} x2={W - m.d} y1={sy(pesoAlvo)} y2={sy(pesoAlvo)} stroke="var(--ouro)" strokeWidth={1.5} strokeDasharray="2 4" />
            <text x={m.e + 4} y={sy(pesoAlvo) - 5} fontSize="11" fill="var(--ouro)" fontWeight="700">alvo {pesoAlvo} kg</text>
          </g>
        ) : null}
        {meta && (
          <line x1={sx(meta.x1)} y1={sy(meta.y1)} x2={sx(meta.x2)} y2={sy(meta.y2)} stroke="var(--texto-2)" strokeWidth={1.5} strokeDasharray="6 4" opacity={0.7} />
        )}
        {proj && (
          <line x1={sx(diaNum(ult.data))} y1={sy(ult.peso)} x2={sx(diaNum(proj.dataPrevista))} y2={sy(pesoAlvo!)} stroke="var(--verde)" strokeWidth={2.5} strokeDasharray="5 5" />
        )}
        <path d={linhaReal} fill="none" stroke="var(--verde)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {pontos.map((p) => (
          <circle key={p.data} cx={sx(diaNum(p.data))} cy={sy(p.peso)} r={4.5} fill="var(--cartao)" stroke="var(--verde)" strokeWidth={2.5}>
            <title>{`${fmtData(p.data)}: ${p.peso.toFixed(1)} kg`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="legenda">
        <span><i style={{ background: 'var(--verde)' }} />Peso real</span>
        {proj && <span><i style={{ background: 'repeating-linear-gradient(90deg,var(--verde) 0 5px,transparent 5px 9px)' }} />Projeção</span>}
        {meta && <span><i style={{ background: 'var(--texto-2)' }} />Meta de GMD</span>}
        {pesoAlvo ? <span><i style={{ background: 'var(--ouro)' }} />Peso alvo</span> : null}
      </figcaption>
    </figure>
  );
}
