export async function fetchQ(ticker, criteria) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const data = await r.json();
    const res = data.chart?.result?.[0]; if (!res) return null;
    const meta = res.meta;
    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose || meta.previousClose || price;
    const chg1d = prev ? ((price - prev) / prev * 100) : null;
    const q0    = res.indicators?.quote?.[0] || {};
    const closes = (q0.close  || []).filter(v => v !== null);
    const highs  = (q0.high   || []).filter(v => v !== null);
    const lows   = (q0.low    || []).filter(v => v !== null);

    // MA check
    let aboveMa = null;
    const mp = criteria?.ma || 200;
    if (closes.length >= mp) { const ma = closes.slice(-mp).reduce((a,b) => a+b, 0) / mp; aboveMa = price > ma; }
    else if (closes.length >= 20) { const ma = closes.reduce((a,b) => a+b, 0) / closes.length; aboveMa = price > ma; }

    // RSI-14
    let rsiEst = null;
    if (closes.length >= 16) {
      const ch = closes.slice(-16).map((c,i,a) => i === 0 ? 0 : c - a[i-1]).slice(1);
      const g  = ch.filter(x => x > 0).reduce((a,b) => a+b, 0) / 14;
      const l  = Math.abs(ch.filter(x => x <= 0).reduce((a,b) => a+b, 0)) / 14;
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
      const mn   = rets.reduce((a,b) => a+b, 0) / rets.length;
      const vr   = rets.reduce((a,b) => a + (b-mn)**2, 0) / rets.length;
      hv30   = Math.sqrt(vr * 252) * 100;
      const h52  = meta.fiftyTwoWeekHigh || price, l52 = meta.fiftyTwoWeekLow || price;
      const pctFrH = (h52 - price) / ((h52 - l52) || 1) * 100;
      ivrEst = Math.min(99, Math.round(hv30 * 1.25 + pctFrH * 0.15));
    }

    return { price, chg1d, aboveMa, rsiEst, stochEst, ivrEst, hv30 };
  } catch(e) { return null; }
}

export async function fetchOptionPrice(ticker, type, strike, expiry_iso) {
  if (!ticker || !strike) return null;
  const contractType = type === 'short_put' ? 'puts' : 'calls';

  function findContract(contracts) {
    if (!contracts || !contracts.length) return null;
    return contracts.find(c => Math.abs(c.strike - strike) < 0.01)
        || contracts.find(c => Math.abs(c.strike - strike) <= 0.50)
        || contracts.find(c => Math.abs(c.strike - strike) <= 1.00)
        || null;
  }

  function priceFromContract(c) {
    if (!c) return null;
    const bid = c.bid ?? null, ask = c.ask ?? null;
    if (bid !== null && ask !== null && bid > 0 && ask > 0) return parseFloat(((bid + ask) / 2).toFixed(2));
    if (c.lastPrice && c.lastPrice > 0) return parseFloat(c.lastPrice.toFixed(2));
    return null;
  }

  // CORS proxy applied during data fetching to bypass browser limitations
  const prefix = 'https://corsproxy.io/?';

  if (expiry_iso) {
    const baseMs = new Date(expiry_iso.split('T')[0] + 'T12:00:00').getTime();
    const offsets = [0, 86400000, -86400000, 172800000];
    for (const offset of offsets) {
      try {
        const ts = Math.floor((baseMs + offset) / 1000);
        const url = `${prefix}https://query1.finance.yahoo.com/v7/finance/options/${ticker}?date=${ts}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const data = await r.json();
        const opts = data?.optionChain?.result?.[0]?.options?.[0];
        if (!opts) continue;
        const price = priceFromContract(findContract(opts[contractType] || []));
        if (price !== null) return price;
      } catch(e) { continue; }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  try {
    const url = `${prefix}https://query1.finance.yahoo.com/v7/finance/options/${ticker}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data = await r.json();
      const result = data?.optionChain?.result?.[0];
      if (result) {
        const price = priceFromContract(findContract(result.options?.[0]?.[contractType] || []));
        if (price !== null) return price;
      }
    }
  } catch(e) {}
  return null;
}
