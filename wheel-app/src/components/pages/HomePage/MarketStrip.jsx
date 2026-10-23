import React from 'react';

// Part 6A: thin row of SPY / QQQ / SMH / VIX — price + % on the day.
const fmt = (v) => (v == null ? '—' : v >= 1000 ? v.toFixed(0) : v.toFixed(2));

export default function MarketStrip({ rows, failed }) {
  return (
    <div className="mstrip" aria-label="Market today">
      {rows.map(r => {
        // VIX up = fear up, so its colors are flipped.
        const good = r.chgPct == null ? null : (r.label === 'VIX' ? r.chgPct <= 0 : r.chgPct >= 0);
        return (
          <div className="mstrip-i" key={r.sym}>
            <div className="mstrip-l">{r.label}</div>
            <div className="mstrip-p">{r.label === 'VIX' ? fmt(r.price) : r.price == null ? '—' : `$${fmt(r.price)}`}</div>
            <div className={`mstrip-c${good == null ? '' : good ? ' g' : ' r'}`}>
              {r.chgPct == null ? (failed ? 'n/a' : '…') : `${r.chgPct > 0 ? '+' : r.chgPct < 0 ? '−' : ''}${Math.abs(r.chgPct).toFixed(1)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
