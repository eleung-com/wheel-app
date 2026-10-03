import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchCompanyBundle, splitFactorAfter, priceAtMonth, resetTickerMap,
} from './companyData.js';
import { scoreStock } from './scoring.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/**
 * Fake SEC + Yahoo + FMP + Finnhub. `concepts` maps "taxonomy/Label" → USD (or other unit) facts.
 */
function fakeTransport({ concepts = {}, unit = 'USD', shares = [], price = 100, months = [], splits = {},
  target = null, fx = null, finnhubCap = null, finnhubCurrency = 'USD', tickers = { 0: { cik_str: 1234, ticker: 'TEST', title: 'Test Corp' } } } = {}) {
  const calls = [];
  const yahooChart = (meta, ts = [], closes = [], events) =>
    json({ chart: { result: [{ meta, timestamp: ts, indicators: { quote: [{ close: closes }] }, events }] } });
  return {
    calls,
    async sec(path) {
      calls.push(['sec', path]);
      if (path === '/files/company_tickers.json') return json(tickers);
      const m = /companyconcept\/CIK\d+\/([^/]+)\/([^/.]+)\.json$/.exec(path);
      if (!m) return json({}, 404);
      const key = `${m[1]}/${m[2]}`;
      if (key === 'dei/EntityCommonStockSharesOutstanding') return shares.length ? json({ units: { shares } }) : json({}, 404);
      return concepts[key] ? json({ units: { [unit]: concepts[key] } }) : json({}, 404);
    },
    async yahoo(path) {
      calls.push(['yahoo', path]);
      if (path.includes('USD%3DX')) return fx ? yahooChart({ regularMarketPrice: fx }) : json({}, 404);
      const ts = months.map((m) => Date.UTC(Number(m[0].slice(0, 4)), Number(m[0].slice(5, 7)) - 1, 1) / 1000);
      return yahooChart({ regularMarketPrice: price, currency: 'USD' }, ts, months.map((m) => m[1]), { splits });
    },
    async fmp(path) {
      calls.push(['fmp', path]);
      return target ? json([{ targetConsensus: target }]) : json({ 'Error Message': 'Premium' }, 402);
    },
    async finnhub(path) {
      calls.push(['finnhub', path]);
      return finnhubCap ? json({ marketCapitalization: finnhubCap, currency: finnhubCurrency, name: 'Foreign Co' }) : json({}, 404);
    },
  };
}

// 2 fiscal years + 8 quarters of a simple calendar-year company.
function usConcepts() {
  const q = (y, i, val) => ({ start: `${y}-${['01-01', '04-01', '07-01', '10-01'][i]}`, end: `${y}-${['03-31', '06-30', '09-30', '12-31'][i]}`, val, filed: `${y}-11-01`, form: '10-Q' });
  const fy = (y, val) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, filed: `${y + 1}-02-10`, form: '10-K' });
  const nine = (y, val) => ({ start: `${y}-01-01`, end: `${y}-09-30`, val, filed: `${y}-11-01`, form: '10-Q' });
  const flows = (base) => [2024, 2025].flatMap((y) => {
    const k = y === 2024 ? 1 : 1.2;
    return [q(y, 0, base * k), q(y, 1, base * k), q(y, 2, base * k), nine(y, 3 * base * k), fy(y, 4 * base * k)];
  });
  const inst = (end, val) => ({ end, val, filed: '2026-02-10', form: '10-K' });
  return {
    'us-gaap/Revenues': flows(1000),
    'us-gaap/OperatingIncomeLoss': flows(200),
    'us-gaap/NetIncomeLoss': flows(150),
    'us-gaap/NetCashProvidedByUsedInOperatingActivities': flows(250),
    'us-gaap/PaymentsToAcquirePropertyPlantAndEquipment': flows(50),
    'us-gaap/StockholdersEquity': [inst('2024-12-31', 2000), inst('2025-12-31', 2400)],
    'us-gaap/Assets': [inst('2024-12-31', 5000), inst('2025-12-31', 5600)],
    'us-gaap/LongTermDebt': [inst('2025-12-31', 1200)],
  };
}

beforeEach(() => resetTickerMap());

describe('helpers', () => {
  it('splitFactorAfter multiplies only splits after the date', () => {
    const splits = [{ date: '2024-06-10', ratio: 10 }, { date: '2021-07-20', ratio: 4 }];
    expect(splitFactorAfter(splits, '2023-12-31')).toBe(10);
    expect(splitFactorAfter(splits, '2020-12-31')).toBe(40);
    expect(splitFactorAfter(splits, '2025-01-01')).toBe(1);
  });
  it('priceAtMonth picks the fiscal-year-end month', () => {
    expect(priceAtMonth([{ month: '2025-12', close: 42 }], '2025-12-31')).toBe(42);
    expect(priceAtMonth([], '2025-12-31')).toBeNull();
  });
});

describe('fetchCompanyBundle — US filer', () => {
  const t = () => fakeTransport({
    concepts: usConcepts(),
    shares: [{ end: '2026-01-31', val: 100, filed: '2026-02-10', accn: 'k1' }, { end: '2025-01-31', val: 100, filed: '2025-02-10', accn: 'k0' }],
    price: 50,
    months: [['2024-12', 40], ['2025-12', 48]],
    target: 60,
  });

  it('assembles a scoring input that the engine can score', async () => {
    const b = await fetchCompanyBundle(t(), 'TEST');
    expect(b.ok).toBe(true);
    expect(b.name).toBe('Test Corp');
    expect(b.input.quarters).toHaveLength(8);
    expect(b.input.quarters.at(-1).operatingCashFlow).toBeCloseTo(300, 6); // FY − 9M
    expect(b.input.balance).toEqual({ totalDebt: 1200, equity: 2400 });
    expect(b.input.sharesOutstanding).toBe(100);
    expect(b.input.analystTarget.value).toBe(60);

    const r = scoreStock({ ...b.input, peers: { source: 'auto', list: [] } });
    expect(r.investmentScore).not.toBeNull();
    expect(r.metrics.operatingPe).toBeCloseTo((50 * 100) / (200 * 1.2 * 4), 6);
  });

  it('computes year-end operating P/E from the month-end price and that year’s shares', async () => {
    const b = await fetchCompanyBundle(t(), 'TEST');
    const y2025 = b.input.opPeHistory.find((h) => h.year === 2025);
    expect(y2025.opPe).toBeCloseTo((48 * 100) / (200 * 1.2 * 4), 6);
  });

  it('tags a missing analyst target as waiting on Claude', async () => {
    const tr = fakeTransport({ concepts: usConcepts(), shares: [{ end: '2026-01-31', val: 100, filed: '2026-02-10' }], price: 50 });
    const b = await fetchCompanyBundle(tr, 'TEST');
    expect(b.input.analystTarget).toBeNull();
    expect(b.dataTags.some((x) => x.code === 'target_pending')).toBe(true);
  });

  it('adjusts old share counts for later stock splits', async () => {
    const tr = fakeTransport({
      concepts: usConcepts(),
      shares: [{ end: '2025-01-31', val: 10, filed: '2025-02-10', accn: 'k0' }, { end: '2026-01-31', val: 10, filed: '2026-02-10', accn: 'k1' }],
      price: 5, months: [['2024-12', 4]],
      splits: { a: { date: Date.UTC(2026, 2, 1) / 1000, numerator: 10, denominator: 1 } },
    });
    const b = await fetchCompanyBundle(tr, 'TEST');
    expect(b.input.sharesOutstanding).toBe(100); // 10 pre-split × 10
    expect(b.input.annual.find((y) => y.fy === 2024).sharesOutstanding).toBe(100);
  });

  it('a ticker SEC does not know → no score, clear tag', async () => {
    const b = await fetchCompanyBundle(t(), 'NOPE');
    expect(b.ok).toBe(false);
    expect(b.dataTags.some((x) => x.code === 'no_sec')).toBe(true);
  });
});

describe('fetchCompanyBundle — foreign filer (20-F, IFRS, home currency)', () => {
  function ifrsConcepts() {
    const fy = (y, val) => ({ start: `${y}-01-01`, end: `${y}-12-31`, val, filed: `${y + 1}-04-01`, form: '20-F' });
    const inst = (y, val) => ({ end: `${y}-12-31`, val, filed: `${y + 1}-04-01`, form: '20-F' });
    const yrs = [2021, 2022, 2023, 2024, 2025];
    return {
      'ifrs-full/Revenue': yrs.map((y, i) => fy(y, 1000 * (1 + i * 0.1))),
      'ifrs-full/ProfitLossFromOperatingActivities': yrs.map((y, i) => fy(y, 400 * (1 + i * 0.1))),
      'ifrs-full/CashFlowsFromUsedInOperatingActivities': yrs.map((y, i) => fy(y, 500 * (1 + i * 0.1))),
      'ifrs-full/PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities': yrs.map((y) => fy(y, 300)),
      'ifrs-full/Equity': yrs.map((y) => inst(y, 3000)),
      'ifrs-full/Borrowings': yrs.map((y) => inst(y, 600)),
    };
  }

  it('falls back to IFRS, converts to USD, spreads years into quarters and tags it', async () => {
    const tr = fakeTransport({
      concepts: ifrsConcepts(), unit: 'TWD', fx: 0.03, finnhubCap: 1000 / 0.03, finnhubCurrency: 'TWD', price: 200,
      months: [['2025-12', 180]],
    });
    const b = await fetchCompanyBundle(tr, 'TEST');
    expect(b.meta.taxonomy).toBe('ifrs-full');
    expect(b.meta.currency).toBe('TWD');
    expect(b.financials.yearlyOnly).toBe(true);
    expect(b.input.quarters).toHaveLength(20);
    // Last 4 synthetic quarters add back up to FY2025 revenue in USD.
    const ttmRev = b.input.quarters.slice(-4).reduce((s, q) => s + q.revenue, 0);
    expect(ttmRev).toBeCloseTo(1400 * 0.03, 6);
    expect(b.input.balance.totalDebt).toBeCloseTo(600 * 0.03, 6);
    expect(b.input.sharesOutstanding).toBeCloseTo(1000e6 / 200, 3);
    const codes = b.dataTags.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['fx_converted', 'yearly_only', 'shares_from_market_cap', 'pe_history_approx']));
  });

  it('flags financials that are old for a yearly filer (SEC only has TSM through FY2024)', async () => {
    const tr = fakeTransport({ concepts: ifrsConcepts(), unit: 'TWD', fx: 0.03, finnhubCap: 1000 / 0.03, finnhubCurrency: 'TWD', price: 200 });
    const fresh = await fetchCompanyBundle(tr, 'TEST', { now: Date.parse('2026-06-01') });
    expect(fresh.dataTags.some((x) => x.code === 'stale_financials')).toBe(false);
    resetTickerMap();
    const old = await fetchCompanyBundle(tr, 'TEST', { now: Date.parse('2027-09-01') });
    expect(old.dataTags.some((x) => x.code === 'stale_financials')).toBe(true);
  });

  it('without an FX rate it refuses to score rather than mixing currencies', async () => {
    const tr = fakeTransport({ concepts: ifrsConcepts(), unit: 'EUR', fx: null, price: 200 });
    const b = await fetchCompanyBundle(tr, 'TEST');
    expect(b.ok).toBe(false);
    expect(b.dataTags.some((x) => x.code === 'no_fx')).toBe(true);
  });
});
