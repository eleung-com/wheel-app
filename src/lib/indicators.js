import { getFinnhubKey } from './utils';

export async function fetchQ(ticker, maPeriod = 200) {
  try {
    // Historical OHLCV via Yahoo Finance proxy
    const url = `/yf/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const data = await r.json();
    const res = data.chart?.result?.[0];
    if (!res) return null;

    const meta   = res.meta;
    let price    = meta.regularMarketPrice;
    let prev     = meta.chartPreviousClose || meta.previousClose || price;
    const q0     = res.indicators?.quote?.[0] || {};
    const closes = (q0.close || []).filter(v => v !== null);
    const highs  = (q0.high  || []).filter(v => v !== null);
    const lows   = (q0.low   || []).filter(v => v !== null);

    // Prefer Finnhub /quote for current price if key is available (more reliable real-time)
    const key = getFinnhubKey();
    let chg1d = prev ? ((price - prev) / prev * 100) : null;
    if (key) {
      try {
        const qr = await fetch(`/fh/api/v1/quote?symbol=${ticker}&token=${key}`, { signal: AbortSignal.timeout(5000) });
        if (qr.ok) {
          const q = await qr.json();
          if (q.c && q.c > 0) {
            price = q.c;
            if (q.pc && q.pc > 0) chg1d = ((price - q.pc) / q.pc * 100);
          }
        }
      } catch (e) { /* fall back to Yahoo price */ }
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
      const h52  = meta.fiftyTwoWeekHigh || price;
      const l52  = meta.fiftyTwoWeekLow  || price;
      const pctFrH = (h52 - price) / ((h52 - l52) || 1) * 100;
      ivrEst     = Math.min(99, Math.round(hv30 * 1.25 + pctFrH * 0.15));
    }

    return { price, chg1d, aboveMa, rsiEst, stochEst, ivrEst, hv30 };
  } catch (e) {
    return null;
  }
}
