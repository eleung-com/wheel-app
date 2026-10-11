import { describe, it, expect } from 'vitest';
import { deriveWeekly, leapsEntryOk, leapsWindow, buildSignals, PRIORITY } from './signalEngine';
import { prefetchLeaps } from './leaps';
import { splitSections } from './signalSections';
import { parseCriteria } from './utils';

const CR = parseCriteria({});

/** Weekly bars: long steady uptrend, then a 3-week dip and a turn up, ending near the 50-wk MA. */
function trendBars({ weeks = 260, dipEnd = true } = {}) {
  const closes = [];
  for (let i = 0; i < weeks; i++) closes.push(100 + i * 0.5);
  if (dipEnd) {
    // pull back toward the 50-wk MA, then tick up
    const top = closes[weeks - 6];
    closes[weeks - 5] = top - 4; closes[weeks - 4] = top - 9; closes[weeks - 3] = top - 13;
    closes[weeks - 2] = top - 15; closes[weeks - 1] = top - 13.5;
  }
  const highs = closes.map(c => c + 1), lows = closes.map(c => c - 1);
  const dates = closes.map((_, i) => new Date(Date.UTC(2021, 9, 4) + i * 7 * 86400000).toISOString().slice(0, 10));
  return { closes, highs, lows, dates, divs: [] };
}

describe('deriveWeekly', () => {
  it('computes 50/200-wk MAs, 4-week-ago MAs and % above the 50', () => {
    const w = deriveWeekly(trendBars({ dipEnd: false }));
    expect(w.weeks).toBe(260);
    expect(w.ma50).toBeGreaterThan(w.ma200);
    expect(w.ma50).toBeGreaterThan(w.ma50Prev);
    expect(w.pctAbove50).toBeGreaterThan(0);
  });
  it('no 200-wk MA under 200 weeks (GEV case)', () => {
    const w = deriveWeekly(trendBars({ weeks: 133, dipEnd: false }));
    expect(w.ma200).toBeNull();
    expect(leapsEntryOk(w, CR)).toBe(false);
  });
  it('counts dividends in the last 12 months only', () => {
    const h = trendBars();
    const last = h.dates.at(-1);
    const d = (daysAgo) => new Date(Date.parse(last) - daysAgo * 86400000).toISOString().slice(0, 10);
    h.divs = [{ date: d(400), amount: 0.5 }, { date: d(200), amount: 0.01 }, { date: d(20), amount: 0.01 }];
    expect(deriveWeekly(h).divCount).toBe(2);
  });
});

describe('leapsEntryOk', () => {
  const base = { ma50: 100, ma200: 80, ma50Prev: 98, ma200Prev: 79, price: 103, pctAbove50: 3, stochK: 15, stochKPrev: 10 };
  it('passes the full rulebook', () => expect(leapsEntryOk(base, CR)).toBe(true));
  it.each([
    ['50 below 200', { ma50: 75 }],
    ['50 not rising', { ma50Prev: 101 }],
    ['200 not rising', { ma200Prev: 81 }],
    ['below the 50', { price: 99, pctAbove50: -1 }],
    ['too far above (>5%)', { price: 106, pctAbove50: 6 }],
    ['%K was already above 20', { stochK: 30, stochKPrev: 25 }],
    ['%K falling', { stochK: 12, stochKPrev: 15 }],
  ])('fails when %s', (_, patch) => expect(leapsEntryOk({ ...base, ...patch }, CR)).toBe(false));
});

describe('leapsWindow', () => {
  it('stocks 15–30 months aiming 21; index 10–14 aiming 12', () => {
    expect(leapsWindow(CR, false)).toEqual({ dteMin: 457, dteMax: 913, target: 639 });
    expect(leapsWindow(CR, true)).toEqual({ dteMin: 304, dteMax: 426, target: 365 });
  });
});

describe('LEAPS cards in buildSignals', () => {
  const pass = { weeks: 260, ma50: 100, ma200: 80, ma50Prev: 98, ma200Prev: 79, price: 103, pctAbove50: 3, stochK: 15, stochKPrev: 10, divCount: 0 };
  const wl = [{ ticker: 'UBER', diveIn: PRIORITY, pageId: 'p' }];
  const contract = { strike: 60, expiry: '2028-06-16', dte: 614, delta: 0.79, premium: 23.3, bid: 22.3, ask: 24.3 };
  const build = (wmap, strikeMap = {}, positions = [], scores = {}) =>
    buildSignals(wl, positions, CR, {}, strikeMap, scores, { wmap });

  it('passing stock → leaps card with the contract and cost', () => {
    const [s] = build({ UBER: pass }, { 'UBER:leaps': contract });
    expect(s).toMatchObject({ type: 'leaps', ticker: 'UBER', index: false, cost: 2330, strike: 60 });
    expect(s.suggestion).toMatch(/^Buy Jun 2028 \$60 call · Δ0\.79 · ~\$2,330 per contract/);
    expect(s.chks.some(c => c.ok && c.l === 'No dividend')).toBe(true);
  });
  it('strict dividend rule: any dividend in 12 months → no card', () => {
    expect(build({ UBER: { ...pass, divCount: 1 } })).toHaveLength(0);
  });
  it('no 15–30 mo option listed → Waiting', () => {
    const [s] = build({ UBER: pass }, { 'UBER:leaps': { none: true } });
    expect(s.type).toBe('leaps_wait');
    expect(s.waitReason).toBe('No 15–30 mo options listed');
  });
  it('chain not fetched (Worker) → still a card, contract left to the app', () => {
    const [s] = build({ UBER: pass });
    expect(s.type).toBe('leaps');
    expect(s.suggestion).toMatch(/open the app for the contract/);
  });
  it('warns over the $10k cap and on a wide bid/ask, never blocks', () => {
    const [s] = build({ UBER: pass }, { 'UBER:leaps': { ...contract, premium: 260.75, bid: 220, ask: 300 } });
    expect(s.type).toBe('leaps');
    expect(s.chks.some(c => c.warn && /over \$10,000/.test(c.l))).toBe(true);
    expect(s.chks.some(c => c.warn && /Wide bid\/ask/.test(c.l))).toBe(true);
  });
  it('Not worth it score → no LEAPS card', () => {
    expect(build({ UBER: pass }, {}, [], { UBER: { verdict: 'Not worth it', score: 40, decision: 'Watch' } })).toHaveLength(0);
  });
  it('already holding a LEAPS on it → no card; open LEAPS at the max → warning', () => {
    expect(build({ UBER: pass }, {}, [{ id: 1, ticker: 'UBER', type: 'long_call' }])).toHaveLength(0);
    const four = [1, 2, 3, 4].map(id => ({ id, ticker: `X${id}`, type: 'long_call' }));
    const [s] = build({ UBER: pass }, {}, four);
    expect(s.chks.some(c => c.warn && c.l === '4 LEAPS already open')).toBe(true);
  });
  it('index (XSP) needs no Priority row, no dividend test, no score — pinned section', () => {
    const sigs = buildSignals([], [], CR, {}, {}, null, { wmap: { XSP: { ...pass, divCount: 4 } } });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'leaps', ticker: 'XSP', index: true, score: null });
    expect(splitSections(sigs).index).toHaveLength(1);
    expect(splitSections(sigs).trades).toHaveLength(0);
  });
});

describe('prefetchLeaps', () => {
  /** Fake transport: Yahoo weekly body from bars; CBOE never asked unless setup passes. */
  function tx(bars) {
    const calls = { yahoo: [], cboe: [] };
    return {
      calls,
      yahoo: async (path) => {
        calls.yahoo.push(path);
        const ts = bars.dates.map(d => Date.parse(d) / 1000);
        return new Response(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: ts,
          indicators: { adjclose: [{ adjclose: bars.closes }], quote: [{ close: bars.closes, high: bars.highs, low: bars.lows }] },
          events: {} }] } }));
      },
      cboe: async (path) => { calls.cboe.push(path); return new Response('{}', { status: 404 }); },
    };
  }
  const wl = [{ ticker: 'UBER', diveIn: PRIORITY }, { ticker: 'AAPL', diveIn: '👀 Watch' }];

  it('weekly request per Priority stock + index, interval=1wk&range=5y&events=div; cached per day', async () => {
    const t = tx(trendBars({ dipEnd: false }));
    const store = new Map();
    const cache = { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    const r = await prefetchLeaps(t, { watchlist: wl, criteria: CR, cache, sleep: async () => {}, now: new Date('2026-10-12T15:00:00Z') });
    expect(Object.keys(r.wmap).sort()).toEqual(['UBER', 'XSP']);
    expect(t.calls.yahoo.every(p => /interval=1wk&range=5y&events=div/.test(p))).toBe(true);
    const n = t.calls.yahoo.length;
    await prefetchLeaps(t, { watchlist: wl, criteria: CR, cache, sleep: async () => {}, now: new Date('2026-10-12T18:00:00Z') });
    expect(t.calls.yahoo.length).toBe(n); // same NY day → from cache
  });

  it('chains:false never touches CBOE (the Worker)', async () => {
    const t = tx(trendBars());
    await prefetchLeaps(t, { watchlist: wl, criteria: { ...CR, leapsMaxAboveMa: 100, leapsStochBelow: 100 }, chains: false, sleep: async () => {} });
    expect(t.calls.cboe).toEqual([]);
  });
});
