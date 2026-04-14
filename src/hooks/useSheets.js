import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { getSheetUrl, getSecret, parseCriteria, parsePositions, parseClosedTrades } from '../lib/utils';

export function useSheets(showToast) {
  const { state, dispatch } = useAppContext();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: '⬡ synced' });

  const icons = { synced: '⬡', syncing: '↻', error: '⚠', idle: '⬡' };

  function setSync(s, msg) {
    setSyncStatus({ state: s, message: `${icons[s] || ''} ${msg}` });
  }

  const sheetRead = useCallback(async () => {
    setSync('syncing', 'pulling…');
    try {
      const url = `${getSheetUrl()}?secret=${encodeURIComponent(getSecret())}&action=read`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setSync('synced', 'synced');
      return data;
    } catch (e) {
      setSync('error', 'sync error');
      showToast('⚠ Could not reach Google Sheets — ' + e.message, 'err');
      return null;
    }
  }, [showToast]);

  // Primary write path — GET with URL-encoded payload to avoid CORS
  const sheetWriteViaGet = useCallback(async (overrideState) => {
    const s = overrideState || stateRef.current;
    setSync('syncing', 'saving…');
    try {
      const payload = JSON.stringify({
        watchlist: s.watchlist.map(w => ({ ticker: w.ticker, addedAt: w.addedAt })),
        positions: s.positions.map(p => ({
          id: p.id, ticker: p.ticker, type: p.type, qty: p.qty, cost: p.cost,
          marketPrice: p.type === 'shares' ? (p._livePrice || p.marketPrice || '') : '',
          strike:      p.strike   !== undefined ? p.strike   : '',
          expiry:      p.expiry   || '',
          prem:        p.prem     !== undefined ? p.prem     : '',
          curPrem:     p.curPrem  !== undefined ? p.curPrem  : '',
          notes:       p.notes    || '',
          enteredAt:   p.enteredAt || '',
        })),
        closedTrades: (s.closedTrades || []).map(t => ({
          id: t.id, ticker: t.ticker, posType: t.posType, closeType: t.closeType,
          qty: t.qty,
          strike:       t.strike        !== undefined ? t.strike        : '',
          expiry:       t.expiry        || '',
          openDate:     t.openDate      || '',
          closeDate:    t.closeDate     || '',
          premCollected:t.premCollected !== undefined ? t.premCollected : '',
          closePrice:   t.closePrice    !== undefined ? t.closePrice    : '',
          pnl:          t.pnl           !== undefined ? t.pnl           : '',
          notes:        t.notes         || '',
          sharesAcquired: t.sharesAcquired !== undefined ? t.sharesAcquired : '',
          costBasis:    t.costBasis     !== undefined ? t.costBasis     : '',
          rolledToId:   t.rolledToId    !== undefined ? t.rolledToId    : '',
        })),
        criteria: s.criteria,
        signals:  s.signals.map(sig => ({
          id: sig.id, type: sig.type, ticker: sig.ticker,
          suggestion: sig.suggestion, ts: sig.ts,
        })),
      });
      const url = `${getSheetUrl()}?secret=${encodeURIComponent(getSecret())}&action=write&data=${encodeURIComponent(payload)}`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { ok: true }; }
      if (data && data.error) throw new Error(data.error);
      setSync('synced', 'saved ✓');
      showToast('Saved to Google Sheets', 'ok');
    } catch (e) {
      setSync('error', 'save failed');
      showToast('⚠ Save failed — ' + e.message, 'err');
    }
  }, [showToast]);

  const syncFromSheet = useCallback(async () => {
    showToast('Pulling from Google Sheets…', '');
    const data = await sheetRead();
    if (!data) return;

    if (Array.isArray(data.watchlist)) {
      dispatch({
        type: 'SET_WATCHLIST',
        payload: data.watchlist.map(w => {
          const existing = stateRef.current.watchlist.find(x => x.ticker === w.ticker);
          // Merge sheet price into liveData, preserving any existing screener metrics
          const sheetPrice = w.price ? { price: Number(w.price) } : null;
          const liveData = existing?.liveData
            ? { ...existing.liveData, ...(sheetPrice || {}) }
            : sheetPrice;
          return {
            ticker:   String(w.ticker),
            addedAt:  w.addedAt || Date.now(),
            liveData,
          };
        }),
      });
    }

    if (Array.isArray(data.positions)) {
      dispatch({ type: 'SET_POSITIONS', payload: parsePositions(data.positions) });
    }

    if (Array.isArray(data.closedTrades)) {
      dispatch({ type: 'SET_CLOSED_TRADES', payload: parseClosedTrades(data.closedTrades) });
    }

    if (data.criteria && typeof data.criteria === 'object') {
      dispatch({ type: 'SET_CRITERIA', payload: parseCriteria(data.criteria) });
    }

    showToast('Synced from Google Sheets ✓', 'ok');
  }, [sheetRead, dispatch, showToast]);

  return { syncStatus, sheetRead, sheetWriteViaGet, syncFromSheet };
}
