import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { fetchQ } from '../lib/indicators';
import { fetchOptionPrice } from '../lib/optionPrice';
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

function saveQmapCache(qmap) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), qmap }));
  } catch (_) {}
}

function loadQmapCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { savedAt, qmap } = JSON.parse(raw);
    // Cache valid for up to 4 days (covers long weekends)
    if (Date.now() - savedAt > 4 * 24 * 60 * 60 * 1000) return null;
    return qmap;
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

  const runScreener = useCallback(async (silent = false) => {
    if (isScreeningRef.current) return;
    isScreeningRef.current = true;
    setIsScreening(true);

    try {
      const currentState = stateRef.current;
      const indicatorTickers = currentState.criteria.indicatorTickers
        ? String(currentState.criteria.indicatorTickers).split(',').map(t => t.trim()).filter(Boolean)
        : [];

      const tickers = [...new Set([
        ...currentState.watchlist.map(w => w.ticker),
        ...currentState.positions.map(p => p.ticker),
      ])];

      if (!tickers.length && !indicatorTickers.length) { isScreeningRef.current = false; setIsScreening(false); return; }

      const marketOpen = isMarketOpen();

      // ── Cache path: market closed → serve cached qmap instantly ──────────────
      let qmap = {};
      if (!marketOpen) {
        const cached = loadQmapCache();
        if (cached) {
          // Only use cache entries for tickers we still care about
          for (const t of [...tickers, ...indicatorTickers]) {
            if (cached[t]) qmap[t] = cached[t];
          }
          // If cache covers all tickers, skip the network fetch entirely
          const allCovered = [...tickers, ...indicatorTickers].every(t => qmap[t]);
          if (allCovered) {
            // fall through to dispatch below with cached data — no fetch needed
          } else {
            // Cache is stale or incomplete — fetch missing tickers
            for (const t of [...tickers, ...indicatorTickers]) {
              if (!qmap[t]) {
                qmap[t] = await fetchQ(t, currentState.criteria.ma);
                await new Promise(r => setTimeout(r, 350));
              }
            }
            saveQmapCache(qmap);
          }
        } else {
          // No cache — fetch and save
          if (!silent) showToast(`Fetching ${tickers.length} ticker${tickers.length > 1 ? 's' : ''}…`, '');
          for (const t of tickers) {
            qmap[t] = await fetchQ(t, currentState.criteria.ma);
            await new Promise(r => setTimeout(r, 350));
          }
          saveQmapCache(qmap);
        }
      } else {
        // ── Live path: market open → fetch fresh, update cache ────────────────
        if (!silent) showToast(`Fetching ${tickers.length} ticker${tickers.length > 1 ? 's' : ''}…`, '');
        for (const t of tickers) {
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

      // Dispatch indicator live data (already fetched into qmap above in cache-aware paths)
      for (const t of indicatorTickers) {
        if (qmap[t]) dispatch({ type: 'UPDATE_INDICATOR_LIVE_DATA', payload: { ticker: t, liveData: qmap[t] } });
      }

      // Batch-update all watchlist liveData in one dispatch → single re-render, no progressive popping
      const watchBatch = {};
      for (const w of currentState.watchlist) {
        if (qmap[w.ticker]) {
          const sheetPrice = stateRef.current.watchlist.find(x => x.ticker === w.ticker)?.liveData?.price;
          watchBatch[w.ticker] = { ...qmap[w.ticker], ...(sheetPrice ? { price: sheetPrice } : {}) };
        }
      }
      if (Object.keys(watchBatch).length) {
        dispatch({ type: 'BATCH_UPDATE_WATCHLIST_LIVE_DATA', payload: watchBatch });
      }

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
