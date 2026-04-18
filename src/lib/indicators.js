import { tradierRequest } from './utils';

// ── Wilder's RSI over the full closes array ───────────────────────────────────
function fullRSI(closes, period = 14) {
  if (closes.length < period + 1) return closes.map(() => null);
  const out = new Array(period).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

// ── Simple moving average over a nullable array ───────────────────────────────
function sma(arr, n) {
  return arr.map((v, i) => {
    if (v === null) return null;
    const win = arr.slice(Math.max(0, i - n + 1), i + 1).filter(x => x !== null);
    return win.length < n ? null : win.reduce((a, b) => a + b, 0) / n;
  });
}

// ── Stochastic RSI — K and D lines ────────────────────────────────────────────
// Uses Wilder RSI(rsiP), then stochastic(stochP) on RSI, smoothed K(kSmooth), D(dSmooth)
function calcStochRSI(closes, rsiP = 14, stochP = 14, kSmooth = 3, dSmooth = 3) {
  const rsis = fullRSI(closes, rsiP);
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
  const req = tradierRequest('');
  if (!req) return null;

  try {
    // Daily OHLCV history — request ~400 calendar days to cover MA-200 + buffer
    const end   = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const { url: histUrl, headers } = tradierRequest(`/v1/markets/history?symbol=${ticker}&interval=daily&start=${start}&end=${end}`);

    const histRes = await fetch(histUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (!histRes.ok) return null;
    const histData = await histRes.json();

    const days = histData?.history?.day;
    if (!days?.length) return null;

    // Tradier returns a single object (not array) when only one day — normalise
    const dayArr = Array.isArray(days) ? days : [days];

    const closes = dayArr.map(d => d.close);
    const highs  = dayArr.map(d => d.high);
    const lows   = dayArr.map(d => d.low);

    // Current quote for live price + prev close
    let price = closes[closes.length - 1];
    let prev  = closes.length >= 2 ? closes[closes.length - 2] : price;
    let chg1d = prev ? ((price - prev) / prev * 100) : null;

    try {
      const { url: quoteUrl, headers: quoteHeaders } = tradierRequest(`/v1/markets/quotes?symbols=${ticker}`);
      const quoteRes = await fetch(quoteUrl, { headers: quoteHeaders, signal: AbortSignal.timeout(5000) });
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
    } catch (e) { /* fall back to last close from history */ }

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

    // RSI-14 (quick estimate for screener signal)
    let rsiEst = null;
    if (closes.length >= 16) {
      const ch = closes.slice(-16).map((c, i, a) => i === 0 ? 0 : c - a[i - 1]).slice(1);
      const g  = ch.filter(x => x > 0).reduce((a, b) => a + b, 0) / 14;
      const l  = Math.abs(ch.filter(x => x <= 0).reduce((a, b) => a + b, 0)) / 14;
      rsiEst   = l === 0 ? 100 : parseFloat((100 - 100 / (1 + g / l)).toFixed(1));
    }

    // Stochastic %K (14-period)
    let stochEst = null;
    if (highs.length >= 14 && lows.length >= 14) {
      const rh = highs.slice(-14), rl = lows.slice(-14);
      const hh = Math.max(...rh), ll = Math.min(...rl);
      stochEst = hh === ll ? 50 : parseFloat(((price - ll) / (hh - ll) * 100).toFixed(1));
    } else if (closes.length >= 14) {
      const rc = closes.slice(-14);
      const hh = Math.max(...rc), ll = Math.min(...rc);
      stochEst = hh === ll ? 50 : parseFloat(((price - ll) / (hh - ll) * 100).toFixed(1));
    }

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
      dates2m:    dayArr.slice(-45).map(d => d.date),
      stochRsi2m: { k: srK.slice(-45), d: srD.slice(-45) },
    };
  } catch (e) {
    console.error(`[fetchQ] ${ticker}:`, e?.message || e);
    return null;
  }
}
