import { describe, it, expect } from 'vitest';
import { fetchQ, fetchOptionPrice, fetchBestStrike, contractMid, chainSideFor } from './marketData';

// Phase 6. Before the consolidation this layer existed twice — once for the
// browser, once for the Worker — and had no test coverage in either copy,
// because every function reached straight for the network. With the transport
// injected it is ordinary testable code, and these are the first tests it has
// ever had. Two real bugs lived here undetected: fetchBestStrike returning
// `premium` in one copy but not the other, and put_spread being priced off the
// call chain.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param routes  path-substring → response (or a function of the path)
 * @param opts.tradierNull  simulate "no API key configured"
 */
function fakeTransport(routes, opts = {}) {
  const calls = [];
  const answer = (path) => {
    for (const [frag, res] of Object.entries(routes)) {
      if (path.includes(frag)) return typeof res === 'function' ? res(path) : res;
    }
    return json({}, 404);
  };
  return {
    calls,
    async tradier(path) {
      calls.push(['tradier', path]);
      if (opts.tradierNull) return null;
      return answer(path);
    },
    async yahoo(path) {
      calls.push(['yahoo', path]);
      return answer(path);
    },
  };
}

/** 30 flat daily bars — enough for deriveIndicators to produce something. */
const flatDays = (price, n = 30) => Array.from({ length: n }, (_, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, '0')}`,
  close: price, high: price + 1, low: price - 1,
}));

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
  it('uses Tradier history and overlays the live quote', async () => {
    const tx = fakeTransport({
      '/v1/markets/history': json({ history: { day: flatDays(100) } }),
      '/v1/markets/quotes':  json({ quotes: { quote: { symbol: 'AAA', last: 110, prevclose: 100 } } }),
    });
    const q = await fetchQ(tx, 'AAA');
    expect(q.price).toBe(110);
    expect(q.chg1d).toBeCloseTo(10, 5);
  });

  it('falls back to the last close when no quote comes back', async () => {
    const tx = fakeTransport({
      '/v1/markets/history': json({ history: { day: flatDays(100) } }),
      '/v1/markets/quotes':  json({ quotes: {} }),
    });
    expect((await fetchQ(tx, 'AAA')).price).toBe(100);
  });

  it('falls back to Yahoo when Tradier is unconfigured', async () => {
    const ts = flatDays(50).map((_, i) => 1750000000 + i * 86400);
    const tx = fakeTransport({
      '/v8/finance/chart': json({
        chart: { result: [{
          timestamp: ts,
          indicators: {
            adjclose: [{ adjclose: ts.map(() => 50) }],
            quote: [{ close: ts.map(() => 50), high: ts.map(() => 51), low: ts.map(() => 49) }],
          },
        }] },
      }),
    }, { tradierNull: true });

    const q = await fetchQ(tx, 'AAA');
    expect(q).not.toBeNull();
    expect(q.price).toBe(50);
    expect(tx.calls.some(([kind]) => kind === 'yahoo')).toBe(true);
  });

  it('returns null when neither source has usable history', async () => {
    const tx = fakeTransport({ '/v1/markets/history': json({}, 500), '/v8/finance/chart': json({}, 500) });
    expect(await fetchQ(tx, 'AAA')).toBeNull();
  });

  it('rejects a history too short to compute indicators from', async () => {
    const tx = fakeTransport({
      '/v1/markets/history': json({ history: { day: flatDays(100, 5) } }),
      '/v8/finance/chart':   json({}, 500),
    });
    expect(await fetchQ(tx, 'AAA')).toBeNull();
  });
});

describe('fetchOptionPrice', () => {
  const chain = (opts) => ({ '/v1/markets/options/chains': json({ options: { option: opts } }) });

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
    expect(tx.calls.filter(([, p]) => p.includes('options/chains'))).toHaveLength(1);
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

  it('returns null without an API key rather than throwing', async () => {
    const tx = fakeTransport({}, { tradierNull: true });
    expect(await fetchOptionPrice(tx, { ticker: 'AAA', type: 'short_put', strike: 100, expiry: '2026-10-16' })).toBeNull();
  });
});

describe('fetchBestStrike', () => {
  function futureDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  it('picks the expiry nearest mid-DTE and the strike nearest mid-delta, with a premium', async () => {
    const tx = fakeTransport({
      '/v1/markets/options/expirations': json({ expirations: { date: [futureDate(7), futureDate(32), futureDate(90)] } }),
      '/v1/markets/options/chains': json({ options: { option: [
        { option_type: 'put', strike: 90, bid: 0.4, ask: 0.6, greeks: { delta: -0.10 } },
        { option_type: 'put', strike: 95, bid: 1.4, ask: 1.6, greeks: { delta: -0.27 } },
        { option_type: 'put', strike: 99, bid: 3.4, ask: 3.6, greeks: { delta: -0.45 } },
      ] } }),
    });

    const best = await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45);
    expect(best.strike).toBe(95);                 // delta -0.27 is nearest the -0.275 mid
    expect(best.dte).toBeGreaterThan(21);
    expect(best.dte).toBeLessThan(45);
    // premium must be present — it was missing from the Worker's copy before this
    expect(best.premium).toBe(1.5);
  });

  it('returns null when no expiry is listed', async () => {
    const tx = fakeTransport({ '/v1/markets/options/expirations': json({ expirations: {} }) });
    expect(await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45)).toBeNull();
  });

  it('returns null without an API key', async () => {
    const tx = fakeTransport({}, { tradierNull: true });
    expect(await fetchBestStrike(tx, 'AAA', 'put', 20, 35, 21, 45)).toBeNull();
  });
});
