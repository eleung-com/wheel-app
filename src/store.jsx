import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchQ, fetchOptionPrice } from './api';

const AppContext = createContext();

export const useAppContext = () => useContext(AppContext);

export const AppProvider = ({ children }) => {
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem('wd_sheet_url') || '');
  const [secret, setSecret] = useState(localStorage.getItem('wd_secret') || '');

  const [watchlist, setWatchlist] = useState([]);
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [signals, setSignals] = useState([]);
  const [criteria, setCriteria] = useState({
    ivr: 50, stoch: 20, rsi: 35, ma: 200, earn: 30,
    delta: 30, dteMin: 21, dteMax: 45,
    shares: 100, ccIvr: 30, ccDelta: 20, ccDteMin: 21, ccDteMax: 35,
    closePct: 50, closeDtePct: 50
  });

  const [syncStatus, setSyncStatus] = useState({ state: 'idle', msg: 'waiting' });
  const [lastRefresh, setLastRefresh] = useState(null);

  const saveSetup = (url, sec) => {
    localStorage.setItem('wd_sheet_url', url);
    localStorage.setItem('wd_secret', sec);
    setSheetUrl(url);
    setSecret(sec);
  };

  const clearSetup = () => {
    localStorage.removeItem('wd_sheet_url');
    localStorage.removeItem('wd_secret');
    setSheetUrl('');
    setSecret('');
  };

  // Google Sheets Read (GET)
  const syncFromSheet = async () => {
    if (!sheetUrl || !secret) return;
    setSyncStatus({ state: 'syncing', msg: 'pulling…' });
    try {
      const url = `${sheetUrl}?secret=${encodeURIComponent(secret)}&action=read`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await r.json();
      if (data.error) throw new Error(data.error);

      if (Array.isArray(data.watchlist)) {
        setWatchlist(prev => data.watchlist.map(w => {
          const existing = prev.find(x => x.ticker === w.ticker);
          return { ticker: String(w.ticker), addedAt: w.addedAt || Date.now(), liveData: existing?.liveData || null };
        }));
      }

      if (Array.isArray(data.positions)) {
        setPositions(data.positions.map(p => ({
          id: Number(p.id) || Date.now(),
          ticker: String(p.ticker || ''),
          type: String(p.type || 'shares'),
          qty: Number(p.qty) || 0,
          cost: Number(p.cost) || 0,
          strike: p.strike !== '' ? Number(p.strike) : undefined,
          expiry: p.expiry || '',
          prem: p.prem !== '' && p.prem !== null ? Number(p.prem) : undefined,
          curPrem: p.curPrem !== '' && p.curPrem !== null ? Number(p.curPrem) : undefined,
          notes: p.notes || '',
          enteredAt: Number(p.enteredAt) || Date.now()
        })));
      }

      // History mapping (if exists on Google Sheet)
      if (Array.isArray(data.history)) {
         setHistory(data.history);
      }

      if (data.criteria && typeof data.criteria === 'object') {
        const c = data.criteria;
        setCriteria({
          ivr: Number(c.ivr)||50, stoch: Number(c.stoch)||20, rsi: Number(c.rsi)||35,
          ma: Number(c.ma)||200, earn: Number(c.earn)||30, delta: Number(c.delta)||30,
          dteMin: Number(c.dteMin)||21, dteMax: Number(c.dteMax)||45,
          shares: Number(c.shares)||100, ccIvr: Number(c.ccIvr)||30,
          ccDelta: Number(c.ccDelta)||20, ccDteMin: Number(c.ccDteMin)||21,
          ccDteMax: Number(c.ccDteMax)||35, closePct: Number(c.closePct)||50,
          closeDtePct: Number(c.closeDtePct)||50
        });
      }

      if (Array.isArray(data.signals)) setSignals(data.signals);

      setSyncStatus({ state: 'synced', msg: 'synced ✓' });
    } catch(e) {
      setSyncStatus({ state: 'error', msg: 'sync error' });
      console.error(e);
    }
  };

  // Google Sheets Write (POST) - Upgraded from GET to support massive Trade History!
  const syncToSheet = async (newState) => {
    if (!sheetUrl || !secret) return;
    setSyncStatus({ state: 'syncing', msg: 'saving…' });

    // Use passed state or fallback to current state if not passed
    const currentW = newState?.watchlist || watchlist;
    const currentP = newState?.positions || positions;
    const currentH = newState?.history || history;
    const currentS = newState?.signals || signals;

    try {
      const payload = {
        watchlist: currentW.map(w => ({ ticker: w.ticker, addedAt: w.addedAt })),
        positions: currentP.map(p => ({
          ...p,
          strike: p.strike || '', expiry: p.expiry || '', prem: p.prem || '',
          curPrem: p.curPrem !== undefined ? p.curPrem : '', notes: p.notes || '', enteredAt: p.enteredAt || ''
        })),
        history: currentH,
        criteria,
        signals: currentS.map(sig => ({ id:sig.id, type:sig.type, ticker:sig.ticker, suggestion:sig.suggestion, ts:sig.ts }))
      };

      const r = await fetch(sheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ secret, action: 'write', ...payload })
      });

      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch(e) { data = { ok: true }; }
      if (data && data.error) throw new Error(data.error);

      setSyncStatus({ state: 'synced', msg: 'saved ✓' });
    } catch(e) {
      setSyncStatus({ state: 'error', msg: 'save failed' });
      // If POST fails (CORS or Apps Script misconfiguration), warn the user
      alert("WARNING: Save failed. Ensure your Google Apps Script supports POST requests with doPost() to support history saving.\nError: " + e.message);
    }
  };

  // Screener Engine
  const runScreener = async () => {
    setSyncStatus({ state: 'syncing', msg: 'screening…' });
    const tickers = [...new Set([...watchlist.map(w => w.ticker), ...positions.map(p => p.ticker)])];
    
    if (!tickers.length) {
      setSyncStatus({ state: 'idle', msg: 'synced ✓' });
      return;
    }

    const qmap = {};
    for (const t of tickers) {
      qmap[t] = await fetchQ(t, criteria);
      await new Promise(r => setTimeout(r, 350));
    }

    const newW = watchlist.map(w => ({ ...w, liveData: qmap[w.ticker] || w.liveData }));
    setWatchlist(newW);

    // Refresh option prices
    const optPositions = positions.filter(p => p.type !== 'shares' && p.expiry && p.strike);
    let newP = [...positions];
    for (const pos of optPositions) {
      const livePrice = await fetchOptionPrice(pos.ticker, pos.type, pos.strike, pos.expiry);
      if (livePrice !== null) {
        const i = newP.findIndex(p => p.id === pos.id);
        if (i !== -1) newP[i] = { ...newP[i], curPrem: livePrice };
      }
      await new Promise(r => setTimeout(r, 450));
    }
    setPositions(newP);
    
    setLastRefresh(Date.now());
    setSyncStatus({ state: 'synced', msg: 'screened ✓' });
  };

  useEffect(() => {
    if (sheetUrl && secret) {
      syncFromSheet();
    }
  }, [sheetUrl, secret]);

  return (
    <AppContext.Provider value={{
      sheetUrl, secret, saveSetup, clearSetup,
      watchlist, setWatchlist,
      positions, setPositions,
      history, setHistory,
      signals, setSignals,
      criteria, setCriteria,
      syncStatus,
      lastRefresh, setLastRefresh,
      syncFromSheet, syncToSheet, runScreener
    }}>
      {children}
    </AppContext.Provider>
  );
};
