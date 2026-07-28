import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { fetchQ } from '../lib/indicators';
import { fetchOptionPrice, fetchBestStrike } from '../lib/optionPrice';
import { buildSignals, PRIORITY } from '../lib/signalEngine';
import { getTradierKey } from '../lib/utils';

// ── Market-close cache ────────────────────────────────────────────────────────
// When markets are closed we cache the last fetched qmap in localStorage so the
// app loads instantly without re-fetching on every page open / refresh.
const CACHE_KEY = 'wd_screener_cache';

function isMarketOpen() {
  const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();   // 0=Sun, 6=Sat
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960; // Mon–Fri 9:30–16:00 ET
}

// Epoch ms of the most recent 16:00 ET session close. A cache saved before this
// instant is missing at least one session's closing print, so it can't be the
// "latest price" no matter how recently it was written.
function lastMarketCloseMs() {
  const now  = new Date();
  const et   = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const skew = et.getTime() - now.getTime(); // ET wall clock minus real time

  const close = new Date(et);
  close.setHours(16, 0, 0, 0);
  // Walk back to the most recent weekday whose close has already happened
  while (close > et || close.getDay() === 0 || close.getDay() === 6) {
    close.setDate(close.getDate() - 1);
  }
  return close.getTime() - skew;
}

function saveQmapCache(qmap) {
  try {
    // Only persist tickers that actually returned data. Writing nulls would let a
    // failed fetch look "covered" on the next boot, and wiping the file outright
    // would cost us a good cache every time the network hiccups.
    const clean = {};
    for (const [t, v] of Object.entries(qmap)) if (v) clean[t] = v;
    if (!Object.keys(clean).length) return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), qmap: clean }));
  } catch (_) {}
}

function loadQmapCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { savedAt, qmap } = JSON.parse(raw);
    if (!qmap) return null;
    // Cache valid for up to 4 days (covers long weekends)
    if (Date.now() - savedAt > 4 * 24 * 60 * 60 * 1000) return null;
    return { savedAt, qmap, current: savedAt >= lastMarketCloseMs() };
  } catch (_) { return null; }
}

export function useScreener(showToast) {
  const { state, dispatch } = useAppContext();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const [isScreening, setIsScreening] = useState(false);
  // Use a ref so runScreener's useCallback doesn't need isScreening as a dep —
  // avoids recreating runScreener on every start/stop which would re-trigger boot().
  const isScreeningRef = useRef(false);

  const refreshOptionPrices = useCallback(async (silent = false) => {
    const optPositions = stateRef.current.positions.filter(p => p.type !== 'shares' && p.expiry && p.strike);
    if (!optPositions.length) return;
    if (!silent) showToast('Refreshing options prices…', '');
    let updated = 0;
    for (const pos of optPositions) {
      const livePrice = await fetchOptionPrice(pos.ticker, pos.type, pos.strike, pos.expiry);
      if (livePrice !== null) {
        dispatch({ type: 'UPDATE_POSITION_LIVE_PREM', payload: { id: pos.id, liveCurPrem: livePrice } });
        updated++;
      }
      await new Promise(r => setTimeout(r, 450));
    }
    if (!silent && updated > 0)  showToast(`Options prices updated (${updated} position${updated > 1 ? 's' : ''})`, 'ok');
    if (!silent && updated === 0) showToast('No live option prices found', 'err');
  }, [dispatch, showToast]);

  /**
   * @param silent  suppress toasts (background refreshes)
   * @param seed    state the caller already has in hand but that React hasn't
   *                committed yet — boot passes the watchlist/positions/criteria
   *                it just fetched, since stateRef only catches up after a render.
   */
  const runScreener = useCallback(async (silent = false, seed = null) => {
    if (isScreeningRef.current) return;
    isScreeningRef.current = true;
    setIsScreening(true);

    try {
      const currentState = seed ? { ...stateRef.current, ...seed } : stateRef.current;
      const indicatorTickers = currentState.criteria.indicatorTickers
        ? String(currentState.criteria.indicatorTickers).split(',').map(t => t.trim()).filter(Boolean)
        : [];

      const tickers = [...new Set([
        ...currentState.watchlist.map(w => w.ticker),
        ...currentState.positions.map(p => p.ticker),
      ])];

      if (!tickers.length && !indicatorTickers.length) { isScreeningRef.current = false; setIsScreening(false); return; }

      const marketOpen = isMarketOpen();
      const allTickers = [...new Set([...tickers, ...indicatorTickers])];

      const paintPrices = (map) => {
        const batch = {};
        for (const w of currentState.watchlist) {
          if (map[w.ticker]) batch[w.ticker] = map[w.ticker];
        }
        if (Object.keys(batch).length) {
          dispatch({ type: 'BATCH_UPDATE_WATCHLIST_LIVE_DATA', payload: batch });
        }
      };

      // First render off the cache, before any network call. Signals ride along:
      // without them the tab sits empty for the whole fetch cycle — a minute or
      // more on a full watchlist — even though the cache already knows which
      // names were signalling. Live strikes aren't in yet, so the suggestions
      // show the criteria range until the fresh pass below replaces them.
      const paintCached = (map) => {
        if (!Object.keys(map).length) return;
        paintPrices(map);
        dispatch({
          type: 'SET_SIGNALS',
          payload: buildSignals(currentState.watchlist, currentState.positions, currentState.criteria, map),
        });
      };

      // ── Cache path ──────────────────────────────────────────────────────────
      // The cache always paints first, open or closed, so the app never opens on
      // an empty screen. It short-circuits the fetch only when markets are closed
      // AND it already reflects the most recent close — a cache written mid-session
      // still holds an intraday price, so that case paints and then refetches.
      let qmap = {};
      let needFetch = true;

      const cached = loadQmapCache();
      if (cached) {
        // Only use cache entries for tickers we still care about
        for (const t of allTickers) {
          if (cached.qmap[t]) qmap[t] = cached.qmap[t];
        }
        const allCovered = allTickers.every(t => qmap[t]);
        if (!marketOpen && allCovered && cached.current) {
          needFetch = false; // already the latest close — dispatch cached data below
        } else {
          paintCached(qmap); // last-known prices and signals now; fresh data follows
        }
      }

      if (needFetch) {
        if (!silent) showToast(`Fetching ${tickers.length} ticker${tickers.length > 1 ? 's' : ''}…`, '');
        for (const t of allTickers) {
          qmap[t] = await fetchQ(t, currentState.criteria.ma);
          await new Promise(r => setTimeout(r, 350));
        }
        saveQmapCache(qmap);
      }

      const gotAny = Object.values(qmap).some(v => v !== null);
      if (!silent && !gotAny) {
        const hasKey = !!getTradierKey();
        showToast(
          hasKey
            ? '⚠ No market data — Tradier API call failed (check console for details)'
            : '⚠ No market data — add your Tradier API key in Settings',
          'err'
        );
      }

      // Surface per-ticker failures instead of silently showing stale data
      const failedTickers = tickers.filter(t => !qmap[t]);
      if (!silent && gotAny && failedTickers.length) {
        showToast(`⚠ No data for ${failedTickers.join(', ')}`, 'err');
      }

      // Dispatch indicator live data (already fetched into qmap above in cache-aware paths)
      for (const t of indicatorTickers) {
        if (qmap[t]) dispatch({ type: 'UPDATE_INDICATOR_LIVE_DATA', payload: { ticker: t, liveData: qmap[t] } });
      }

      // Batch-update all watchlist liveData in one dispatch → single re-render, no progressive popping
      // The quote is the only price source now — the sheet's GOOGLEFINANCE column
      // used to win here, but Notion doesn't carry a price.
      paintPrices(qmap);

      // Update market price on share positions
      const shareTickers = [...new Set(currentState.positions.filter(p => p.type === 'shares').map(p => p.ticker))];
      for (const ticker of shareTickers) {
        if (qmap[ticker]?.price) {
          dispatch({ type: 'UPDATE_POSITION_MARKET_PRICE', payload: { ticker, price: qmap[ticker].price } });
        }
      }

      // Fetch live option prices
      const optPositions = currentState.positions.filter(p => p.type !== 'shares' && p.expiry && p.strike);
      const livePremMap  = {};
      for (const pos of optPositions) {
        const livePrice = await fetchOptionPrice(pos.ticker, pos.type, pos.strike, pos.expiry);
        if (livePrice !== null) {
          livePremMap[pos.id] = livePrice;
          dispatch({ type: 'UPDATE_POSITION_LIVE_PREM', payload: { id: pos.id, liveCurPrem: livePrice } });
        }
        await new Promise(r => setTimeout(r, 450));
      }

      // Build a merged positions snapshot so buildSignals sees _liveCurPrem
      const mergedPositions = currentState.positions.map(p =>
        livePremMap[p.id] !== undefined ? { ...p, _liveCurPrem: livePremMap[p.id] } : p
      );

      // ── Live strike lookup for tickers that will produce full signals ────────
      // Mirror buildSignals' pass conditions so we only hit Tradier for tickers
      // that actually generate a card. Failures degrade to generic suggestions.
      const cr = currentState.criteria;
      const strikeMap = {};

      for (const w of currentState.watchlist) {
        if (w.diveIn !== PRIORITY) continue;
        const q = qmap[w.ticker];
        if (!q || q.dropPct == null) continue;
        const dropOk = q.dropPct >= cr.dropPct;
        const hasOpt = mergedPositions.some(p =>
          p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
        if (dropOk && !hasOpt) {
          const best = await fetchBestStrike(w.ticker, 'put', cr.deltaMin, cr.deltaMax, cr.dteMin, cr.dteMax);
          if (best) strikeMap[`${w.ticker}:put`] = best;
          await new Promise(r => setTimeout(r, 450));
        }
      }

      for (const pos of mergedPositions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= 100)) {
        const q = qmap[pos.ticker];
        if (!q || q.rallyPct == null || strikeMap[`${pos.ticker}:call`]) continue;
        const rallyOk = q.rallyPct >= cr.ccRallyPct;
        const hasCall = mergedPositions.some(p =>
          p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
        if (rallyOk && !hasCall) {
          const best = await fetchBestStrike(pos.ticker, 'call', cr.ccDeltaMin, cr.ccDeltaMax, cr.ccDteMin, cr.ccDteMax);
          if (best) strikeMap[`${pos.ticker}:call`] = best;
          await new Promise(r => setTimeout(r, 450));
        }
      }

      // Build signals and publish — the missing link that left the Signals tab empty
      // A run that got nothing back leaves the cached cards up rather than
      // blanking the tab — the "no market data" toast above already said why,
      // and the price columns keep their last-known values for the same reason.
      if (gotAny || !cached) {
        const sigs = buildSignals(currentState.watchlist, mergedPositions, cr, qmap, strikeMap);
        dispatch({ type: 'SET_SIGNALS', payload: sigs });
      }

      // NOTE: screener never writes to the sheet — only explicit user actions (save/delete) do
    } catch (e) {
      if (!silent) showToast('⚠ Screener error — ' + e.message, 'err');
    } finally {
      isScreeningRef.current = false;
      setIsScreening(false);
    }
  }, [dispatch, showToast]); // no isScreening dep — ref handles guard

  return { isScreening, runScreener, refreshOptionPrices };
}
