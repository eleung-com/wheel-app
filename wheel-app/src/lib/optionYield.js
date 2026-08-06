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

/**
 * Defined-risk yield math for a put CREDIT spread (short higher strike, long
 * lower strike, same expiry). Everything is computed on the spread WIDTH — the
 * true capital at risk / buying power for a vertical — not the short strike.
 *
 *   width        = shortStrike − longStrike
 *   net credit   = shortPrem − longPrem   (per share)
 *   max profit   = net credit × qty × 100
 *   max loss     = (width − net credit) × qty × 100
 *   collateral   = width × qty × 100
 *   breakeven    = shortStrike − net credit
 *   return       = net credit ÷ width
 *   annualized   = return × 365/DTE
 */
export function spreadMetrics({ shortStrike, longStrike, shortPrem, longPrem, netCredit, qty, dte }) {
  const ss = parseFloat(shortStrike) || 0;
  const ls = parseFloat(longStrike)  || 0;
  const q  = parseInt(qty, 10)       || 1;
  const d  = parseFloat(dte)         || 0;

  // Net credit either passed directly or derived from the two leg premiums.
  const nc = netCredit != null && netCredit !== ''
    ? (parseFloat(netCredit) || 0)
    : (parseFloat(shortPrem) || 0) - (parseFloat(longPrem) || 0);

  const width = ss - ls;
  const valid = width > 0;

  return {
    width,
    netCredit:     nc,
    totalPrem:     nc * q * 100,
    maxProfit:     nc * q * 100,
    maxLoss:       valid ? (width - nc) * q * 100 : null,
    collateral:    valid ? width * q * 100 : null,
    breakeven:     valid ? ss - nc : null,
    returnPct:     valid ? (nc / width) * 100 : null,
    annualizedPct: valid && d > 0 ? (nc / width) * (365 / d) * 100 : null,
  };
}

/**
 * Two-leg `legs[]` for the payoff chart / stats bar from a put credit spread.
 * Uses the real per-leg premiums so the chart and breakeven are exact.
 */
export function buildPutSpreadLegs({ shortStrike, longStrike, shortPrem, longPrem, qty }) {
  const q = qty || '1';
  return [
    { id: 1, action: 'sell', optType: 'put', qty: q, strike: shortStrike, premium: shortPrem, expiry: '' },
    { id: 2, action: 'buy',  optType: 'put', qty: q, strike: longStrike,  premium: longPrem,  expiry: '' },
  ];
}
