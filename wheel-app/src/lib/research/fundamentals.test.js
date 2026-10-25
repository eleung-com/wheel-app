import { describe, it, expect } from 'vitest';
import { median, mean, ttm, consecutiveRun, nextQuarter, pctChange, cagr, negativeFcfStreak, piotroski, altmanZ } from './fundamentals.js';

describe('median / mean', () => {
  it('median ignores one wild year where the average would not (fix #2, VST)', () => {
    const pes = [18, 20, 22, 24, 73];
    expect(median(pes)).toBe(22);
    expect(mean(pes)).toBeCloseTo(31.4);
  });
  it('even count averages the middle two; skips non-numbers', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, undefined])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe('ttm', () => {
  const q = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ revenue: v }));
  it('sums the last 4, or the 4 before that with offset 4', () => {
    expect(ttm(q, 'revenue')).toBe(26);
    expect(ttm(q, 'revenue', 4)).toBe(10);
  });
  it('is null when a quarter is missing or history is short', () => {
    expect(ttm(q.slice(0, 3), 'revenue')).toBeNull();
    expect(ttm([...q.slice(0, 7), { revenue: null }], 'revenue')).toBeNull();
  });
  it('treats 0 as a real value', () => {
    expect(ttm([0, 0, 0, 0].map((revenue) => ({ revenue })), 'revenue')).toBe(0);
  });
  // Part 10A (SPCX): Q4 2025 missing → the newest 4 aren't 12 months.
  const dated = (ends) => ends.map((end, i) => ({ end, operatingIncome: [27, -970, 823, -1943, -143, 2790][i] }));
  const spcx = dated(['2025-03-31', '2025-06-30', '2025-09-30', '2026-03-31', '2026-06-30', '2026-09-30']);
  it('refuses to add quarters across a gap', () => {
    expect(ttm(spcx, 'operatingIncome')).toBeNull();
    const full = dated(['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']);
    expect(ttm(full, 'operatingIncome')).toBe(27 - 970 + 823 - 1943);
  });
  it('a year-earlier window must also connect to today', () => {
    const q8 = ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
      .map((end) => ({ end, revenue: 1 }));
    expect(ttm(q8, 'revenue')).toBe(4);       // newest 4 are back-to-back
    expect(ttm(q8, 'revenue', 4)).toBeNull(); // but Q3 2025 is missing between the two years
  });
  it('counts back-to-back quarters from the newest', () => {
    expect(consecutiveRun(spcx)).toBe(3);
    expect(consecutiveRun([])).toBe(0);
    expect(nextQuarter({ end: '2025-12-31#1', synthetic: true }, { end: '2025-12-31#2', synthetic: true })).toBe(true);
  });
});

describe('growth helpers', () => {
  it('pctChange is null from a non-positive base', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(5, -2)).toBeNull();
    expect(pctChange(5, 0)).toBeNull();
  });
  it('cagr compounds and refuses a loss-making start', () => {
    expect(cagr(100, 133.1, 3)).toBeCloseTo(10);
    expect(cagr(-10, 50, 3)).toBeNull();
    expect(cagr(100, -5, 3)).toBe(-100);
  });
});

describe('negativeFcfStreak', () => {
  it('counts consecutive negative FCF quarters from the latest backwards', () => {
    const q = [
      { operatingCashFlow: 10, capex: 2 },
      { operatingCashFlow: 1, capex: 5 },
      { operatingCashFlow: 1, capex: 4 },
    ];
    expect(negativeFcfStreak(q)).toBe(2);
    expect(negativeFcfStreak([...q, { operatingCashFlow: 9, capex: 1 }])).toBe(0);
  });
});

describe('piotroski', () => {
  const prev = { revenue: 100, grossProfit: 40, netIncome: 5, operatingCashFlow: 8, totalAssets: 200,
    longTermDebt: 60, currentAssets: 50, currentLiabilities: 40, sharesOutstanding: 10 };
  const cur = { revenue: 120, grossProfit: 50, netIncome: 9, operatingCashFlow: 14, totalAssets: 210,
    longTermDebt: 55, currentAssets: 60, currentLiabilities: 40, sharesOutstanding: 10 };

  it('a company improving on every line scores 9', () => {
    const r = piotroski(cur, prev);
    expect(r.run).toBe(9);
    expect(r.passed).toBe(9);
    expect(r.score).toBe(9);
  });
  it('skips tests without data and scales (no gross profit line, like UBER)', () => {
    const r = piotroski({ ...cur, grossProfit: null }, { ...prev, grossProfit: null });
    expect(r.run).toBe(8);
    expect(r.score).toBe(9); // 8 of 8 run → 9
  });
  it('dilution and falling ROA fail their tests', () => {
    const r = piotroski({ ...cur, netIncome: 2, sharesOutstanding: 12 }, prev);
    expect(r.tests.find((t) => t.id === 'no_dilution').pass).toBe(false);
    expect(r.tests.find((t) => t.id === 'roa_up').pass).toBe(false);
  });
  it('too few tests → null score', () => {
    expect(piotroski({ netIncome: 1, totalAssets: 10 }, { netIncome: 1, totalAssets: 10 }).score).toBeNull();
  });
});

describe('altmanZ', () => {
  it('computes the original formula and needs every input', () => {
    const y = { currentAssets: 50, currentLiabilities: 30, retainedEarnings: 40, operatingIncome: 20,
      totalLiabilities: 100, revenue: 150, totalAssets: 200 };
    // 1.2·0.1 + 1.4·0.2 + 3.3·0.1 + 0.6·3 + 1.0·0.75
    expect(altmanZ(y, 300)).toBeCloseTo(0.12 + 0.28 + 0.33 + 1.8 + 0.75);
    expect(altmanZ({ ...y, retainedEarnings: null }, 300)).toBeNull();
  });
});
