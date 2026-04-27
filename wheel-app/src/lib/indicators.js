import { tradierRequest } from './utils';

// ── RSI using Wilder's RMA — matches TradingView ta.rsi() exactly ─────────────
// RMA (Wilder's Moving Average) differs from EMA: the multiplier is 1/length
// not 2/(length+1), making it smoother and slower to react.
// Seeding rule: the very first RMA value is a plain SMA of the first `length`
// gains (or losses). Every subsequent bar uses the RMA recurrence.
// This two-phase approach is exactly what Pine Script's ta.rma() does.
function calcRSI(closes, length = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < length + 1) return out;

  // Compute per-bar gain and loss series
  const gains = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i]  = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }

  // Seed: SMA of the first `length` gains/losses (bars 1..length)
  let avgGain = gains.slice(1, length + 1).reduce((a, b) => a + b, 0) / length;
  let avgLoss = losses.slice(1, length + 1).reduce((a, b) => a + b, 0) / length;

  // First RSI value lives at index `length`
  if (avgLoss === 0) out[length] = 100;
  else if (avgGain === 0) out[length] = 0;
  else out[length] = 100 - 100 / (1 + avgGain / avgLoss);

  // RMA recurrence from bar length+1 onward
  for (let i = length + 1; i < n; i++) {
    avgGain = (avgGain * (length - 1) + gains[i])  / length;
    avgLoss = (avgLoss * (length - 1) + losses[i]) / length;
    if (avgLoss === 0) out[i] = 100;
    else if (avgGain === 0) out[i] = 0;
    else out[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

// ── Slow Stochastic (14,3,3) — matches TradingView ta.stoch() exactly ─────────
// rawK  = 100 * (close - lowestLow_14) / (highestHigh_14 - lowestLow_14)  [Fast %K]
// %K    = SMA(rawK, 3)   [Slow %K — the plotted line]
// %D    = SMA(%K, 3)
// All smoothing is plain SMA, not EMA or RMA. Using EMA would produce
// different values (Fast Stoch uses no smoothing; Slow uses SMA).
// Flat-range edge case: if highestHigh == lowestLow, carry forward the last
// valid rawK, or use 50 if no prior value exists.
function calcStoch(highs, lows, closes, kLen = 14, kSmooth = 3, dSmooth = 3) {
  const n = closes.length;
  const rawK = new Array(n).fill(null);
  let lastValidRawK = 50;

  for (let i = kLen - 1; i < n; i++) {
    const hh = Math.max(...highs.slice(i - kLen + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kLen + 1, i + 1));
    if (hh === ll) {
      // Flat range — carry forward previous rawK to avoid a 0/0 spike
      rawK[i] = lastValidRawK;
    } else {
      rawK[i] = 100 * (closes[i] - ll) / (hh - ll);
      lastValidRawK = rawK[i];
    }
  }

  // %K = SMA(rawK, kSmooth)
  const pctK = new Array(n).fill(null);
  for (let i = kLen - 1 + kSmooth - 1; i < n; i++) {
    const win = rawK.slice(i - kSmooth + 1, i + 1);
    if (win.some(v => v === null)) continue;
    pctK[i] = win.reduce((a, b) => a + b, 0) / kSmooth;
  }

  // %D = SMA(%K, dSmooth)
  const pctD = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (pctK[i] === null) continue;
    const win = [];
    for (let j = i - dSmooth + 1; j <= i; j++) {
      if (j < 0 || pctK[j] === null) { win.length = 0; break; }
      win.push(pctK[j]);
    }
    if (win.length === dSmooth) pctD[i] = win.reduce((a, b) => a + b, 0) / dSmooth;
  }

  return { K: pctK, D: pctD };
}

// ── Simple moving average over a nullable array (used for Stoch RSI chart) ────
function sma(arr, n) {
  return arr.map((_, i) => {
    const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter(x => x !== null);
    return win.length < n ? null : win.reduce((a, b) => a + b, 0) / n;
  });
}

// ── Stochastic RSI — K and D lines (for sparkline chart only) ─────────────────
function calcStochRSI(closes, rsiP = 14, stochP = 14, kSmooth = 3, dSmooth = 3) {
  const rsis = calcRSI(closes, rsiP);
  const rawSR = rsis.map((r, i) => {
    if (r === null) return null;
    const win = rsis.slice(Math.max(0, i - stochP + 1), i + 1).filter(x => x !== null);
    if (win.length < stochP) return null;
    const lo = Math.min(...win), hi = Math.max(...win);
    return hi === lo ? 0 : (r - lo) / (hi - lo) * 100;
  });
  const K = sma(rawSR, kSmooth);
  const D = sma(K, dSmooth);
  return { K, D };
}

export async function fetchQ(ticker, maPeriod = 200) {
  try {
    // Yahoo Finance for dividend+split adjusted OHLC history — matches TradingView's default.
    // Local: Vite proxy at /yf sets browser User-Agent so Yahoo doesn't reject the request.
    // Production (GitHub Pages): direct URL works since browsers send a real User-Agent.
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const yahooBase = isLocal ? '/yf' : 'https://query1.finance.yahoo.com';
    const yahooUrl = `${yahooBase}/v8/finance/chart/${ticker}?interval=1d&range=2y`;

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

    if (closes.length < 20) return null;

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

    // RSI-14 — Wilder RMA on adjusted closes, matches TradingView ta.rsi()
    const rsiArr  = calcRSI(closes);
    const rsiLast = rsiArr[rsiArr.length - 1];
    const rsiEst  = rsiLast !== null ? parseFloat(rsiLast.toFixed(1)) : null;

    // Slow Stochastic (14,3,3) on adjusted OHLC, matches TradingView ta.stoch()
    const { K: stochK } = calcStoch(highs, lows, closes);
    const stochLast = stochK[stochK.length - 1];
    const stochEst  = stochLast !== null ? parseFloat(stochLast.toFixed(1)) : null;

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

    // Stoch RSI computed on full dataset for proper warm-up, last 45 returned
    const { K: srK, D: srD } = calcStochRSI(closes);

    return {
      price, chg1d, aboveMa, rsiEst, stochEst, ivrEst, hv30,
      closes2m:   closes.slice(-45),
      dates2m:    dates.slice(-45),
      stochRsi2m: { k: srK.slice(-45), d: srD.slice(-45) },
    };
  } catch (e) {
    console.error(`[fetchQ] ${ticker}:`, e?.message || e);
    return null;
  }
}
