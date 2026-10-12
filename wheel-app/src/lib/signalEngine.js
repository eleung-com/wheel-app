// Runtime-agnostic signal engine — no fetch, no browser/DOM globals. This is the
// single source of truth for the wheel signal logic: both the browser
// (useScreener.js, via indicators.js) and the Cloudflare Worker's unattended
// scan (worker/scan.js) import from here so the two never drift apart.

// Explicit .js extension: this module is imported by worker/scan.js, which runs
// under plain Node/Cloudflare ESM where extensionless specifiers do not resolve.
// Vite would happily resolve it, so the browser build hides the breakage.
import {
  rsiWilder, stochastic, turningUpFrom, rollingOverFrom, rsiInBand,
} from './oscillators.js';
import { fmvOf, fmvStale, vsMidPct } from './fairValue.js';

// Part 3E: fair value on trade cards. Shared by CSP and LEAPS cards.
function fmvFields(row, price, nowMs) {
  const fmv = row ? fmvOf(row) : null;
  if (!fmv) return { fmv: null, fmvPct: null, fmvStale: false };
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return { fmv, fmvPct: vsMidPct(price, fmv), fmvStale: fmvStale(fmv, today) };
}

/** Warning pill: the put strike sits above the evaluator's buy-below price (FMV Low). */
export function strikeOverLowPill(strike, fmv) {
  if (strike == null || !fmv || fmv.low == null || !(strike > fmv.low)) return null;
  return { l: `Strike $${strike} > buy-below $${fmv.low}`, ok: false, warn: true };
}

// The Dive-In select value in Notion that promotes a watchlist row into the
// signal engine. Rows reading anything else are never scanned for entries.
export const PRIORITY = '🔥 Priority';

const RSI_PERIOD = 14;

// Index / ETF symbols: no earnings, so the earnings gate never applies to them.
// Shared with worker/earnings.js so both agree on what "has no earnings" means.
export const NO_EARNINGS = new Set(['XSP', 'SPX', 'NDX', 'RUT', 'DJX', 'VIX', 'SPY', 'QQQ', 'IWM', 'DIA', 'SMH']);

// Fewest weekly bars before weekly RSI(14) is worth trusting. A0 check (10-04):
// 2 yrs of daily bars → ~105 weeks gives the same weekly RSI as 5 yrs.
const MIN_WEEKS = RSI_PERIOD + 1;

/**
 * Daily closes → one close per calendar week (Mon–Sun), the last close in it.
 * `dates` are 'YYYY-MM-DD' aligned to `closes`. The current, unfinished week
 * counts with its latest close — the same thing TradingView's weekly chart shows.
 */
export function weeklyCloses(closes, dates) {
  if (!Array.isArray(dates) || dates.length !== closes.length) return [];
  const out = [];
  let lastKey = null;
  for (let i = 0; i < closes.length; i++) {
    const d = new Date(String(dates[i]).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d)) continue;
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    const key = d.toISOString().slice(0, 10);
    if (key === lastKey) out[out.length - 1] = closes[i];
    else { out.push(closes[i]); lastKey = key; }
  }
  return out;
}

// Option rows the roll/close pass evaluates. `put_spread` was added to the app
// in 414ce3d but never reached the signal engine, so a breached spread produced
// no card and no alert — the only thing that ever fired on one was the calendar
// DTE nudge, which uses a different filter in worker/scan.js.
export const OPEN_OPTION_TYPES = new Set(['short_put', 'short_call', 'put_spread']);

export function dte(expiry) {
  if (!expiry) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((new Date(expiry + 'T12:00:00') - now) / 86400000);
}

// ── ATR-14 using Wilder's RMA — matches TradingView ta.atr() exactly ─────────
// True Range is the widest of: today's range, or today's high/low measured
// against yesterday's close (which captures overnight gaps that a plain
// high−low misses). RMA smoothing uses a 1/length multiplier rather than the
// EMA's 2/(length+1), and seeds on a plain SMA of the first `length` TRs —
// exactly what Pine Script's ta.rma() does.
export function calcATR(highs, lows, closes, length = 14) {
  const n = closes.length;
  if (n < length + 1) return null;

  const tr = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }

  let atr = tr.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < tr.length; i++) {
    atr = (atr * (length - 1) + tr[i]) / length;
  }
  return atr > 0 ? atr : null;
}

/**
 * Pure derived-indicator math shared by browser and Worker: both already have
 * `{closes, highs, lows, dates}` daily history plus a live price/chg1d from
 * their own fetch path (direct for the Worker, the Worker proxy for the
 * browser) — this just turns those arrays into the fields buildSignals reads.
 */
export function deriveIndicators({ closes, highs, lows, dates = [] }, price, chg1d, maPeriod = 200) {
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

  // ── Weekly extremes — the basis for both entry signals ───────────────────
  // "Past week" means the last 5 trading sessions, not 7 calendar days, so a
  // holiday-shortened week still compares five real bars. The window includes
  // today, so an intraday high set this morning counts as the week high.
  const WEEK_BARS = 5;
  let dropPct = null, rallyPct = null, weekHigh = null, weekLow = null;
  if (closes.length >= WEEK_BARS) {
    weekHigh = Math.max(...highs.slice(-WEEK_BARS));
    weekLow  = Math.min(...lows.slice(-WEEK_BARS));
    if (weekHigh > 0) dropPct  = (weekHigh - price) / weekHigh * 100;
    if (weekLow  > 0) rallyPct = (price - weekLow)  / weekLow  * 100;
  }

  // How far the drop is in units of the stock's own average daily range.
  // Displayed rather than gated on — it ranks which names deserve a manual
  // RSI/Stochastic check first.
  const atr     = calcATR(highs, lows, closes);
  const atrDrop = (atr && weekHigh !== null) ? (weekHigh - price) / atr : null;

  // HV30 → IVR estimate. NOTE: this is a realized-volatility estimate, not a
  // real IV Rank (no options-market data goes into it) — always label it
  // "HV30 est" wherever it's shown, per the Worker's Telegram messages too.
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

  // ── RSI + Stochastic ──────────────────────────────────────────────────────
  // Computed from the daily bars already fetched — no extra request. These now
  // gate entry signals; the drop and ATR figures above are carried for display
  // only. The previous %K rides along because the triggers are crossings
  // ("turning up from below 20"), which need two bars to evaluate.
  const rsiSeries  = rsiWilder(closes, RSI_PERIOD);

  // Weekly RSI(14) — the CSP trend floor (Part 2A). Built from the same daily
  // bars, so no extra request. null when there isn't enough history.
  const wk = weeklyCloses(closes, dates);
  const rsiWeekly = wk.length >= MIN_WEEKS ? (rsiWilder(wk, RSI_PERIOD).at(-1) ?? null) : null;
  const { k: kSeries, d: dSeries } = stochastic(highs, lows, closes);
  const last = closes.length - 1;

  return {
    price, chg1d, aboveMa, ivrEst, hv30,
    dropPct, rallyPct, weekHigh, weekLow, atr, atrDrop,
    rsi:        rsiSeries[last] ?? null,
    rsiWeekly,
    stochK:     kSeries[last]   ?? null,
    stochD:     dSeries[last]   ?? null,
    stochKPrev: last > 0 ? (kSeries[last - 1] ?? null) : null,
    closes2m: closes.slice(-45),
    dates2m:  dates.slice(-45),
  };
}

/** "RSI 42" / "RSI n/a" — n/a when there aren't enough bars yet. */
function rsiLabel(q) {
  return q.rsi == null ? 'RSI n/a' : `RSI ${q.rsi.toFixed(0)}`;
}

/** "%K 18 ↑" — the arrow is the direction the trigger actually tests. */
function stochLabel(q) {
  if (q.stochK == null) return '%K n/a';
  let arrow = '';
  if (q.stochKPrev != null) arrow = q.stochK > q.stochKPrev ? ' ↑' : (q.stochK < q.stochKPrev ? ' ↓' : ' →');
  return `%K ${q.stochK.toFixed(0)}${arrow}`;
}

/** "down 2.3x its average daily range" — omitted when ATR can't be computed. */
function atrNote(q) {
  return q.atrDrop != null ? `${q.atrDrop.toFixed(1)}x ATR` : null;
}

// ── Earnings ────────────────────────────────────────────────────────────────
// Part 2A (decided 10-04): for CSPs, earnings now BLOCK. Dates come from
// Finnhub (worker/earnings.js keeps Notion's "Earnings Date" correct), so the
// old reason for advisory-only — hand-typed, often-missing dates — is gone.
//
//   block  earnings on or before the contract's expiry, OR no usable date
//          (blank / past). Unknown is never treated as safe.
//   warn   earnings within `cr.earnAfter` (default 14) days AFTER expiry.
//   na     index / ETF — no earnings, gate doesn't apply.
//
// Expiry is the live strike's DTE when one was fetched, else the far end of the
// target DTE range (the longest contract the criteria would have you sell) —
// the conservative choice. Covered calls still only warn (see buildSignals).

/** @returns { known, na, days, block, warn } */
export function earningsNote(earnings, dteTarget, cr, ticker = '') {
  if (ticker && NO_EARNINGS.has(String(ticker).toUpperCase())) {
    return { known: false, na: true, days: null, block: false, warn: false };
  }
  const expiry = dteTarget != null ? dteTarget : cr.dteMax;
  const after  = cr.earnAfter != null ? cr.earnAfter : 14;
  const days = earnings ? dte(earnings) : null;
  // dte() counts today as 1, so anything <= 0 is in the past — a stale entry.
  if (days == null || days <= 0) return { known: false, na: false, days: null, block: true, warn: false };
  const block = days <= expiry;
  return { known: true, na: false, days, block, warn: !block && days <= expiry + after };
}

/** Short date for pills: '2026-10-28' → '10/28'. */
function md(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${+m[1]}/${+m[2]}` : '';
}

/** Why a CSP is waiting, in words, or null when earnings don't block it. */
function earningsBlockReason(note, date) {
  if (!note.block) return null;
  if (!note.known) return 'No earnings date';
  return `Earnings ${md(date)} — before expiry`;
}

/** The earnings pill for a CSP that passed the gate (warn only), else null. */
function cspEarningsPill(note, date) {
  if (note.na) return null;
  if (note.warn) return { l: `Earnings ${md(date)} (${note.days}d, after expiry)`, ok: false, warn: true };
  return { l: `Earnings ${md(date)}`, ok: true };
}

/** Covered calls stay advisory: warn when earnings land inside the contract or are unknown. */
function ccEarningsPill(note) {
  if (note.na) return null;
  if (!note.known) return { l: 'No earnings date', ok: false, warn: true };
  if (note.block)  return { l: `Earnings in ${note.days}d`, ok: false, warn: true };
  return null;
}

// ── Entry predicates ─────────────────────────────────────────────────────────
// The market-data half of an entry decision, exported so that everything which
// needs to answer "will this ticker produce an entry card?" asks the same
// function rather than re-implementing the test.
//
// This exists because the two disagreed. buildSignals moved to RSI + Stochastic
// in b2c4fd3, but the live-strike prefetch in useScreener.js and worker/scan.js
// kept selecting tickers by the retired 5-day-drop rule. The two sets barely
// overlapped, so most cards that fired had no strike fetched for them and
// rendered the generic "20–35Δ · 21–45d" line, while Tradier calls were spent on
// tickers that produced no card at all.
//
// Callers keep their own structural checks — the Priority flag, a 100-share lot,
// an already-open contract — because those legitimately differ by caller. What
// must never differ again is the oscillator test, which lives here now.

// ── LEAPS (Part 2D) ──────────────────────────────────────────────────────────
// Your rulebook, on WEEKLY bars (5 yrs from fetchWeekly):
//   50-wk MA above the 200-wk MA · each higher than 4 weeks ago · price above
//   both but at most `leapsMaxAboveMa`% (5) above the 50 · weekly Stoch %K
//   under `leapsStochBelow` (20) and turning up · stocks: NO dividend in the
//   last 12 months (strict, decided 10-11). Index (XSP) has no dividend test.

const RISE_WEEKS = 4;
const smaAt = (a, n, end = a.length) => (end < n ? null : a.slice(end - n, end).reduce((x, y) => x + y, 0) / n);

/** Weekly bars → the numbers the LEAPS rules read. Pure. */
export function deriveWeekly(hist, price = null) {
  if (!hist || !Array.isArray(hist.closes) || !hist.closes.length) return null;
  const { closes, highs, lows } = hist;
  const p = price ?? closes[closes.length - 1];
  const n = closes.length;
  const ma50 = smaAt(closes, 50), ma200 = smaAt(closes, 200);
  const ma50Prev = smaAt(closes, 50, n - RISE_WEEKS), ma200Prev = smaAt(closes, 200, n - RISE_WEEKS);
  const { k } = stochastic(highs, lows, closes);
  const lastDate = hist.dates?.[n - 1] || null;
  const cutoff = lastDate ? new Date(Date.parse(lastDate) - 365 * 86400000).toISOString().slice(0, 10) : null;
  const divs12m = (hist.divs || []).filter(d => !cutoff || d.date > cutoff);
  return {
    weeks: n, price: p, ma50, ma200, ma50Prev, ma200Prev,
    pctAbove50: ma50 ? (p / ma50 - 1) * 100 : null,
    stochK: k[n - 1] ?? null, stochKPrev: n > 1 ? (k[n - 2] ?? null) : null,
    divCount: divs12m.length,
    divYield: p ? divs12m.reduce((s, d) => s + d.amount, 0) / p * 100 : null,
  };
}

/** The trend + timing half of the LEAPS rules (dividend + held checks live in buildSignals). */
export function leapsEntryOk(w, cr) {
  if (!w || w.ma50 == null || w.ma200 == null || w.ma50Prev == null || w.ma200Prev == null) return false;
  const maxAbove = cr.leapsMaxAboveMa != null ? cr.leapsMaxAboveMa : 5;
  const stochBelow = cr.leapsStochBelow != null ? cr.leapsStochBelow : 20;
  return w.ma50 > w.ma200
    && w.ma50 > w.ma50Prev && w.ma200 > w.ma200Prev
    && w.price > w.ma50 && w.price > w.ma200
    && w.pctAbove50 <= maxAbove
    && turningUpFrom(w.stochK, w.stochKPrev, stochBelow);
}

/** Month windows → DTE numbers for fetchBestStrike. */
export function leapsWindow(cr, isIndex) {
  const m = (v) => Math.round(v * 30.44);
  return isIndex
    ? { dteMin: m(cr.leapsIndexMinMonths ?? 10), dteMax: m(cr.leapsIndexMaxMonths ?? 14), target: m(cr.leapsIndexTargetMonths ?? 12) }
    : { dteMin: m(cr.leapsMinMonths ?? 15), dteMax: m(cr.leapsMaxMonths ?? 30), target: m(cr.leapsTargetMonths ?? 21) };
}

/** Open LEAPS rows (long calls) — added in Part 2D step D3; none before then. */
export const isOpenLeaps = (p) => p && p.type === 'long_call' && !p.linkedId;
// Part 4C: LEAPS review card thresholds (days to expiry).
export const LEAPS_REVIEW_DAYS = 180;
export const LEAPS_URGENT_DAYS = 90;

/**
 * CSP entry: daily RSI inside the band, %K turning up from below the level,
 * and weekly RSI at or above the trend floor (Part 2A — no naked puts on a
 * stock in a long slide). Unknown weekly RSI fails: not enough history to say.
 */
export function cspEntryOk(q, cr) {
  if (!q) return false;
  const floor = cr.weeklyRsiMin != null ? cr.weeklyRsiMin : 40;
  return rsiInBand(q.rsi, cr.rsiMin, cr.rsiMax)
    && turningUpFrom(q.stochK, q.stochKPrev, cr.stochBelow)
    && q.rsiWeekly != null && q.rsiWeekly >= floor;
}

/** Covered call: the mirror — RSI in its band, %K rolling over from above. */
export function ccEntryOk(q, cr) {
  if (!q) return false;
  return rsiInBand(q.rsi, cr.ccRsiMin, cr.ccRsiMax)
    && rollingOverFrom(q.stochK, q.stochKPrev, cr.ccStochAbove);
}

// ── Investment Score gate (Part 2B) ─────────────────────────────────────────
// `scores` = scoreMap() of the latest Stock Runs row per ticker, or null when
// it couldn't be read (cards then still fire, tagged "Score unavailable" —
// a Notion outage must not silence every CSP).
const SCORE_STALE_MS = 90 * 86400000;

/** Pills describing the score on a CSP card. */
function scorePills(s, scores, now) {
  if (!scores) return [{ l: 'Score unavailable', ok: false, warn: true }];
  if (!s || s.score == null || s.verdict === 'No score') return [{ l: 'Unscored – run it', ok: false, warn: true }];
  const short = s.verdict === 'Worth investing' ? 'Worth' : s.verdict;
  const pills = [{ l: `Score ${Math.round(s.score)} · ${short}${s.scoreType === 'Preliminary' ? ' · Prelim' : ''}`, ok: true }];
  const at = s.runAt ? Date.parse(s.runAt) : NaN;
  if (Number.isFinite(at) && now - at > SCORE_STALE_MS) {
    const d = new Date(at);
    pills.push({ l: `Score from ${d.getMonth() + 1}/${d.getDate()} · stale`, ok: false, warn: true });
  }
  return pills;
}

export function buildSignals(watchlist, positions, criteria, qmap, strikeMap = {}, scores = null, extra = {}) {
  const cr   = criteria;
  const sigs = [];

  // Covered calls key off a share lot, which may sit on a ticker that never
  // made the watchlist — hence a lookup rather than reading the row directly.
  const byTicker = new Map(watchlist.map(w => [w.ticker, w]));

  /** Notion context every signal carries, so cards can show the latest eval. */
  const notionOf = (ticker) => {
    const w = byTicker.get(ticker);
    return {
      pageId:       w?.pageId       || null,
      notes:        w?.notes        || '',
      wheel:        w?.wheel        || '',
      fundamentals: w?.fundamentals || '',
      lastEval:     w?.lastEval     || '',
      earnings:     w?.earnings     || '',
    };
  };

  // ── CSP signals ───────────────────────────────────────────────────────────
  // The row must be flagged Priority in Notion, then RSI and Stochastic decide.
  // The drop from the 5-day high and the ATR multiple are no longer conditions —
  // they ride along on the card as context for sizing the move.
  const now = Date.now();
  for (const w of watchlist) {
    if (w.diveIn !== PRIORITY) continue;

    // Score gate: Priority but the latest run says Not worth it → no trade
    // card, a Score review card instead (until El moves it or keeps it).
    const sc = scores ? scores[w.ticker] : undefined;
    if (sc && sc.verdict === 'Not worth it') {
      // Shown until El decides on that run (any decision hides it — Watch
      // flips Dive-In, Priority = "keep it", Reject = skip). The gate itself
      // stays: no trade cards while the latest score is Not worth it.
      if (!sc.decision) {
        const qq = qmap[w.ticker];
        sigs.push({
          id: `review-${w.ticker}`, type: 'score_review', ticker: w.ticker,
          price: qq?.price ?? null, chg: qq?.chg1d ?? null,
          score: sc.score, verdict: sc.verdict, scoreType: sc.scoreType, scoreAt: sc.runAt,
          runPageId: sc.pageId,
          ...notionOf(w.ticker),
          chks: [{ l: `Score ${sc.score != null ? Math.round(sc.score) : '—'} · Not worth it`, ok: false }],
          suggestion: 'No trade cards while it scores below 55. Move to Watch, or keep Priority.',
          ts: now,
        });
      }
      continue;
    }

    const q = qmap[w.ticker];
    if (!q) continue;

    // Individual booleans drive the pills below; cspEntryOk is what decides.
    const rsiOk   = rsiInBand(q.rsi, cr.rsiMin, cr.rsiMax);
    const stochOk = turningUpFrom(q.stochK, q.stochKPrev, cr.stochBelow);
    const hasOpt  = positions.find(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
    if (!cspEntryOk(q, cr) || hasOpt) continue;

    const live    = strikeMap[`${w.ticker}:put`];
    const strike  = live?.strike ?? null;
    const dteT    = live?.dte    ?? null;
    const deltaStr = live?.delta != null
      ? `Δ${Math.abs(live.delta).toFixed(2)}`
      : `${cr.deltaMin}–${cr.deltaMax}Δ range`;

    // Dive-In, the drop and the ATR multiple were pills here. Dive-In is a
    // filter every card already passed, and the other two are in the metrics
    // grid directly below — restating them crowded the card without adding
    // anything. What's left is the pair that actually decided the signal.
    const earnDate = byTicker.get(w.ticker)?.earnings || '';
    const earnNote = earningsNote(earnDate, dteT, cr, w.ticker);
    const blockedBy = earningsBlockReason(earnNote, earnDate);
    const earnPill  = blockedBy ? null : cspEarningsPill(earnNote, earnDate);

    const floor = cr.weeklyRsiMin != null ? cr.weeklyRsiMin : 40;
    const chks = [
      { l: rsiLabel(q),   ok: rsiOk,   tgt: `${cr.rsiMin}–${cr.rsiMax}` },
      { l: stochLabel(q), ok: stochOk, tgt: `up from <${cr.stochBelow}` },
      { l: `Wkly RSI ${q.rsiWeekly.toFixed(0)}`, ok: true, tgt: `≥${floor}` },
      ...(earnPill ? [earnPill] : []),
      ...scorePills(sc, scores, now),
    ];
    const fv = fmvFields(w, q.price, now);
    const overLow = strikeOverLowPill(strike, fv.fmv);
    if (overLow) chks.push(overLow);

    const suggParts = [];
    if (dteT != null && strike != null) suggParts.push(`Sell ${dteT}d $${strike} put`);
    else suggParts.push(`Sell put · ${cr.deltaMin}–${cr.deltaMax}Δ · ${cr.dteMin}–${cr.dteMax}d`);
    if (live) suggParts.push(deltaStr);
    // The MA no longer gates the signal, but a deep drop below it is the
    // difference between a pullback and a falling knife — worth saying out loud.
    if (q.aboveMa === false) suggParts.push(`⚠ Below the ${cr.ma}MA`);

    // Part 2A: an earnings block doesn't hide the setup — it becomes a
    // "waiting" card (type csp_wait) shown greyed in the app and never sent to
    // Telegram. The trade line says why instead of what to sell.
    sigs.push({
      id: `csp-${w.ticker}`, type: blockedBy ? 'csp_wait' : 'csp', ticker: w.ticker,
      price: q.price, chg: q.chg1d, strike, dteTarget: dteT,
      // Part 3W: the Watchlist "Trade" button fills these into Log a trade.
      expiry: live?.expiry ?? null, mid: live?.premium ?? null,
      ivr: q.ivrEst ?? null, aboveMa: q.aboveMa, maPeriod: cr.ma,
      ...notionOf(w.ticker),
      dropPct: q.dropPct, weekHigh: q.weekHigh, atrDrop: q.atrDrop,
      rsi: q.rsi, rsiWeekly: q.rsiWeekly, stochK: q.stochK, stochD: q.stochD, chks,
      earnWarn: earnNote,
      ...fv,
      waitReason: blockedBy,
      score: sc?.score ?? null, verdict: sc?.verdict ?? null, scoreType: sc?.scoreType ?? null,
      scoreAt: sc?.runAt ?? null, unscored: !!scores && (!sc || sc.score == null || sc.verdict === 'No score'),
      quality: sc?.quality ?? null, value: sc?.value ?? null, upsideScore: sc?.upside ?? null,
      runPageId: sc?.pageId ?? null,
      suggestion: blockedBy ? `Waiting: ${blockedBy}` : suggParts.join(' · '),
      ts: Date.now(),
    });
  }

  // ── LEAPS signals (Part 2D) ───────────────────────────────────────────────
  // wmap: ticker → deriveWeekly() result. strikeMap[`${T}:leaps`]: the picked
  // contract, `{ none: true }` when no 15–30 mo option is listed, or missing
  // when the chain wasn't fetched (the Worker never fetches LEAPS chains —
  // Telegram only counts).
  const wmap = extra.wmap || {};
  const openLeaps = positions.filter(isOpenLeaps);
  const indexT = cr.leapsIndex || 'XSP';
  const leapsTickers = [
    ...watchlist.filter(w => w.diveIn === PRIORITY && !NO_EARNINGS.has(w.ticker)).map(w => ({ ticker: w.ticker, index: false })),
    ...(indexT ? [{ ticker: indexT, index: true }] : []),
  ];
  for (const { ticker, index } of leapsTickers) {
    const w = wmap[ticker];
    if (!leapsEntryOk(w, cr)) continue;
    const sc = scores ? scores[ticker] : undefined;
    if (!index && sc && sc.verdict === 'Not worth it') continue; // Score review card covers it
    if (!index && w.divCount > 0) continue;                      // strict: no dividend
    if (openLeaps.some(p => p.ticker === ticker)) continue;      // already held
    const q = qmap[ticker];
    const live = strikeMap[`${ticker}:leaps`];
    const noneListed = live && live.none;
    const contract = live && !live.none ? live : null;

    const chks = [
      { l: 'Wkly 50 > 200, both rising', ok: true },
      { l: `${w.pctAbove50.toFixed(0)}% above 50MA`, ok: true },
      { l: `Wkly %K ${w.stochK.toFixed(0)} ↑`, ok: true },
      ...(index ? [] : [{ l: 'No dividend', ok: true }]),
    ];
    const cost = contract && contract.premium != null ? Math.round(contract.premium * 100) : null;
    const maxCost = cr.leapsMaxCost ?? 10000;
    if (cost != null && cost > maxCost) chks.push({ l: `$${cost.toLocaleString()} per contract — over $${maxCost.toLocaleString()}`, ok: false, warn: true });
    if (contract && contract.bid > 0 && contract.ask > 0) {
      const spread = (contract.ask - contract.bid) / ((contract.ask + contract.bid) / 2) * 100;
      if (spread > 10) chks.push({ l: `Wide bid/ask ${spread.toFixed(0)}% — use a limit order`, ok: false, warn: true });
    }
    if (openLeaps.length >= (cr.leapsMaxOpen ?? 4)) chks.push({ l: `${openLeaps.length} LEAPS already open`, ok: false, warn: true });
    if (!index) chks.push(...scorePills(sc, scores, now));

    const mon = (iso) => { const d = new Date(String(iso) + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); };
    const win = leapsWindow(cr, index);
    const suggestion = contract
      ? `Buy ${mon(contract.expiry)} $${contract.strike} call · Δ${contract.delta.toFixed(2)} · ~$${cost != null ? cost.toLocaleString() : '—'} per contract (mid)${contract.bid != null && contract.ask != null ? ` · bid/ask $${contract.bid} / $${contract.ask}` : ''}`
      : `Buy a ~0.80Δ call, ${Math.round(win.dteMin / 30.44)}–${Math.round(win.dteMax / 30.44)} months out · open the app for the contract`;

    sigs.push({
      id: `leaps-${ticker}`, type: noneListed ? 'leaps_wait' : 'leaps', ticker, index,
      price: q?.price ?? w.price, chg: q?.chg1d ?? null,
      strike: contract?.strike ?? null, expiry: contract?.expiry ?? null, dteTarget: contract?.dte ?? null,
      delta: contract?.delta ?? null, mid: contract?.premium ?? null, bid: contract?.bid ?? null, ask: contract?.ask ?? null, cost,
      weekly: w, chks,
      ...(index ? {} : notionOf(ticker)),
      ...(index ? { fmv: null, fmvPct: null, fmvStale: false } : fmvFields(byTicker.get(ticker), q?.price ?? w.price, now)),
      waitReason: noneListed ? `No ${Math.round(win.dteMin / 30.44)}–${Math.round(win.dteMax / 30.44)} mo options listed` : null,
      score: index ? null : sc?.score ?? null, verdict: index ? null : sc?.verdict ?? null,
      scoreType: index ? null : sc?.scoreType ?? null, scoreAt: index ? null : sc?.runAt ?? null,
      unscored: !index && !!scores && (!sc || sc.score == null || sc.verdict === 'No score'),
      quality: index ? null : sc?.quality ?? null, value: index ? null : sc?.value ?? null, upsideScore: index ? null : sc?.upside ?? null,
      openLeaps: openLeaps.length,
      suggestion: noneListed ? `Waiting: No ${Math.round(win.dteMin / 30.44)}–${Math.round(win.dteMax / 30.44)} mo options listed` : suggestion,
      ts: now,
    });
  }

  // ── LEAPS review (Part 4C / D3) ──────────────────────────────────────────
  // A held LEAPS shows a Manage card once ≤180 days are left (decide: keep,
  // roll out or sell), urgent at ≤90 (time value decays fast from there).
  for (const pos of openLeaps) {
    const days = dte(pos.expiry);
    if (days == null || days > LEAPS_REVIEW_DAYS) continue;
    const q = qmap[pos.ticker];
    const urgent = days <= LEAPS_URGENT_DAYS;
    const cur = pos._liveCurPrem ?? pos.curPrem ?? null;
    const pnlPct = cur != null && pos.prem ? Math.round((cur / pos.prem - 1) * 100) : null;
    const pnlTxt = pnlPct != null ? ` Now ${pnlPct >= 0 ? '+' : ''}${pnlPct}% on what you paid.` : '';
    sigs.push({
      id: `leapsrev-${pos.id}`, type: 'leaps_review', ticker: pos.ticker, posId: pos.id, posType: 'long_call',
      price: q?.price ?? null, chg: q?.chg1d ?? null, strike: pos.strike, expiry: pos.expiry,
      days, urgent, prem: pos.prem ?? null, cur, pnlPct,
      suggestion: (urgent
        ? `${days} days left — time value now shrinks fast. Sell it, or roll out to a later expiry.`
        : `${days} days left — decide: keep it, roll out to a later expiry, or sell.`) + pnlTxt,
      ts: Date.now(),
    });
  }

  // ── Covered Call signals ──────────────────────────────────────────────────
  const CC_MIN_SHARES = 100;
  for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= CC_MIN_SHARES)) {
    const q = qmap[pos.ticker];
    if (!q) continue;
    // Mirror of the put rule, one oscillator turn later: calls are sold into
    // strength rolling over, puts into weakness turning up. The rally off the
    // 5-day low is context on the card now, not a condition.
    // Individual booleans drive the pills below; ccEntryOk is what decides.
    const ccRsiOk   = rsiInBand(q.rsi, cr.ccRsiMin, cr.ccRsiMax);
    const ccStochOk = rollingOverFrom(q.stochK, q.stochKPrev, cr.ccStochAbove);
    const hasCall = positions.find(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
    const contracts = Math.floor(pos.qty / 100);
    if (ccEntryOk(q, cr) && !hasCall && contracts >= 1) {
      const live     = strikeMap[`${pos.ticker}:call`];
      const strike   = live?.strike ?? null;
      const dteT     = live?.dte    ?? null;
      const deltaStr = live?.delta != null
        ? `Δ${Math.abs(live.delta).toFixed(2)}`
        : `${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ range`;
      const suggParts = [];
      if (dteT != null && strike != null) suggParts.push(`Sell ${contracts} x ${dteT}d $${strike} call`);
      else suggParts.push(`Sell ${contracts} call · ${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ · ${cr.ccDteMin}–${cr.ccDteMax}d`);
      if (live) suggParts.push(deltaStr);
      const ccEarnNote = earningsNote(byTicker.get(pos.ticker)?.earnings, dteT, cr, pos.ticker);
      const ccEarnPill = ccEarningsPill(ccEarnNote);
      const ccChks = [
        { l: `${pos.qty} shares (${contracts} contract${contracts > 1 ? 's' : ''})`, ok: true },
        { l: rsiLabel(q),   ok: ccRsiOk,   tgt: `${cr.ccRsiMin}–${cr.ccRsiMax}` },
        { l: stochLabel(q), ok: ccStochOk, tgt: `over from >${cr.ccStochAbove}` },
        ...(ccEarnPill ? [ccEarnPill] : []),
      ];
      sigs.push({
        id: `cc-${pos.id}`, type: 'cc', ticker: pos.ticker,
        price: q.price, chg: q.chg1d, strike, dteTarget: dteT,
        contracts, sharesOwned: pos.qty,
        ...notionOf(pos.ticker),
        rallyPct: q.rallyPct, weekLow: q.weekLow, ivr: q.ivrEst ?? null,
        rsi: q.rsi, stochK: q.stochK, stochD: q.stochD,
        chks: ccChks,
        earnWarn: ccEarnNote,
        suggestion: suggParts.join(' · '),
        ts: Date.now(),
      });
    }
  }

  // ── Roll / Close signals ──────────────────────────────────────────────────
  for (const pos of positions.filter(p => OPEN_OPTION_TYPES.has(p.type) && !p.linkedId)) {
    const q    = qmap[pos.ticker];
    const days = dte(pos.expiry);
    if (days === null) continue;

    let origDte = null;
    if (pos.expiry && pos.enteredAt && pos.enteredAt > 0) {
      const calc = Math.round((new Date(pos.expiry + 'T12:00:00') - new Date(pos.enteredAt)) / 86400000);
      if (!isNaN(calc) && calc > 0) origDte = calc;
    }
    if (!origDte) origDte = pos.origDte || null;

    const pctT = (origDte && origDte > 0)
      ? Math.max(0, Math.round((1 - days / origDte) * 100))
      : null;

    const effectiveCurPrem = (pos._liveCurPrem !== undefined && pos._liveCurPrem !== null)
      ? pos._liveCurPrem
      : pos.curPrem;

    const pctCap = (effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem)
      ? Math.round((1 - effectiveCurPrem / pos.prem) * 100)
      : null;

    // A put credit spread's `strike` is the SHORT leg and `longStrike` the long
    // one, so it has two thresholds rather than one. Below the short strike is
    // the same "you're being tested" signal a naked put gives. Below the LONG
    // strike is categorically different: the spread is at max loss, both legs
    // are in the money, and rolling reflexively is usually the wrong move —
    // it deserves its own card, not a louder roll.
    // isPutLike drives the breach test and must not depend on longStrike: a
    // put_spread row saved without its long leg is malformed, but it is still a
    // short put at `strike`, and going silent on it would be the worst outcome.
    // isSpread is the narrower "we can reason about both legs" test.
    const isPutLike = pos.type === 'short_put' || pos.type === 'put_spread';
    const isSpread  = pos.type === 'put_spread' && pos.longStrike != null;
    const maxLoss   = q && isSpread && q.price < pos.longStrike;
    const putBr     = q && !maxLoss && isPutLike && q.price < pos.strike;
    const callBr    = q && pos.type === 'short_call' && q.price > pos.strike;
    const earlyClose = pctCap !== null && pctCap >= cr.closePct && pctT !== null && pctT < cr.closeDtePct;

    // Width is what a spread actually risks — the payoff is capped, so this is
    // the number that makes "max loss" mean something on the card.
    const width = isSpread ? pos.strike - pos.longStrike : null;

    if (maxLoss) {
      sigs.push({
        id: `maxloss-${pos.id}`, type: 'maxloss', ticker: pos.ticker,
        price: q?.price, chg: q?.chg1d, strike: pos.strike, longStrike: pos.longStrike,
        width, days, pctT: pctT ?? '—', pctCap, posType: pos.type,
        chks: [
          { l: 'Both legs in the money', ok: false },
          { l: `${days}d left`, ok: false, warn: true },
        ],
        suggestion: `Price $${q.price.toFixed(2)} < long strike $${pos.longStrike} · Spread at max loss ($${width} wide) · ${days}d left — decide, don't roll on reflex`,
        ts: Date.now(),
      });
    } else if (putBr || callBr) {
      sigs.push({
        id: `roll-${pos.id}`, type: 'roll', ticker: pos.ticker,
        price: q?.price, chg: q?.chg1d, strike: pos.strike, days,
        ...(isSpread ? { longStrike: pos.longStrike, width } : {}),
        pctT: pctT ?? '—', pctCap, posType: pos.type,
        chks: [
          { l: 'Strike breached', ok: false },
          // Breached at 40 days and breached at 3 are different decisions, and
          // the card never said which one you were looking at.
          { l: `${days}d left`, ok: false, warn: true },
        ],
        suggestion: putBr
          ? `Price $${q.price.toFixed(2)} < strike $${pos.strike} · ${days}d left · Roll down & out to next expiry`
          : `Price $${q.price.toFixed(2)} > strike $${pos.strike} · ${days}d left · Roll up & out or accept assignment`,
        ts: Date.now(),
      });
    } else if (earlyClose) {
      sigs.push({
        id: `close-${pos.id}`, type: 'close', ticker: pos.ticker,
        price: q?.price, chg: q?.chg1d, strike: pos.strike, days, pctT, pctCap,
        ...(isSpread ? { longStrike: pos.longStrike, width } : {}), posType: pos.type,
        chks: [
          { l: `${pctCap}% captured`, ok: true },
          { l: `${pctT}% elapsed`,    ok: true },
        ],
        suggestion: `${pctCap}% of premium captured · ${pctT}% of time elapsed · Buy to close & redeploy capital`,
        ts: Date.now(),
      });
    }
  }

  return sigs;
}
