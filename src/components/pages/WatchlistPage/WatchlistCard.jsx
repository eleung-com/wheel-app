import React from 'react';

export default function WatchlistCard({ watch: w, criteria: cr, onRemove }) {
  const d = w.liveData;

  let pills, st, stTxt;

  if (!d) {
    pills = <span className="cpill warn" style={{ fontSize: 9, padding: '2px 5px' }}>Tap ↻ to screen</span>;
    stTxt = '⏳ No data yet — tap ↻ above';
    st    = 'waiting';
  } else {
    const chks = [
      { l: `IVR ${d.ivrEst   !== null ? d.ivrEst + '%'         : '?'}`, ok: d.ivrEst   !== null && d.ivrEst   >= cr.ivr   },
      { l: `RSI ${d.rsiEst   !== null ? d.rsiEst.toFixed(0)    : '?'}`, ok: d.rsiEst   !== null && d.rsiEst   <= cr.rsi   },
      { l: `Stoch ${d.stochEst !== null ? d.stochEst.toFixed(0) : '?'}`, ok: d.stochEst !== null && d.stochEst <= cr.stoch },
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

  const price = d?.price ? `$${d.price.toFixed(2)}` : '—';
  const chgEl = d?.chg1d !== null && d?.chg1d !== undefined
    ? <span style={{ color: `var(--${d.chg1d >= 0 ? 'g' : 'r'})` }}>{d.chg1d >= 0 ? '+' : ''}{d.chg1d.toFixed(1)}%</span>
    : null;

  return (
    <div className="witem" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div className="wtkr" style={{ fontSize: 15, minWidth: 'auto' }}>{w.ticker}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--mu2)' }}>{price} {chgEl}</span>
          <div className="wdel" onClick={() => onRemove(w.ticker)} style={{ fontSize: 16 }}>×</div>
        </div>
      </div>
      <div className="wcrit" style={{ gap: 3 }}>{pills}</div>
      <div className={`wst ${st}`} style={{ fontSize: 10 }}>{stTxt}</div>
    </div>
  );
}
