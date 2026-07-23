import { tradierRequest, yahooBase } from './utils';

// ── ATR-14 using Wilder's RMA — matches TradingView ta.atr() exactly ─────────
// True Range is the widest of: today's range, or today's high/low measured
// against yesterday's close (which captures overnight gaps that a plain
// high−low misses). RMA smoothing uses a 1/length multiplier rather than the
// EMA's 2/(length+1), and seeds on a plain SMA of the first `length` TRs —
// exactly what Pine Script's ta.rma() does.
//
// ATR is the yardstick that makes a fixed percentage threshold comparable
// across the watchlist: a 5% drop is a rare event for SPY and an ordinary
// week for NVDA, but "fell 2.3x its average daily range" means the same
// thing for both.
function calcATR(highs, lows, closes, length = 14) {
  const n = closes.length;
  if (n < length + 1) return null;

  const tr = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }

  // Seed on the SMA of the first `length` true ranges, then apply the recurrence
  let atr = tr.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < tr.length; i++) {
    atr = (atr * (length - 1) + tr[i]) / length;
  }
  return atr > 0 ? atr : null;
}

// ── Daily OHLC history: Tradier primary, Yahoo fallback ──────────────────────
// Tradier is an authenticated API with reliable limits (~120 req/min). Yahoo
// aggressively 429-throttles unauthenticated IPs (observed in the wild), so it
// only serves as the keyless fallback. Both return { closes, highs, lows, dates }.

async function fetchHistoryTradier(ticker) {
  const start = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
  const end   = new Date().toISOString().slice(0, 10);
  const req = tradierRequest(
    `/v1/markets/history?symbol=${ticker}&interval=daily&start=${start}&end=${end}&session_filter=all`
  );
  if (!req) return null;

  const r = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const data = await r.json();

  const rawDays = data?.history?.day;
  if (!rawDays) return null;
  const days = Array.isArray(rawDays) ? rawDays : [rawDays];

  const closes = [], highs = [], lows = [], dates = [];
  for (const d of days) {
    if (d.close == null || d.high == null || d.low == null || d.close === 0) continue;
    closes.push(d.close);
    highs.push(d.high);
    lows.push(d.low);
    dates.push(d.date);
  }
  return closes.length >= 20 ? { closes, highs, lows, dates } : null;
}

async function fetchHistoryYahoo(ticker) {
  const yahooUrl = `${yahooBase()}/v8/finance/chart/${ticker}?interval=1d&range=2y`;

  const histRes = await fetch(yahooUrl, { signal: AbortSignal.timeout(8000) });
  if (!histRes.ok) return null;
  const histData = await histRes.json();

  const result = histData?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp;
  const adjCloses  = result.indicators.adjclose?.[0]?.adjclose;
  const rawCloses  = result.indicators.quote[0].close;
  const rawHighs   = result.indicators.quote[0].high;
  const rawLows    = result.indicators.quote[0].low;

  if (!timestamps?.length || !adjCloses?.length || !rawCloses?.length) return null;

  // Build clean arrays — skip bars with null/zero values
  // Apply adjclose/close ratio to high & low so all prices are consistently adjusted
  const closes = [], highs = [], lows = [], dates = [];
  for (let i = 0; i < timestamps.length; i++) {
    const adj = adjCloses[i], raw = rawCloses[i];
    if (adj == null || raw == null || raw === 0 || rawHighs[i] == null || rawLows[i] == null) continue;
    const ratio = adj / raw;
    closes.push(adj);
    highs.push(rawHighs[i] * ratio);
    lows.push(rawLows[i] * ratio);
    dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
  }
  return closes.length >= 20 ? { closes, highs, lows, dates } : null;
}

export async function fetchQ(ticker, maPeriod = 200) {
  try {
    let hist = null;
    try { hist = await fetchHistoryTradier(ticker); } catch (_) { /* fall through to Yahoo */ }
    if (!hist) {
      try { hist = await fetchHistoryYahoo(ticker); } catch (_) { /* both failed */ }
    }
    if (!hist) {
      console.error(`[fetchQ] ${ticker}: no history from Tradier or Yahoo`);
      return null;
    }
    const { closes, highs, lows, dates } = hist;

    // Live price + 1d change from Tradier quote (falls back to last adj close)
    let price = closes[closes.length - 1];
    let chg1d = closes.length >= 2 ? ((price - closes[closes.length - 2]) / closes[closes.length - 2] * 100) : null;

    try {
      const req = tradierRequest(`/v1/markets/quotes?symbols=${ticker}`);
      if (req) {
        const quoteRes = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(5000) });
        if (quoteRes.ok) {
          const qd = await quoteRes.json();
          const q = qd?.quotes?.quote;
          const quote = Array.isArray(q) ? q.find(x => x.symbol === ticker) : q;
          if (quote?.last && quote.last > 0) {
            price = quote.last;
            if (quote.prevclose && quote.prevclose > 0) {
              chg1d = ((price - quote.prevclose) / quote.prevclose * 100);
            }
          }
        }
      }
    } catch (e) { /* fall back to last adj close */ }

    // MA check
    let aboveMa = null;
    const mp = maPeriod || 200;
    if (closes.length >= mp) {
      const ma = closes.slice(-mp).reduce((a, b) => a + b, 0) / mp;
      aboveMa = price > ma;
    } else if (closes.length >= 20) {
      const ma = closes.reduce((a, b) => a + b, 0) / closes.length;
      aboveMa = price > ma;
    }

    // ── Weekly extremes — the basis for both entry signals ───────────────────
    // "Past week" means the last 5 trading sessions, not 7 calendar days, so a
    // holiday-shortened week still compares five real bars. The window includes
    // today, so an intraday high set this morning counts as the week high.
    const WEEK_BARS = 5;
    let dropPct = null, rallyPct = null, weekHigh = null, weekLow = null;
    if (closes.length >= WEEK_BARS) {
      weekHigh = Math.max(...highs.slice(-WEEK_BARS));
      weekLow  = Math.min(...lows.slice(-WEEK_BARS));
      if (weekHigh > 0) dropPct  = (weekHigh - price) / weekHigh * 100;
      if (weekLow  > 0) rallyPct = (price - weekLow)  / weekLow  * 100;
    }

    // How far the drop is in units of the stock's own average daily range.
    // Displayed rather than gated on — it ranks which names deserve a manual
    // RSI/Stochastic check first.
    const atr     = calcATR(highs, lows, closes);
    const atrDrop = (atr && weekHigh !== null) ? (weekHigh - price) / atr : null;

    // HV30 → IVR estimate
    let ivrEst = null, hv30 = null;
    if (closes.length >= 22) {
      const rc   = closes.slice(-22);
      const rets = rc.slice(1).map((c, i) => Math.log(c / rc[i]));
      const mn   = rets.reduce((a, b) => a + b, 0) / rets.length;
      const vr   = rets.reduce((a, b) => a + (b - mn) ** 2, 0) / rets.length;
      hv30       = Math.sqrt(vr * 252) * 100;

      const yr  = closes.slice(-252);
      const yh  = highs.slice(-252);
      const yl  = lows.slice(-252);
      const h52 = yh.length ? Math.max(...yh) : Math.max(...yr);
      const l52 = yl.length ? Math.min(...yl) : Math.min(...yr);
      const pctFrH = (h52 - price) / ((h52 - l52) || 1) * 100;
      ivrEst = Math.min(99, Math.round(hv30 * 1.25 + pctFrH * 0.15));
    }

    return {
      price, chg1d, aboveMa, ivrEst, hv30,
      dropPct, rallyPct, weekHigh, weekLow, atr, atrDrop,
      closes2m: closes.slice(-45),
      dates2m:  dates.slice(-45),
    };
  } catch (e) {
    console.error(`[fetchQ] ${ticker}:`, e?.message || e);
    return null;
  }
}
