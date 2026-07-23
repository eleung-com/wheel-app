import { useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { notionRequest } from '../lib/utils';

/**
 * Watchlist storage, backed by the Notion "Stock Scan Results" database.
 *
 * Membership is read-only here — tickers are curated in Notion (anything tagged
 * in TV Lists). The app owns exactly two properties, Notes and App Category,
 * and writes them back per-edit.
 *
 * All calls go through the Cloudflare Worker; the browser never holds a Notion
 * token. Each row carries its pageId so writes don't need a second lookup.
 */
export function useNotion(showToast) {
  const { state, dispatch } = useAppContext();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  /** Pull the watchlist from Notion into state, preserving live quote data. */
  const notionSyncWatchlist = useCallback(async ({ quiet = false } = {}) => {
    const { url, headers } = notionRequest('/watchlist');
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      const text = await r.text();

      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Non-JSON response: ${text.slice(0, 120)}`); }
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);

      const seen = new Set();
      const rows = (data.watchlist || [])
        .map(w => {
          const ticker = String(w.ticker || '').toUpperCase();
          // Quotes come from the screener, not Notion — don't clobber them on refresh.
          const existing = stateRef.current.watchlist.find(x => x.ticker === ticker);
          return {
            ticker,
            pageId:   w.pageId,
            notes:    w.notes || '',
            category: w.category || '',
            sector:   w.sector || '',
            diveIn:   w.diveIn || '',
            // Shown as pills on the signal cards; lastEval also expires the
            // cached page-body eval when the Notion entry is rewritten.
            wheel:        w.wheel        || '',
            fundamentals: w.fundamentals || '',
            lastEval:     w.lastEval     || '',
            // Feeds the Home news-tab earnings calendar. ISO date string or ''.
            earnings:     w.earnings     || '',
            addedAt:  w.addedAt || Date.now(),
            liveData: existing?.liveData || null,
          };
        })
        .filter(w => w.ticker && !seen.has(w.ticker) && seen.add(w.ticker))
        .sort((a, b) => a.ticker.localeCompare(b.ticker));

      dispatch({ type: 'SET_WATCHLIST', payload: rows });
      if (!quiet) showToast(`Synced ${rows.length} tickers from Notion ✓`, 'ok');
      return rows;
    } catch (e) {
      showToast('⚠ Notion sync failed — ' + e.message, 'err');
      return null;
    }
  }, [dispatch, showToast]);

  /**
   * Patch Notes and/or App Category on one ticker's Notion page.
   * Optimistic: state is already updated by the caller, so on failure we surface
   * the error and re-pull rather than leaving the UI lying about what was saved.
   */
  const notionUpdateWatch = useCallback(async (ticker, patch) => {
    const row = stateRef.current.watchlist.find(w => w.ticker === ticker);
    if (!row?.pageId) {
      showToast('⚠ No Notion page for ' + ticker + ' — try refreshing', 'err');
      return false;
    }

    const { url, headers } = notionRequest('/page');
    try {
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: row.pageId, ...patch }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      return true;
    } catch (e) {
      showToast('⚠ Notion save failed — ' + e.message, 'err');
      notionSyncWatchlist({ quiet: true });
      return false;
    }
  }, [showToast, notionSyncWatchlist]);

  return { notionSyncWatchlist, notionUpdateWatch };
}
