import React from 'react';
import { yieldMetrics, spreadMetrics } from '../../../lib/optionYield';

const fmtPct    = n => n != null ? `${n.toFixed(2)}%` : '—';
const fmtDollar = n => n > 0
  ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--b1)' }}>
      <span style={{ fontSize: 12, color: 'var(--mu2)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--fg)' }}>{value}</span>
    </div>
  );
}

/**
 * The yield results box — total premium, collateral, return on collateral, and
 * the annualized figure — computed straight from {prem, strike, qty, dte}.
 * Shared by the Settings yield calculator and the position modal.
 */
export default function YieldSummary({ prem, strike, qty, dte, spread }) {
  // Spread mode: defined-risk yield computed on the width (see spreadMetrics).
  if (spread) {
    const { totalPrem, maxLoss, collateral, returnPct, annualizedPct } =
      spreadMetrics({ ...spread, qty, dte });

    return (
      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '0 14px' }}>
        <Row label="Net credit (max profit)"      value={fmtDollar(totalPrem)} />
        <Row label="Max loss"                     value={maxLoss != null ? fmtDollar(maxLoss) : '—'} />
        <Row label="Capital at risk (width)"      value={collateral != null ? fmtDollar(collateral) : '—'} />
        <Row label="Return on width"              value={fmtPct(returnPct)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--mu2)' }}>Annualized return</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: annualizedPct != null ? 'var(--g)' : 'var(--fg)', fontWeight: 600 }}>
            {fmtPct(annualizedPct)}
          </span>
        </div>
      </div>
    );
  }

  const { totalPrem, collateral, returnPct, annualizedPct } = yieldMetrics({ prem, strike, qty, dte });

  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '0 14px' }}>
      <Row label="Total premium collected"      value={fmtDollar(totalPrem)} />
      <Row label="Capital at risk (collateral)" value={fmtDollar(collateral)} />
      <Row label="Return on collateral"         value={fmtPct(returnPct)} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0' }}>
        <span style={{ fontSize: 12, color: 'var(--mu2)' }}>Annualized return</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: annualizedPct != null ? 'var(--g)' : 'var(--fg)', fontWeight: 600 }}>
          {fmtPct(annualizedPct)}
        </span>
      </div>
    </div>
  );
}
