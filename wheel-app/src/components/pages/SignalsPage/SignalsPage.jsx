import React from 'react';
import SummaryBar from './SummaryBar';
import SignalCard from './SignalCard';

export default function SignalsPage({ signals, lastRefresh, evals = {}, evalsLoading, onShowDetail }) {
  const card = s => (
    <SignalCard
      key={s.id}
      signal={s}
      evaluation={evals[s.ticker] || null}
      loading={evalsLoading}
      onClick={onShowDetail}
    />
  );

  const act = signals.filter(s => s.type === 'roll' || s.type === 'close');
  const cc  = signals.filter(s => s.type === 'cc');
  // Biggest move relative to the stock's own daily range leads — a 5% drop
  // means far more on a quiet name than on a volatile one, so this is the
  // order worth working down when checking RSI and Stochastic by hand.
  const csp = signals
    .filter(s => s.type === 'csp')
    .sort((a, b) => (b.atrDrop ?? 0) - (a.atrDrop ?? 0));

  const isEmpty = signals.length === 0;

  const ago = lastRefresh ? Math.round((Date.now() - lastRefresh) / 60000) : null;

  return (
    <div>
      <SummaryBar signals={signals} />

      <div id="sig-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {isEmpty && !lastRefresh && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="empty-icon">📡</div>
            <div className="empty-title">No signals yet</div>
            <div className="empty-sub">Add tickers to your watchlist and positions, then tap ↻.</div>
          </div>
        )}

        {isEmpty && lastRefresh && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="empty-icon">✓</div>
            <div className="empty-title">No signals right now</div>
            <div className="empty-sub">No Priority ticker has pulled back far enough, and nothing needs rolling. Auto-refreshes every 20 min during market hours.</div>
          </div>
        )}

        {act.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>⚡ Action Required</div>
            {act.map(card)}
          </>
        )}
        {cc.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>🟢 Covered Call Opportunities</div>
            {cc.map(card)}
          </>
        )}
        {csp.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>🔵 CSP Entry — Priority &amp; Pulled Back</div>
            {csp.map(card)}
          </>
        )}

        {!isEmpty && ago !== null && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 10, color: 'var(--mu)', padding: '14px 0' }}>
            Last screened {ago < 1 ? 'just now' : `${ago}m ago`} · auto-refreshes every 20m during market hours
          </div>
        )}
      </div>
    </div>
  );
}
