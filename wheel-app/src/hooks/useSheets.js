import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { getSheetUrl, getSecret, parseCriteria, parsePositions, parseClosedTrades, idWarning } from '../lib/utils';

export function useSheets(showToast) {
  const { state, dispatch } = useAppContext();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: '⬡ synced' });

  // ── Part 5A: load guard ──────────────────────────────────────────────────
  // Every save rewrites the WHOLE sheet from what the app holds. If the sheet
  // never loaded, the app holds nothing — so one save would wipe every trade.
  // Saving stays off until one read has come back complete. A later failed
  // pull doesn't turn it off: the list already loaded is still good.
  const loadedRef = useRef(false);
  const [canSave, setCanSave] = useState(false);
  // Part 5F: a plain-English note about rows with missing / repeated ids.
  const [idNote, setIdNote] = useState(null);

  const icons = { synced: '⬡', syncing: '↻', error: '⚠', idle: '⬡' };

  function setSync(s, msg) {
    setSyncStatus({ state: s, message: `${icons[s] || ''} ${msg}` });
  }

  const sheetRead = useCallback(async () => {
    setSync('syncing', 'pulling…');
    try {
      const url = `${getSheetUrl()}?secret=${encodeURIComponent(getSecret())}&action=read`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error(`Non-JSON response: ${text.slice(0, 120)}`); }
      if (data.error) throw new Error(data.error);
      // 5A: a reply without both lists is not a complete load.
      if (!Array.isArray(data.positions) || !Array.isArray(data.closedTrades)) {
        throw new Error('Sheet reply was incomplete');
      }
      loadedRef.current = true;
      setCanSave(true);
      setIdNote(idWarning(data.positions, data.closedTrades));
      setSync('synced', 'synced');
      return data;
    } catch (e) {
      setSync('error', 'sync error');
      showToast('⚠ Sheets read failed — ' + e.message, 'err');
      return null;
    }
  }, [showToast]);

  // Write via POST with Content-Type: text/plain — avoids CORS preflight and GET URL length limits
  const sheetWriteViaGet = useCallback(async (overrideState) => {
    // 5A backstop — callers check canSave first; this catches any that don't.
    if (!loadedRef.current) {
      setSync('error', 'saving off');
      showToast('⚠ Not saved — the sheet hasn’t loaded. Tap Retry at the top.', 'err');
      return false;
    }
    const s = overrideState || stateRef.current;
    setSync('syncing', 'saving…');
    try {
      // No watchlist key — the watchlist lives in Notion now. The Apps Script
      // write action must leave the Watchlist tab untouched when it is absent.
      const data = {
        positions: s.positions.map(p => ({
          id:          p.id,
          ticker:      p.ticker,
          type:        p.type,
          qty:         p.qty,
          cost:        p.cost,
          marketPrice: p.type === 'shares' ? (p._livePrice || p.marketPrice || '') : '',
          strike:      p.strike      !== undefined ? p.strike      : '',
          longStrike:  p.longStrike  !== undefined ? p.longStrike  : '',
          expiry:      p.expiry      || '',
          prem:        p.prem        !== undefined ? p.prem        : '',
          shortPrem:   p.shortPrem   !== undefined ? p.shortPrem   : '',
          longPrem:    p.longPrem    !== undefined ? p.longPrem    : '',
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
          longStrike:    t.longStrike    !== undefined ? t.longStrike    : '',
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
      // Stand-in ids (5F) are in the sheet now.
      setIdNote(null);
      return true;
    } catch (e) {
      setSync('error', 'save failed');
      showToast('⚠ Save failed — ' + e.message, 'err');
      return false;
    }
  }, [showToast]);

  const syncFromSheet = useCallback(async () => {
    showToast('Pulling from Google Sheets…', '');
    const data = await sheetRead();
    if (!data) return;

    // data.watchlist is deliberately ignored — Notion owns the watchlist.

    // 5A: an empty Positions tab when the app already holds trades is far more
    // likely a bad read than a real wipe. Keep what's on screen and say so.
    const parsed = parsePositions(data.positions);
    if (!parsed.length && stateRef.current.positions.length) {
      showToast('⚠ Sheet came back empty — kept your current trades. Check the sheet.', 'err');
      return;
    }
    dispatch({ type: 'SET_POSITIONS', payload: parsed });

    if (Array.isArray(data.closedTrades)) {
      dispatch({ type: 'SET_CLOSED_TRADES', payload: parseClosedTrades(data.closedTrades) });
    }

    if (data.criteria && typeof data.criteria === 'object') {
      dispatch({ type: 'SET_CRITERIA', payload: parseCriteria(data.criteria) });
    }

    showToast('Synced from Google Sheets ✓', 'ok');
  }, [sheetRead, dispatch, showToast]);

  return { syncStatus, sheetRead, sheetWriteViaGet, syncFromSheet, canSave, idNote, clearIdNote: () => setIdNote(null) };
}
