// Unattended signal scan — the server-side mirror of useScreener.js. Runs on
// the Cron Trigger (see worker.js's scheduled() and wrangler.toml), pulls the
// same watchlist/positions/criteria the app uses, re-runs the shared signal
// engine, and DMs new hits to Telegram with KV de-duping so a persisting
// condition doesn't re-alert all day.

import { readWatchlist } from './notion.js';
import { PRIORITY, dte, deriveIndicators, buildSignals } from '../src/lib/signalEngine.js';
import { parsePositions, parseCriteria } from '../src/lib/utils.js';
import { sendTelegram, formatAlert } from './telegram.js';
import { isMarketOpen, etDateString } from './marketHours.js';

const TRADIER_ORIGIN = 'https://api.tradier.com';
const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';

// A signal that fires and gets dismissed still shouldn't re-alert same-day —
// a few days of headroom past the daily de-dupe window is plenty; KV just
// needs the key gone well before it could collide with a future date.
const DEDUPE_TTL_SECONDS     = 3 * 24 * 60 * 60;
const SELF_ALERT_TTL_SECONDS = 24 * 60 * 60;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sheet: positions + criteria (Notion owns the watchlist; the Sheet owns
// held lots and the screener's saved thresholds) ────────────────────────────
async function fetchSheetData(env) {
  if (!env.SHEET_URL) throw new Error('SHEET_URL secret is not set on the worker');
  const url = `${env.SHEET_URL}?secret=${encodeURIComponent(env.APP_SECRET || '')}&action=read`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`sheet read HTTP ${r.status}`);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`sheet read: non-JSON response: ${text.slice(0, 120)}`); }
  if (data.error) throw new Error(data.error);
  return {
    positions: Array.isArray(data.positions) ? parsePositions(data.positions) : [],
    criteria:  parseCriteria(data.criteria && typeof data.criteria === 'object' ? data.criteria : {}),
  };
}

// ── Daily OHLC history: Tradier primary, Yahoo fallback — same shape and
// fallback order as src/lib/indicators.js, just fetched directly since the
// Worker isn't subject to the browser CORS restrictions that route exists for.
async function fetchHistoryTradier(env, ticker) {
  if (!env.TRADIER_TOKEN) return null;
  const start = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
  const end   = new Date().toISOString().slice(0, 10);
  const url = `${TRADIER_ORIGIN}/v1/markets/history?symbol=${ticker}&interval=daily&start=${start}&end=${end}&session_filter=all`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.TRADIER_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const rawDays = data?.history?.day;
  if (!rawDays) return null;
  const days = Array.isArray(rawDays) ? rawDays : [rawDays];

  const closes = [], highs = [], lows = [], dates = [];
  for (const d of days) {
    if (d.close == null || d.high == null || d.low == null || d.close === 0) continue;
    closes.push(d.close); highs.push(d.high); lows.push(d.low); dates.push(d.date);
  }
  return closes.length >= 20 ? { closes, highs, lows, dates } : null;
}

async function fetchHistoryYahoo(ticker) {
  const url = `${YAHOO_ORIGIN}/v8/finance/chart/${ticker}?interval=1d&range=2y`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': 'https://finance.yahoo.com/',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const histData = await r.json();
  const result = histData?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp;
  const adjCloses  = result.indicators.adjclose?.[0]?.adjclose;
  const rawCloses  = result.indicators.quote[0].close;
  const rawHighs   = result.indicators.quote[0].high;
  const rawLows    = result.indicators.quote[0].low;
  if (!timestamps?.length || !adjCloses?.length || !rawCloses?.length) return null;

  const closes = [], highs = [], lows = [], dates = [];
  for (let i = 0; i < timestamps.length; i++) {
    const adj = adjCloses[i], raw = rawCloses[i];
    if (adj == null || raw == null || raw === 0 || rawHighs[i] == null || rawLows[i] == null) continue;
    const ratio = adj / raw;
    closes.push(adj); highs.push(rawHighs[i] * ratio); lows.push(rawLows[i] * ratio);
    dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
  }
  return closes.length >= 20 ? { closes, highs, lows, dates } : null;
}

async function fetchQuote(env, ticker) {
  if (!env.TRADIER_TOKEN) return null;
  try {
    const url = `${TRADIER_ORIGIN}/v1/markets/quotes?symbols=${ticker}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${env.TRADIER_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const qd = await r.json();
    const q = qd?.quotes?.quote;
    const quote = Array.isArray(q) ? q.find(x => x.symbol === ticker) : q;
    if (quote?.last && quote.last > 0) {
      return { price: quote.last, prevclose: quote.prevclose > 0 ? quote.prevclose : null };
    }
  } catch (_) { /* fall back to last adj close */ }
  return null;
}

async function fetchQ(env, ticker, maPeriod) {
  let hist = null;
  try { hist = await fetchHistoryTradier(env, ticker); } catch (_) { /* fall through to Yahoo */ }
  if (!hist) {
    try { hist = await fetchHistoryYahoo(ticker); } catch (_) { /* both failed */ }
  }
  if (!hist) return null;

  const { closes, highs, lows, dates } = hist;
  let price = closes[closes.length - 1];
  let chg1d = closes.length >= 2 ? ((price - closes[closes.length - 2]) / closes[closes.length - 2] * 100) : null;

  const quote = await fetchQuote(env, ticker);
  if (quote) {
    price = quote.price;
    if (quote.prevclose) chg1d = (price - quote.prevclose) / quote.prevclose * 100;
  }

  return deriveIndicators({ closes, highs, lows, dates }, price, chg1d, maPeriod);
}

// ── Best strike lookup — mirrors src/lib/optionPrice.js's fetchBestStrike,
// with a direct Tradier call (Worker secret) instead of the browser's
// tradierRequest(). Failures degrade to the generic delta/DTE-range suggestion
// buildSignals already falls back to when strikeMap has no entry.
async function fetchBestStrike(env, ticker, optionType, deltaMin, deltaMax, dteMin, dteMax) {
  if (!env.TRADIER_TOKEN) return null;
  try {
    const expUrl = `${TRADIER_ORIGIN}/v1/markets/options/expirations?symbol=${ticker}&includeAllRoots=true&strikes=false`;
    const expRes = await fetch(expUrl, {
      headers: { Authorization: `Bearer ${env.TRADIER_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!expRes.ok) return null;
    const expData = await expRes.json();
    const rawDates = expData?.expirations?.date;
    if (!rawDates) return null;
    const dateArr = Array.isArray(rawDates) ? rawDates : [rawDates];

    const dteMid   = (dteMin + dteMax) / 2;
    const allDated = dateArr.map(d => ({ date: d, dte: dte(d) })).filter(d => d.dte !== null && d.dte > 0);
    if (!allDated.length) return null;
    const inRange = allDated.filter(d => d.dte >= dteMin && d.dte <= dteMax);
    const pool    = inRange.length ? inRange : allDated;
    const target  = pool.reduce((best, d) => Math.abs(d.dte - dteMid) < Math.abs(best.dte - dteMid) ? d : best);

    const chainUrl = `${TRADIER_ORIGIN}/v1/markets/options/chains?symbol=${ticker}&expiration=${target.date}&greeks=true`;
    const chainRes = await fetch(chainUrl, {
      headers: { Authorization: `Bearer ${env.TRADIER_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!chainRes.ok) return null;
    const chainData = await chainRes.json();
    const rawOpts = chainData?.options?.option;
    if (!rawOpts) return null;
    const contracts = (Array.isArray(rawOpts) ? rawOpts : [rawOpts])
      .filter(o => o.option_type === optionType && o.greeks?.delta != null);
    if (!contracts.length) return null;

    const deltaMidD    = (deltaMin + deltaMax) / 2 / 100;
    const targetDelta  = optionType === 'put' ? -deltaMidD : deltaMidD;
    const loDecimal    = optionType === 'put' ? -(deltaMax / 100) : (deltaMin / 100);
    const hiDecimal    = optionType === 'put' ? -(deltaMin / 100) : (deltaMax / 100);
    const deltaInRange = contracts.filter(o => o.greeks.delta >= loDecimal && o.greeks.delta <= hiDecimal);
    const deltaPool    = deltaInRange.length ? deltaInRange : contracts;
    const best = deltaPool.reduce((b, o) =>
      Math.abs(o.greeks.delta - targetDelta) < Math.abs(b.greeks.delta - targetDelta) ? o : b);

    return { strike: best.strike, expiry: target.date, dte: target.dte, delta: best.greeks.delta };
  } catch (_) {
    return null;
  }
}

async function selfAlertOnce(env, message, now) {
  const key = `self-alert|${etDateString(now)}`;
  if (env.ALERTS_KV && await env.ALERTS_KV.get(key)) return;
  try {
    await sendTelegram(env, `⚠️ Wheel scan\n${message}`);
  } catch (e) {
    console.error('[scan] self-alert delivery failed:', e?.message || e);
    return; // don't mark as sent if we couldn't even deliver the self-alert
  }
  if (env.ALERTS_KV) await env.ALERTS_KV.put(key, '1', { expirationTtl: SELF_ALERT_TTL_SECONDS });
}

// `now` is an injectable clock — worker.js's scheduled() calls this with no
// second argument (real time); tests pass a fixed Date for determinism.
export async function runScan(env, now = new Date()) {
  if (!isMarketOpen(now)) return;

  try {
    const watchlist = await readWatchlist(env);
    const { positions, criteria } = await fetchSheetData(env);

    const priorityTickers = watchlist.filter(w => w.diveIn === PRIORITY).map(w => w.ticker);
    const heldTickers = positions
      .filter(p => (p.type === 'shares' || p.type === 'short_put' || p.type === 'short_call') && !p.linkedId)
      .map(p => p.ticker);
    const tickers = [...new Set([...priorityTickers, ...heldTickers])];

    if (!tickers.length) return; // nothing flagged and nothing held → clean no-op

    const qmap = {};
    let gotAny = false;
    for (const t of tickers) {
      try { qmap[t] = await fetchQ(env, t, criteria.ma); }
      catch (e) { console.error(`[scan] ${t} fetch failed, skipping:`, e?.message || e); qmap[t] = null; }
      if (qmap[t]) gotAny = true;
      await sleep(350); // Tradier throttle — matches useScreener.js's pacing
    }

    if (!gotAny) {
      await selfAlertOnce(env, 'Every ticker fetch failed this run — Yahoo (and Tradier, if configured) may be unreachable, or TRADIER_TOKEN may have expired.', now);
      return;
    }

    // Live strike lookups, mirroring buildSignals' own pass conditions so we
    // only spend Tradier calls on tickers that will actually produce a card.
    const strikeMap = {};
    for (const w of watchlist) {
      if (w.diveIn !== PRIORITY) continue;
      const q = qmap[w.ticker];
      if (!q || q.dropPct == null || q.dropPct < criteria.dropPct) continue;
      const hasOpt = positions.some(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
      if (hasOpt) continue;
      const best = await fetchBestStrike(env, w.ticker, 'put', criteria.deltaMin, criteria.deltaMax, criteria.dteMin, criteria.dteMax);
      if (best) strikeMap[`${w.ticker}:put`] = best;
      await sleep(450);
    }
    for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= 100)) {
      const q = qmap[pos.ticker];
      if (!q || q.rallyPct == null || q.rallyPct < criteria.ccRallyPct) continue;
      const hasCall = positions.some(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
      if (hasCall) continue;
      const best = await fetchBestStrike(env, pos.ticker, 'call', criteria.ccDeltaMin, criteria.ccDeltaMax, criteria.ccDteMin, criteria.ccDteMax);
      if (best) strikeMap[`${pos.ticker}:call`] = best;
      await sleep(450);
    }

    const sigs = buildSignals(watchlist, positions, criteria, qmap, strikeMap);

    for (const sig of sigs) {
      const key = `${sig.ticker}|${sig.type}|${etDateString(now)}`;
      if (env.ALERTS_KV && await env.ALERTS_KV.get(key)) continue; // already alerted today

      try {
        await sendTelegram(env, formatAlert(sig));
      } catch (e) {
        console.error(`[scan] telegram send failed for ${key}, will retry next run:`, e?.message || e);
        continue; // don't write the KV key — a failed send must not go silent forever
      }
      if (env.ALERTS_KV) await env.ALERTS_KV.put(key, '1', { expirationTtl: DEDUPE_TTL_SECONDS });
      await sleep(1200); // Telegram throttle — keep well under its rate limits
    }
  } catch (e) {
    console.error('[scan] run failed:', e?.message || e);
    await selfAlertOnce(env, `Scan crashed: ${e?.message || e}`, now);
  }
}
