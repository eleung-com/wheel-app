import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { fetchQ } from '../lib/indicators';
import { fetchOptionPrice, fetchBestStrike } from '../lib/optionPrice';
import { buildSignals } from '../lib/signals';
import { getTradierKey } from '../lib/utils';

export function useScreener(showToast) {
  const { state, dispatch } = useAppContext();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const [isScreening, setIsScreening] = useState(false);

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

  const runScreener = useCallback(async () => {
    if (isScreening) return;
    setIsScreening(true);

    try {
      const currentState = stateRef.current;
      const tickers = [...new Set([
        ...currentState.watchlist.map(w => w.ticker),
        ...currentState.positions.map(p => p.ticker),
      ])];

      if (!tickers.length) { setIsScreening(false); return; }

      showToast(`Fetching ${tickers.length} ticker${tickers.length > 1 ? 's' : ''}…`, '');

      // Fetch market data for all tickers
      const qmap = {};
      for (const t of tickers) {
        qmap[t] = await fetchQ(t, currentState.criteria.ma);
        await new Promise(r => setTimeout(r, 350));
      }

      const gotAny = Object.values(qmap).some(v => v !== null);
      if (!gotAny) {
        const hasKey = !!getTradierKey();
        showToast(
          hasKey
            ? '⚠ No market data — Tradier API call failed (check console for details)'
            : '⚠ No market data — add your Tradier API key in Settings',
          'err'
        );
      }

      // Update liveData for watchlist items
      for (const w of currentState.watchlist) {
        if (qmap[w.ticker]) {
          const sheetPrice = stateRef.current.watchlist.find(x => x.ticker === w.ticker)?.liveData?.price;
          const liveData = {
            ...qmap[w.ticker],
            ...(sheetPrice ? { price: sheetPrice } : {}),
          };
          dispatch({ type: 'UPDATE_WATCHLIST_LIVE_DATA', payload: { ticker: w.ticker, liveData } });
        }
      }

      // Update market price on share positions (covers tickers not on watchlist too)
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

      // Pre-fetch live strikes from Tradier for tickers that will generate a full signal.
      // CSP: all 4 criteria pass + no existing open option.
      // CC:  IVR passes + has enough shares + no existing open call.
      const cr = currentState.criteria;
      const strikeMap = {};

      for (const w of currentState.watchlist) {
        const q = qmap[w.ticker];
        if (!q) continue;
        const hasOpt = mergedPositions.find(
          p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId
        );
        if (hasOpt) continue;
        const allOk = q.ivrEst >= cr.ivr && q.rsiEst <= cr.rsi && q.stochEst <= cr.stoch && q.aboveMa !== false;
        if (allOk) {
          const result = await fetchBestStrike(w.ticker, 'put', cr.deltaMin, cr.deltaMax, cr.dteMin, cr.dteMax);
          if (result) strikeMap[`${w.ticker}:put`] = result;
          await new Promise(r => setTimeout(r, 350));
        }
      }

      for (const pos of mergedPositions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= 100)) {
        const q = qmap[pos.ticker];
        if (!q) continue;
        const hasCall = mergedPositions.find(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
        if (hasCall) continue;
        if (q.ivrEst !== null && q.ivrEst >= cr.ccIvr && q.stochEst !== null && q.stochEst >= cr.ccStoch) {
          const result = await fetchBestStrike(pos.ticker, 'call', cr.ccDeltaMin, cr.ccDeltaMax, cr.ccDteMin, cr.ccDteMax);
          if (result) strikeMap[`${pos.ticker}:call`] = result;
          await new Promise(r => setTimeout(r, 350));
        }
      }

      const sigs = buildSignals(currentState.watchlist, mergedPositions, currentState.criteria, qmap, strikeMap);
      dispatch({ type: 'SET_SIGNALS', payload: sigs });
      // NOTE: screener never writes to the sheet — only explicit user actions (save/delete) do
    } catch (e) {
      showToast('⚠ Screener error — ' + e.message, 'err');
    } finally {
      setIsScreening(false);
    }
  }, [isScreening, dispatch, showToast]);

  return { isScreening, runScreener, refreshOptionPrices };
}
