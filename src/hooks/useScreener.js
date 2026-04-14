import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { fetchQ } from '../lib/indicators';
import { fetchOptionPrice } from '../lib/optionPrice';
import { buildSignals } from '../lib/signals';

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
    if (!silent && updated === 0) showToast('No live prices found — check Finnhub key in Settings', 'err');
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
        showToast('⚠ Could not reach Finnhub — check your API key in Settings', 'err');
      }

      // Update liveData: Finnhub provides indicators; sheet provides price (preferred)
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

      const sigs = buildSignals(currentState.watchlist, mergedPositions, currentState.criteria, qmap);
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
