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

  // Write via POST with Content-Type: text/plain — avoids CORS preflight and GET URL length limits
  const sheetWriteViaGet = useCallback(async (overrideState) => {
    const s = overrideState || stateRef.current;
    setSync('syncing', 'saving…');
    try {
      const data = {
        watchlist: s.watchlist.map(w => ({ ticker: w.ticker, addedAt: w.addedAt, notes: w.notes || '' })),
        positions: s.positions.map(p => ({
          id:          p.id,
          ticker:      p.ticker,
          type:        p.type,
          qty:         p.qty,
          cost:        p.cost,
          marketPrice: p.type === 'shares' ? (p._livePrice || p.marketPrice || '') : '',
          strike:      p.strike      !== undefined ? p.strike      : '',
          expiry:      p.expiry      || '',
          prem:        p.prem        !== undefined ? p.prem        : '',
          curPrem:     p.curPrem     !== undefined ? p.curPrem     : '',
          notes:       p.notes       || '',
          acct:        p.account     || 'Esther',
          enteredAt:   p.enteredAt   || '',
          posType:     p.posType     || '',
          closePrice:  p.closePrice  !== undefined ? p.closePrice  : '',
          pnl:         p.pnl         !== undefined ? p.pnl         : '',
          linkedId:    p.linkedId    !== undefined ? p.linkedId    : '',
          rolledToId:  p.rolledToId  !== undefined ? p.rolledToId  : '',
          sharesAcquired: p.sharesAcquired !== undefined ? p.sharesAcquired : '',
          costBasis:   p.costBasis   !== undefined ? p.costBasis   : '',
        })),
        closedTrades: (s.closedTrades || []).map(t => ({
          id: t.id, ticker: t.ticker, posType: t.posType, closeType: t.closeType,
          qty: t.qty,
          acct:          t.account       || 'Esther',
          strike:        t.strike        !== undefined ? t.strike        : '',
          expiry:        t.expiry        || '',
          openDate:      t.openDate      || '',
          closeDate:     t.closeDate     || '',
          premCollected: t.premCollected !== undefined ? t.premCollected : '',
          closePrice:    t.closePrice    !== undefined ? t.closePrice    : '',
          pnl:           t.pnl           !== undefined ? t.pnl           : '',
          notes:         t.notes         || '',
          sharesAcquired: t.sharesAcquired !== undefined ? t.sharesAcquired : '',
          costBasis:     t.costBasis     !== undefined ? t.costBasis     : '',
          rolledToId:    t.rolledToId    !== undefined ? t.rolledToId    : '',
        })),
        criteria: s.criteria,
      };
      const body = JSON.stringify({ secret: getSecret(), action: 'write', data });
      const r = await fetch(getSheetUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      let resp;
      try { resp = JSON.parse(text); } catch (_) { resp = { ok: true }; }
      if (resp && resp.error) throw new Error(resp.error);
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
      const seen = new Set();
      dispatch({
        type: 'SET_WATCHLIST',
        payload: data.watchlist
          .map(w => {
            const existing = stateRef.current.watchlist.find(x => x.ticker === w.ticker);
            const sheetPrice = w.price ? { price: Number(w.price) } : null;
            const liveData = existing?.liveData
              ? { ...existing.liveData, ...(sheetPrice || {}) }
              : sheetPrice;
            return { ticker: String(w.ticker), addedAt: w.addedAt || Date.now(), notes: w.notes || '', liveData };
          })
          .filter(w => w.ticker && !seen.has(w.ticker) && seen.add(w.ticker)),
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
