import { describe, it, expect } from 'vitest';
import { spreadMetrics, buildPutSpreadLegs } from './optionYield';

// Reference spread: sell $45 put for 1.85, buy $40 put for 0.70, 1 spread, 30 DTE.
// width = 5, net credit = 1.15
const base = { shortStrike: 45, longStrike: 40, shortPrem: 1.85, longPrem: 0.70, qty: 1, dte: 30 };

describe('spreadMetrics', () => {
  it('computes width, credit, max profit, max loss on the width', () => {
    const m = spreadMetrics(base);
    expect(m.width).toBe(5);
    expect(m.netCredit).toBeCloseTo(1.15, 10);
    expect(m.maxProfit).toBeCloseTo(115, 6);          // 1.15 * 1 * 100
    expect(m.maxLoss).toBeCloseTo(385, 6);            // (5 - 1.15) * 100
    expect(m.collateral).toBeCloseTo(500, 6);         // width * 100
    expect(m.breakeven).toBeCloseTo(43.85, 6);        // 45 - 1.15
  });

  it('returns are computed on width, not the short strike', () => {
    const m = spreadMetrics(base);
    expect(m.returnPct).toBeCloseTo(23, 6);           // 1.15 / 5 * 100
    // annualized = 1.15/5 * 365/30 * 100
    expect(m.annualizedPct).toBeCloseTo(279.833, 2);
  });

  it('scales max profit / loss with quantity', () => {
    const m = spreadMetrics({ ...base, qty: 3 });
    expect(m.maxProfit).toBeCloseTo(345, 6);
    expect(m.maxLoss).toBeCloseTo(1155, 6);
    expect(m.collateral).toBeCloseTo(1500, 6);
  });

  it('accepts an explicit netCredit override', () => {
    const m = spreadMetrics({ shortStrike: 45, longStrike: 40, netCredit: 2, qty: 1, dte: 30 });
    expect(m.netCredit).toBe(2);
    expect(m.maxProfit).toBeCloseTo(200, 6);
  });

  it('guards invalid widths (long >= short)', () => {
    const m = spreadMetrics({ shortStrike: 40, longStrike: 45, shortPrem: 1, longPrem: 0.5, qty: 1, dte: 30 });
    expect(m.maxLoss).toBeNull();
    expect(m.collateral).toBeNull();
    expect(m.returnPct).toBeNull();
  });
});

describe('buildPutSpreadLegs', () => {
  it('builds a sell-short / buy-long two-leg put structure', () => {
    const legs = buildPutSpreadLegs(base);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ action: 'sell', optType: 'put', strike: 45, premium: 1.85 });
    expect(legs[1]).toMatchObject({ action: 'buy',  optType: 'put', strike: 40, premium: 0.70 });
  });
});
