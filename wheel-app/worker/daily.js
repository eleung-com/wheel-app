// Daily jobs — Part 3 (PRD claude/wheel-app-prd-part3-fair-value, decided 10-11).
//
// Its own Cron Trigger (wrangler.toml "40 13,14 * * 1-5"), separate from the
// 30-minute signal scan so each gets its own subrequest budget. Runs once per
// trading day, in the first firing after the open (9:40 ET, both EDT and EST).
//
//   1. Earnings dates from Finnhub (moved here from the scan; the scan still
//      calls it after 11:00 ET as a fallback — the KV day key stops a repeat).
//   2. Dive-In for every non-index row: app score verdict + price vs FMV Mid
//      (src/lib/fairValue.js). A Research decision by El wins until a newer
//      score run or newer FMV numbers.
//   3. "FMV after earnings": 2 trading days after a stock reports, start the
//      Claude routine for it (max 3 tries per report, one per day).
//
// Never throws: one failed part must not stop the others.

import { readWatchlist, setDiveInName } from './notion.js';
import { refreshEarnings, KV_LAST, daysBetween } from './earnings.js';
import { listRuns, OVERRIDE_KEY } from './stockRuns.js';
import { scoreMap } from '../src/lib/research/runRecord.js';
import { NO_EARNINGS, OPEN_OPTION_TYPES } from '../src/lib/signalEngine.js';
import { decideDiveIn, fmvOf, DIVE } from '../src/lib/fairValue.js';
import { isMarketOpen, etDateString, addTradingDays } from './marketHours.js';
import { fetchSheetData } from './scan.js';

export const DAILY_CRON = '40 13,14 * * 1-5';
const KV_DAY = (d) => `daily|day|${d}`;
const FIRE_KEY = (t, e) => `fmv|fire|${t}|${e}`;
export const FMV_AFTER_DAYS = 2;   // trading days after the report (D6)
export const FMV_MAX_TRIES = 3;
const FMV_MAX_AGE_DAYS = 20;       // older reports: the Monday eval covers it
const ROUTINE_VERSION = '2023-06-01';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const isIndex = (t) => NO_EARNINGS.has(t);

// ── Prices: one Yahoo "spark" call per 15 tickers ───────────────────────────
export function parseSpark(body) {
  const out = {};
  for (const [t, v] of Object.entries(body || {})) {
    const closes = v && Array.isArray(v.close) ? v.close.filter((x) => typeof x === 'number') : [];
    const p = closes.length ? closes[closes.length - 1] : null;
    if (p) out[t.toUpperCase()] = Math.round(p * 100) / 100;
  }
  return out;
}

export async function fetchPrices(tickers, fetchImpl = fetch) {
  const out = {};
  for (let i = 0; i < tickers.length; i += 15) {
    const syms = tickers.slice(i, i + 15).join(',');
    try {
      const r = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms)}&range=1d&interval=1d`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) Object.assign(out, parseSpark(await r.json()));
      else console.error('[daily] spark', r.status);
    } catch (e) { console.error('[daily] spark failed:', e?.message || e); }
  }
  return out;
}

// ── 2. Dive-In ──────────────────────────────────────────────────────────────
/** Is El's Research decision still in force? (same latest run, no newer FMV) */
export function overrideActive(ov, latestRunId, fmvDate) {
  if (!ov || !ov.runId) return false;
  if (latestRunId && latestRunId !== ov.runId) return false;
  if (fmvDate && ov.day && fmvDate.slice(0, 10) > ov.day) return false;
  return true;
}

export async function updateDiveIns(env, watchlist, scores, prices) {
  const out = { changed: [], kept: [], failed: [] };
  const kv = env.ALERTS_KV;
  for (const w of watchlist) {
    if (!w.pageId || isIndex(w.ticker)) continue;
    const s = scores ? scores[w.ticker] : null;
    if (kv) {
      let ov = null;
      try { ov = JSON.parse((await kv.get(OVERRIDE_KEY(w.ticker))) || 'null'); } catch { ov = null; }
      if (ov) {
        if (overrideActive(ov, s && s.pageId, w.fmvDate)) { out.kept.push(w.ticker); continue; }
        await kv.delete(OVERRIDE_KEY(w.ticker)).catch(() => {});
      }
    }
    const d = decideDiveIn({ current: w.diveIn || '', verdict: s ? s.verdict : null, price: prices[w.ticker] ?? null, fmv: fmvOf(w) });
    if (!d) continue;
    try {
      await setDiveInName(env, w.pageId, d.diveIn);
      out.changed.push(`${w.ticker} ${w.diveIn || '—'}→${d.diveIn} (${d.reason})`);
      w.diveIn = d.diveIn;
    } catch (e) {
      out.failed.push(w.ticker);
      console.error(`[daily] dive-in ${w.ticker}:`, e?.message || e);
    }
  }
  return out;
}

// ── 3. FMV after earnings ───────────────────────────────────────────────────
/** The report that should trigger a refresh today, or null. */
export function dueReport({ notionDate, lastDate, fmvDate, today }) {
  const past = [notionDate, lastDate].map((d) => (d || '').slice(0, 10)).filter((d) => d && d < today).sort();
  const e = past[past.length - 1];
  if (!e) return null;
  if (daysBetween(e, today) > FMV_MAX_AGE_DAYS) return null;
  if (addTradingDays(e, FMV_AFTER_DAYS) > today) return null;     // too early
  if (fmvDate && fmvDate.slice(0, 10) > e) return null;           // already refreshed
  return e;
}

export async function fireFmvRoutine(env, ticker, pageId, earningsDate, fetchImpl = fetch) {
  if (!env.FMV_ROUTINE_FIRE_URL || !env.FMV_ROUTINE_TOKEN) return { ok: false, error: 'FMV routine not set up' };
  try {
    const res = await fetchImpl(env.FMV_ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FMV_ROUTINE_TOKEN}`,
        'anthropic-version': ROUTINE_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: `ticker: ${ticker}\npage_id: ${pageId}\nearnings_date: ${earningsDate}` }),
    });
    if (!res.ok) return { ok: false, error: `routine ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `routine unreachable: ${String(e.message || e).slice(0, 120)}` };
  }
}

export async function fmvAfterEarnings(env, watchlist, today, fetchImpl = fetch) {
  const out = { fired: [], failed: [], gaveUp: [] };
  const kv = env.ALERTS_KV;
  if (!kv) return out;
  for (const w of watchlist) {
    if (!w.pageId || isIndex(w.ticker) || w.diveIn === DIVE.SKIP) continue;
    const lastDate = await kv.get(KV_LAST(w.ticker));
    const e = dueReport({ notionDate: w.earnings, lastDate, fmvDate: w.fmvDate, today });
    if (!e) continue;
    const tries = Number((await kv.get(FIRE_KEY(w.ticker, e))) || 0);
    if (tries >= FMV_MAX_TRIES) { out.gaveUp.push(w.ticker); continue; }
    const r = await fireFmvRoutine(env, w.ticker, w.pageId, e, fetchImpl);
    await kv.put(FIRE_KEY(w.ticker, e), String(tries + 1), { expirationTtl: 60 * 86400 });
    if (r.ok) out.fired.push(`${w.ticker} (${e}, try ${tries + 1})`);
    else { out.failed.push(`${w.ticker}: ${r.error}`); console.error('[daily] fmv fire', w.ticker, r.error); }
  }
  return out;
}

// ── Entry ───────────────────────────────────────────────────────────────────
export async function runDaily(env, now = new Date()) {
  if (!isMarketOpen(now)) return null;
  const today = etDateString(now);
  const kv = env.ALERTS_KV;
  if (kv && await kv.get(KV_DAY(today))) return null;   // already ran today
  const log = { today };

  let watchlist;
  try { watchlist = await readWatchlist(env); }
  catch (e) { console.error('[daily] watchlist read failed:', e?.message || e); return null; }

  try {
    let held = [];
    try {
      const { positions } = await fetchSheetData(env);
      held = positions.filter((p) => (p.type === 'shares' || OPEN_OPTION_TYPES.has(p.type)) && !p.linkedId).map((p) => p.ticker);
    } catch (e) { console.error('[daily] sheet read failed:', e?.message || e); }
    log.earnings = await refreshEarnings(env, watchlist, held, now);
  } catch (e) { console.error('[daily] earnings failed:', e?.message || e); }

  try {
    let scores = null;
    try { scores = scoreMap(await listRuns(env, { limit: 50 })); }
    catch (e) { console.error('[daily] score read failed:', e?.message || e); }
    if (scores) {
      const tickers = watchlist.filter((w) => !isIndex(w.ticker)).map((w) => w.ticker);
      const prices = await fetchPrices(tickers);
      log.diveIn = await updateDiveIns(env, watchlist, scores, prices);
    } else {
      log.diveIn = 'skipped: scores unavailable';   // never judge Dive-In blind
    }
  } catch (e) { console.error('[daily] dive-in failed:', e?.message || e); }

  try { log.fmv = await fmvAfterEarnings(env, watchlist, today); }
  catch (e) { console.error('[daily] fmv failed:', e?.message || e); }

  if (kv) await kv.put(KV_DAY(today), '1', { expirationTtl: 3 * 86400 });
  console.log('[daily]', JSON.stringify(log));
  return log;
}
