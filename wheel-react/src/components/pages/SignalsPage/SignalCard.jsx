import React from 'react';

export default function SignalCard({ signal: s, onClick }) {
  const lbl = { csp: 'CSP', cc: 'Cov. Call', roll: 'Roll', close: 'Close' }[s.type];
  const chgC   = s.chg > 0 ? 'g' : s.chg < 0 ? 'r' : 'mu2';
  const chgStr = (s.chg !== null && s.chg !== undefined)
    ? <span style={{ color: `var(--${chgC})` }}>{s.chg > 0 ? '+' : ''}{s.chg.toFixed(1)}%</span>
    : null;
  const priceS = s.price ? `$${s.price.toFixed(2)}` : '—';

  let mets = null;
  if (s.type === 'csp' && !s.partial)
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Strike</div><div className="met-v b" style={{ fontSize: 11 }}>${s.strike}</div></div>
        <div className="met"><div className="met-l">DTE</div><div className="met-v" style={{ fontSize: 11 }}>{s.dteTarget}d</div></div>
      </div>
    );
  else if (s.type === 'cc')
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Strike</div><div className="met-v g" style={{ fontSize: 11 }}>${s.strike}</div></div>
        <div className="met"><div className="met-l">DTE</div><div className="met-v" style={{ fontSize: 11 }}>{s.dteTarget}d</div></div>
      </div>
    );
  else if (s.type === 'roll')
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Strike</div><div className="met-v r" style={{ fontSize: 11 }}>${s.strike}</div></div>
        <div className="met"><div className="met-l">DTE</div><div className="met-v a" style={{ fontSize: 11 }}>{s.days}d</div></div>
      </div>
    );
  else if (s.type === 'close')
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Captured</div><div className="met-v g" style={{ fontSize: 11 }}>{s.pctCap}%</div></div>
        <div className="met"><div className="met-l">DTE</div><div className="met-v a" style={{ fontSize: 11 }}>{s.days}d</div></div>
      </div>
    );

  return (
    <div
      className={`scard ${s.type}${s.partial ? ' partial' : ''}`}
      style={{ padding: '10px 10px 8px', marginBottom: 0 }}
      onClick={() => onClick(s.id)}
    >
      <div className="ctop" style={{ marginBottom: 6 }}>
        <div className="tblk">
          <div className="tkr" style={{ fontSize: 14 }}>{s.ticker}</div>
          <div className="tkr-sub" style={{ fontSize: 10 }}>{priceS} {chgStr}</div>
        </div>
        <div className={`stbdg ${s.type}`} style={{ fontSize: 8, padding: '2px 6px' }}>{lbl}</div>
      </div>
      <div className="cpills" style={{ marginBottom: 6, gap: 3 }}>
        {(s.chks || []).map((ch, i) => (
          <span key={i} className={`cpill ${ch.ok ? 'pass' : 'fail'}`} style={{ fontSize: 9, padding: '2px 6px' }}>
            {ch.ok ? '✓' : '✗'} {ch.l}
          </span>
        ))}
      </div>
      {mets}
      <div className="sugg" style={{ fontSize: 10, padding: '6px 8px', lineHeight: 1.45 }}>{s.suggestion}</div>
    </div>
  );
}
