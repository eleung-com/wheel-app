/**
 * Dive-In ordering for the watchlist.
 *
 * Lives outside the page component because two callers need to agree on it:
 * WatchlistPage renders the groups, and App builds the Notion eval fetch queue
 * in the same sequence so the tickers you triaged as Priority resolve first.
 */

export const UNTRIAGED = 'Untriaged';

// Priority first, then Watch, then anything without a call, then explicit Skip.
export const GROUP_ORDER = ['🔥 Priority', '👀 Watch', UNTRIAGED, '— Skip'];

/** Rows carrying a Dive-In value Notion doesn't know about fall into Untriaged. */
export function groupName(w) {
  return GROUP_ORDER.includes(w.diveIn) ? w.diveIn : UNTRIAGED;
}

/** watchlist → [{ name, entries }] in GROUP_ORDER, alphabetical within a group. */
export function groupByDiveIn(watchlist) {
  const byName = new Map();
  for (const w of watchlist) {
    const name = groupName(w);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(w);
  }
  return GROUP_ORDER
    .filter(name => byName.has(name))
    .map(name => ({
      name,
      entries: byName.get(name).sort((a, b) => a.ticker.localeCompare(b.ticker)),
    }));
}

/** The same ordering as a flat list — the order evals are fetched in. */
export function sortByDiveIn(watchlist) {
  return groupByDiveIn(watchlist).flatMap(g => g.entries);
}
