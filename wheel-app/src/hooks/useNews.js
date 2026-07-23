import { useState, useCallback, useEffect, useRef } from 'react';
import { yahooBase } from '../lib/utils';

/**
 * Market, sector and ticker news for the Home page.
 *
 * Everything comes from Yahoo's search endpoint through the worker's /yf proxy.
 * That endpoint returns "stories that mention this symbol", not "stories about
 * this company" — a Domino's piece that name-checks Uber Eats comes back under
 * UBER. rankForTicker below pushes the on-topic ones up; it can't fully fix it.
 *
 * A run is 1 market + 11 sector + N ticker requests, so results are cached in
 * localStorage for an hour and only re-fetched on demand.
 */

// GICS sectors, each read through its SPDR sector ETF — Yahoo has no sector
// news endpoint, and the ETF ticker is the closest proxy it does index.
export const SECTORS = [
  { etf: 'XLK',  name: 'Technology'             },
  { etf: 'XLV',  name: 'Health Care'            },
  { etf: 'XLF',  name: 'Financials'             },
  { etf: 'XLY',  name: 'Consumer Discretionary' },
  { etf: 'XLP',  name: 'Consumer Staples'       },
  { etf: 'XLI',  name: 'Industrials'            },
  { etf: 'XLE',  name: 'Energy'                 },
  { etf: 'XLB',  name: 'Materials'              },
  { etf: 'XLU',  name: 'Utilities'              },
  { etf: 'XLRE', name: 'Real Estate'            },
  { etf: 'XLC',  name: 'Communication Services' },
];

const MARKET_SYMBOL = '^GSPC';
const CACHE_KEY     = 'wd_news_cache';
const TTL_MS        = 60 * 60 * 1000;  // an hour
const CONCURRENCY   = 5;               // polite fan-out; the worker forwards each one

function normalize(item) {
  return {
    id:          item.uuid,
    title:       item.title || '',
    publisher:   item.publisher || '',
    link:        item.link || '',
    publishedAt: (item.providerPublishTime || 0) * 1000,
    // Surfacing these is what makes a loosely-matched story obvious at a glance.
    tickers:     Array.isArray(item.relatedTickers) ? item.relatedTickers : [],
    thumb:       item.thumbnail?.resolutions?.[0]?.url || '',
  };
}

async function fetchNews(symbol, count) {
  const url = `${yahooBase()}/v1/finance/search`
    + `?q=${encodeURIComponent(symbol)}&newsCount=${count}&quotesCount=0`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return (data.news || []).map(normalize);
}

/** A headline naming the ticker outranks one that merely lists it. */
function rankForTicker(items, ticker) {
  const named = new RegExp(`\\b${ticker}\\b`, 'i');
  return items
    .map(it => ({
      ...it,
      onTopic: named.test(it.title) || it.tickers[0] === ticker,
    }))
    .sort((a, b) => (b.onTopic - a.onTopic) || (b.publishedAt - a.publishedAt));
}

/** Resolve tasks a few at a time rather than firing 22 requests at once. */
async function pooled(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { out[i] = await tasks[i](); }
      catch { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && typeof c.fetchedAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

export function useNews(tickers, showToast) {
  const [news, setNews]       = useState(readCache);
  const [loading, setLoading] = useState(false);

  // Array identity changes every render; the joined list is what actually matters.
  const tickerKey = tickers.join(',');
  const inFlight  = useRef(false);

  const load = useCallback(async ({ force = false } = {}) => {
    if (inFlight.current) return;

    const cached = readCache();
    const fresh  = cached
      && Date.now() - cached.fetchedAt < TTL_MS
      && cached.tickerKey === tickerKey;
    if (fresh && !force) {
      setNews(cached);
      return;
    }

    inFlight.current = true;
    setLoading(true);

    const wanted = tickerKey ? tickerKey.split(',') : [];
    const tasks = [
      () => fetchNews(MARKET_SYMBOL, 6),
      ...SECTORS.map(s => () => fetchNews(s.etf, 3)),
      ...wanted.map(t => () => fetchNews(t, 4)),
    ];

    try {
      const results = await pooled(tasks, CONCURRENCY);
      const market  = results[0] || [];
      const sectors = {};
      SECTORS.forEach((s, i) => { sectors[s.etf] = results[1 + i] || []; });
      const byTicker = {};
      wanted.forEach((t, i) => {
        byTicker[t] = rankForTicker(results[1 + SECTORS.length + i] || [], t);
      });

      if (!market.length && !Object.values(sectors).some(v => v.length)) {
        throw new Error('Yahoo returned no stories');
      }

      const next = { fetchedAt: Date.now(), tickerKey, market, sectors, tickers: byTicker };
      setNews(next);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* quota — fine */ }
      if (force) showToast('News refreshed ✓', 'ok');
    } catch (e) {
      showToast('⚠ News failed to load — ' + e.message, 'err');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [tickerKey, showToast]);

  // First paint uses whatever is cached; a stale cache triggers one refetch.
  useEffect(() => { load(); }, [load]);

  return { news, loading, refreshNews: () => load({ force: true }) };
}
