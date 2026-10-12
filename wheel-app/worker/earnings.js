// Earnings dates from Finnhub — Part 2A step A1 (PRD v1.5 §6, decided 10-04).
//
// Finnhub is the source of truth for the Notion "Earnings Date" field. The A0
// check found 4 of 7 hand/evaluator-written Notion dates a day late (MTSI
// reports before the open on 11/04; Notion said 11/05), which would have let a
// put expiring on report day through the earnings gate.
//
// Rules (per non-Skip or held ticker that has a Notion watchlist row — Part 3):
//   • "Earnings locked" ticked          → never touched.
//   • Weekly full refresh (≥7 days since the last one, tracked in KV) → every
//     ticker is asked and Notion is overwritten when Finnhub differs.
//   • Otherwise, daily: only blank or past dates are asked, and only if
//     "Earnings checked" isn't within the last 14 days.
//   • Finnhub has no upcoming date → stamp "Earnings checked" = today and wait
//     14 days before asking again (the company hasn't announced yet).
//   • Index / ETF symbols have no earnings and are skipped.
//
// Runs once per ET day, inside the first market-hours scan (see scan.js).
// Volume: ~10 calls on a full-refresh day, a handful otherwise. Finnhub free
// allows 60/min; calls are spaced ~1.1 s apart to stay far under it.

import { NO_EARNINGS } from '../src/lib/signalEngine.js';
import { DIVE } from '../src/lib/fairValue.js';

const SKIP = DIVE.SKIP;
import { etDateString } from './marketHours.js';
import { setEarningsFields } from './notion.js';

export const RECHECK_DAYS   = 14;
export const FULL_EVERY_DAYS = 7;
export const LOOKAHEAD_DAYS = 200;
const CALL_GAP_MS = 1100;

// No earnings for index/ETF symbols — the set lives in signalEngine.js so the
// earnings gate and this refresh agree. Re-exported for existing imports.
export { NO_EARNINGS };

const KV_DAY  = (d) => `earnings|day|${d}`;
const KV_FULL = 'earnings|last-full';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 'YYYY-MM-DD' + n days. Pure string math in UTC so DST never shifts it. */
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a → b (both 'YYYY-MM-DD'). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** Earliest Finnhub calendar date on or after `today`, else null. */
export function pickNextDate(body, today) {
  const list = (body && Array.isArray(body.earningsCalendar)) ? body.earningsCalendar : [];
  const dates = list
    .map(e => (e && typeof e.date === 'string') ? e.date.slice(0, 10) : null)
    .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
    .sort();
  return dates[0] || null;
}

/** Should this row be asked today? `full` = this is a weekly full-refresh day. */
export function needsCheck(row, today, full) {
  if (!row || row.earningsLocked) return false;
  if (NO_EARNINGS.has(row.ticker)) return false;
  const date = (row.earnings || '').slice(0, 10);
  const upcoming = date && date >= today;
  if (full) {
    // Weekly refresh still respects the 14-day wait for tickers Finnhub had
    // nothing for — a full day must not undo the credit-saving rule.
    if (!upcoming && row.earningsChecked && daysBetween(row.earningsChecked.slice(0, 10), today) < RECHECK_DAYS) return false;
    return true;
  }
  if (upcoming) return false;
  if (row.earningsChecked && daysBetween(row.earningsChecked.slice(0, 10), today) < RECHECK_DAYS) return false;
  return true;
}

/**
 * Rows to consider: every row that isn't Skip (Priority, Watch, blank), plus
 * held tickers, with a Notion page. Part 3 widened this from Priority-only:
 * a Watch stock can turn Priority any day (price ≤ fair value), and its
 * after-earnings FMV refresh needs a correct earnings date.
 */
export function targetRows(watchlist, heldTickers = []) {
  const held = new Set(heldTickers.map(t => String(t).toUpperCase()));
  return watchlist.filter(w => w.pageId && (w.diveIn !== SKIP || held.has(w.ticker)));
}

// Part 3: the last earnings date that passed, kept when Notion's date is
// replaced by the next one — worker/daily.js needs it to start the
// "FMV after earnings" routine 2 trading days later.
export const KV_LAST = (t) => `earnings|last|${t}`;
const LAST_TTL = 120 * 86400;

async function finnhubNext(env, ticker, today) {
  const q = new URLSearchParams({ symbol: ticker, from: today, to: addDays(today, LOOKAHEAD_DAYS), token: env.FINNHUB_KEY });
  const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?${q}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`finnhub ${res.status}`);
  return pickNextDate(await res.json(), today);
}

/**
 * Refresh earnings dates for Priority + held tickers. Mutates the matching
 * watchlist rows' `earnings` in place so the same scan's signals use the new
 * date. Never throws — a Finnhub or Notion failure must not stop the scan.
 *
 * @returns { ran, full, asked, updated, noDate, failed } for logging/tests.
 */
export async function refreshEarnings(env, watchlist, heldTickers, now = new Date(), { gapMs = CALL_GAP_MS } = {}) {
  const out = { ran: false, full: false, asked: 0, updated: [], noDate: [], failed: [] };
  if (!env.FINNHUB_KEY) { console.error('[earnings] FINNHUB_KEY not set — skipped'); return out; }

  const today = etDateString(now);
  const kv = env.ALERTS_KV;
  if (kv && await kv.get(KV_DAY(today))) return out; // already ran today

  const lastFull = kv ? await kv.get(KV_FULL) : null;
  out.full = !lastFull || daysBetween(lastFull, today) >= FULL_EVERY_DAYS;
  out.ran = true;

  const rows = targetRows(watchlist, heldTickers).filter(r => needsCheck(r, today, out.full));
  for (const row of rows) {
    if (out.asked > 0) await sleep(gapMs);
    out.asked++;
    let next;
    try { next = await finnhubNext(env, row.ticker, today); }
    catch (e) { out.failed.push(row.ticker); console.error(`[earnings] ${row.ticker}:`, e?.message || e); continue; }

    try {
      if (next) {
        const prev = (row.earnings || '').slice(0, 10);
        if (next !== prev) {
          await setEarningsFields(env, row.pageId, { earnings: next, checked: null });
          if (kv && prev && prev < today) await kv.put(KV_LAST(row.ticker), prev, { expirationTtl: LAST_TTL });
          out.updated.push(`${row.ticker} ${row.earnings || '—'}→${next}`);
          row.earnings = next;
        }
      } else {
        await setEarningsFields(env, row.pageId, { checked: today });
        row.earningsChecked = today;
        out.noDate.push(row.ticker);
      }
    } catch (e) {
      out.failed.push(row.ticker);
      console.error(`[earnings] notion write ${row.ticker}:`, e?.message || e);
    }
  }

  if (kv) {
    // Marked done even after partial failure: a Finnhub outage should cost one
    // day's refresh, not 14 retries an hour. The next day tries again.
    await kv.put(KV_DAY(today), '1', { expirationTtl: 3 * 86400 });
    if (out.full && out.failed.length < rows.length) await kv.put(KV_FULL, today);
  }
  console.log('[earnings]', JSON.stringify(out));
  return out;
}
