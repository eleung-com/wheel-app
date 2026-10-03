// Runtime-agnostic market-data layer: every Yahoo/CBOE request the app or the
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
// Sources (Tradier removed 10-02-2026 — account closed):
//   • Yahoo  — daily history + latest price (chart endpoint).
//   • CBOE   — option chains with delta, from the exchange's free delayed-quote
//              feed (cdn.cboe.com, ~15 min delayed, no key). One JSON file per
//              underlying holds every expiry, so it is fetched once per ticker
//              and cached briefly.
//
// The only thing that differs between runtimes is HOW a request is addressed:
// the browser goes through the Cloudflare Worker (no CORS on either source),
// the Worker calls them directly. That difference is the `transport`:
//   {
//     yahoo(path, timeoutMs) -> Promise<Response|null>   path under query1.finance.yahoo.com
//     cboe(path,  timeoutMs) -> Promise<Response|null>   path under cdn.cboe.com/api/global/delayed_quotes
//   }
// A thrown error, a null, or a non-ok Response all mean "no data" to callers.

import { deriveIndicators, dte } from './signalEngine.js';

const HISTORY_YEARS = 2;
const MIN_BARS      = 20;   // below this the indicators are not worth computing

const T_HISTORY_YAHOO = 8000;
const T_CHAIN         = 15000;
const CHAIN_TTL_MS    = 5 * 60 * 1000;

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

// ── Daily OHLC history + latest price (Yahoo) ───────────────────────────────

// Yahoo lists indexes under caret symbols, not their option tickers. Each entry
// is tried in order; `scale` converts a stand-in (XSP is exactly SPX ÷ 10, so
// if Yahoo has no ^XSP series the S&P 500 index is used, divided by 10).
const YAHOO_INDEX = {
  XSP: [{ symbol: '^XSP', scale: 1 }, { symbol: '^GSPC', scale: 0.1 }],
  SPX: [{ symbol: '^GSPC', scale: 1 }],
  VIX: [{ symbol: '^VIX', scale: 1 }],
  NDX: [{ symbol: '^NDX', scale: 1 }],
  RUT: [{ symbol: '^RUT', scale: 1 }],
  DJX: [{ symbol: '^DJI', scale: 0.01 }],
};
export function yahooCandidates(ticker) {
  const t = String(ticker || '').toUpperCase();
  return YAHOO_INDEX[t] || [{ symbol: t, scale: 1 }];
}

async function historyFromYahoo(transport, ticker, scale = 1) {
  const res = await transport.yahoo(`/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${HISTORY_YEARS}y`, T_HISTORY_YAHOO);
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
    closes.push(adj * scale); highs.push(rawHighs[i] * ratio * scale); lows.push(rawLows[i] * ratio * scale);
    dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
  }
  if (closes.length < MIN_BARS) return null;

  // Latest trade price, and the raw close of the last session BEFORE it, so the
  // day change is right whether or not today's bar is already in the series.
  const meta = result.meta || {};
  let live = null;
  if (meta.regularMarketPrice > 0) {
    const liveDay = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null;
    let prevclose = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const day = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      if (rawCloses[i] != null && rawCloses[i] > 0 && (!liveDay || day < liveDay)) { prevclose = rawCloses[i] * scale; break; }
    }
    live = { price: meta.regularMarketPrice * scale, prevclose };
  }
  return { closes, highs, lows, dates, live };
}

/** `{closes, highs, lows, dates, live}` from Yahoo, else null. */
export async function fetchHistory(transport, ticker) {
  for (const { symbol, scale } of yahooCandidates(ticker)) {
    try {
      const h = await historyFromYahoo(transport, symbol, scale);
      if (h) return h;
    } catch (_) { /* try the next candidate */ }
  }
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

  if (hist.live) {
    price = hist.live.price;
    if (hist.live.prevclose) chg1d = (price - hist.live.prevclose) / hist.live.prevclose * 100;
  }

  return deriveIndicators(hist, price, chg1d, maPeriod);
}

// ── Option chains (CBOE delayed quotes) ─────────────────────────────────────

// Cash-settled indexes live under an underscore-prefixed file on CBOE.
const CBOE_INDEXES = new Set(['SPX', 'XSP', 'VIX', 'NDX', 'RUT', 'DJX', 'OEX', 'XEO', 'MRUT']);
export function cboeSymbol(ticker) {
  const t = String(ticker || '').toUpperCase();
  return CBOE_INDEXES.has(t) ? `_${t}` : t;
}

/**
 * OCC option symbol → parts. ROOT + YYMMDD + C|P + strike×1000 (8 digits),
 * e.g. AAPL261016P00250000 → AAPL, 2026-10-16, put, 250.
 */
export function parseOcc(sym) {
  const m = /^([A-Z0-9.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(sym || '').trim());
  if (!m) return null;
  return {
    root: m[1],
    expiry: `20${m[2]}-${m[3]}-${m[4]}`,
    side: m[5] === 'P' ? 'put' : 'call',
    strike: Number(m[6]) / 1000,
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * CBOE body → contracts in the shape the rest of this file uses:
 * { expiry, option_type, strike, bid, ask, last, greeks: { delta }, iv, openInterest }.
 * Only the underlying's own roots are kept (SPX also lists SPXW weeklies);
 * adjusted roots after splits/mergers (e.g. AAPL1) are dropped. Delta is
 * normalised to negative for puts, positive for calls, whatever the feed sends.
 */
export function parseCboeChain(body, ticker) {
  const base = String(ticker || '').toUpperCase();
  const roots = new Set([base, `${base}W`]);
  const out = [];
  for (const o of body?.data?.options || []) {
    const p = parseOcc(o.option);
    if (!p || !roots.has(p.root)) continue;
    const d = num(o.delta);
    out.push({
      expiry: p.expiry,
      option_type: p.side,
      strike: p.strike,
      bid: num(o.bid),
      ask: num(o.ask),
      last: num(o.last_trade_price),
      greeks: { delta: d === null || d === 0 ? null : (p.side === 'put' ? -Math.abs(d) : Math.abs(d)) },
      iv: num(o.iv),
      openInterest: num(o.open_interest),
    });
  }
  return out;
}

// One CBOE file holds every expiry, and a single scan asks for the same ticker
// more than once (pricing a position, then suggesting the next contract), so
// keep the parsed chain for a few minutes. In-flight requests are shared too.
const chainCache = new Map(); // ticker → { at, promise }

export function clearChainCache() { chainCache.clear(); }

async function fetchFullChain(transport, ticker) {
  const key = String(ticker || '').toUpperCase();
  const hit = chainCache.get(key);
  if (hit && Date.now() - hit.at < CHAIN_TTL_MS) return hit.promise;
  const promise = (async () => {
    const res = await transport.cboe(`/options/${cboeSymbol(key)}.json`, T_CHAIN);
    if (!res || !res.ok) return null;
    const contracts = parseCboeChain(await res.json(), key);
    return contracts.length ? contracts : null;
  })().catch(() => null);
  chainCache.set(key, { at: Date.now(), promise });
  const result = await promise;
  if (!result) chainCache.delete(key); // don't cache a failure
  return result;
}

/** Every contract for one expiry, one side. */
async function fetchChain(transport, ticker, expiry, side) {
  const all = await fetchFullChain(transport, ticker);
  if (!all) return null;
  const contracts = all.filter(o => o.expiry === expiry && o.option_type === side);
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
    const contracts = await fetchChain(transport, ticker, expiry, chainSideFor(type));
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
 * Put deltas are negative (parseCboeChain guarantees it); the criteria are
 * positive whole numbers (20 means 0.20), so the band is mirrored for puts.
 *
 * @returns { strike, expiry, dte, delta, premium } or null.
 */
export async function fetchBestStrike(transport, ticker, optionType, deltaMin, deltaMax, dteMin, dteMax) {
  try {
    const full = await fetchFullChain(transport, ticker);
    if (!full) return null;
    const dateArr = [...new Set(full.filter(o => o.option_type === optionType).map(o => o.expiry))].sort();
    if (!dateArr.length) return null;

    const dteMid   = (dteMin + dteMax) / 2;
    const allDated = dateArr.map(d => ({ date: d, dte: dte(d) })).filter(d => d.dte !== null && d.dte > 0);
    if (!allDated.length) return null;
    // Prefer an expiry inside the range; if none is listed, take the closest.
    const inRange = allDated.filter(d => d.dte >= dteMin && d.dte <= dteMax);
    const pool    = inRange.length ? inRange : allDated;
    const target  = pool.reduce((best, d) => Math.abs(d.dte - dteMid) < Math.abs(best.dte - dteMid) ? d : best);

    const all = await fetchChain(transport, ticker, target.date, optionType);
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
