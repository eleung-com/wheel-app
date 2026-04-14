import { getFinnhubKey } from './utils';

export async function fetchQ(ticker, maPeriod = 200) {
  const key = getFinnhubKey();
  if (!key) return null;

  try {
    const now   = Math.floor(Date.now() / 1000);
    const from  = now - 400 * 86400; // ~400 days back for MA200 + buffer

    // Candle data for OHLCV history
    const candleUrl = `/fh/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}&token=${key}`;
    const candleRes = await fetch(candleUrl, { signal: AbortSignal.timeout(8000) });
    if (!candleRes.ok) return null;
    const candle = await candleRes.json();
    if (candle.s !== 'ok' || !candle.c?.length) return null;

    // Quote for current price + prev close
    const quoteUrl = `/fh/api/v1/quote?symbol=${ticker}&token=${key}`;
    const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(6000) });
    let price = candle.c[candle.c.length - 1];
    let prev  = candle.c.length >= 2 ? candle.c[candle.c.length - 2] : price;
    let chg1d = null;
    let h52   = null;
    let l52   = null;

    if (quoteRes.ok) {
      const q = await quoteRes.json();
      if (q.c && q.c > 0) price = q.c;
      if (q.pc && q.pc > 0) {
        prev  = q.pc;
        chg1d = ((price - prev) / prev * 100);
      }
    }

    const closes = candle.c;
    const highs  = candle.h || [];
    const lows   = candle.l || [];

    // 52-week high/low from candle history (up to 252 trading days)
    const yr = closes.slice(-252);
    const yh = highs.slice(-252);
    const yl = lows.slice(-252);
    h52 = yh.length ? Math.max(...yh) : Math.max(...yr);
    l52 = yl.length ? Math.min(...yl) : Math.min(...yr);

    if (chg1d === null) {
      chg1d = prev ? ((price - prev) / prev * 100) : null;
    }

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

    // RSI-14
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
      const pctFrH = (h52 - price) / ((h52 - l52) || 1) * 100;
      ivrEst     = Math.min(99, Math.round(hv30 * 1.25 + pctFrH * 0.15));
    }

    return { price, chg1d, aboveMa, rsiEst, stochEst, ivrEst, hv30 };
  } catch (e) {
    return null;
  }
}
