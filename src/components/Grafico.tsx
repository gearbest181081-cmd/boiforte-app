import { diaNum, fmtData, fmtNum, type PontoPeso, type Projecao } from '../calc';
import { escalaCurva, escalaGmd } from '../curva';

/** Curva de crescimento: peso real, linha da meta e projeção até o peso alvo. */
export function GraficoCrescimento({ pontos, gmdMeta, pesoAlvo, projecao }: {
  pontos: PontoPeso[]; gmdMeta?: number | null; pesoAlvo?: number | null; projecao?: Projecao | null;
}) {
  const e = escalaCurva(pontos, { gmdMeta, pesoAlvo, projecao });
  if (!e) return <p className="mudo">Sem pesagens ainda.</p>;
  const W = 340, H = 220, m = { e: 42, d: 12, t: 12, b: 30 };
  const { x0, xFim, yMin, yMax, ys, proj, meta } = e;
  const ult = pontos[pontos.length - 1];
  const sx = (d: number) => m.e + ((d - x0) / (xFim - x0)) * (W - m.e - m.d);
  const sy = (p: number) => H - m.b - ((p - yMin) / (yMax - yMin)) * (H - m.t - m.b);
  const linhaReal = pontos.map((p, i) => `${i ? 'L' : 'M'}${sx(diaNum(p.data)).toFixed(1)},${sy(p.peso).toFixed(1)}`).join(' ');

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

/** GMD de cada período entre pesagens, em barras. Vermelho quando ficou abaixo da meta. */
export function GraficoGmd({ periodos, gmdMeta }: { periodos: { ate: string; gmd: number | null }[]; gmdMeta?: number | null }) {
  const ps = periodos.filter((p) => p.gmd != null) as { ate: string; gmd: number }[];
  if (!ps.length) return <p className="mudo">O ganho por período aparece a partir da segunda pesagem.</p>;
  const W = 340, H = 200, m = { e: 42, d: 8, t: 18, b: 28 };
  const { min, max, ys } = escalaGmd(ps.map((p) => p.gmd), gmdMeta);
  const sy = (v: number) => H - m.b - ((v - min) / (max - min)) * (H - m.t - m.b);
  const larg = (W - m.e - m.d) / ps.length;
  const barra = Math.min(46, larg * 0.62);
  const meta = gmdMeta && gmdMeta > 0 ? gmdMeta : null;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ganho de peso por dia em cada período">
        {ys.map((v) => (
          <g key={v}>
            <line x1={m.e} x2={W - m.d} y1={sy(v)} y2={sy(v)} stroke="var(--borda)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={m.e - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--texto-2)">{fmtNum(v, 2)}</text>
          </g>
        ))}
        {ps.map((p, i) => {
          const cx = m.e + larg * i + larg / 2;
          const ruim = meta != null && p.gmd < meta * 0.9;
          const y1 = sy(Math.max(0, p.gmd)), y2 = sy(Math.min(0, p.gmd));
          return (
            <g key={p.ate + i}>
              <rect x={cx - barra / 2} y={y1} width={barra} height={Math.max(1, y2 - y1)} rx={3} fill={ruim ? 'var(--alerta)' : 'var(--verde)'}>
                <title>{`até ${fmtData(p.ate)}: ${fmtNum(p.gmd, 3)} kg/dia`}</title>
              </rect>
              {ps.length <= 8 && <text x={cx} y={p.gmd >= 0 ? y1 - 4 : y2 + 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--texto)">{p.gmd.toFixed(3).replace('.', ',')}</text>}
              {(ps.length <= 8 || i === 0 || i === ps.length - 1) && <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--texto-2)">{fmtData(p.ate).slice(0, 5)}</text>}
            </g>
          );
        })}
        {meta != null && (
          <line x1={m.e} x2={W - m.d} y1={sy(meta)} y2={sy(meta)} stroke="var(--texto-2)" strokeWidth={1.5} strokeDasharray="6 4" />
        )}
      </svg>
      <figcaption className="legenda">
        <span><i style={{ background: 'var(--verde)' }} />GMD do período (kg/dia)</span>
        {meta != null && <><span><i style={{ background: 'var(--alerta)' }} />Mais de 10% abaixo da meta</span><span><i style={{ background: 'var(--texto-2)' }} />Meta {meta.toFixed(3).replace('.', ',')}</span></>}
      </figcaption>
    </figure>
  );
}
