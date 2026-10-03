import { describe, it, expect, beforeEach } from 'vitest';
import { fetchPeerMetrics, buildPeerSet, fetchAutoPeerTickers } from './peers.js';
import { runPreliminary, rescoreFinal } from './run.js';
import { resetTickerMap } from './companyData.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const NOW = Date.parse('2026-10-02');

/**
 * A small fake market. `companies` maps TICKER → { cik, oi: [4 quarterly values] | null,
 * equity, debt, shares, price } — enough for peer metrics and a full subject run.
 */
function fakeMarket(companies, { finnhubPeers = {} } = {}) {
  const byCik = {};
  const tickers = {};
  Object.entries(companies).forEach(([t, c], i) => {
    tickers[i] = { cik_str: c.cik, ticker: t, title: `${t} Inc` };
    byCik[String(c.cik).padStart(10, '0')] = c;
  });
  const qEnds = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
  const qStarts = ['2025-07-01', '2025-10-01', '2026-01-01', '2026-04-01'];
  const calls = [];
  return {
    calls,
    async sec(path) {
      calls.push(path);
      if (path === '/files/company_tickers.json') return json(tickers);
      const m = /CIK(\d+)\/([^/]+)\/([^/.]+)\.json$/.exec(path);
      const c = m && byCik[m[1]];
      if (!c) return json({}, 404);
      const [, , tax, label] = m;
      const inst = (val) => ({ units: { USD: [{ end: '2026-06-30', val, filed: '2026-08-01', form: '10-Q' }] } });
      if (tax === 'dei' && label === 'EntityCommonStockSharesOutstanding') {
        return json({ units: { shares: [{ end: '2026-07-20', val: c.shares, filed: '2026-08-01', accn: 'x' }] } });
      }
      if (label === 'OperatingIncomeLoss' && c.oi) {
        return json({ units: { USD: c.oi.map((val, i) => ({ start: qStarts[i], end: qEnds[i], val, filed: '2026-08-01', form: '10-Q' })) } });
      }
      if (label === 'Revenues' && c.oi) {
        return json({ units: { USD: c.oi.map((val, i) => ({ start: qStarts[i], end: qEnds[i], val: val * 5, filed: '2026-08-01', form: '10-Q' })) } });
      }
      if (label === 'StockholdersEquity' && c.equity != null) return json(inst(c.equity));
      if (label === 'LongTermDebt' && c.debt != null) return json(inst(c.debt));
      return json({}, 404);
    },
    async yahoo(path) {
      const t = decodeURIComponent(/chart\/([^?]+)/.exec(path)[1]);
      const c = companies[t];
      return c ? json({ chart: { result: [{ meta: { regularMarketPrice: c.price }, timestamp: [], indicators: { quote: [{ close: [] }] } }] } }) : json({}, 404);
    },
    async finnhub(path) {
      const t = /symbol=([^&]+)/.exec(path)[1];
      return json(finnhubPeers[t] || []);
    },
    async fmp() { return json([], 402); },
  };
}

beforeEach(() => resetTickerMap());

describe('fetchPeerMetrics', () => {
  it('operating P/E = market cap ÷ last 4 quarters of operating income; D/E from the newest balance sheet', async () => {
    const tx = fakeMarket({ DASH: { cik: 1, oi: [10, 10, 10, 10], equity: 200, debt: 50, shares: 100, price: 12 } });
    const p = await fetchPeerMetrics(tx, 'DASH', { now: NOW });
    expect(p.ok).toBe(true);
    expect(p.opPe).toBeCloseTo(1200 / 40, 6);
    expect(p.debtToEquity).toBeCloseTo(0.25, 6);
  });

  it('keeps a loss-making peer for the debt comparison but gives it no P/E', async () => {
    const tx = fakeMarket({ LYFT: { cik: 2, oi: [-5, 1, 1, 1], equity: 100, debt: 30, shares: 10, price: 10 } });
    const p = await fetchPeerMetrics(tx, 'LYFT', { now: NOW });
    expect(p.ok).toBe(true);
    expect(p.opPe).toBeNull();
    expect(p.debtToEquity).toBeCloseTo(0.3, 6);
  });

  it('skips foreign / non-SEC peers with a reason', async () => {
    const tx = fakeMarket({});
    const p = await fetchPeerMetrics(tx, '2330.TW', { now: NOW });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/No US SEC filings/);
  });

  it('a peer that throws is skipped with a reason, never crashes the run', async () => {
    const tx = fakeMarket({ BAD: { cik: 4, oi: [1, 1, 1, 1], equity: 1, shares: 1, price: 1 } });
    tx.yahoo = async () => { throw new Error('boom'); };
    const realSec = tx.sec;
    tx.sec = async (p) => (p.includes('OperatingIncomeLoss') ? { ok: true, json: async () => { throw new Error('bad json'); } } : realSec(p));
    const p = await fetchPeerMetrics(tx, 'BAD', { now: NOW });
    expect(p.ok).toBe(false);
  });

  it('skips peers whose operating income is out of date', async () => {
    const tx = fakeMarket({ OLD: { cik: 3, oi: [1, 1, 1, 1], equity: 1, shares: 1, price: 1 } });
    const p = await fetchPeerMetrics(tx, 'OLD', { now: Date.parse('2027-12-01') });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/out of date/);
  });
});

describe('buildPeerSet', () => {
  const market = () => fakeMarket({
    GOOGL: { cik: 9, oi: [40, 40, 40, 40], equity: 600, debt: 100, shares: 12, price: 340 },
    GOOG: { cik: 9, oi: [40, 40, 40, 40], equity: 600, debt: 100, shares: 12, price: 341 },
    META: { cik: 10, oi: [20, 20, 20, 20], equity: 200, debt: 30, shares: 2.5, price: 700 },
    PINS: { cik: 11, oi: [1, 1, 1, 1], equity: 3, debt: 0, shares: 0.7, price: 30 },
    SNAP: { cik: 12, oi: [-1, -1, -1, -1], equity: 2, debt: 4, shares: 1.7, price: 9 },
  });

  it('drops the company’s own other share class, foreign tickers, and lists every skip with a reason', async () => {
    const set = await buildPeerSet(market(), ['GOOG', 'META', '2330.TW', 'PINS', 'SNAP'], { source: 'auto', subjectCik: '0000000009', now: NOW });
    expect(set.used.map((p) => p.ticker)).toEqual(['META', 'PINS', 'SNAP']);
    expect(set.skipped).toEqual(expect.arrayContaining([
      { ticker: 'GOOG', reason: 'Same company (other share class)' },
      { ticker: '2330.TW', reason: 'No US SEC filings' },
    ]));
  });

  it('skips a peer with neither a P/E nor a debt ratio (UBER’s DWAY)', async () => {
    const tx = fakeMarket({ DWAY: { cik: 30, oi: [-1, -1, -1, -1], shares: 1, price: 2 } });
    const set = await buildPeerSet(tx, ['DWAY'], { source: 'auto', now: NOW });
    expect(set.used).toHaveLength(0);
    expect(set.skipped[0].reason).toMatch(/No usable numbers/);
  });

  it('multi-class companies with no cover-page total fall back to diluted average shares (META)', async () => {
    const tx = fakeMarket({ META: { cik: 31, oi: [20, 20, 20, 20], equity: 200, debt: 30, shares: null, price: 700 } });
    const realSec = tx.sec;
    tx.sec = async (p) => {
      if (p.includes('dei/EntityCommonStockSharesOutstanding')) return json({}, 404);
      if (p.includes('WeightedAverageNumberOfDilutedSharesOutstanding')) {
        return json({ units: { shares: [{ start: '2026-04-01', end: '2026-06-30', val: 2.5, filed: '2026-08-01' }] } });
      }
      return realSec(p);
    };
    const p = await fetchPeerMetrics(tx, 'META', { now: NOW });
    expect(p.ok).toBe(true);
    expect(p.marketCap).toBeCloseTo(1750, 6);
  });

  it('a malformed diluted-shares body is no data, not a crash (CAR, BE)', async () => {
    const tx = fakeMarket({ CAR: { cik: 32, oi: [1, 1, 1, 1], equity: 5, debt: 20, shares: null, price: 150 } });
    const realSec = tx.sec;
    tx.sec = async (p) => {
      if (p.includes('dei/EntityCommonStockSharesOutstanding')) return json({}, 404);
      if (p.includes('WeightedAverageNumberOfDilutedSharesOutstanding')) return json({ units: { shares: { odd: true } } });
      return realSec(p);
    };
    const p = await fetchPeerMetrics(tx, 'CAR', { now: NOW });
    expect(p.reason).toBe('No price or share count');
  });

  it('stops at the maximum', async () => {
    const set = await buildPeerSet(market(), ['META', 'PINS', 'SNAP'], { source: 'claude', max: 2, now: NOW });
    expect(set.used).toHaveLength(2);
    expect(set.skipped.map((s) => s.ticker)).toContain('SNAP');
  });

  it('fetchAutoPeerTickers removes the subject itself', async () => {
    const tx = fakeMarket({}, { finnhubPeers: { UBER: ['UBER', 'LYFT', 'car', 'LYFT'] } });
    expect(await fetchAutoPeerTickers(tx, 'UBER')).toEqual(['LYFT', 'CAR']);
  });
});

describe('runPreliminary → rescoreFinal', () => {
  const market = () => fakeMarket({
    UBER: { cik: 20, oi: [1.5, 1.6, 1.8, 1.9], equity: 27, debt: 14, shares: 2, price: 70 },
    CAR: { cik: 21, oi: [0.5, 0.5, 0.5, 0.5], equity: 1, debt: 20, shares: 0.04, price: 150 },
    HTZ: { cik: 22, oi: [0.1, 0.1, 0.1, 0.1], equity: 0.5, debt: 15, shares: 0.3, price: 6 },
    LYFT: { cik: 23, oi: [0.1, 0.1, 0.1, 0.1], equity: 0.7, debt: 1, shares: 0.4, price: 20 },
    DASH: { cik: 24, oi: [0.3, 0.3, 0.3, 0.3], equity: 8, debt: 2, shares: 0.42, price: 250 },
  }, { finnhubPeers: { UBER: ['LYFT', 'CAR', 'HTZ', 'MRT'] } });

  it('preliminary uses Finnhub peers; final swaps in Claude’s and is tagged Final', async () => {
    const tx = market();
    const pre = await runPreliminary(tx, 'uber', { now: NOW });
    expect(pre.result.scoreType).toBe('Preliminary');
    expect(pre.peers.source).toBe('auto');
    expect(pre.peers.used.map((p) => p.ticker)).toEqual(['LYFT', 'CAR', 'HTZ']);
    expect(pre.result.tags.some((t) => t.code === 'target_pending')).toBe(true);

    const fin = await rescoreFinal(tx, pre, {
      peerTickers: ['DASH', 'LYFT'],
      analystTarget: { value: 100, source: 'Claude (consensus)', asOf: '2026-10-02' },
      beatRate: { beats: 7, total: 8, stale: false },
    }, { now: NOW });
    expect(fin.result.scoreType).toBe('Final');
    expect(fin.peers.used.map((p) => p.ticker)).toEqual(['DASH', 'LYFT']);
    expect(fin.result.upside.target.value).toBe(100);
    expect(fin.result.quality.checks.find((c) => c.id === 'beat_rate').display).toBe('7 of 8');
    expect(fin.result.tags.some((t) => t.code === 'target_pending')).toBe(false);
    // Fewer than 3 usable Claude peers → weak comparison tag.
    expect(fin.result.tags.some((t) => t.code === 'weak_comparison')).toBe(true);
  });

  it('a ticker that cannot be scored returns no result but explains why', async () => {
    const pre = await runPreliminary(market(), 'NOPE', { now: NOW });
    expect(pre.result).toBeNull();
    expect(pre.bundle.dataTags.some((t) => t.code === 'no_sec')).toBe(true);
  });
});
