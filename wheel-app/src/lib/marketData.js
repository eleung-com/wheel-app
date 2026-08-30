// Runtime-agnostic market-data layer: every Tradier/Yahoo request the app or the
// Worker makes, with the parsing and fallback rules written exactly once.
//
// This exists because the two runtimes each had their own copy — src/lib
// (indicators.js, optionPrice.js) for the browser, worker/scan.js for the cron —
// roughly 150 near-identical lines that had already drifted twice:
//
//   • fetchBestStrike returned `premium` in the browser and not in the Worker.
//   • fetchOptionPrice sent every put_spread to the CALL chain, so spread close
//     signals were computed off meaningless prices, and the Worker's separate
//     copy had to be fixed separately.
//
// The only thing that genuinely differs between runtimes is HOW a request is
// authorised and addressed: the browser goes through a Cloudflare Worker proxy
// with the key in a header, the Worker calls the APIs directly with a secret.
// That difference is the `transport`, and it is the whole of the difference.
//
// A transport is:
//   {
//     tradier(path, timeoutMs) -> Promise<Response|null>
//     yahoo(path,   timeoutMs) -> Promise<Response|null>
//   }
// Returning null means "this source isn't configured here" (no API key, no
// secret) — distinct from a thrown error or a non-ok Response, both of which
// mean "configured, but the call failed". Callers treat all three as no data.

import { deriveIndicators, dte } from './signalEngine.js';

const HISTORY_YEARS = 2;
const MIN_BARS      = 20;   // below this the indicators are not worth computing

const T_HISTORY_TRADIER = 10000;
const T_HISTORY_YAHOO   = 8000;
const T_QUOTE           = 5000;
const T_EXPIRATIONS     = 8000;
const T_CHAIN           = 10000;

/** Tradier returns a bare object rather than a 1-element array. Normalise. */
function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Mid of the book, falling back to last trade when there is no two-sided market. */
export function contractMid(o) {
  if (!o) return null;
  const bid = o.bid ?? null, ask = o.ask ?? null;
  if (bid !== null && ask !== null && bid > 0 && ask > 0) return (bid + ask) / 2;
  if (o.last && o.last > 0) return o.last;
  return null;
}

/** Closest listed strike to `want`, widening tolerance in steps. */
function findAtStrike(contracts, want) {
  return contracts.find(o => Math.abs(o.strike - want) < 0.01)
    || contracts.find(o => Math.abs(o.strike - want) <= 0.50)
    || contracts.find(o => Math.abs(o.strike - want) <= 1.00)
    || null;
}

/** 'put' for short puts and put credit spreads, 'call' for short calls. */
export function chainSideFor(type) {
  return (type === 'short_put' || type === 'put_spread') ? 'put' : 'call';
}

// ── Daily OHLC history ──────────────────────────────────────────────────────
// Tradier is primary: it is authenticated, with documented limits. Yahoo is the
// keyless fallback only — it 429s unauthenticated IPs aggressively, which is
// what broke production before the Worker proxy existed.

async function historyFromTradier(transport, ticker) {
  const start = new Date(Date.now() - HISTORY_YEARS * 365 * 86400000).toISOString().slice(0, 10);
  const end   = new Date().toISOString().slice(0, 10);
  const res = await transport.tradier(
    `/v1/markets/history?symbol=${ticker}&interval=daily&start=${start}&end=${end}&session_filter=all`,
    T_HISTORY_TRADIER,
  );
  if (!res || !res.ok) return null;
  const data = await res.json();

  const closes = [], highs = [], lows = [], dates = [];
  for (const d of asArray(data?.history?.day)) {
    if (d.close == null || d.high == null || d.low == null || d.close === 0) continue;
    closes.push(d.close); highs.push(d.high); lows.push(d.low); dates.push(d.date);
  }
  return closes.length >= MIN_BARS ? { closes, highs, lows, dates } : null;
}

async function historyFromYahoo(transport, ticker) {
  const res = await transport.yahoo(`/v8/finance/chart/${ticker}?interval=1d&range=${HISTORY_YEARS}y`, T_HISTORY_YAHOO);
  if (!res || !res.ok) return null;
  const result = (await res.json())?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp;
  const adjCloses  = result.indicators.adjclose?.[0]?.adjclose;
  const rawCloses  = result.indicators.quote[0].close;
  const rawHighs   = result.indicators.quote[0].high;
  const rawLows    = result.indicators.quote[0].low;
  if (!timestamps?.length || !adjCloses?.length || !rawCloses?.length) return null;

  // Highs and lows are scaled by the same adjclose/close ratio so splits and
  // dividends don't leave the bar's extremes on a different basis than its close.
  const closes = [], highs = [], lows = [], dates = [];
  for (let i = 0; i < timestamps.length; i++) {
    const adj = adjCloses[i], raw = rawCloses[i];
    if (adj == null || raw == null || raw === 0 || rawHighs[i] == null || rawLows[i] == null) continue;
    const ratio = adj / raw;
    closes.push(adj); highs.push(rawHighs[i] * ratio); lows.push(rawLows[i] * ratio);
    dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
  }
  return closes.length >= MIN_BARS ? { closes, highs, lows, dates } : null;
}

/** `{closes, highs, lows, dates}` from whichever source answers, else null. */
export async function fetchHistory(transport, ticker) {
  try {
    const t = await historyFromTradier(transport, ticker);
    if (t) return t;
  } catch (_) { /* fall through to Yahoo */ }
  try {
    return await historyFromYahoo(transport, ticker);
  } catch (_) {
    return null;
  }
}

/** Live last/prevclose, or null when unavailable — callers fall back to the last close. */
export async function fetchQuote(transport, ticker) {
  try {
    const res = await transport.tradier(`/v1/markets/quotes?symbols=${ticker}`, T_QUOTE);
    if (!res || !res.ok) return null;
    const q = (await res.json())?.quotes?.quote;
    const quote = Array.isArray(q) ? q.find(x => x.symbol === ticker) : q;
    if (quote?.last && quote.last > 0) {
      return { price: quote.last, prevclose: quote.prevclose > 0 ? quote.prevclose : null };
    }
  } catch (_) { /* fall back to last adj close */ }
  return null;
}

/** History + live quote → the derived-indicator bundle buildSignals reads. */
export async function fetchQ(transport, ticker, maPeriod = 200) {
  const hist = await fetchHistory(transport, ticker);
  if (!hist) return null;

  const { closes } = hist;
  let price = closes[closes.length - 1];
  let chg1d = closes.length >= 2
    ? ((price - closes[closes.length - 2]) / closes[closes.length - 2] * 100)
    : null;

  const quote = await fetchQuote(transport, ticker);
  if (quote) {
    price = quote.price;
    if (quote.prevclose) chg1d = (price - quote.prevclose) / quote.prevclose * 100;
  }

  return deriveIndicators(hist, price, chg1d, maPeriod);
}

// ── Option chains ───────────────────────────────────────────────────────────

/** Every contract for one expiry, one side. `greeks` costs nothing extra to ask for. */
async function fetchChain(transport, ticker, expiry, side, greeks) {
  const res = await transport.tradier(
    `/v1/markets/options/chains?symbol=${ticker}&expiration=${expiry}&greeks=${greeks ? 'true' : 'false'}`,
    T_CHAIN,
  );
  if (!res || !res.ok) return null;
  const contracts = asArray((await res.json())?.options?.option).filter(o => o.option_type === side);
  return contracts.length ? contracts : null;
}

/**
 * What an open position is worth right now.
 *
 * A put credit spread is priced as the NET of both legs off one chain, so the
 * result is directly comparable to the net credit stored in `prem`. If either
 * leg can't be priced this returns null rather than half a spread — a wrong
 * "percent captured" is worse than none.
 */
export async function fetchOptionPrice(transport, { ticker, type, strike, expiry, longStrike = null }) {
  if (!ticker || strike == null || !expiry) return null;
  try {
    const isSpread  = type === 'put_spread';
    const contracts = await fetchChain(transport, ticker, expiry, chainSideFor(type), false);
    if (!contracts) return null;

    const shortMid = contractMid(findAtStrike(contracts, strike));
    if (shortMid === null) return null;

    if (isSpread) {
      if (longStrike == null) return null;
      const longMid = contractMid(findAtStrike(contracts, longStrike));
      if (longMid === null) return null; // both legs or nothing
      return parseFloat((shortMid - longMid).toFixed(2));
    }
    return parseFloat(shortMid.toFixed(2));
  } catch (_) {
    return null;
  }
}

/**
 * The contract to suggest for a new entry: the expiry nearest the middle of the
 * target DTE range, then the strike nearest the middle of the target delta band.
 *
 * Tradier reports put deltas as negative; the criteria are positive whole
 * numbers (20 means 0.20), so the band is mirrored for puts.
 *
 * @returns { strike, expiry, dte, delta, premium } or null.
 */
export async function fetchBestStrike(transport, ticker, optionType, deltaMin, deltaMax, dteMin, dteMax) {
  try {
    const expRes = await transport.tradier(
      `/v1/markets/options/expirations?symbol=${ticker}&includeAllRoots=true&strikes=false`,
      T_EXPIRATIONS,
    );
    if (!expRes || !expRes.ok) return null;
    const dateArr = asArray((await expRes.json())?.expirations?.date);
    if (!dateArr.length) return null;

    const dteMid   = (dteMin + dteMax) / 2;
    const allDated = dateArr.map(d => ({ date: d, dte: dte(d) })).filter(d => d.dte !== null && d.dte > 0);
    if (!allDated.length) return null;
    // Prefer an expiry inside the range; if none is listed, take the closest.
    const inRange = allDated.filter(d => d.dte >= dteMin && d.dte <= dteMax);
    const pool    = inRange.length ? inRange : allDated;
    const target  = pool.reduce((best, d) => Math.abs(d.dte - dteMid) < Math.abs(best.dte - dteMid) ? d : best);

    const all = await fetchChain(transport, ticker, target.date, optionType, true);
    if (!all) return null;
    const contracts = all.filter(o => o.greeks?.delta != null);
    if (!contracts.length) return null;

    const deltaMidD    = (deltaMin + deltaMax) / 2 / 100;
    const targetDelta  = optionType === 'put' ? -deltaMidD : deltaMidD;
    const lo           = optionType === 'put' ? -(deltaMax / 100) : (deltaMin / 100);
    const hi           = optionType === 'put' ? -(deltaMin / 100) : (deltaMax / 100);
    const inBand       = contracts.filter(o => o.greeks.delta >= lo && o.greeks.delta <= hi);
    const deltaPool    = inBand.length ? inBand : contracts;

    const chosen = deltaPool.reduce((b, o) =>
      Math.abs(o.greeks.delta - targetDelta) < Math.abs(b.greeks.delta - targetDelta) ? o : b);

    const mid = contractMid(chosen);
    return {
      strike:  chosen.strike,
      expiry:  target.date,
      dte:     target.dte,
      delta:   chosen.greeks.delta,
      premium: mid === null ? null : parseFloat(mid.toFixed(2)),
    };
  } catch (_) {
    return null;
  }
}
