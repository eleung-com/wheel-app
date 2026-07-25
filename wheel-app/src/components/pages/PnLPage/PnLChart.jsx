import React, { useState, useRef } from 'react';

/**
 * Reusable option P&L visuals: the payoff chart and the max-profit / max-loss /
 * breakeven stats bar. Driven by a `legs` array — each leg
 * { action:'buy'|'sell', optType:'call'|'put', qty, strike, premium }.
 * Used by the Add/Edit Position modal to project a single short leg.
 */

// ── P&L math ──────────────────────────────────────────────────────────────────
function legPnl(leg, price) {
  const k = parseFloat(leg.strike)  || 0;
  const p = parseFloat(leg.premium) || 0;
  const q = parseInt(leg.qty, 10)   || 1;
  const intrinsic = leg.optType === 'call'
    ? Math.max(0, price - k)
    : Math.max(0, k - price);
  return (leg.action === 'buy' ? intrinsic - p : p - intrinsic) * q * 100;
}

function totalPnl(legs, price) {
  return legs.reduce((sum, leg) => sum + legPnl(leg, price), 0);
}

function findBreakevens(prices, pnls) {
  const bes = [];
  for (let i = 1; i < pnls.length; i++) {
    const a = pnls[i - 1], b = pnls[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0))
      bes.push(prices[i - 1] + (a / (a - b)) * (prices[i] - prices[i - 1]));
  }
  return bes;
}

function niceStep(range) {
  if (range <= 0) return 100;
  const rough = range / 6;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm  = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

function fmtPnl(v) {
  const abs  = Math.abs(v);
  const sign = v < 0 ? '-' : '+';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ── SVG P&L Chart ─────────────────────────────────────────────────────────────
const W = 560, H = 260;
const PAD = { top: 26, right: 16, bottom: 36, left: 60 };
const CW  = W - PAD.left - PAD.right;
const CH  = H - PAD.top  - PAD.bottom;

export function PnLChart({ legs }) {
  const [hoverPct, setHoverPct] = useState(null);
  const wrapRef = useRef(null);

  const strikes  = legs.map(l => parseFloat(l.strike)).filter(Boolean);
  const avgStrike = strikes.length
    ? strikes.reduce((a, b) => a + b, 0) / strikes.length
    : 50;
  const lo = Math.max(0.01, avgStrike * 0.4);
  const hi = avgStrike * 1.6;

  const STEPS  = 300;
  const prices = Array.from({ length: STEPS + 1 }, (_, i) => lo + i * (hi - lo) / STEPS);
  const pnls   = prices.map(p => totalPnl(legs, p));

  const rawMax = Math.max(...pnls);
  const rawMin = Math.min(...pnls);
  const pad    = Math.max(50, (rawMax - rawMin) * 0.12);
  const step   = niceStep(rawMax - rawMin + pad * 2);
  const yMin   = Math.floor((rawMin - pad) / step) * step;
  const yMax   = Math.ceil ((rawMax + pad) / step) * step;
  const yRange = yMax - yMin;

  const yTicks = [];
  for (let v = yMin; v <= yMax + step * 0.01; v += step) yTicks.push(Math.round(v));

  const breakevens = findBreakevens(prices, pnls);

  const toX   = p  => PAD.left + ((p  - lo)   / (hi - lo)) * CW;
  const toY   = pv => PAD.top  + ((yMax - pv) / yRange)    * CH;
  const zeroY = toY(0);

  const pts   = prices.map((p, i) => `${toX(p).toFixed(1)},${toY(pnls[i]).toFixed(1)}`);
  const lineD = `M ${pts[0]} ` + pts.slice(1).map(pt => `L ${pt}`).join(' ');
  const areaD = lineD
    + ` L ${toX(hi).toFixed(1)},${zeroY.toFixed(1)}`
    + ` L ${toX(lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const xTicks = Array.from({ length: 7 }, (_, i) => lo + (i / 6) * (hi - lo));

  const fmtY = v => {
    if (v === 0) return '$0';
    const abs = Math.abs(v), sign = v < 0 ? '-' : '';
    if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
    return `${sign}$${abs}`;
  };

  function handlePointer(clientX) {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const svgX = (clientX - rect.left) / rect.width * W;
    setHoverPct(Math.max(0, Math.min(1, (svgX - PAD.left) / CW)));
  }

  const hoverPrice = hoverPct !== null ? lo + hoverPct * (hi - lo) : null;
  const hoverPnl   = hoverPrice !== null ? totalPnl(legs, hoverPrice) : null;
  const hoverX     = hoverPrice !== null ? toX(hoverPrice) : null;
  const hoverY     = hoverPnl  !== null ? toY(hoverPnl)   : null;
  const tipRight   = hoverPct !== null && hoverPct < 0.55;
  const tipAnchorX = hoverX !== null ? (tipRight ? hoverX + 8 : hoverX - 8) : 0;

  // Badge label at top of a vertical marker line
  function VMarker({ x, color, label, row = 0 }) {
    const TW = label.length * 5.6 + 10;
    const TH = 13;
    const tx = Math.max(PAD.left + TW / 2 + 2, Math.min(PAD.left + CW - TW / 2 - 2, x));
    const ty = PAD.top + row * (TH + 3);
    return (
      <g>
        <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + CH}
          stroke={color} strokeWidth="1.5" strokeDasharray="6,4" strokeOpacity="0.9" />
        <rect x={tx - TW / 2} y={ty} width={TW} height={TH} rx="3" fill={color} fillOpacity="0.92" />
        <text x={tx} y={ty + TH - 3.5} textAnchor="middle"
          fontSize="8" fill="#fff" fontFamily="monospace" fontWeight="600">{label}</text>
      </g>
    );
  }

  return (
    <div
      ref={wrapRef}
      style={{ width: '100%', touchAction: 'none', cursor: 'crosshair' }}
      onMouseMove={e  => handlePointer(e.clientX)}
      onMouseLeave={() => setHoverPct(null)}
      onTouchMove={e  => { e.preventDefault(); handlePointer(e.touches[0].clientX); }}
      onTouchEnd={() => setHoverPct(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <clipPath id="pnl-above">
            <rect x={PAD.left} y={PAD.top} width={CW} height={Math.max(0, zeroY - PAD.top)} />
          </clipPath>
          <clipPath id="pnl-below">
            <rect x={PAD.left} y={zeroY} width={CW} height={Math.max(0, PAD.top + CH - zeroY)} />
          </clipPath>
          <clipPath id="pnl-area">
            <rect x={PAD.left} y={PAD.top} width={CW} height={CH} />
          </clipPath>
        </defs>

        {/* Y grid + labels */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.left} y1={toY(v)} x2={PAD.left + CW} y2={toY(v)}
              style={{ stroke: v === 0 ? 'var(--mu2)' : 'var(--b1)' }}
              strokeWidth={v === 0 ? 1 : 0.8} />
            <text x={PAD.left - 6} y={toY(v) + 3.5}
              textAnchor="end" fontSize="8.5" style={{ fill: 'var(--mu)' }} fontFamily="monospace">
              {fmtY(v)}
            </text>
          </g>
        ))}

        {/* X grid + labels */}
        {xTicks.map((p, i) => (
          <g key={i}>
            <line x1={toX(p)} y1={PAD.top} x2={toX(p)} y2={PAD.top + CH}
              style={{ stroke: 'var(--b1)' }} strokeWidth="0.8" />
            <text x={toX(p)} y={PAD.top + CH + 13}
              textAnchor="middle" fontSize="8.5" style={{ fill: 'var(--mu)' }} fontFamily="monospace">
              ${p.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Fills */}
        <path d={areaD} fill="rgba(31,216,160,0.22)" clipPath="url(#pnl-above)" />
        <path d={areaD} fill="rgba(255,82,82,0.22)"  clipPath="url(#pnl-below)" />

        {/* P&L line */}
        <path d={lineD} fill="none" style={{ stroke: 'var(--tx)' }} strokeWidth="1.8"
          strokeLinejoin="round" strokeLinecap="round" clipPath="url(#pnl-area)" />

        {/* Breakeven markers */}
        {breakevens.map((be, i) =>
          be >= lo && be <= hi && (
            <VMarker key={i} x={toX(be)} color="#ff5252" label={`BE $${be.toFixed(2)}`} row={i} />
          )
        )}

        {/* Hover crosshair + dot + tooltip */}
        {hoverX !== null && (
          <g>
            <line x1={hoverX} y1={PAD.top} x2={hoverX} y2={PAD.top + CH}
              style={{ stroke: 'var(--mu2)' }} strokeWidth="1" strokeDasharray="3,2" />
            <circle cx={hoverX} cy={hoverY} r="5.5"
              fill={hoverPnl >= 0 ? 'rgba(31,216,160,0.25)' : 'rgba(255,82,82,0.25)'} />
            <circle cx={hoverX} cy={hoverY} r="3"
              fill={hoverPnl >= 0 ? '#1fd8a0' : '#ff5252'}
              stroke="rgba(255,255,255,0.8)" strokeWidth="1.2" />
            <rect
              x={tipRight ? tipAnchorX : tipAnchorX - 84}
              y={Math.min(hoverY - 28, PAD.top + CH - 34)}
              width={84} height={30} rx="4"
              fill="rgba(14,14,20,0.94)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"
            />
            <text
              x={tipRight ? tipAnchorX + 6 : tipAnchorX - 78}
              y={Math.min(hoverY - 28, PAD.top + CH - 34) + 12}
              fontSize="8.5" fill="rgba(255,255,255,0.55)" fontFamily="monospace">
              ${hoverPrice.toFixed(2)}
            </text>
            <text
              x={tipRight ? tipAnchorX + 6 : tipAnchorX - 78}
              y={Math.min(hoverY - 28, PAD.top + CH - 34) + 23}
              fontSize="9.5" fontWeight="700" fontFamily="monospace"
              fill={hoverPnl >= 0 ? '#1fd8a0' : '#ff5252'}>
              {fmtPnl(hoverPnl)}
            </text>
          </g>
        )}

        {/* Axis labels */}
        <text x={PAD.left - 46} y={PAD.top + CH / 2} textAnchor="middle"
          fontSize="8" style={{ fill: 'var(--mu)' }} fontFamily="monospace"
          transform={`rotate(-90, ${PAD.left - 46}, ${PAD.top + CH / 2})`}>
          P&amp;L at Expiry ($)
        </text>
        <text x={PAD.left + CW / 2} y={H - 2} textAnchor="middle"
          fontSize="8" style={{ fill: 'var(--mu)' }} fontFamily="monospace">
          Price at Expiry ($)
        </text>
      </svg>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
export function StatsBar({ legs }) {
  const strikes  = legs.map(l => parseFloat(l.strike)).filter(Boolean);
  const refPrice = strikes.length ? Math.max(...strikes) : 50;

  const hiStat = Math.max(refPrice * 5, ...strikes.map(s => s * 3));
  const prices = Array.from({ length: 1001 }, (_, i) => (i / 1000) * hiStat);
  prices.push(0.001);
  const pnls = prices.map(p => totalPnl(legs, p));
  pnls.push(totalPnl(legs, 1_000_000));

  const maxPnl = Math.max(...pnls);
  const minPnl = Math.min(...pnls);
  // Breakevens run over the real 0…hiStat sweep only. The 0.001 / 1e6 sentinels
  // above exist just for min/max detection; including them here left prices and
  // pnls at mismatched lengths, so findBreakevens read an undefined price and
  // reported a phantom "$NaN" breakeven.
  const baseLen = prices.length - 1;
  const bes     = findBreakevens(prices.slice(0, baseLen), pnls.slice(0, baseLen));

  const fmt = v => {
    const abs = Math.abs(v);
    if (abs >= 1000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
    return `${v < 0 ? '-' : ''}$${abs.toFixed(0)}`;
  };

  return (
    <div style={{
      display: 'flex', gap: 16, flexWrap: 'wrap',
      padding: '10px 12px', marginBottom: 12,
      background: 'var(--b1)', borderRadius: 8,
    }}>
      {[
        { label: 'MAX PROFIT', val: maxPnl > 9e5 ? '∞' : fmt(maxPnl),  color: 'var(--g)' },
        { label: 'MAX LOSS',   val: minPnl < -9e5 ? '∞' : fmt(minPnl), color: 'var(--r)' },
        {
          label: `BREAKEVEN${bes.length !== 1 ? 'S' : ''}`,
          val: bes.length ? bes.map(b => `$${b.toFixed(2)}`).join(' · ') : '—',
          color: '#ff5252',
        },
      ].map(item => (
        <div key={item.label}>
          <div style={{ fontSize: 8.5, color: 'var(--mu)', fontFamily: 'var(--mono)', letterSpacing: '0.05em', marginBottom: 2 }}>
            {item.label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: item.color, fontFamily: 'var(--mono)' }}>
            {item.val}
          </div>
        </div>
      ))}
    </div>
  );
}
