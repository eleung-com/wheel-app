import React, { useState } from 'react';
import { money } from '../../../lib/research/explain';

// Small bar chart for the Research result screen. One y-axis (dollars), bars
// for 1–2 stacked series plus an optional line series on the same scale.
// Palette checked with the dataviz validator against the app surface (#FAF9F4):
//   periwinkle #5B62B8 / amber #B0791A (debt split) and sage #6F7F35 /
//   periwinkle #5B62B8 (FCF vs capex) both pass CVD + normal-vision checks.
// Hover / tap a bar → the period's values appear in the readout line.

const W = 320, H = 132, PL = 34, PR = 6, PT = 8, PB = 18;

export default function MiniBarChart({ labels, bars, line, negativeColor = '#8B4048', ariaLabel }) {
  const [hover, setHover] = useState(null);
  const n = labels.length;
  if (!n) return <div className="rs-chart-empty">No data</div>;

  // Stacked totals for the y-range.
  const totals = labels.map((_, i) => bars.reduce((s, b) => s + (b.data[i] ?? 0), 0));
  const all = [...totals, ...(line ? line.data.filter((v) => v != null) : []), 0];
  const max = Math.max(...all), min = Math.min(...all);
  const span = (max - min) || 1;
  const y = (v) => PT + (H - PT - PB) * (1 - (v - min) / span);
  const slot = (W - PL - PR) / n;
  const bw = Math.max(2, slot - 2); // 2px surface gap between bars

  const ticks = [max, (max + min) / 2].filter((t, i, a) => a.indexOf(t) === i);
  const at = hover ?? n - 1;

  return (
    <div className="rs-chart">
      <div className="rs-readout">
        <b>{labels[at]}</b>
        {bars.map((b) => <span key={b.name}><i style={{ background: b.color }} />{b.name} {money(b.data[at])}</span>)}
        {line && <span><i className="ln" style={{ background: line.color }} />{line.name} {money(line.data[at])}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="rgba(38,37,36,.08)" />
            <text x={PL - 4} y={y(t) + 3} fontSize="8" fill="#9A958B" textAnchor="end">{money(t).replace('$', '')}</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="rgba(38,37,36,.22)" />
        {labels.map((_, i) => {
          let base = 0;
          const x = PL + i * slot + 1;
          return (
            <g key={i}>
              {bars.map((b, bi) => {
                const v = b.data[i];
                if (v == null) return null;
                const y0 = y(base), y1 = y(base + v);
                base += v;
                const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
                const fill = v < 0 && b.allowNegative ? negativeColor : b.color;
                return <rect key={bi} x={x} y={top} width={bw} height={h - (bi < bars.length - 1 ? 1 : 0)} rx="1.5" fill={fill}
                  opacity={hover === null || hover === i ? 1 : 0.45} />;
              })}
              <rect x={PL + i * slot} y={PT} width={slot} height={H - PT - PB} fill="transparent"
                onPointerEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
        {line && (
          <polyline fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={line.dashed ? '4 3' : undefined}
            points={line.data.map((v, i) => (v == null ? null : `${PL + i * slot + slot / 2},${y(v)}`)).filter(Boolean).join(' ')} />
        )}
        <text x={PL + slot / 2} y={H - 4} fontSize="8" fill="#9A958B" textAnchor="middle">{labels[0]}</text>
        <text x={W - PR - slot / 2} y={H - 4} fontSize="8" fill="#9A958B" textAnchor="middle">{labels[n - 1]}</text>
      </svg>
    </div>
  );
}
