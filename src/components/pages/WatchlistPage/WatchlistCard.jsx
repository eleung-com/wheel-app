import React, { useState, useRef } from 'react';

// ── Price sparkline with interactive crosshair ────────────────────────────────
function PriceChart({ closes, dates, ticker, hoverIdx }) {
  if (!closes || closes.length < 2) return null;

  const W = 300, H = 62, PAD = 4;
  const n   = closes.length;
  const lo  = Math.min(...closes);
  const hi  = Math.max(...closes);
  const rng = hi - lo || 1;

  const toX = i => (i / (n - 1)) * W;
  const toY = v => H - PAD - ((v - lo) / rng) * (H - PAD * 2);

  const up      = closes[n - 1] >= closes[0];
  const color   = up ? '#1fd8a0' : '#ff5252';
  const gradId  = `sp-${ticker}`;
  const activeI = hoverIdx ?? n - 1;
  const ax      = toX(activeI);
  const ay      = toY(closes[activeI]);

  const pts   = closes.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(' ');
  const areaD = `M 0,${toY(closes[0]).toFixed(1)} ` +
    closes.map((c, i) => `L ${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(' ') +
    ` L ${W},${H} L 0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={areaD} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Crosshair */}
      <line x1={ax} y1={0} x2={ax} y2={H}
        stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3,2" />

      {/* Dot */}
      <circle cx={ax} cy={ay} r="5" fill={color} fillOpacity="0.18" />
      <circle cx={ax} cy={ay} r="2.8" fill={color} />
    </svg>
  );
}

// ── Chart key + hover readout ─────────────────────────────────────────────────
function ChartKey({ closes, dates, hoverIdx }) {
  const n       = closes?.length ?? 0;
  const activeI = hoverIdx ?? (n > 0 ? n - 1 : 0);

  const priceVal = closes?.[activeI];
  const dateVal  = dates?.[activeI];

  const up    = closes && closes[n - 1] >= closes[0];
  const color = up ? '#1fd8a0' : '#ff5252';

  const dateLabel = dateVal
    ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <div style={{ borderTop: '1px solid var(--b1)', paddingTop: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <span style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
        {dateLabel || '2 months'}
      </span>
      {priceVal != null && (
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700, color }}>
          ${priceVal.toFixed(2)}
        </span>
      )}
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────
export default function WatchlistCard({ watch: w, criteria: cr, onRemove, onEditNotes }) {
  const d = w.liveData;
  const [hoverIdx, setHoverIdx] = useState(null);
  const chartRef = useRef(null);

  function handlePointer(clientX) {
    if (!chartRef.current || !d?.closes2m) return;
    const rect = chartRef.current.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(pct * (d.closes2m.length - 1)));
  }

  const chartHandlers = {
    onMouseMove:  e => handlePointer(e.clientX),
    onMouseLeave: () => setHoverIdx(null),
    onTouchMove:  e => handlePointer(e.touches[0].clientX),
    onTouchEnd:   () => setHoverIdx(null),
  };

  // ── Screener pills ──
  let pills, st, stTxt;
  if (!d) {
    pills = <span className="cpill warn" style={{ fontSize: 9, padding: '2px 5px' }}>Tap ↻ to screen</span>;
    stTxt = '⏳ No data yet — tap ↻ above';
    st    = 'waiting';
  } else {
    const chks = [
      { l: `IVR ${d.ivrEst   != null ? d.ivrEst + '%'         : '?'}`, ok: d.ivrEst   != null && d.ivrEst   >= cr.ivr   },
      { l: `RSI ${d.rsiEst   != null ? d.rsiEst.toFixed(0)    : '?'}`, ok: d.rsiEst   != null && d.rsiEst   <= cr.rsi   },
      { l: `Stoch ${d.stochEst != null ? d.stochEst.toFixed(0) : '?'}`, ok: d.stochEst != null && d.stochEst <= cr.stoch },
      { l: `${cr.ma}MA`, ok: d.aboveMa !== false },
    ];
    pills = chks.map((ch, i) => (
      <span key={i} className={`cpill ${ch.ok ? 'pass' : 'fail'}`} style={{ fontSize: 9, padding: '2px 5px' }}>
        {ch.ok ? '✓' : '✗'} {ch.l}
      </span>
    ));
    const pass = chks.filter(c => c.ok).length;
    if (pass === 4)     { st = 'ready';   stTxt = '✓ CSP ready'; }
    else if (pass >= 2) { st = 'partial'; stTxt = `${pass}/4 met`; }
    else                { st = 'waiting'; stTxt = `${pass}/4 met`; }
  }

  const priceStr = d?.price ? `$${d.price.toFixed(2)}` : '—';
  const chgEl    = d?.chg1d != null
    ? <span style={{ color: `var(--${d.chg1d >= 0 ? 'g' : 'r'})` }}>
        {d.chg1d >= 0 ? '+' : ''}{d.chg1d.toFixed(1)}%
      </span>
    : null;

  const hasChart = !!d?.closes2m;

  return (
    <div className="witem" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 10 }}>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div className="wtkr" style={{ fontSize: 15, minWidth: 'auto' }}>{w.ticker}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--mu2)' }}>{priceStr} {chgEl}</span>
          <button onClick={() => onEditNotes && onEditNotes(w.ticker)} title="Edit notes"
            style={{ background: 'none', border: 'none', color: w.notes ? 'var(--bl)' : 'var(--mu)', fontSize: 13, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✎</button>
          <button onClick={() => onRemove(w.ticker)} title="Remove"
            style={{ background: 'none', border: 'none', color: 'var(--mu)', fontSize: 16, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Interactive charts */}
      {hasChart && (
        <div ref={chartRef} style={{ width: '100%', touchAction: 'none', cursor: 'crosshair' }} {...chartHandlers}>
          <PriceChart
            closes={d.closes2m}
            dates={d.dates2m}
            ticker={w.ticker}
            hoverIdx={hoverIdx}
          />
          <ChartKey
            closes={d.closes2m}
            dates={d.dates2m}
            hoverIdx={hoverIdx}
          />
        </div>
      )}

      {/* Screener pills + status */}
      <div className="wcrit" style={{ gap: 3 }}>{pills}</div>
      <div className={`wst ${st}`} style={{ fontSize: 10 }}>{stTxt}</div>

      {/* Notes */}
      {w.notes && (
        <div style={{ fontSize: 10, color: 'var(--mu2)', borderTop: '1px solid var(--b1)', paddingTop: 5, width: '100%', lineHeight: 1.4 }}>
          {w.notes}
        </div>
      )}
    </div>
  );
}
