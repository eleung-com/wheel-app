// Fair value (FMV) rules — Part 3 (PRD claude/wheel-app-prd-part3-fair-value, decided 10-11).
//
// FMV Low / Mid / High live on the Notion watchlist row ("Stock Scan Results"),
// written by the Monday eval task and the "FMV after earnings" routine:
//   Low  = the evaluator's buy-below price (blended fair value × 0.85)
//   Mid  = blended fair value (DCF base + peer multiples + analyst average)
//   High = DCF bull case
//
// Dive-In is set every trading day by the Worker (worker/daily.js):
//   1. Good company? App score verdict: Worth investing / Maybe → at least
//      Watch · Not worth it → Skip · no score yet → leave as is.
//   2. Price at or below FMV Mid → Priority. Back to Watch only once the price
//      is more than 3% above Mid (stops a stock flipping every day).
// Shared by the Worker and the app (cards show price vs fair value).

export const DIVE = { PRIORITY: '🔥 Priority', WATCH: '👀 Watch', SKIP: '— Skip' };
export const FMV_BUFFER = 0.03;      // D11: back to Watch only above Mid + 3%
export const FMV_STALE_DAYS = 10;    // D13: a missed Monday → "FMV stale"
const GOOD = new Set(['Worth investing', 'Maybe']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** FMV fields of a watchlist row, or null when Mid is missing. */
export function fmvOf(row) {
  const mid = num(row && row.fmvMid);
  if (!mid) return null;
  return { low: num(row.fmvLow), mid, high: num(row.fmvHigh), date: (row.fmvDate || '').slice(0, 10) || null };
}

/** Whole days between two YYYY-MM-DD dates. */
function days(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** True when the FMV numbers are older than FMV_STALE_DAYS (or undated). */
export function fmvStale(fmv, today) {
  if (!fmv) return false;
  if (!fmv.date) return true;
  return days(fmv.date, today) > FMV_STALE_DAYS;
}

/** % the price sits above (+) or below (−) FMV Mid, 1 decimal. */
export function vsMidPct(price, fmv) {
  if (!num(price) || !fmv) return null;
  return Math.round((price / fmv.mid - 1) * 1000) / 10;
}

/**
 * The Dive-In a row should have today, or null to leave it alone.
 * @param current  current Dive-In name ('' when blank)
 * @param verdict  latest app score verdict, or null when never scored
 * @param price    today's price (null when unknown)
 * @param fmv      fmvOf(row)
 * @returns { diveIn, reason } | null
 */
export function decideDiveIn({ current = '', verdict = null, price = null, fmv = null }) {
  if (!verdict || verdict === 'No score') return null;          // step 1 can't be judged
  if (!GOOD.has(verdict)) {
    return current === DIVE.SKIP ? null : { diveIn: DIVE.SKIP, reason: `score: ${verdict}` };
  }
  // Good company → never Skip.
  const p = num(price);
  let want;
  let reason;
  if (!fmv || !p) {
    // No fair value (or no price) yet: keep Priority/Watch as is, lift Skip/blank to Watch.
    if (current === DIVE.PRIORITY || current === DIVE.WATCH) return null;
    want = DIVE.WATCH; reason = !fmv ? 'good score, no fair value yet' : 'good score, no price';
  } else if (p <= fmv.mid) {
    want = DIVE.PRIORITY; reason = `$${p} ≤ fair $${fmv.mid}`;
  } else if (p > fmv.mid * (1 + FMV_BUFFER)) {
    want = DIVE.WATCH; reason = `$${p} > fair $${fmv.mid} + 3%`;
  } else {
    // Inside the buffer: Priority stays Priority; anything else becomes Watch.
    if (current === DIVE.PRIORITY || current === DIVE.WATCH) return null;
    want = DIVE.WATCH; reason = `$${p} within 3% above fair $${fmv.mid}`;
  }
  return want === current ? null : { diveIn: want, reason };
}
