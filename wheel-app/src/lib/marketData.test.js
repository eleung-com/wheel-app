import { describe, it, expect, beforeEach } from 'vitest';
import {
  fetchQ, fetchOptionPrice, fetchBestStrike, contractMid, chainSideFor,
  parseOcc, parseCboeChain, cboeSymbol, clearChainCache,
} from './marketData';

// Phase 6. Before the consolidation this layer existed twice — once for the
// browser, once for the Worker — and had no test coverage in either copy,
// because every function reached straight for the network. With the transport
// injected it is ordinary testable code. Two real bugs lived here undetected:
// fetchBestStrike returning `premium` in one copy but not the other, and
// put_spread being priced off the call chain.
//
// 10-02-2026: Tradier retired. History + price now come from Yahoo alone, and
// option chains from CBOE's delayed-quote feed.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/** @param routes  path-substring → response (or a function of the path) */
function fakeTransport(routes) {
  const calls = [];
  const answer = (path) => {
    for (const [frag, res] of Object.entries(routes)) {
      if (path.includes(frag)) return typeof res === 'function' ? res(path) : res;
    }
    return json({}, 404);
  };
  return {
    calls,
    async yahoo(path) { calls.push(['yahoo', path]); return answer(path); },
    async cboe(path)  { calls.push(['cboe', path]);  return answer(path); },
  };
}

/** Yahoo chart body: `n` flat daily bars at `close`, plus optional live price meta. */
function yahooChart(close, n = 30, meta = {}) {
  const ts = Array.from({ length: n }, (_, i) => 1750000000 + i * 86400);
  return json({ chart: { result: [{
    meta,
    timestamp: ts,
    indicators: {
      adjclose: [{ adjclose: ts.map(() => close) }],
      quote: [{ close: ts.map(() => close), high: ts.map(() => close + 1), low: ts.map(() => close - 1) }],
    },
  }] } });
}

/** OCC symbol for a test contract. */
function occ(root, expiry, side, strike) {
  const [y, m, d] = expiry.split('-');
  return `${root}${y.slice(2)}${m}${d}${side === 'put' ? 'P' : 'C'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

/** CBOE body from [{ expiry, side, strike, bid, ask, delta, root? }]. */
function cboeChain(rows, ticker = 'AAA') {
  return json({ data: { symbol: ticker, options: rows.map(r => ({
    option: occ(r.root || ticker, r.expiry, r.side, r.strike),
    bid: r.bid, ask: r.ask, last_trade_price: r.last ?? 0, delta: r.delta ?? 0, iv: 0.3, open_interest: 100,
  })) } });
}

beforeEach(() => clearChainCache());

describe('helpers', () => {
  it('contractMid prefers the book, falls back to last, else null', () => {
    expect(contractMid({ bid: 1, ask: 2 })).toBe(1.5);
    expect(contractMid({ bid: 0, ask: 0, last: 3 })).toBe(3);
    expect(contractMid({ bid: 0, ask: 0, last: 0 })).toBeNull();
    expect(contractMid(null)).toBeNull();
  });

  it('chainSideFor sends spreads to the PUT chain — the bug that made spread pricing meaningless', () => {
    expect(chainSideFor('short_put')).toBe('put');
    expect(chainSideFor('put_spread')).toBe('put');
    expect(chainSideFor('short_call')).toBe('call');
  });
});

describe('fetchQ', () => {
  it('uses Yahoo history and overlays the live price, with the day change vs the prior session', async () => {
    // Last bar is "today" (same day as regularMarketTime), so prevclose must be the bar before it.
    const n = 30, last = 1750000000 + (n - 1) * 86400;
    const tx = fakeTransport({ '/v8/finance/chart': yahooChart(100, n, { regularMarketPrice: 110, regularMarketTime: last + 3600 }) });
    const q = await fetchQ(tx, 'AAA');
    expect(q.price).toBe(110);
    expect(q.chg1d).toBeCloseTo(10, 5);
  });

  it('falls back to the last close when Yahoo sends no live price', async () => {
    const tx = fakeTransport({ '/v8/finance/chart': yahooChart(100) });
    expect((await fetchQ(tx, 'AAA')).price).toBe(100);
  });

  it('returns null when Yahoo has no usable history', async () => {
    const tx = fakeTransport({ '/v8/finance/chart': json({}, 500) });
    expect(await fetchQ(tx, 'AAA')).toBeNull();
  });

  it('rejects a history too short to compute indicators from', async () => {
    const tx = fakeTransport({ '/v8/finance/chart': yahooChart(100, 5) });
    expect(await fetchQ(tx, 'AAA')).toBeNull();
  });

  it('never calls anything but Yahoo for prices', async () => {
    const tx = fakeTransport({ '/v8/finance/chart': yahooChart(100) });
    await fetchQ(tx, 'AAA');
    expect(tx.calls.every(([kind]) => kind === 'yahoo')).toBe(true);
  });
});

describe('CBOE parsing', () => {
  it('parseOcc splits root, expiry, side and strike', () => {
    expect(parseOcc('AAPL261016P00250000')).toEqual({ root: 'AAPL', expiry: '2026-10-16', side: 'put', strike: 250 });
    expect(parseOcc('SPXW261016C05800000')).toEqual({ root: 'SPXW', expiry: '2026-10-16', side: 'call', strike: 5800 });
    expect(parseOcc('MU261120P00092500').strike).toBe(92.5);
    expect(parseOcc('garbage')).toBeNull();
  });

  it('cboeSymbol prefixes cash-settled indexes only', () => {
    expect(cboeSymbol('xsp')).toBe('_XSP');
    expect(cboeSymbol('SPX')).toBe('_SPX');
    expect(cboeSymbol('MU')).toBe('MU');
  });

  it('keeps the underlying’s own roots, drops adjusted ones, and signs delta by side', async () => {
    const res = cboeChain([
      { expiry: '2026-10-16', side: 'put',  strike: 100, bid: 1, ask: 2, delta: 0.3 },   // positive put delta → flipped
      { expiry: '2026-10-16', side: 'call', strike: 100, bid: 1, ask: 2, delta: -0.6 },  // negative call delta → flipped
      { expiry: '2026-10-16', side: 'put',  strike: 100, bid: 1, ask: 2, delta: -0.3, root: 'AAA1' }, // adjusted root
      { expiry: '2026-10-16', side: 'put',  strike: 90,  bid: 0, ask: 0, delta: 0 },     // no delta → null
    ]);
    const rows = parseCboeChain(await res.json(), 'AAA');
    expect(rows).toHaveLength(3);
    expect(rows[0].greeks.delta).toBe(-0.3);
    expect(rows[1].greeks.delta).toBe(0.6);
    expect(rows[2].greeks.delta).toBeNull();
  });
});

describe('fetchOptionPrice', () => {
  const EXP = '2026-10-16';
  const chain = (opts) => ({ '/options/AAA.json': () => cboeChain(opts.map(o => ({ expiry: EXP, side: o.option_type, ...o }))) });

  it('prices a short put at the mid', async () => {
    const tx = fakeTransport(chain([{ option_type: 'put', strike: 100, bid: 1.9, ask: 2.1 }]));
    const px = await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 100, expiry: '2026-10-16' });
    expect(px).toBe(2);
  });

  it('prices a spread as short minus long, off one chain', async () => {
    const tx = fakeTransport(chain([
      { option_type: 'put', strike: 100, bid: 1.9, ask: 2.1 },
      { option_type: 'put', strike: 95,  bid: 0.7, ask: 0.9 },
    ]));
    const px = await fetchOptionPrice(tx, {
      ticker: 'AAA', type: 'put_spread', strike: 100, longStrike: 95, expiry: '2026-10-16',
    });
    expect(px).toBe(1.2);
    // One chain call, not two.
    expect(tx.calls.filter(([kind]) => kind === 'cboe')).toHaveLength(1);
  });

  it('returns null when only one leg of a spread is priceable', async () => {
    const tx = fakeTransport(chain([{ option_type: 'put', strike: 100, bid: 1.9, ask: 2.1 }]));
    expect(await fetchOptionPrice(tx, {
      ticker: 'AAA', type: 'put_spread', strike: 100, longStrike: 95, expiry: '2026-10-16',
    })).toBeNull();
  });

  it('never reads the call chain for a put spread', async () => {
    // Calls at the same strikes would give a plausible-looking wrong number.
    const tx = fakeTransport(chain([
      { option_type: 'call', strike: 100, bid: 9, ask: 11 },
      { option_type: 'call', strike: 95,  bid: 4, ask: 6 },
    ]));
    expect(await fetchOptionPrice(tx, {
      ticker: 'AAA', type: 'put_spread', strike: 100, longStrike: 95, expiry: '2026-10-16',
    })).toBeNull();
  });

  it('returns null when CBOE is unreachable rather than throwing', async () => {
    const tx = fakeTransport({ '/options/AAA.json': json({}, 503) });
    expect(await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 100, expiry: '2026-10-16' })).toBeNull();
  });

  it('returns null when the position’s expiry is not in the chain', async () => {
    const tx = fakeTransport(chain([{ option_type: 'put', strike: 100, bid: 1.9, ask: 2.1 }]));
    expect(await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 100, expiry: '2026-11-20' })).toBeNull();
  });

  it('downloads each ticker’s chain once per run, however many positions use it', async () => {
    const tx = fakeTransport(chain([{ option_type: 'put', strike: 100, bid: 1.9, ask: 2.1 }, { option_type: 'put', strike: 95, bid: 0.9, ask: 1.1 }]));
    await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 100, expiry: EXP });
    await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 95, expiry: EXP });
    expect(tx.calls.filter(([kind]) => kind === 'cboe')).toHaveLength(1);
  });
});

describe('fetchBestStrike', () => {
  function futureDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  it('picks the expiry nearest mid-DTE and the strike nearest mid-delta, with a premium', async () => {
    const e7 = futureDate(7), e32 = futureDate(32), e90 = futureDate(90);
    const tx = fakeTransport({ '/options/AAA.json': () => cboeChain([
      { expiry: e7,  side: 'put', strike: 95, bid: 0.4, ask: 0.6, delta: -0.27 },
      { expiry: e32, side: 'put', strike: 90, bid: 0.4, ask: 0.6, delta: -0.10 },
      { expiry: e32, side: 'put', strike: 95, bid: 1.4, ask: 1.6, delta: -0.27 },
      { expiry: e32, side: 'put', strike: 99, bid: 3.4, ask: 3.6, delta: -0.45 },
      { expiry: e90, side: 'put', strike: 95, bid: 4.4, ask: 4.6, delta: -0.30 },
      { expiry: e32, side: 'call', strike: 95, bid: 9, ask: 10, delta: 0.27 },
    ]) });

    const best = await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45);
    expect(best.strike).toBe(95);                 // delta -0.27 is nearest the -0.275 mid
    expect(best.expiry).toBe(e32);
    expect(best.dte).toBeGreaterThan(21);
    expect(best.dte).toBeLessThan(45);
    // premium must be present — it was missing from the Worker's copy before this
    expect(best.premium).toBe(1.5);
  });

  it('returns null when the chain is empty', async () => {
    const tx = fakeTransport({ '/options/AAA.json': () => cboeChain([]) });
    expect(await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45)).toBeNull();
  });

  it('returns null when CBOE is unreachable', async () => {
    const tx = fakeTransport({ '/options/AAA.json': json({}, 503) });
    expect(await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45)).toBeNull();
  });

  it('asks CBOE for the underscore file for index options', async () => {
    const tx = fakeTransport({ '/options/_XSP.json': () => cboeChain([], 'XSP') });
    await fetchBestStrike(tx, 'XSP', 'put', 20, 35, 21, 45);
    expect(tx.calls[0]).toEqual(['cboe', '/options/_XSP.json']);
  });
});
