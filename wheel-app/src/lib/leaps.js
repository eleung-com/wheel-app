// Part 2D: LEAPS data, fetched the same way by the app (useScreener.js) and
// the Worker (worker/scan.js) so both see the same setups.
//
//   prefetchLeaps(transport, { watchlist, positions, criteria, scores, chains, cache, sleep })
//     → { wmap, strikes }
//
// wmap     ticker → deriveWeekly(...) for every Priority stock + the index
//          (cr.leapsIndex, XSP). One small weekly request each, cached per
//          New York day (weekly bars barely move intraday).
// strikes  `${T}:leaps` → picked contract or { none: true }, only for tickers
//          whose weekly setup passes — so option chains are fetched rarely.
//          `chains: false` (the Worker) skips them entirely: Telegram only
//          counts, and the XSP chain alone is ~7 MB.

import { fetchWeekly, fetchBestStrike } from './marketData.js';
import { PRIORITY, NO_EARNINGS, deriveWeekly, leapsEntryOk, leapsWindow, isOpenLeaps } from './signalEngine.js';

const nyDay = (now = new Date()) => new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);

/** Default per-day cache: an in-memory Map (fine for the app's page lifetime). */
const memory = new Map();
export const memoryCache = {
  get: async (k) => memory.get(k) ?? null,
  put: async (k, v) => { memory.set(k, v); },
};
export function clearLeapsCache() { memory.clear(); }

export async function prefetchLeaps(transport, {
  watchlist = [], positions = [], criteria: cr, scores = null,
  chains = true, cache = memoryCache, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = new Date(),
} = {}) {
  const wmap = {};
  const strikes = {};
  const day = nyDay(now);
  const indexT = cr.leapsIndex || 'XSP';
  const list = [
    ...watchlist.filter(w => w.diveIn === PRIORITY && !NO_EARNINGS.has(w.ticker)).map(w => ({ ticker: w.ticker, index: false })),
    ...(indexT ? [{ ticker: indexT, index: true }] : []),
  ];
  const held = new Set(positions.filter(isOpenLeaps).map(p => p.ticker));

  for (const { ticker, index } of list) {
    const key = `weekly|${ticker}|${day}`;
    let w = null;
    try {
      const hit = await cache.get(key);
      if (hit) w = typeof hit === 'string' ? JSON.parse(hit) : hit;
    } catch (_) { /* cache miss */ }
    if (!w) {
      try {
        const hist = await fetchWeekly(transport, ticker);
        w = hist ? deriveWeekly(hist) : null;
        if (w) await cache.put(key, JSON.stringify(w), { expirationTtl: 2 * 86400 });
      } catch (_) { w = null; }
      await sleep(350); // Yahoo pacing
    }
    if (!w) continue;
    wmap[ticker] = w;

    if (!chains || !leapsEntryOk(w, cr)) continue;
    if (!index && w.divCount > 0) continue;
    if (held.has(ticker)) continue;
    const sc = scores ? scores[ticker] : undefined;
    if (!index && sc && sc.verdict === 'Not worth it') continue;
    const win = leapsWindow(cr, index);
    const best = await fetchBestStrike(transport, ticker, 'call', cr.leapsDeltaMin ?? 75, cr.leapsDeltaMax ?? 85,
      win.dteMin, win.dteMax, { targetDte: win.target, strict: true });
    if (best) strikes[`${ticker}:leaps`] = best;
    await sleep(450);
  }
  return { wmap, strikes };
}
