import React from 'react';

export default function HelpModal({ onClose }) {
  return (
    <>
      <div className="mtitle">How to use Wheel.desk</div>
      <div style={{ fontSize: 13, color: 'var(--mu2)', lineHeight: 1.7 }}>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: 'var(--tx)' }}>Cross-device sync</strong> — all your positions, watchlist, and criteria are stored in your Google Sheet and sync automatically. Use ⇩ to pull the latest from any device.
        </p>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: 'var(--tx)' }}>Watchlist</strong> — tickers screened live against IVR ≥50, RSI &lt;35, Stoch &lt;20, and price above MA. All 4 must pass for a CSP signal.
        </p>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: 'var(--tx)' }}>Positions</strong> — log share lots and short options. Add a current option price for live P&amp;L and progress tracking.
        </p>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: 'var(--tx)' }}>Signals</strong> — four equal-priority types:{' '}
          <span style={{ color: 'var(--r)' }}>Roll</span> (strike breached),{' '}
          <span style={{ color: 'var(--a)' }}>Close Early</span> (50%+ premium),{' '}
          <span style={{ color: 'var(--g)' }}>Covered Call</span>,{' '}
          <span style={{ color: 'var(--bl)' }}>CSP Entry</span>.
        </p>
        <p style={{ fontSize: 11, color: 'var(--mu)' }}>
          ⚠️ IVR, RSI, and Stochastic are approximated from Yahoo Finance daily data. Premium estimates use HV30. Always verify in Fidelity before trading. Auto-refreshes every 20 min during market hours.
        </p>
      </div>
      <button className="btn-s" onClick={onClose}>Got it</button>
    </>
  );
}
