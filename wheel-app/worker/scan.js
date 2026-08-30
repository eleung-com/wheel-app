// Unattended signal scan — the server-side mirror of useScreener.js. Runs on
// the Cron Trigger (see worker.js's scheduled() and wrangler.toml), pulls the
// same watchlist/positions/criteria the app uses, re-runs the shared signal
// engine, and DMs new hits to Telegram with KV de-duping so a persisting
// condition doesn't re-alert all day.

import { readWatchlist } from './notion.js';
import { PRIORITY, dte, deriveIndicators, buildSignals, cspEntryOk, ccEntryOk, OPEN_OPTION_TYPES } from '../src/lib/signalEngine.js';
import { parsePositions, parseCriteria, CLOSE_TYPES, isPriceableOption } from '../src/lib/utils.js';
import { sendTelegram, formatAlert, formatDteAlert } from './telegram.js';
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

    // Premium is computed here purely to keep this return shape identical to
    // the browser's fetchBestStrike (src/lib/optionPrice.js). Nothing reads it
    // yet — but a shape that differs between the two runtimes is a trap set for
    // whoever adds the first reader, and the mid is free once the chain is in hand.
    const bid = best.bid ?? null, ask = best.ask ?? null;
    const premium = (bid !== null && ask !== null && bid > 0 && ask > 0)
      ? parseFloat(((bid + ask) / 2).toFixed(2))
      : (best.last > 0 ? parseFloat(best.last.toFixed(2)) : null);

    return { strike: best.strike, expiry: target.date, dte: target.dte, delta: best.greeks.delta, premium };
  } catch (_) {
    return null;
  }
}

// ── Live option premium ──────────────────────────────────────────────────────
// The close signal is "you have captured X% of the premium, take it off". X is
// computed from what the contract is worth NOW against what it was sold for.
// The browser fetches that live on every screener run; this scan never did, so
// it evaluated against `curPrem` — whatever was last hand-typed into the Sheet.
// A close alert built on a stale number is worse than no alert: it tells you to
// buy back at a price that is not the price.
//
// Mirrors src/lib/optionPrice.js's fetchOptionPrice, with a direct Tradier call
// instead of the browser's tradierRequest(). The duplication is deliberate for
// now and is what Phase 6 consolidates.
//
// Returns null when the position cannot be priced — the caller suppresses the
// close alert in that case rather than falling back to the Sheet.
async function fetchLivePremium(env, pos) {
  if (!env.TRADIER_TOKEN) return null;
  try {
    const isSpread   = pos.type === 'put_spread';
    const optionType = (pos.type === 'short_put' || isSpread) ? 'put' : 'call';

    const url = `${TRADIER_ORIGIN}/v1/markets/options/chains?symbol=${pos.ticker}&expiration=${pos.expiry}&greeks=false`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${env.TRADIER_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data?.options?.option;
    if (!raw) return null;

    const contracts = (Array.isArray(raw) ? raw : [raw]).filter(o => o.option_type === optionType);

    const findAt = (want) =>
      contracts.find(o => Math.abs(o.strike - want) < 0.01)
      || contracts.find(o => Math.abs(o.strike - want) <= 0.50)
      || contracts.find(o => Math.abs(o.strike - want) <= 1.00)
      || null;

    const midOf = (o) => {
      if (!o) return null;
      const bid = o.bid ?? null, ask = o.ask ?? null;
      if (bid !== null && ask !== null && bid > 0 && ask > 0) return (bid + ask) / 2;
      if (o.last && o.last > 0) return o.last;
      return null;
    };

    const shortMid = midOf(findAt(pos.strike));
    if (shortMid === null) return null;

    if (isSpread) {
      if (pos.longStrike == null) return null;
      const longMid = midOf(findAt(pos.longStrike));
      if (longMid === null) return null; // both legs or nothing
      return parseFloat((shortMid - longMid).toFixed(2));
    }
    return parseFloat(shortMid.toFixed(2));
  } catch (_) {
    return null;
  }
}

/**
 * Price every open contract and stamp `_liveCurPrem` on it, exactly as the
 * browser's screener does before calling buildSignals.
 *
 * @returns { priced, unpricedIds } — `unpricedIds` are the positions whose close
 * signal must be suppressed, because the only premium available for them is the
 * Sheet's possibly-stale one.
 */
async function withLivePremiums(env, positions) {
  const open = positions.filter(isPriceableOption);
  if (!open.length) return { priced: positions, unpricedIds: new Set() };

  const live = new Map();
  const unpricedIds = new Set();
  for (const pos of open) {
    const premium = await fetchLivePremium(env, pos);
    if (premium === null) unpricedIds.add(pos.id);
    else live.set(pos.id, premium);
    await sleep(450); // same pacing as the browser's option loop
  }

  const priced = positions.map(p =>
    live.has(p.id) ? { ...p, _liveCurPrem: live.get(p.id) } : p);
  return { priced, unpricedIds };
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

// ── 21-DTE management nudge ──────────────────────────────────────────────────
// Wheel convention says decide (roll / close / take assignment) around 21 DTE,
// where gamma risk starts climbing fast. This pass is deliberately *not* part of
// buildSignals: nothing has to have moved in the market for it to fire, it's
// purely the calendar, and it stays out of the dashboard's signal cards.

/** Still-open option row: has a contract, hasn't been closed out or rolled. */
function isOpenOption(p) {
  return p.strike != null
    && !!p.expiry
    && p.type !== 'shares'
    && !p.linkedId            // set on the opening row once it's been closed
    && !CLOSE_TYPES.has(p.type); // the close row itself
}

/**
 * One Telegram nudge per open option per ET day while it sits in the management
 * window. De-duped on position id (not ticker) so two contracts on the same
 * underlying each get their own message. Runs before the market-data pass and in
 * its own try/catch — a Tradier/Yahoo outage must not swallow a calendar alert.
 */
export async function runDteNudges(env, positions, criteria, now) {
  const threshold = criteria.manageDte;
  if (!threshold || threshold < 1) return;

  for (const pos of positions.filter(isOpenOption)) {
    const days = dte(pos.expiry);
    // NOTE the `<= 1`. The shared dte() counts expiry day itself as 1 — an
    // option expiring today reads "1 DTE" everywhere in the dashboard — so
    // "silent on expiry day, and after it" is days <= 1, not days < 1. The
    // number in the message is deliberately the same one the dashboard shows.
    if (days == null || days <= 1 || days > threshold) continue;

    const key = `manage-dte|${pos.id}|${etDateString(now)}`;
    if (env.ALERTS_KV && await env.ALERTS_KV.get(key)) continue; // already nudged today

    try {
      await sendTelegram(env, formatDteAlert(pos, days, threshold));
    } catch (e) {
      console.error(`[scan] dte nudge send failed for ${key}, will retry next run:`, e?.message || e);
      continue; // no KV write — a failed send must not go silent for the day
    }
    if (env.ALERTS_KV) await env.ALERTS_KV.put(key, '1', { expirationTtl: DEDUPE_TTL_SECONDS });
    await sleep(1200); // Telegram throttle, same pacing as the signal loop
  }
}

// `now` is an injectable clock — worker.js's scheduled() calls this with no
// second argument (real time); tests pass a fixed Date for determinism.
export async function runScan(env, now = new Date()) {
  if (!isMarketOpen(now)) return;

  try {
    const watchlist = await readWatchlist(env);
    const { positions, criteria } = await fetchSheetData(env);

    // Calendar-only, so it runs before (and independently of) the market-data
    // pass — and its own failure can never take the signal scan down with it.
    try {
      await runDteNudges(env, positions, criteria, now);
    } catch (e) {
      console.error('[scan] dte nudge pass failed:', e?.message || e);
    }

    const priorityTickers = watchlist.filter(w => w.diveIn === PRIORITY).map(w => w.ticker);
    const heldTickers = positions
      .filter(p => (p.type === 'shares' || OPEN_OPTION_TYPES.has(p.type)) && !p.linkedId)
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

    // Live strike lookups, gated on the same cspEntryOk/ccEntryOk predicates
    // buildSignals decides with — so a Telegram alert can never be built for a
    // ticker whose strike this loop skipped. It used to filter on the retired
    // 5-day-drop rule, which is why alerts mostly carried the generic
    // delta/DTE line instead of a concrete contract.
    const strikeMap = {};
    for (const w of watchlist) {
      if (w.diveIn !== PRIORITY) continue;
      if (strikeMap[`${w.ticker}:put`]) continue;
      if (!cspEntryOk(qmap[w.ticker], criteria)) continue;
      const hasOpt = positions.some(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
      if (hasOpt) continue;
      const best = await fetchBestStrike(env, w.ticker, 'put', criteria.deltaMin, criteria.deltaMax, criteria.dteMin, criteria.dteMax);
      if (best) strikeMap[`${w.ticker}:put`] = best;
      await sleep(450);
    }
    for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= 100)) {
      if (strikeMap[`${pos.ticker}:call`]) continue;
      if (!ccEntryOk(qmap[pos.ticker], criteria)) continue;
      const hasCall = positions.some(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
      if (hasCall) continue;
      const best = await fetchBestStrike(env, pos.ticker, 'call', criteria.ccDeltaMin, criteria.ccDeltaMax, criteria.ccDteMin, criteria.ccDteMax);
      if (best) strikeMap[`${pos.ticker}:call`] = best;
      await sleep(450);
    }

    // Price open contracts before the signal pass — the close rule is meaningless
    // without a current premium, and the Sheet's copy is only as fresh as the
    // last time it was typed in.
    let pricedPositions = positions;
    let unpricedIds = new Set();
    try {
      ({ priced: pricedPositions, unpricedIds } = await withLivePremiums(env, positions));
    } catch (e) {
      // Pricing is an enhancement to the close rule, not a prerequisite for the
      // roll/max-loss alerts, which key off the stock price alone. Treat a total
      // failure as "nothing could be priced" so those still go out.
      console.error('[scan] live premium pass failed:', e?.message || e);
      unpricedIds = new Set(positions.filter(isPriceableOption).map(p => p.id));
    }

    const sigs = buildSignals(watchlist, pricedPositions, criteria, qmap, strikeMap)
      // A close alert says "buy it back at this price". Sending one computed off
      // a stale Sheet value is worse than staying quiet — the roll and max-loss
      // alerts for the same position are unaffected, since those read the stock.
      .filter(sig => !(sig.type === 'close' && unpricedIds.has(Number(sig.id.slice('close-'.length)))));

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
