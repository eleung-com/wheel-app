import React from 'react';
import EvalBody from './EvalBody';

export default function SignalCard({ signal: s, onClick, evaluation, loading }) {
  // Only entry signals carry a Notion evaluation — roll and close cards are
  // about a position already open, where the thesis is no longer the question.
  // Those that do take the full grid row: the evaluation contains tables, and a
  // three-column table is unreadable in a half-width card.
  const showEval = s.type === 'csp' || s.type === 'cc';
  const lbl = { csp: 'CSP', cc: 'Cov. Call', roll: 'Roll', close: 'Close' }[s.type];
  const chgC   = s.chg > 0 ? 'g' : s.chg < 0 ? 'r' : 'mu2';
  const chgStr = (s.chg !== null && s.chg !== undefined)
    ? <span style={{ color: `var(--${chgC})` }}>{s.chg > 0 ? '+' : ''}{s.chg.toFixed(1)}%</span>
    : null;
  const priceS = s.price ? `$${s.price.toFixed(2)}` : '—';

  let mets = null;
  // Strike and DTE need a Tradier key to resolve and are already spelled out in
  // the suggestion line, so the grid leads with the figures that always exist:
  // how far the stock fell, and how big that is against its own daily range.
  if (s.type === 'csp')
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Off week high</div><div className="met-v r" style={{ fontSize: 11 }}>{s.dropPct != null ? `${s.dropPct.toFixed(1)}%` : '—'}</div></div>
        <div className="met"><div className="met-l">vs ATR</div><div className="met-v b" style={{ fontSize: 11 }}>{s.atrDrop != null ? `${s.atrDrop.toFixed(1)}x` : '—'}</div></div>
      </div>
    );
  else if (s.type === 'cc')
    mets = (
      <div className="mgrid c2" style={{ marginBottom: 6 }}>
        <div className="met"><div className="met-l">Off week low</div><div className="met-v g" style={{ fontSize: 11 }}>{s.rallyPct != null ? `+${s.rallyPct.toFixed(1)}%` : '—'}</div></div>
        <div className="met"><div className="met-l">Strike</div><div className="met-v" style={{ fontSize: 11 }}>{s.strike != null ? `$${s.strike}` : '—'}</div></div>
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
      className={`scard ${s.type}${showEval ? ' scard-wide' : ''}`}
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
        {s.wheel && <span className="cpill vpill" style={{ fontSize: 9, padding: '2px 6px' }}>Wheel {s.wheel}</span>}
        {s.fundamentals && <span className="cpill vpill" style={{ fontSize: 9, padding: '2px 6px' }}>Fundamentals {s.fundamentals}</span>}
      </div>
      {mets}
      <div className="sugg" style={{ fontSize: 10, padding: '6px 8px', lineHeight: 1.45 }}>{s.suggestion}</div>

      {showEval && (
        // Scrolls inside the card so a long evaluation doesn't stretch the grid
        // row. Wheel events are stopped from bubbling into the card's onClick.
        <div className="evl evl-card" onClick={e => e.stopPropagation()}>
          <EvalBody evaluation={evaluation} notes={s.notes} loading={loading} />
        </div>
      )}
    </div>
  );
}
