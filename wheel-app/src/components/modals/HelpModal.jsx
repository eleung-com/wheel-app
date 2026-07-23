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
          <strong style={{ color: 'var(--tx)' }}>Watchlist</strong> — synced from Notion. Only rows where <strong style={{ color: 'var(--tx)' }}>Dive-In = 🔥 Priority</strong> are scanned for CSP entries; a signal fires when one drops 5%+ from its 5-day high. Tap a ticker for the chart, which carries RSI and Stochastic studies.
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
          ⚠️ Signals flag candidates, they don't confirm them — check RSI and Stochastic on the chart yourself before selling. The ATR figure on each card says how big the move is against that stock's own daily range, so start with the largest. IVR and premium estimates use HV30. Always verify the chain in Fidelity. Auto-refreshes every 20 min during market hours.
        </p>
      </div>
      <button className="btn-s" onClick={onClose}>Got it</button>
    </>
  );
}
