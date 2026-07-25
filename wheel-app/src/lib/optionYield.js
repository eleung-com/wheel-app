/**
 * Single source of truth for the annualized-yield math, shared by the Settings
 * → Yield calculator and the Add/Edit Position modal so the two can never drift.
 *
 * annualized = (premium ÷ strike) × (365 ÷ DTE) × 100
 */
export function yieldMetrics({ prem, strike, qty, dte }) {
  const p = parseFloat(prem)   || 0;
  const s = parseFloat(strike) || 0;
  const q = parseInt(qty, 10)  || 1;
  const d = parseFloat(dte)    || 0;

  return {
    totalPrem:     p * q * 100,
    collateral:    s * q * 100,
    returnPct:     s > 0 ? (p / s) * 100 : null,
    annualizedPct: s > 0 && d > 0 ? (p / s) * (365 / d) * 100 : null,
  };
}
