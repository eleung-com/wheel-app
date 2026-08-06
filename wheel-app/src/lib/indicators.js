import { tradierRequest, yahooBase } from './utils';
import { deriveIndicators } from './signalEngine';

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

    return deriveIndicators({ closes, highs, lows, dates }, price, chg1d, maPeriod);
  } catch (e) {
    console.error(`[fetchQ] ${ticker}:`, e?.message || e);
    return null;
  }
}
