import { useState, useEffect } from 'react';
import { yahooBase } from '../lib/utils';
import { STRIP, parseStrip } from '../lib/homeFeed';

/**
 * Part 6A: SPY / QQQ / SMH / VIX price + day % for the top of Home.
 * One Yahoo "spark" request through the Worker. Refreshes when the app
 * opens and whenever the screener refreshes (`refreshKey` = lastRefresh) —
 * no polling of its own, same as the rest of the app.
 */
export function useMarketStrip(refreshKey) {
  const [rows, setRows] = useState(() => STRIP.map(s => ({ ...s, price: null, chgPct: null })));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const syms = STRIP.map(s => s.sym).join(',');
    fetch(`${yahooBase()}/v8/finance/spark?symbols=${encodeURIComponent(syms)}&range=5d&interval=1d`,
      { signal: AbortSignal.timeout(12000) })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(body => { if (alive) { setRows(parseStrip(body)); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); }); // keep the last good numbers
    return () => { alive = false; };
  }, [refreshKey]);

  return { rows, failed };
}
