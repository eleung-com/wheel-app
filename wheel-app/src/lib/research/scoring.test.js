import { describe, it, expect } from 'vitest';
import { scoreStock, verdictFor, operatingPe } from './scoring.js';
import { SCORING_VERSION } from './rules.js';
import { ttm } from './fundamentals.js';

// ── Fixture builder ─────────────────────────────────────────────────────────
// Synthetic companies. Each dry-run scenario (VST / UBER / GOOGL / GEV) is
// rebuilt from the specific behaviour that exposed a rule bug, not from the
// real filings — real-ticker checks happen in P1.1 once SEC data flows.

const SHARES = 100;

/** 20 quarters from per-quarter functions of i (0 = oldest). */
function quarters(fn, n = 20) {
  return Array.from({ length: n }, (_, i) => ({ end: `q${i}`, ...fn(i) }));
}

// Healthy grower: revenue +3%/qtr, operating margin widening 1 pt/qtr from 10%.
const healthyQ = (i) => {
  const revenue = 1000 * 1.03 ** i;
  const operatingIncome = revenue * (0.10 + 0.01 * i);
  return { revenue, operatingIncome, netIncome: operatingIncome * 0.8, operatingCashFlow: revenue * 0.25, capex: revenue * 0.05 };
};

const goodYears = [
  { fy: 2024, revenue: 100, grossProfit: 40, operatingIncome: 15, netIncome: 5, operatingCashFlow: 8, totalAssets: 200, totalLiabilities: 100,
    longTermDebt: 60, currentAssets: 50, currentLiabilities: 40, retainedEarnings: 50, sharesOutstanding: SHARES },
  { fy: 2025, revenue: 120, grossProfit: 50, operatingIncome: 20, netIncome: 9, operatingCashFlow: 14, totalAssets: 210, totalLiabilities: 100,
    longTermDebt: 55, currentAssets: 60, currentLiabilities: 40, retainedEarnings: 60, sharesOutstanding: SHARES },
];

/** Build an input; `opPe` sets the price so the current operating P/E equals it. */
function company({ q = quarters(healthyQ), opPe = 20, upsidePct = 30, ...rest } = {}) {
  const oi = ttm(q, 'operatingIncome');
  const price = oi > 0 ? (opPe * oi) / SHARES : 50;
  return {
    ticker: 'TEST',
    stage: 'final',
    price,
    sharesOutstanding: SHARES,
    quarters: q,
    balance: { totalDebt: 50, equity: 100 },
    annual: goodYears,
    opPeHistory: [25, 25, 25, 25, 25].map((opPe, k) => ({ year: 2021 + k, opPe })),
    peers: { source: 'claude', list: [{ ticker: 'A', opPe: 25, debtToEquity: 0.5 }, { ticker: 'B', opPe: 26, debtToEquity: 0.6 }, { ticker: 'C', opPe: 30, debtToEquity: 0.4 }] },
    analystTarget: { value: price * (1 + upsidePct / 100), source: 'FMP', asOf: '2026-10-01' },
    beatRate: { beats: 8, total: 8, stale: false },
    ...rest,
  };
}

const check = (r, id) => r.quality.checks.find((c) => c.id === id);
const part = (r, id) => r.value.parts.find((p) => p.id === id);
const hasTag = (r, code) => r.tags.some((t) => t.code === code);

// ── Baseline ────────────────────────────────────────────────────────────────

describe('baseline healthy company', () => {
  const r = scoreStock(company());
  it('scores 100 across the board and says Worth investing', () => {
    expect(r.quality.score).toBe(100);
    expect(r.value.score).toBe(100);
    expect(r.upside.score).toBe(100);
    expect(r.investmentScore).toBe(100);
    expect(r.verdict).toBe('Worth investing');
  });
  it('stamps the rules version and score type', () => {
    expect(r.version).toBe(SCORING_VERSION);
    expect(r.scoreType).toBe('Final');
  });
  it('is deterministic — same input, same output', () => {
    expect(scoreStock(company())).toEqual(scoreStock(company()));
  });
});

// ── Dry-run fixes ───────────────────────────────────────────────────────────

describe('VST dry run: fixes #1, #2, #3, #4', () => {
  // Shrinking revenue, margin falling ~2.4 pts a year, debt above peers,
  // cash flow positive but falling — but cheap with a big analyst target.
  const vstQ = quarters((i) => {
    const revenue = 1000 * 0.98 ** i;
    const operatingIncome = revenue * (0.25 - 0.006 * i);
    return { revenue, operatingIncome, netIncome: operatingIncome * 0.7, operatingCashFlow: 300 - 5 * i, capex: 50 };
  });
  const badYears = [
    { ...goodYears[1], fy: 2024 },
    { ...goodYears[0], fy: 2025, sharesOutstanding: SHARES * 1.1 },
  ];
  const input = company({
    q: vstQ, opPe: 10, upsidePct: 45, annual: badYears,
    balance: { totalDebt: 180, equity: 100 }, // D/E 1.8
    peers: { source: 'claude', list: [{ ticker: 'P1', opPe: 14, debtToEquity: 1.5 }, { ticker: 'P2', opPe: 15, debtToEquity: 1.7 }, { ticker: 'P3', opPe: 16, debtToEquity: 1.6 }] },
    opPeHistory: [12, 13, 14, 15, 73].map((opPe, k) => ({ year: 2021 + k, opPe })),
    beatRate: null,
  });
  const r = scoreStock(input);

  it('#1 quality floor: low quality → Not worth it even with a decent overall score', () => {
    expect(r.quality.score).toBeLessThan(50);
    expect(r.investmentScore).toBeGreaterThanOrEqual(55);
    expect(r.verdict).toBe('Not worth it');
    expect(r.verdictReason).toMatch(/floor/);
  });
  it('#2 own P/E uses the median (14), not the average inflated by the 73 year', () => {
    expect(part(r, 'pe_own').display).toBe('10.0 vs 14.0');
  });
  it('#3 debt is judged against the peer average: 1.8 vs 1.6 avg → yellow, not red', () => {
    expect(check(r, 'debt_to_equity').color).toBe('yellow');
  });
  it('#4 margin falling >2 pts is red', () => {
    expect(check(r, 'margin_trend').color).toBe('red');
  });
});

describe('fix #4: margin tolerance band', () => {
  const marginQ = (m) => quarters((i) => ({ ...healthyQ(0), revenue: 1000, operatingIncome: 1000 * (i < 4 ? 0.20 : m) }), 8);
  it.each([
    [0.187, 'yellow'], // −1.3 pts (the VST dip) = flat
    [0.213, 'yellow'], // +1.3 pts = flat
    [0.17, 'red'],     // −3 pts
    [0.23, 'green'],   // +3 pts
  ])('margin 20%% → %s gives %s', (m, color) => {
    expect(check(scoreStock(company({ q: marginQ(m) })), 'margin_trend').color).toBe(color);
  });
});

describe('UBER dry run: fixes #5, #6, #7', () => {
  // Operating income +49% year over year; net income swamped by one-off gains
  // in two quarters, so net income actually FELL vs the inflated year before.
  const uberQ = quarters((i) => {
    const revenue = 1000;
    const operatingIncome = i < 16 ? 100 : 149;
    const oneOff = i === 13 || i === 14 ? 900 : 0;
    return { revenue, operatingIncome, netIncome: operatingIncome * 0.8 + oneOff, operatingCashFlow: 250 + i, capex: 20 };
  });
  const r = scoreStock(company({
    q: uberQ,
    balance: { totalDebt: 52, equity: 100 }, // 0.52
    peers: { source: 'claude', list: [
      { ticker: 'DASH', opPe: 30, debtToEquity: 0.05 },
      { ticker: 'LYFT', opPe: 2.1, debtToEquity: 0.3 },
      { ticker: 'GRAB', opPe: 25, debtToEquity: 0.02 },
      { ticker: 'CART', opPe: 26, debtToEquity: 0.01 },
    ] },
  }));

  it('#5 scores operating income growth (+49%, green), not net income', () => {
    expect(check(r, 'op_income_growth').color).toBe('green');
    expect(check(r, 'op_income_growth').value).toBeCloseTo(49, 0);
  });
  it('#6 D/E 0.52 is green even though peers carry almost no debt', () => {
    expect(check(r, 'debt_to_equity').color).toBe('green');
  });
  it('#7 peer P/E uses the median, so one odd peer (LYFT 2.1) can’t swing it', () => {
    expect(part(r, 'pe_peers').display).toBe('20.0 vs 25.5');
  });
});

describe('fix #7: peer rules', () => {
  it('excludes peers with a negative P/E', () => {
    const r = scoreStock(company({ peers: { source: 'claude', list: [
      { ticker: 'A', opPe: 18 }, { ticker: 'B', opPe: -40 }, { ticker: 'C', opPe: 22 }, { ticker: 'D', opPe: 24 },
    ] } }));
    expect(part(r, 'pe_peers').note).toBe('3 peers');
    expect(part(r, 'pe_peers').display).toBe('20.0 vs 22.0');
  });
  it('fewer than 3 usable peers → weak comparison tag, still scored', () => {
    const r = scoreStock(company({ peers: { source: 'auto', list: [{ ticker: 'A', opPe: 18 }, { ticker: 'B', opPe: 30 }] } }));
    expect(hasTag(r, 'weak_comparison')).toBe(true);
    expect(part(r, 'pe_peers').points).not.toBeNull();
  });
});

describe('fix #3 + #6: debt bands', () => {
  const peers = { source: 'claude', list: [1.4, 1.6, 1.8].map((d, k) => ({ ticker: `P${k}`, opPe: 20, debtToEquity: d })) }; // avg 1.6
  const colorAt = (de, p = peers) => check(scoreStock(company({ balance: { totalDebt: de * 100, equity: 100 }, peers: p })), 'debt_to_equity').color;
  it('at/below peer average = green, up to 1.5× = yellow, above = red', () => {
    expect(colorAt(1.5)).toBe('green');
    expect(colorAt(2.4)).toBe('yellow');
    expect(colorAt(2.5)).toBe('red');
  });
  it('no peer debt data → fixed 1.0 / 2.0 fallback, tagged', () => {
    const none = { source: 'auto', list: [] };
    expect(colorAt(1.9, none)).toBe('yellow');
    expect(colorAt(2.2, none)).toBe('red');
    expect(hasTag(scoreStock(company({ balance: { totalDebt: 190, equity: 100 }, peers: none })), 'weak_comparison_debt')).toBe(true);
  });
  it('negative equity → left out of the score and tagged', () => {
    const r = scoreStock(company({ balance: { totalDebt: 100, equity: -20 } }));
    expect(check(r, 'debt_to_equity').color).toBe('na');
    expect(hasTag(r, 'negative_equity')).toBe(true);
  });
});

describe('fix #8: beat rate', () => {
  const colorFor = (beatRate) => check(scoreStock(company({ beatRate })), 'beat_rate').color;
  it('7/8 green · 6/8 (exactly 75%) yellow · 3/8 red', () => {
    expect(colorFor({ beats: 7, total: 8 })).toBe('green');
    expect(colorFor({ beats: 6, total: 8 })).toBe('yellow');
    expect(colorFor({ beats: 3, total: 8 })).toBe('red');
  });
  it('stale or not yet known → n/a, and the other 5 checks share its 70 points', () => {
    expect(colorFor({ beats: 8, total: 8, stale: true })).toBe('na');
    const r = scoreStock(company({ beatRate: null }));
    expect(check(r, 'beat_rate').display).toBe('pending');
    expect(check(r, 'revenue_growth').maxPoints).toBe(14);
    expect(r.quality.score).toBe(100);
  });
});

describe('GEV dry run: fix #9 operating P/E', () => {
  // Most of the reported profit is one-time (tax benefit, stake revaluation).
  const gevQ = quarters((i) => ({ ...healthyQ(i), netIncome: healthyQ(i).operatingIncome * 0.8 + (i >= 17 ? 3000 : 0) }));
  const r = scoreStock(company({ q: gevQ }));
  it('scores on operating P/E; the reported P/E is shown but much lower', () => {
    expect(r.metrics.operatingPe).toBeCloseTo(20);
    expect(r.metrics.reportedPe).toBeLessThan(r.metrics.operatingPe / 2);
    expect(part(r, 'pe_own').display).toBe('20.0 vs 25.0');
  });
});

describe('GOOGL dry run: fix #10 FCF', () => {
  it('a capex spike that shrinks FCF is still green while operating cash flow grows', () => {
    const q = quarters((i) => ({ ...healthyQ(i), capex: i === 19 ? healthyQ(i).revenue * 0.2 : healthyQ(i).capex }));
    const c = check(scoreStock(company({ q })), 'fcf');
    expect(c.color).toBe('green');
  });
  it('FCF positive but operating cash flow falling → yellow', () => {
    const q = quarters((i) => ({ ...healthyQ(i), operatingCashFlow: 500 - 5 * i, capex: 10 }));
    expect(check(scoreStock(company({ q })), 'fcf').color).toBe('yellow');
  });
  it('FCF negative over 12 months → red, plus a streak tag', () => {
    const q = quarters((i) => ({ ...healthyQ(i), capex: healthyQ(i).revenue * 0.4 }));
    const r = scoreStock(company({ q }));
    expect(check(r, 'fcf').color).toBe('red');
    expect(hasTag(r, 'fcf_negative_streak')).toBe(true);
  });
});

// ── Scales, cutoffs, gaps ───────────────────────────────────────────────────

describe('verdict cutoffs (decided 10-02)', () => {
  it.each([
    [75, 80, 'Worth investing'],
    [74, 80, 'Maybe'],
    [55, 80, 'Maybe'],
    [54, 80, 'Not worth it'],
    [90, 49, 'Not worth it'], // floor
    [90, 50, 'Worth investing'],
  ])('score %i, quality %i → %s', (score, quality, verdict) => {
    expect(verdictFor(score, quality).verdict).toBe(verdict);
  });
});

describe('target upside scale', () => {
  it.each([[-5, 0], [0, 0], [15, 50], [30, 100], [60, 100]])('%i%% upside → %i points', (pct, pts) => {
    expect(scoreStock(company({ upsidePct: pct })).upside.score).toBe(pts);
  });
  it('no target → upside left out and weights rescaled (quality 53% / value 47%)', () => {
    const r = scoreStock(company({ analystTarget: null }));
    expect(r.upside.score).toBeNull();
    expect(hasTag(r, 'no_target')).toBe(true);
    expect(r.weightsUsed.quality).toBeCloseTo(0.4 / 0.75);
    expect(r.weightsUsed.value).toBeCloseTo(0.35 / 0.75);
    expect(r.investmentScore).toBe(100);
  });
});

describe('value scale', () => {
  it('P/E up to 25% above the reference = 50, beyond = 0', () => {
    expect(part(scoreStock(company({ opPe: 31 })), 'pe_own').points).toBe(50); // 31 ≤ 25×1.25
    expect(part(scoreStock(company({ opPe: 32 })), 'pe_own').points).toBe(0);
  });
  it('PEG bands: <1 = 100 · 1–2 = 50 · >2 = 0; no growth = 0', () => {
    // Flat op income for 16 quarters then a jump → modest 3-yr growth.
    const slowQ = (g) => quarters((i) => ({ ...healthyQ(i), revenue: 1000, operatingIncome: i < 8 ? 100 : 100 * (1 + g) ** 3 }));
    const pegPts = (g, opPe) => part(scoreStock(company({ q: slowQ(g), opPe })), 'peg').points;
    expect(pegPts(0.30, 20)).toBe(100); // 20 / 30 = 0.67
    expect(pegPts(0.15, 20)).toBe(50);  // 20 / 15 = 1.33
    expect(pegPts(0.05, 20)).toBe(0);   // 20 / 5  = 4
    expect(pegPts(-0.05, 20)).toBe(0);
  });
  it('no operating profit → value n/a, tagged, score still produced from quality + upside', () => {
    const q = quarters((i) => ({ ...healthyQ(i), operatingIncome: -50 }));
    const r = scoreStock(company({ q }));
    expect(operatingPe(company({ q }))).toBeNull();
    expect(r.value.score).toBeNull();
    expect(hasTag(r, 'no_operating_profit')).toBe(true);
    expect(r.investmentScore).not.toBeNull();
  });
});

describe('preliminary → final', () => {
  it('auto peers give one answer; Claude’s peers re-score it', () => {
    const autoPeers = { source: 'auto', list: [{ ticker: 'X', opPe: 18 }, { ticker: 'Y', opPe: 19 }, { ticker: 'Z', opPe: 17 }] };
    const pre = scoreStock(company({ stage: 'preliminary', peers: autoPeers, beatRate: null }));
    const fin = scoreStock(company({ stage: 'final' }));
    expect(pre.scoreType).toBe('Preliminary');
    expect(pre.peerSource).toBe('auto');
    expect(part(pre, 'pe_peers').points).toBe(50);
    expect(fin.scoreType).toBe('Final');
    expect(part(fin, 'pe_peers').points).toBe(100);
    expect(fin.investmentScore).toBeGreaterThan(pre.investmentScore);
  });
});

describe('data gaps', () => {
  it('no SEC data at all → No score', () => {
    const r = scoreStock({ ticker: 'ADR', price: 10, sharesOutstanding: 1, quarters: [], annual: [], peers: { list: [] } });
    expect(r.investmentScore).toBeNull();
    expect(r.verdict).toBe('No score');
  });
  it('no Piotroski data → the checks carry the full 100', () => {
    const r = scoreStock(company({ annual: [] }));
    expect(r.quality.piotroskiPoints).toBeNull();
    expect(r.quality.score).toBe(100);
  });
  it('Altman Z under 1.8 adds a tag but never changes points', () => {
    // Huge liabilities shrink the market-cap term; deficit + negative working capital do the rest.
    const weak = goodYears.map((y) => ({ ...y, retainedEarnings: -300, currentAssets: 10, currentLiabilities: 90, totalLiabilities: 1e6 }));
    const r = scoreStock(company({ annual: weak }));
    expect(hasTag(r, 'altman_danger')).toBe(true);
    // Same company with Altman uncomputable (no retained earnings) → identical quality points.
    const noZ = scoreStock(company({ annual: weak.map((y) => ({ ...y, retainedEarnings: null })) }));
    expect(hasTag(noZ, 'altman_danger')).toBe(false);
    expect(r.quality.score).toBe(noZ.quality.score);
  });
});
