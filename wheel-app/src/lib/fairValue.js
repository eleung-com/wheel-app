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
  // High = the bigger of the DCF bull case and Fair (El, 10-12): the bull DCF
  // can land under the blend when analyst targets pull Fair up.
  const high = num(row.fmvHigh);
  return { low: num(row.fmvLow), mid, high: high != null ? Math.max(high, mid) : null, date: (row.fmvDate || '').slice(0, 10) || null };
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

// ── Watchlist tab (Part 3W) ─────────────────────────────────────────────────
// Groups follow the LIVE price with the same rule the daily job applies to
// Dive-In (decided 10-12), so the tab never disagrees with the rule even
// between the 9:40am updates.
export const CLOSE_PCT = 10;   // within 10% above fair = "Close"
export const WL_GROUPS = ['ready', 'close', 'wait', 'todo', 'skip', 'idx'];
const OVERRIDE_GROUP = { [DIVE.PRIORITY]: 'ready', [DIVE.SKIP]: 'skip' };

/**
 * Where a watchlist row sits on the Watchlist tab, and the one-line "why".
 * @param row       watchlist row (diveIn, fmvLow/Mid/High, fmvDate)
 * @param score     scoreMap entry ({ verdict, score }) or null
 * @param price     live price or null
 * @param isIndex   index/ETF row
 * @param override  El's manual Dive-In ('🔥 Priority' …) or null
 * @returns { group, pct, why, tag }
 */
export function watchlistGroup({ row = {}, score = null, price = null, isIndex = false, override = null }) {
  if (isIndex) return { group: 'idx', pct: null, why: 'Index · LEAPS live in Signals', tag: null };
  const fmv = fmvOf(row);
  const p = num(price);
  const pct = p && fmv ? vsMidPct(p, fmv) : null;
  const priceWhy = () => (pct == null ? null
    : pct <= 0 ? `${Math.abs(pct)}% under fair value · in buy zone`
      : `${pct}% over fair · Priority at ≤ $${fmv.mid}`);

  if (override) {
    const g = OVERRIDE_GROUP[override] || (pct != null && pct <= CLOSE_PCT ? 'close' : 'wait');
    return { group: g, pct, why: priceWhy() || `Set by you: ${override}`, tag: 'Your call' };
  }
  const verdict = score && score.verdict && score.verdict !== 'No score' ? score.verdict : null;
  if (verdict && !GOOD.has(verdict)) return { group: 'skip', pct, why: `Score ${score.score ?? '—'} · ${verdict}`, tag: null };
  if (!verdict) return { group: 'todo', pct, why: 'No app score yet — run it in Research', tag: null };
  if (!fmv) return { group: 'todo', pct, why: 'Fair value not set yet — fills on the Monday run', tag: null };
  if (!p) {
    const g = row.diveIn === DIVE.PRIORITY ? 'ready' : 'wait';
    return { group: g, pct, why: 'No live price — showing Notion Dive-In', tag: null };
  }
  if (pct <= 0) return { group: 'ready', pct, why: priceWhy(), tag: null };
  // Same 3% buffer as the daily job: a Priority stock stays Priority until > Mid + 3%.
  if (row.diveIn === DIVE.PRIORITY && pct <= FMV_BUFFER * 100) {
    return { group: 'ready', pct, why: `${pct}% over fair · stays Priority until +3%`, tag: null };
  }
  return { group: pct <= CLOSE_PCT ? 'close' : 'wait', pct, why: priceWhy(), tag: null };
}

/** Sort key inside a group: closest to fair value first, unknowns last. */
export function wlSortKey(item) {
  return item.pct == null ? Infinity : item.pct;
}
