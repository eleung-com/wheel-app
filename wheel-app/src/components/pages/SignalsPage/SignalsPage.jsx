import React from 'react';
import SummaryBar from './SummaryBar';
import SignalCard from './SignalCard';

export default function SignalsPage({ signals, lastRefresh, evals = {}, evalsLoading, onShowDetail, onScoreReview, reviewBusyId }) {
  const card = s => (
    <SignalCard
      key={s.id}
      signal={s}
      evaluation={evals[s.ticker] || null}
      loading={evalsLoading}
      onClick={onShowDetail}
      onScoreReview={onScoreReview}
      reviewBusy={reviewBusyId === s.id}
    />
  );

  // Max loss leads: it is the only one of these where the position is already
  // as bad as it can get. Within the group, fewest days left first — breached at
  // 3 DTE and breached at 40 are different decisions and the sooner one is the
  // one to look at.
  const ACT_ORDER = { maxloss: 0, roll: 1, close: 2, score_review: 3 };
  const act = signals
    .filter(s => s.type === 'roll' || s.type === 'close' || s.type === 'maxloss' || s.type === 'score_review')
    .sort((a, b) => (ACT_ORDER[a.type] - ACT_ORDER[b.type]) || ((a.days ?? 99) - (b.days ?? 99)));
  const cc  = signals.filter(s => s.type === 'cc');
  // Biggest move relative to the stock's own daily range leads — a 5% drop
  // means far more on a quiet name than on a volatile one, so this is the
  // order worth working down when checking RSI and Stochastic by hand.
  const csp = signals
    .filter(s => s.type === 'csp')
    .sort((a, b) => (b.atrDrop ?? 0) - (a.atrDrop ?? 0));
  // Part 2A: CSPs blocked by earnings. Shown greyed at the bottom of the CSP
  // section so a good setup isn't invisible — but never a trade today.
  const waiting = signals.filter(s => s.type === 'csp_wait');

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
            <div className="empty-sub">No Priority ticker is showing a daily RSI 30–40 + Stochastic turn with weekly RSI ≥ 40, and nothing needs rolling. Refreshes when you open the app · Telegram alerts run in the background.</div>
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
        {(csp.length > 0 || waiting.length > 0) && (
          <>
            <div className="slabel" style={{ gridColumn: '1/-1' }}>🔵 CSP Entry — Priority &amp; Pulled Back</div>
            {csp.map(card)}
            {waiting.length > 0 && (
              <div className="slabel" style={{ gridColumn: '1/-1', marginTop: 10 }}>⏳ Waiting — blocked by earnings</div>
            )}
            {waiting.map(card)}
          </>
        )}

        {!isEmpty && ago !== null && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 10, color: 'var(--mu)', padding: '14px 0' }}>
            Last screened {ago < 1 ? 'just now' : `${ago}m ago`} · refreshes when you open the app · Telegram alerts run in the background
          </div>
        )}
      </div>
    </div>
  );
}
