// Part 9D (PRD part9, approved 10-25): the Stocks tab list — the old
// Watchlist sections plus a search box that also researches new tickers.
import { watchlistGroup, wlSortKey } from './fairValue';
import { TICKER_RE } from './research/runRecord';

export const GROUP_KEYS = ['ready', 'close', 'wait', 'todo', 'skip', 'idx'];

/** Watchlist rows → { ready: [...], close: [...], ... } with the card data. */
export function groupStocks(watchlist = [], scores = null, isIndex = () => false) {
  const out = Object.fromEntries(GROUP_KEYS.map((k) => [k, []]));
  for (const w of watchlist) {
    const score = scores ? scores[w.ticker] || null : null;
    const price = w.liveData?.price ?? null;
    const g = watchlistGroup({ row: w, score, price, isIndex: isIndex(w.ticker), override: w.override });
    out[g.group].push({ w, g, score, price, pct: g.pct });
  }
  for (const k of ['ready', 'close', 'wait']) out[k].sort((a, b) => wlSortKey(a) - wlSortKey(b));
  for (const k of ['todo', 'skip', 'idx']) out[k].sort((a, b) => a.w.ticker.localeCompare(b.w.ticker));
  return out;
}

/** Normalise what was typed into the search box. */
export const cleanQuery = (q) => String(q || '').trim().toUpperCase();

/** Keep only cards whose ticker contains the query (all of them when empty). */
export function filterGroups(byGroup, query) {
  const q = cleanQuery(query);
  if (!q) return byGroup;
  const out = {};
  for (const k of Object.keys(byGroup)) out[k] = byGroup[k].filter((x) => x.w.ticker.includes(q));
  return out;
}

/**
 * What the search box's button does:
 *  'open'     — the ticker is on your watchlist → its stock page (saved run)
 *  'research' — a valid ticker that isn't on it → a fresh run
 *  null       — nothing usable typed
 */
export function searchAction(query, watchlist = []) {
  const q = cleanQuery(query);
  if (!q || !TICKER_RE.test(q)) return null;
  return watchlist.some((w) => w.ticker === q) ? 'open' : 'research';
}
