import { describe, it, expect } from 'vitest';
import { plainLines, chartSeries, quarterLabel, money } from './explain.js';
import { scoreStock } from './scoring.js';

function fin(n = 8) {
  const quarters = Array.from({ length: n }, (_, i) => {
    const y = 2025 + Math.floor(i / 4), q = (i % 4) + 1;
    const end = `${y}-${String(q * 3).padStart(2, '0')}-${q === 1 || q === 4 ? '31' : '30'}`;
    return { end, revenue: 100 + i * 5, operatingIncome: 20 + i, netIncome: 15, operatingCashFlow: 30 + i, capex: i === 2 ? 50 : 5,
      debtLongTerm: 80, debtShortTerm: 10, cash: 40 };
  });
  return { quarters, annual: [], yearlyOnly: false };
}

function run(f = fin()) {
  const input = { ticker: 'T', price: 50, sharesOutstanding: 10, quarters: f.quarters, balance: { totalDebt: 90, equity: 300 },
    annual: [], opPeHistory: [{ year: 2024, opPe: 10 }, { year: 2025, opPe: 6 }],
    peers: { source: 'claude', list: [{ ticker: 'AA', opPe: 9 }, { ticker: 'BB', opPe: 7 }, { ticker: 'CC', opPe: 8 }] },
    analystTarget: { value: 60 }, stage: 'final', beatRate: null };
  return { result: scoreStock(input), bundle: { financials: f }, peers: { used: input.peers.list } };
}

describe('helpers', () => {
  it('quarterLabel + money', () => {
    expect(quarterLabel('2026-06-30')).toBe("Q2'26");
    expect(quarterLabel('2025-12-31')).toBe("Q4'25");
    expect(money(14.1e9)).toBe('$14.1B');
    expect(money(4.2e12)).toBe('$4.20T');
    expect(money(-3e8)).toBe('−$300M');
    expect(money(null)).toBe('—');
  });
});

describe('plainLines', () => {
  it('builds the fixed-template lines with tones from the checks', () => {
    const lines = plainLines(run());
    const texts = lines.map((l) => l.text);
    expect(texts[0]).toBe('Revenue up year over year in 4 of the last 4 quarters');
    expect(texts.some((t) => /^Operating income \+\d/.test(t))).toBe(true);
    expect(texts.some((t) => t.startsWith('Free cash flow positive in 7 of 8 quarters'))).toBe(true);
    expect(texts.some((t) => /vs own 5-yr median 8\.0/.test(t))).toBe(true);
    expect(texts.some((t) => /vs peers 8\.0 \(AA, BB, CC\)/.test(t))).toBe(true);
    expect(texts.at(-1)).toMatch(/^Analyst average target \$60\.00 \(\+20\.0%\)/);
    expect(lines.every((l) => ['g', 'a', 'r', 'n'].includes(l.tone))).toBe(true);
  });

  it('no target → waiting on Claude', () => {
    const r = run();
    r.result = scoreStock({ ...{ ticker: 'T', price: 50, sharesOutstanding: 10, quarters: fin().quarters, balance: { totalDebt: 90, equity: 300 }, annual: [], opPeHistory: [] }, analystTarget: null });
    expect(plainLines(r).at(-1).text).toBe('Analyst target: waiting on Claude');
  });

  it('empty run → no lines', () => {
    expect(plainLines(null)).toEqual([]);
  });
});

describe('chartSeries', () => {
  it('quarterly series with FCF = op cash − capex and the debt split', () => {
    const s = chartSeries(fin());
    expect(s.period).toBe('quarter');
    expect(s.labels[0]).toBe("Q1'25");
    expect(s.fcf[2]).toBe(32 - 50);
    expect(s.debtLongTerm[0]).toBe(80);
    expect(s.cash.at(-1)).toBe(40);
  });

  it('yearly-only filers get yearly bars', () => {
    const s = chartSeries({ yearlyOnly: true, quarters: [], annual: [{ fy: 2024, revenue: 1 }, { fy: 2025, revenue: 2 }] });
    expect(s.period).toBe('year');
    expect(s.labels).toEqual(['FY24', 'FY25']);
    expect(s.revenue).toEqual([1, 2]);
  });
});
