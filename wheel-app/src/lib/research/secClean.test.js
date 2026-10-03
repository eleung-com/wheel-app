import { describe, it, expect } from 'vitest';
import {
  flowSeries, instantSeries, debtAt, shareSeries, buildFinancials, quartersFromYears,
  factsFromConcept, conceptList, US_GAAP, reportingUnit,
} from './secClean.js';

// Fact builders shaped like SEC companyconcept rows.
const flow = (start, end, val, filed = '2026-08-01', form = '10-Q') => ({ start, end, val, filed, form });
const inst = (end, val, filed = '2026-08-01', form = '10-Q') => ({ end, val, filed, form });

describe('flowSeries', () => {
  it('turns year-to-date cash flow into single quarters, incl. Q4 = year − 9 months', () => {
    // Calendar FY 2025: YTD 100 / 250 / 450 / 700  →  quarters 100 / 150 / 200 / 250
    const { quarters, years } = flowSeries([[
      flow('2025-01-01', '2025-03-31', 100),
      flow('2025-01-01', '2025-06-30', 250),
      flow('2025-01-01', '2025-09-30', 450),
      flow('2025-01-01', '2025-12-31', 700, '2026-02-10', '10-K'),
    ]]);
    expect(quarters.get('2025-03-31')).toBe(100);
    expect(quarters.get('2025-06-30')).toBe(150);
    expect(quarters.get('2025-09-30')).toBe(200);
    expect(quarters.get('2025-12-31')).toBe(250);
    expect(years.get('2025-12-31').val).toBe(700);
  });

  it('prefers a reported 3-month figure over a derived one', () => {
    const { quarters } = flowSeries([[
      flow('2025-01-01', '2025-03-31', 100),
      flow('2025-01-01', '2025-06-30', 260),
      flow('2025-04-01', '2025-06-30', 155), // company reported Q2 directly
    ]]);
    expect(quarters.get('2025-06-30')).toBe(155);
  });

  it('merges labels so a company that renamed revenue keeps its full history (UBER/NVDA/TER)', () => {
    const oldLabel = [flow('2019-01-01', '2019-03-31', 10, '2019-05-01')];
    const newLabel = [flow('2026-04-01', '2026-06-30', 99)];
    const { quarters } = flowSeries([newLabel, oldLabel]);
    expect([...quarters.keys()].sort()).toEqual(['2019-03-31', '2026-06-30']);
  });

  it('a restatement (later filing, same period) wins', () => {
    const { quarters } = flowSeries([[
      flow('2025-04-01', '2025-06-30', 100, '2025-08-01'),
      flow('2025-04-01', '2025-06-30', 90, '2026-08-01'), // restated in next year's 10-Q
    ]]);
    expect(quarters.get('2025-06-30')).toBe(90);
  });

  it('handles 52/53-week years (AAPL-style 14-week quarter)', () => {
    const { quarters } = flowSeries([[
      flow('2024-09-29', '2024-12-28', 120), // 13 weeks
      flow('2024-09-29', '2025-03-29', 220), // +13
      flow('2024-09-29', '2025-06-28', 310), // +13
      flow('2024-09-29', '2025-10-04', 420, '2025-11-01', '10-K'), // +14 weeks
    ]]);
    expect(quarters.get('2025-10-04')).toBe(110);
  });

  it('skips periods that are not a quarter apart (missing 9-month figure)', () => {
    const { quarters } = flowSeries([[
      flow('2025-01-01', '2025-06-30', 250),
      flow('2025-01-01', '2025-12-31', 700, '2026-02-10', '10-K'),
    ]]);
    expect(quarters.has('2025-12-31')).toBe(false);
  });
});

describe('instants + debt', () => {
  it('instantSeries keeps the latest filing per date', () => {
    const s = instantSeries([[inst('2025-12-31', 5, '2026-02-01'), inst('2025-12-31', 6, '2026-05-01')]]);
    expect(s.get('2025-12-31')).toBe(6);
  });

  it('debt = long-term (incl. current) + short-term borrowings', () => {
    const instants = {
      ltdTotal: new Map([['2026-06-30', 100]]),
      shortTermBorrowings: new Map([['2026-06-30', 20]]),
    };
    expect(debtAt(instants, '2026-06-30')).toEqual({ value: 120, noDebtReported: false });
  });

  it('debt = noncurrent + current when no total is tagged', () => {
    const instants = { ltdNoncurrent: new Map([['2026-06-30', 80]]), ltdCurrent: new Map([['2026-06-30', 15]]) };
    expect(debtAt(instants, '2026-06-30').value).toBe(95);
  });

  it('a company with no debt concepts at all has zero debt (DUOL)', () => {
    expect(debtAt({}, '2026-06-30')).toEqual({ value: 0, noDebtReported: true });
  });

  it('reports debt but not on this date → null', () => {
    expect(debtAt({ ltdTotal: new Map([['2025-12-31', 100]]) }, '2026-06-30').value).toBeNull();
  });
});

describe('shareSeries', () => {
  it('sums share classes reported in one filing (GOOG A+B+C)', () => {
    const s = shareSeries([
      { end: '2026-07-20', val: 5.8e9, accn: 'a1', filed: '2026-07-25' },
      { end: '2026-07-20', val: 0.86e9, accn: 'a1', filed: '2026-07-25' },
      { end: '2026-07-20', val: 5.4e9, accn: 'a1', filed: '2026-07-25' },
      { end: '2026-04-20', val: 12.1e9, accn: 'a0', filed: '2026-04-25' },
    ]);
    expect(s.at(-1).val).toBeCloseTo(12.06e9, -6);
    expect(s[0].val).toBe(12.1e9);
  });
});

describe('factsFromConcept', () => {
  it('uses USD, else the home currency; drops forms we do not trust', () => {
    const usd = factsFromConcept({ units: { USD: [inst('2025-12-31', 1, '2026-01-01', '10-K'), inst('2025-12-31', 2, '2026-01-01', '8-K')] } });
    expect(usd.unit).toBe('USD');
    expect(usd.facts).toHaveLength(1);
    const twd = factsFromConcept({ units: { TWD: [inst('2025-12-31', 1, '2026-01-01', '20-F')] } });
    expect(twd.unit).toBe('TWD');
  });

  it('reportingUnit picks the home currency even when a few USD convenience figures exist (TSM)', () => {
    const body = { units: {
      USD: [inst('2024-12-31', 90, '2025-04-01', '20-F')],
      TWD: [inst('2024-12-31', 2900, '2025-04-01', '20-F'), inst('2025-12-31', 3800, '2026-04-01', '20-F')],
    } };
    expect(reportingUnit([body])).toBe('TWD');
    expect(factsFromConcept(body, 'TWD').facts).toHaveLength(2);
    expect(factsFromConcept(body, 'EUR').facts).toHaveLength(0);
  });

  it('total revenue beats contract revenue when one filing tags both (VST)', () => {
    const contract = [flow('2026-04-01', '2026-06-30', 3800)];
    const total = [flow('2026-04-01', '2026-06-30', 4017)];
    const order = US_GAAP.flows.revenue;
    const lists = order.map((l) => (l === 'Revenues' ? total : l === 'RevenueFromContractWithCustomerExcludingAssessedTax' ? contract : []));
    expect(flowSeries(lists).quarters.get('2026-06-30')).toBe(4017);
  });

  it('conceptList flattens every label', () => {
    const list = conceptList(US_GAAP);
    expect(list.find((c) => c.label === 'Revenues').item).toBe('revenue');
  });
});

describe('buildFinancials', () => {
  // Two calendar years of a steady company, all from YTD cash flow + direct income quarters.
  function rawCompany() {
    const incomeQ = [];
    const cfYtd = [];
    for (const y of [2024, 2025]) {
      const ends = [`${y}-03-31`, `${y}-06-30`, `${y}-09-30`, `${y}-12-31`];
      const starts = [`${y}-01-01`, `${y}-04-01`, `${y}-07-01`, `${y}-10-01`];
      ends.forEach((e, i) => {
        if (i < 3) incomeQ.push(flow(starts[i], e, 100 + i + (y - 2024) * 10));
        cfYtd.push(flow(`${y}-01-01`, e, 30 * (i + 1), i === 3 ? `${y + 1}-02-10` : `${y}-08-01`, i === 3 ? '10-K' : '10-Q'));
      });
      incomeQ.push(flow(`${y}-01-01`, `${y}-12-31`, 4 * 101.5 + (y - 2024) * 40, `${y + 1}-02-10`, '10-K'));
      incomeQ.push(flow(`${y}-01-01`, `${y}-09-30`, 303 + (y - 2024) * 30));
    }
    return {
      flows: {
        revenue: [incomeQ],
        operatingIncome: [incomeQ.map((f) => ({ ...f, val: f.val / 10 }))],
        operatingCashFlow: [cfYtd],
        capex: [cfYtd.map((f) => ({ ...f, val: f.val / 3 }))],
      },
      instants: {
        equity: [[inst('2024-12-31', 500, '2025-02-10', '10-K'), inst('2025-12-31', 550, '2026-02-10', '10-K')]],
        totalAssets: [[inst('2025-12-31', 1000, '2026-02-10', '10-K')]],
        ltdTotal: [[inst('2025-12-31', 200, '2026-02-10', '10-K')]],
      },
    };
  }

  it('builds aligned quarters (incl. derived Q4) and fiscal years', () => {
    const fin = buildFinancials(rawCompany());
    expect(fin.quarters).toHaveLength(8);
    const q4 = fin.quarters.find((q) => q.end === '2025-12-31');
    expect(q4.revenue).toBeCloseTo(4 * 101.5 + 40 - (303 + 30), 6); // FY − 9M
    expect(q4.operatingCashFlow).toBe(30); // 120 − 90
    expect(fin.annual.map((y) => y.fy)).toEqual([2024, 2025]);
    expect(fin.balance).toMatchObject({ asOf: '2025-12-31', equity: 550, totalDebt: 200 });
    expect(fin.yearlyOnly).toBe(false);
  });

  it('derives total liabilities from assets − equity when not tagged', () => {
    const fin = buildFinancials(rawCompany());
    expect(fin.annual.at(-1).totalLiabilities).toBe(450);
  });

  it('returns null without revenue', () => {
    expect(buildFinancials({ flows: {}, instants: {} })).toBeNull();
  });

  it('flags yearly-only filers (20-F)', () => {
    const years = [2023, 2024, 2025].map((y) => flow(`${y}-01-01`, `${y}-12-31`, 1000 + y, `${y + 1}-04-01`, '20-F'));
    const fin = buildFinancials({ flows: { revenue: [years] }, instants: {} });
    expect(fin.yearlyOnly).toBe(true);
    expect(fin.annual).toHaveLength(3);
  });
});

describe('quartersFromYears', () => {
  it('spreads each year into 4 equal quarters so 12-month math becomes year-vs-year', () => {
    const q = quartersFromYears([{ end: '2024-12-31', revenue: 400 }, { end: '2025-12-31', revenue: 480 }]);
    expect(q).toHaveLength(8);
    expect(q.slice(-4).reduce((s, x) => s + x.revenue, 0)).toBe(480);
    expect(q.every((x) => x.synthetic)).toBe(true);
  });
});
