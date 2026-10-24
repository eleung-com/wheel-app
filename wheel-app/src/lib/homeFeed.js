// Part 6A (PRD claude/wheel-app-prd-part6-home-news-movers, approved 10-23):
// pure helpers behind the new Home tab — the market strip and Today's movers.

import { NO_EARNINGS } from './signalEngine';

// ── Market strip ─────────────────────────────────────────────────────────────
export const STRIP = [
  { sym: 'SPY',  label: 'SPY' },
  { sym: 'QQQ',  label: 'QQQ' },
  { sym: 'SMH',  label: 'SMH' },
  { sym: '^VIX', label: 'VIX' },
];

/**
 * Yahoo v8 "spark" (range=5d, interval=1d) → strip rows.
 * Last daily close = today's price (live while the market is open); the one
 * before it = yesterday's close, so the % is the normal "on the day" change.
 */
export function parseStrip(body) {
  return STRIP.map(({ sym, label }) => {
    const v = body && body[sym];
    const closes = v && Array.isArray(v.close) ? v.close.filter(x => typeof x === 'number') : [];
    const price = closes.length ? closes[closes.length - 1] : null;
    const prev  = closes.length > 1 ? closes[closes.length - 2] : null;
    const chgPct = price != null && prev ? Math.round(((price - prev) / prev) * 1000) / 10 : null;
    return { sym, label, price, chgPct };
  });
}

// ── Today's movers ──────────────────────────────────────────────────────────
export const MOVER_PCT = 5;

/** YYYY-MM-DD in New York — the date the Worker stamps on a move note. */
export function nyDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Today's movers: watchlist stocks that moved ±5% or more today, biggest first,
 * PLUS any stock with a Claude move note dated today (El, 10-24: Home and the
 * Watchlist card must match — a stock that was −6% at 10 AM and got a note
 * stays here even if it's back to −4% by 2 PM).
 * Index ETFs are left out (they live in the market strip).
 */
export function pickMovers(watchlist, heldTickers = new Set(), today = nyDate()) {
  const out = [];
  for (const w of watchlist || []) {
    if (!w || NO_EARNINGS.has(w.ticker)) continue;
    const live = w.liveData && typeof w.liveData.chg1d === 'number' ? w.liveData.chg1d : null;
    const note = moveNoteFor(w, today);
    const bigMove = live != null && Math.abs(live) >= MOVER_PCT;
    if (!bigMove && !note) continue;
    const chg = live != null ? live : note.pct;
    out.push({
      ticker: w.ticker,
      price:  w.liveData?.price ?? null,
      chg:    chg != null ? Math.round(chg * 10) / 10 : null,
      held:   heldTickers.has(w.ticker),
      note:   note ? note.text : null,
      link:   note ? note.link : null,
    });
  }
  return out.sort((a, b) => Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0));
}

/**
 * Part 6D: the move note to show on a Watchlist card, or null.
 * Shown only on the day it was written for (New York date).
 */
export function moveNoteFor(w, today = nyDate()) {
  if (!w || !w.moveNote) return null;
  if ((w.moveNoteDate || '').slice(0, 10) !== today) return null;
  const pct = typeof w.movePct === 'number' ? w.movePct
    : typeof w.liveData?.chg1d === 'number' ? Math.round(w.liveData.chg1d * 10) / 10 : null;
  return { text: w.moveNote, pct, link: w.moveLink || null };
}
