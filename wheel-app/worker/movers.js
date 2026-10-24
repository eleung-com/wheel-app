// Part 6B/6C — "why it moved" (PRD claude/wheel-app-prd-part6-home-news-movers,
// approved 10-23).
//
// Its own Cron Trigger (wrangler.toml), offset from the 30-min signal scan, so
// it gets its own subrequest budget and a failure here can never break the
// scan's alerts. Each run, during market hours:
//   1. Day % for every watchlist stock — one Yahoo "spark" call per 15 tickers.
//   2. New movers = ±5% or more AND not summarized today — or summarized, but
//      the move has since doubled (−5% at 10 AM, −10% by 2 PM → once more).
//   3. ONE Claude "Mover Summary" routine run for the whole batch (max 15).
//      The routine looks up the news and writes Move note / Move note date /
//      Move % / Move link on each Notion row. The app shows them that day.
// KV remembers what was sent today. A failed fire marks nothing, so the next
// run retries — at most MAX_FIRES_PER_DAY fires a day, whatever happens.
//
// Held tickers that aren't on the watchlist have no Notion row to write to,
// so they're skipped (PRD Q1 — nearly all holdings are on the watchlist).

import { readWatchlist } from './notion.js';
import { isMarketOpen, etDateString } from './marketHours.js';
import { NO_EARNINGS } from '../src/lib/signalEngine.js';

export const MOVERS_CRON = '15,45 13-20 * * 1-5';
export const MOVE_PCT = 5;
export const MAX_BATCH = 15;
export const MAX_FIRES_PER_DAY = 8;
export const MARKET = ['SPY', 'QQQ', 'SMH'];
const ROUTINE_VERSION = '2023-06-01';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const KV_DONE  = (d) => `movers|done|${d}`;
const KV_FIRES = (d) => `movers|fires|${d}`;
const TTL = 3 * 86400;

/** Yahoo spark (range=5d, interval=1d) → { TICKER: day % } from the last two daily closes. */
export function parseDayMoves(body) {
  const out = {};
  for (const [t, v] of Object.entries(body || {})) {
    const c = v && Array.isArray(v.close) ? v.close.filter((x) => typeof x === 'number') : [];
    if (c.length < 2 || !c[c.length - 2]) continue;
    out[t.toUpperCase()] = Math.round(((c[c.length - 1] - c[c.length - 2]) / c[c.length - 2]) * 1000) / 10;
  }
  return out;
}

export async function fetchDayMoves(tickers, fetchImpl = fetch) {
  const out = {};
  for (let i = 0; i < tickers.length; i += 15) {
    const syms = tickers.slice(i, i + 15).join(',');
    try {
      const r = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms)}&range=5d&interval=1d`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) Object.assign(out, parseDayMoves(await r.json()));
      else console.error('[movers] spark', r.status);
    } catch (e) { console.error('[movers] spark failed:', e?.message || e); }
  }
  return out;
}

/**
 * Who needs a summary now. `done` = { TICKER: |%| already summarized today }.
 * Biggest moves first, capped at MAX_BATCH.
 */
export function pickNewMovers(watchlist, moves, done = {}) {
  const out = [];
  for (const w of watchlist || []) {
    if (!w || !w.pageId || NO_EARNINGS.has(w.ticker)) continue;
    const pct = moves[w.ticker];
    if (typeof pct !== 'number' || Math.abs(pct) < MOVE_PCT) continue;
    const prev = done[w.ticker];
    if (prev != null && Math.abs(pct) < prev * 2) continue; // already explained, not doubled
    out.push({ ticker: w.ticker, pct, pageId: w.pageId });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, MAX_BATCH);
}

const sign = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`;

/** The routine's input — data only, one mover per line (see routines/mover-summary.md). */
export function moverPayload(date, moves, list) {
  const market = MARKET.map((t) => `${t} ${typeof moves[t] === 'number' ? sign(moves[t]) : 'n/a'}`).join(' · ');
  return [
    `date: ${date}`,
    `market: ${market}`,
    'movers:',
    ...list.map((m) => `${m.ticker} ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)} ${m.pageId}`),
  ].join('\n');
}

/** Fire the Mover Summary routine. Never throws. */
export async function fireMoverRoutine(env, text, fetchImpl = fetch) {
  if (!env.MOVER_ROUTINE_FIRE_URL || !env.MOVER_ROUTINE_TOKEN) return { ok: false, error: 'Mover Summary routine not set up yet' };
  try {
    const res = await fetchImpl(env.MOVER_ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MOVER_ROUTINE_TOKEN}`,
        'anthropic-version': ROUTINE_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) return { ok: false, error: 'Claude busy' };
    if (!res.ok) return { ok: false, error: `routine ${res.status}: ${(await res.text()).slice(0, 160)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `routine unreachable: ${String(e?.message || e).slice(0, 120)}` };
  }
}

/** Cron entry. Never throws. Returns what it did (for tests and logs). */
export async function runMovers(env, now = new Date(), deps = {}) {
  const read = deps.readWatchlist || readWatchlist;
  const fetchImpl = deps.fetch || fetch;
  try {
    if (!isMarketOpen(now)) return { skipped: 'market closed' };
    const kv = env.ALERTS_KV;
    const date = etDateString(now);
    const fires = kv ? Number(await kv.get(KV_FIRES(date))) || 0 : 0;
    if (fires >= MAX_FIRES_PER_DAY) return { skipped: 'daily fire cap' };

    const watchlist = await read(env);
    const tickers = [...new Set([...watchlist.map((w) => w.ticker).filter((t) => !NO_EARNINGS.has(t)), ...MARKET])];
    const moves = await fetchDayMoves(tickers, fetchImpl);
    const done = kv ? JSON.parse((await kv.get(KV_DONE(date))) || '{}') : {};
    const list = pickNewMovers(watchlist, moves, done);
    if (!list.length) return { movers: [] };

    if (kv) await kv.put(KV_FIRES(date), String(fires + 1), { expirationTtl: TTL });
    const fired = await fireMoverRoutine(env, moverPayload(date, moves, list), fetchImpl);
    if (!fired.ok) {
      console.error('[movers] fire failed, retry next run:', fired.error);
      return { movers: list.map((m) => m.ticker), fired: false, error: fired.error };
    }
    for (const m of list) done[m.ticker] = Math.abs(m.pct);
    if (kv) await kv.put(KV_DONE(date), JSON.stringify(done), { expirationTtl: TTL });
    console.log('[movers] fired for', list.map((m) => `${m.ticker} ${m.pct}`).join(', '));
    return { movers: list.map((m) => m.ticker), fired: true };
  } catch (e) {
    console.error('[movers] run failed:', e?.message || e);
    return { error: String(e?.message || e) };
  }
}
