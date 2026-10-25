import React from 'react';
import EvalBody from '../pages/SignalsPage/EvalBody';

export default function SignalDetailModal({ signalId, signals, positions, onClose, onTrade, evaluation, loading, onOpenStock }) {
  const s = signals.find(sig => sig.id === signalId);
  if (!s) return null;

  const lbl = { csp: 'Cash-Secured Put', csp_wait: 'CSP — Waiting', leaps: 'LEAPS', leaps_wait: 'LEAPS — Waiting', leaps_review: 'LEAPS review', score_review: 'Score review', cc: 'Covered Call', roll: 'Roll Position', close: 'Buy to Close', maxloss: 'Spread at Max Loss' }[s.type];

  // For roll/close signals, find the underlying position
  const posId = signalId ? parseInt(signalId.replace('roll-', '').replace('close-', '')) : null;
  const pos   = (s.type === 'roll' || s.type === 'close') ? positions.find(p => p.id === posId) : null;

  return (
    <>
      <div className="mtitle">{s.ticker} · {lbl}</div>

      <div className="dsec">
        <div className="dlbl">Suggested Action</div>
        <div className="sugg" style={{ margin: 0 }}>{s.suggestion}</div>
      </div>

      {/* Stated in full here because the card has room for a pill, not a
          sentence. CSPs: before expiry / unknown blocks (Part 2A); covered
          calls stay advisory. */}
      {s.earnWarn && !s.earnWarn.na && (s.earnWarn.warn || s.earnWarn.block) && (
        <div className="dsec">
          <div className="dlbl">Earnings</div>
          <div className="mhint" style={{ margin: 0 }}>
            {!s.earnWarn.known
              ? (s.type === 'cc'
                  ? 'No upcoming earnings date found for this ticker, so this cannot be checked.'
                  : 'No upcoming earnings date found (Finnhub is rechecked automatically), so this CSP is waiting. Unknown is never treated as safe.')
              : s.earnWarn.block
                ? (s.type === 'cc'
                    ? `Reports in ${s.earnWarn.days} day${s.earnWarn.days === 1 ? '' : 's'} — before this call would expire. Advisory only for covered calls.`
                    : `Reports in ${s.earnWarn.days} day${s.earnWarn.days === 1 ? '' : 's'} — on or before this contract's expiry, so this CSP is waiting until after earnings.`)
                : `Reports in ${s.earnWarn.days} day${s.earnWarn.days === 1 ? '' : 's'} — shortly after this contract expires. Not blocked, but the stock may move into the print.`}
          </div>
        </div>
      )}

      {s.fmv && (
        // Part 3E: the fair-value range behind the card (Monday eval / after-earnings).
        <div className="dsec">
          <div className="dlbl">Fair value{s.fmv.date ? ` · from ${s.fmv.date.slice(5).replace('-', '/')}` : ''}{s.fmvStale ? ' · stale' : ''}</div>
          <div className="mgrid c3">
            <div className="met"><div className="met-l">Buy below (Low)</div><div className="met-v">{s.fmv.low != null ? `$${s.fmv.low.toFixed(2)}` : '—'}</div></div>
            <div className="met"><div className="met-l">Fair (Mid)</div><div className="met-v b">${s.fmv.mid.toFixed(2)}</div></div>
            <div className="met"><div className="met-l">High</div><div className="met-v">{s.fmv.high != null ? `$${s.fmv.high.toFixed(2)}` : '—'}</div></div>
          </div>
          {s.fmvPct != null && (
            <div className="mhint" style={{ margin: '8px 0 0' }}>
              Price is {Math.abs(s.fmvPct)}% {s.fmvPct <= 0 ? 'under' : 'over'} fair value.
              {s.type === 'csp' && s.strike != null && s.fmv.low != null && s.strike > s.fmv.low
                ? ` The suggested $${s.strike} strike is above the buy-below price — if assigned, you'd own it above your evaluator's entry price.` : ''}
            </div>
          )}
        </div>
      )}

      {(s.type === 'leaps' || s.type === 'leaps_wait') && s.weekly && (
        // Part 2D: the weekly numbers behind the card, so it can be checked
        // against TradingView's weekly chart.
        <div className="dsec">
          <div className="dlbl">Weekly setup</div>
          <div className="mgrid c3">
            <div className="met"><div className="met-l">50-wk MA</div><div className="met-v">${s.weekly.ma50?.toFixed(2)}</div></div>
            <div className="met"><div className="met-l">200-wk MA</div><div className="met-v">${s.weekly.ma200?.toFixed(2)}</div></div>
            <div className="met"><div className="met-l">Above 50MA</div><div className="met-v">{s.weekly.pctAbove50?.toFixed(1)}%</div></div>
            <div className="met"><div className="met-l">Wkly %K</div><div className="met-v">{s.weekly.stochK?.toFixed(0)} (was {s.weekly.stochKPrev?.toFixed(0)})</div></div>
            <div className="met"><div className="met-l">Dividends 12 mo</div><div className="met-v">{s.index ? 'n/a' : s.weekly.divCount}</div></div>
            <div className="met"><div className="met-l">1 contract</div><div className="met-v">{s.cost != null ? `$${s.cost.toLocaleString()}` : '—'}</div></div>
          </div>
        </div>
      )}

      {(s.type === 'csp' || s.type === 'csp_wait') && (
        <div className="dsec">
          <div className="dlbl">Pullback Snapshot</div>
          <div className="mgrid c2">
            <div className="met"><div className="met-l">Off week high</div><div className="met-v r">{s.dropPct != null ? `${s.dropPct.toFixed(1)}%` : '—'}</div></div>
            <div className="met"><div className="met-l">Week high</div><div className="met-v">{s.weekHigh != null ? `$${s.weekHigh.toFixed(2)}` : '—'}</div></div>
            <div className="met"><div className="met-l">In ATR units</div><div className="met-v b">{s.atrDrop != null ? `${s.atrDrop.toFixed(1)}x` : '—'}</div></div>
            <div className="met">
              <div className="met-l">vs {s.maPeriod || 200}MA</div>
              <div className={`met-v ${s.aboveMa === false ? 'r' : s.aboveMa ? 'g' : ''}`}>
                {s.aboveMa == null ? '—' : s.aboveMa ? 'Above' : 'Below'}
              </div>
            </div>
          </div>
          <div className="mhint" style={{ marginTop: 8, marginBottom: 0 }}>
            ATR units scale the drop by this stock&rsquo;s own average daily range, so it stays comparable across the watchlist. Above roughly 2x the move is unusual for the name &mdash; check RSI and Stochastic on the Watchlist chart before selling.
          </div>
        </div>
      )}

      {s.type === 'cc' && (
        <div className="dsec">
          <div className="dlbl">Rally Snapshot</div>
          <div className="mgrid c3">
            <div className="met"><div className="met-l">Off week low</div><div className="met-v g">{s.rallyPct != null ? `+${s.rallyPct.toFixed(1)}%` : '—'}</div></div>
            <div className="met"><div className="met-l">Week low</div><div className="met-v">{s.weekLow != null ? `$${s.weekLow.toFixed(2)}` : '—'}</div></div>
            <div className="met"><div className="met-l">IVR (est.)</div><div className="met-v b">{s.ivr != null ? `${s.ivr}%` : '—'}</div></div>
          </div>
        </div>
      )}

      {(s.type === 'csp' || s.type === 'cc') && (
        <div className="dsec">
          <div className="dlbl">
            Latest Evaluation
            {(s.wheel || s.fundamentals) && (
              <span className="dlbl-x">
                {s.wheel && `Wheel ${s.wheel}`}
                {s.wheel && s.fundamentals && ' · '}
                {s.fundamentals && `Fundamentals ${s.fundamentals}`}
              </span>
            )}
          </div>
          <div className="evl evl-modal">
            <EvalBody evaluation={evaluation} notes={s.notes} loading={loading} />
          </div>
        </div>
      )}

      {(s.type === 'roll' || s.type === 'close') && (
        <div className="dsec">
          <div className="dlbl">Position Details</div>
          <div className="mgrid c2">
            <div className="met"><div className="met-l">Strike</div><div className="met-v b">${s.strike}</div></div>
            <div className="met"><div className="met-l">DTE left</div><div className="met-v a">{s.days}d</div></div>
            <div className="met"><div className="met-l">Expiry</div><div className="met-v">{pos?.expiry || '—'}</div></div>
            <div className="met"><div className="met-l">% elapsed</div><div className="met-v">{s.pctT !== null && s.pctT !== '—' ? `${s.pctT}%` : '—'}</div></div>
            {s.pctCap !== null && <div className="met"><div className="met-l">Premium captured</div><div className="met-v g">{s.pctCap}%</div></div>}
            {pos?.prem && <div className="met"><div className="met-l">Collected</div><div className="met-v g">${Number(pos.prem).toFixed(2)}</div></div>}
          </div>
        </div>
      )}

      <div className="dsec">
        <div className="dlbl">Criteria Check</div>
        <div className="cpills">
          {(s.chks || []).map((ch, i) => (
            <span key={i} className={`cpill ${ch.warn ? 'warn' : ch.ok ? 'pass' : 'fail'}`}>{ch.warn ? '⚠' : ch.ok ? '✓' : '✗'} {ch.l}</span>
          ))}
        </div>
      </div>

      {onTrade && (s.type === 'csp' || s.type === 'leaps') && (
        // Part 4C: log the suggested contract (the order itself is placed in Fidelity).
        <button className="btn-p" onClick={() => onTrade(s)}>Log this trade</button>
      )}
      {onOpenStock && <button className="btn-s" onClick={() => onOpenStock(s.ticker)}>View {s.ticker} in Stocks ›</button>}
      <button className="btn-s" onClick={onClose}>Close</button>
    </>
  );
}
