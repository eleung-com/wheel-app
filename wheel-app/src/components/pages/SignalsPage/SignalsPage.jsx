import React from 'react';
import SummaryBar from './SummaryBar';
import SignalCard from './SignalCard';

export default function SignalsPage({ signals, lastRefresh, onShowDetail }) {
  const act  = signals.filter(s => s.type === 'roll' || s.type === 'close');
  const csp  = signals.filter(s => s.type === 'csp'  && !s.partial);
  const cspP = signals.filter(s => s.type === 'csp'  &&  s.partial);
  const cc   = signals.filter(s => s.type === 'cc');

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
            <div className="empty-sub">None of your tickers meet criteria. Auto-refreshes every 20 min during market hours.</div>
          </div>
        )}

        {act.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>⚡ Action Required</div>
            {act.map(s => <SignalCard key={s.id} signal={s} onClick={onShowDetail} />)}
          </>
        )}
        {cc.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>🟢 Covered Call Opportunities</div>
            {cc.map(s => <SignalCard key={s.id} signal={s} onClick={onShowDetail} />)}
          </>
        )}
        {csp.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>🔵 CSP Entry — All Criteria Met</div>
            {csp.map(s => <SignalCard key={s.id} signal={s} onClick={onShowDetail} />)}
          </>
        )}
        {cspP.length > 0 && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1', color: 'var(--a)' }}>○ Watching — Partial Criteria</div>
            {cspP.map(s => <SignalCard key={s.id} signal={s} onClick={onShowDetail} />)}
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
