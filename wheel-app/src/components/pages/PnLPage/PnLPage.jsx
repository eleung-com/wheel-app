import React, { useState, useRef } from 'react';

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

function PnLChart({ legs }) {
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
              stroke={v === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}
              strokeWidth={v === 0 ? 1 : 0.8} />
            <text x={PAD.left - 6} y={toY(v) + 3.5}
              textAnchor="end" fontSize="8.5" fill="rgba(255,255,255,0.4)" fontFamily="monospace">
              {fmtY(v)}
            </text>
          </g>
        ))}

        {/* X grid + labels */}
        {xTicks.map((p, i) => (
          <g key={i}>
            <line x1={toX(p)} y1={PAD.top} x2={toX(p)} y2={PAD.top + CH}
              stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" />
            <text x={toX(p)} y={PAD.top + CH + 13}
              textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.4)" fontFamily="monospace">
              ${p.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Fills */}
        <path d={areaD} fill="rgba(31,216,160,0.22)" clipPath="url(#pnl-above)" />
        <path d={areaD} fill="rgba(255,82,82,0.22)"  clipPath="url(#pnl-below)" />

        {/* P&L line */}
        <path d={lineD} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.8"
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
              stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="3,2" />
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
          fontSize="8" fill="rgba(255,255,255,0.25)" fontFamily="monospace"
          transform={`rotate(-90, ${PAD.left - 46}, ${PAD.top + CH / 2})`}>
          P&amp;L at Expiry ($)
        </text>
        <text x={PAD.left + CW / 2} y={H - 2} textAnchor="middle"
          fontSize="8" fill="rgba(255,255,255,0.25)" fontFamily="monospace">
          Price at Expiry ($)
        </text>
      </svg>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ legs }) {
  const strikes  = legs.map(l => parseFloat(l.strike)).filter(Boolean);
  const refPrice = strikes.length ? Math.max(...strikes) : 50;

  const hiStat = Math.max(refPrice * 5, ...strikes.map(s => s * 3));
  const prices = Array.from({ length: 1001 }, (_, i) => (i / 1000) * hiStat);
  prices.push(0.001);
  const pnls = prices.map(p => totalPnl(legs, p));
  pnls.push(totalPnl(legs, 1_000_000));

  const maxPnl = Math.max(...pnls);
  const minPnl = Math.min(...pnls);
  const bes    = findBreakevens(prices.slice(0, -1), pnls.slice(0, -1));

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

// ── Leg row ───────────────────────────────────────────────────────────────────
function TogglePair({ options, value, onChange, colors }) {
  return (
    <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid var(--b1)', width: '100%' }}>
      {options.map(opt => {
        const active = value === opt;
        return (
          <button key={opt} onClick={() => onChange(opt)} style={{
            flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', border: 'none',
            background: active ? (colors?.[opt] ?? 'var(--bl)') : 'transparent',
            color: active ? (opt === 'buy' || opt === 'sell' ? '#000' : '#fff') : 'var(--mu2)',
            textTransform: 'capitalize',
            transition: 'background 0.12s',
          }}>{opt}</button>
        );
      })}
    </div>
  );
}

// Column definitions for header + leg rows
const LEG_COLS = [
  { label: 'Action',  w: 76  },
  { label: 'Type',    w: 76  },
  { label: 'Qty',     w: 50  },
  { label: 'Strike',  w: 68  },
  { label: 'Premium', w: 68  },
  { label: 'Expiry',  w: 112 },
  { label: '',        w: 24  },
];

function LegRow({ leg, idx, onChange, onRemove, canRemove }) {
  function set(key, val) { onChange(idx, { ...leg, [key]: val }); }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--b1)' }}>
      <div style={{ width: LEG_COLS[0].w, flexShrink: 0 }}>
        <TogglePair options={['buy', 'sell']} value={leg.action} onChange={v => set('action', v)}
          colors={{ buy: 'var(--g)', sell: 'var(--r)' }} />
      </div>
      <div style={{ width: LEG_COLS[1].w, flexShrink: 0 }}>
        <TogglePair options={['call', 'put']} value={leg.optType} onChange={v => set('optType', v)}
          colors={{ call: 'var(--bl)', put: 'var(--bl)' }} />
      </div>
      <input className="sinput" type="number" min="1" value={leg.qty}
        onChange={e => set('qty', e.target.value)}
        style={{ width: LEG_COLS[2].w, flexShrink: 0, textAlign: 'center' }} />
      <input className="sinput" type="number" step="0.5" min="0" value={leg.strike}
        onChange={e => set('strike', e.target.value)}
        placeholder="0.00" style={{ width: LEG_COLS[3].w, flexShrink: 0 }} />
      <input className="sinput" type="number" step="0.01" min="0" value={leg.premium}
        onChange={e => set('premium', e.target.value)}
        placeholder="0.00" style={{ width: LEG_COLS[4].w, flexShrink: 0 }} />
      <input className="sinput" type="date" value={leg.expiry}
        onChange={e => set('expiry', e.target.value)}
        style={{ width: LEG_COLS[5].w, flexShrink: 0, fontSize: 12, padding: '6px 8px' }} />
      <div style={{ width: LEG_COLS[6].w, flexShrink: 0 }}>
        {canRemove && (
          <button onClick={() => onRemove(idx)} style={{
            background: 'none', border: 'none', color: 'var(--mu)',
            fontSize: 18, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
          }}>×</button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
let nextId = 1;
function newLeg() {
  return { id: nextId++, action: 'sell', qty: '1', strike: '', premium: '', optType: 'put', expiry: '' };
}

export default function PnLPage() {
  const [legs, setLegs] = useState([newLeg()]);

  const hasValidLegs = legs.some(l => l.strike && l.premium);

  function handleChange(idx, updated) { setLegs(prev => prev.map((l, i) => i === idx ? updated : l)); }
  function handleRemove(idx)          { setLegs(prev => prev.filter((_, i) => i !== idx)); }
  function handleAdd()                { setLegs(prev => [...prev, newLeg()]); }
  function handleReset()              { setLegs([newLeg()]); }

  return (
    <div>
      {/* Stats — shown above form once data is entered */}
      {hasValidLegs && <StatsBar legs={legs} />}

      {/* Leg form */}
      <div className="ssec" style={{ padding: '0 10px' }}>
        {/* Scrollable table — single row per leg */}
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Header */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 0 4px', borderBottom: '1px solid var(--b1)', minWidth: 'max-content' }}>
            {LEG_COLS.map((col, i) => (
              <div key={i} style={{ width: col.w, flexShrink: 0 }}>
                <span style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {col.label}
                </span>
              </div>
            ))}
          </div>
          {legs.map((leg, idx) => (
            <LegRow key={leg.id} leg={leg} idx={idx}
              onChange={handleChange} onRemove={handleRemove} canRemove={legs.length > 1} />
          ))}
          {/* Add Leg sits inline with the rows */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', minWidth: 'max-content' }}>
            <button className="btn-s" onClick={handleAdd}
              style={{ margin: 0, fontSize: 11, padding: '6px 14px' }}>
              + Add Leg
            </button>
          </div>
        </div>{/* end scroll wrapper */}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
          <button onClick={handleReset} style={{
            background: 'none', border: 'none', color: 'var(--mu)',
            fontSize: 11, cursor: 'pointer', padding: '4px 6px', fontFamily: 'var(--mono)',
          }}>Reset</button>
        </div>
      </div>

      {/* Chart */}
      {hasValidLegs ? (
        <div style={{ marginTop: 16 }}>
          <PnLChart legs={legs} />
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--mu)', fontSize: 12, marginTop: 32, fontFamily: 'var(--mono)' }}>
          Enter a strike and premium to see the P&L chart
        </div>
      )}
    </div>
  );
}
