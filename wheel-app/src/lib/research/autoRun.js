// Part 4D: auto-run Research for watchlist stocks with no app score (or a
// score older than 90 days), and finish runs whose Claude write-up is in.
// Part 8 (10-24): also re-score runs made under older rules ('rescore', 8D)
// and Not-worth-it stocks whose price has fallen to fair value ('rescue', 8E).
// Both update the latest row in place and reuse Claude's research — no new
// Claude session.
// Runs in the app (it already holds the research keys), when it opens.
// Same steps as pressing Run / "Tap for Final" on the Research tab.

import { runPreliminary, rescoreFinal } from './run.js';
import { fairValueInput } from './resultView.js';
import { researchTransport } from './researchTransport.js';
import { saveRun, loadRuns } from './runStore.js';
import { claudeState, claudeInputs, SCORE_STALE_DAYS } from './runRecord.js';
import { LIVE_RULES } from './rules.js';
import { fmvOf } from '../fairValue.js';

export const AUTO_MAX = 3;            // stocks per app open (FMP / Finnhub free limits)
const RETRY_AFTER_MS = 20 * 3600e3;   // a failed ticker is retried the next day
const triedKey = (t) => `wd_autorun_${t}`;

function recentlyTried(t, now) {
  try { const v = Number(localStorage.getItem(triedKey(t)) || 0); return now - v < RETRY_AFTER_MS; }
  catch { return false; }
}
function markTried(t, now) { try { localStorage.setItem(triedKey(t), String(now)); } catch { /* private mode */ } }

/**
 * What to do this time. Pure — tested.
 * @param watchlist rows ({ ticker })
 * @param runs      latest Stock Runs rows (newest first), from loadRuns
 * @param isIndex   ticker → true for index/ETF symbols (never researched)
 * @returns [{ ticker, kind: 'new' | 'stale' | 'finish' | 'rescue' | 'rescore', row? }] (max AUTO_MAX)
 */
export function planAutoRuns(watchlist, runs, isIndex, { now = Date.now(), max = AUTO_MAX, tried = () => false } = {}) {
  const latest = {};
  for (const r of runs || []) {
    const t = String(r.ticker || '').toUpperCase();
    if (t && !latest[t]) latest[t] = r;
  }
  const finish = [], fresh = [], rescue = [], rescore = [], stale = [];
  for (const w of watchlist || []) {
    const t = w.ticker;
    if (!t || isIndex(t) || tried(t)) continue;
    const r = latest[t];
    if (!r) { fresh.push({ ticker: t, kind: 'new' }); continue; }
    if (r.investmentScore != null && claudeState(r, now) === 'done' && r.status !== 'Final') { finish.push({ ticker: t, kind: 'finish', row: r }); continue; }
    const age = r.runAt ? (now - Date.parse(r.runAt)) / 864e5 : Infinity;
    if (age > SCORE_STALE_DAYS) { stale.push({ ticker: t, kind: 'stale' }); continue; }
    // 8D: scored under older rules → bring it up to the live rules.
    if (r.investmentScore != null && r.version && r.version !== LIVE_RULES) { rescore.push({ ticker: t, kind: 'rescore', row: r }); continue; }
    // 8E Skip rescue: Not worth it with decent Quality, and today's price is at
    // or under fair value → the price part may no longer hold it down.
    const fmv = fmvOf(w);
    const price = w.liveData?.price;
    if (r.verdict === 'Not worth it' && (r.quality ?? 0) >= 50 && fmv && price && price <= fmv.mid) {
      rescue.push({ ticker: t, kind: 'rescue', row: r });
    }
  }
  // Finishing costs no Claude session, so it goes first; then never-scored,
  // Skip rescues, rule upgrades, then stale.
  return [...finish, ...fresh, ...rescue, ...rescore, ...stale].slice(0, max);
}

/** Run the plan one stock at a time. Never throws. Returns a short summary. */
export async function runAutoResearch(watchlist, isIndex, { onDone } = {}) {
  const now = Date.now();
  let runs = [];
  try { runs = await loadRuns({ limit: 50 }); } catch { return { done: [], failed: [] }; }
  const plan = planAutoRuns(watchlist, runs, isIndex, { now, tried: (t) => recentlyTried(t, now) });
  const done = [], failed = [];
  for (const p of plan) {
    markTried(p.ticker, now);
    try {
      const res = await runPreliminary(researchTransport, p.ticker, { fairValue: fairValueInput(p.ticker, watchlist) }); // v2.8
      if (p.kind === 'rescore' || p.kind === 'rescue') {
        if (!res.result) throw new Error('no score');
        // Reuse Claude's research when it exists; update the latest row in place.
        const out = claudeState(p.row, now) === 'done' ? await rescoreFinal(researchTransport, res, claudeInputs(p.row)) : res;
        await saveRun(out, { pageId: p.row.pageId });
        const was = p.row.verdict && out.result.verdict !== p.row.verdict ? ` (was ${p.row.verdict})` : '';
        done.push(`${p.ticker} ${p.kind === 'rescue' ? 're-checked' : 'updated'} ${out.result.investmentScore ?? '—'}${was}`);
      } else if (p.kind === 'finish') {
        if (!res.result) throw new Error('no score');
        const final = await rescoreFinal(researchTransport, res, claudeInputs(p.row));
        await saveRun(final, { pageId: p.row.pageId });
        done.push(`${p.ticker} final ${final.result.investmentScore ?? '—'}`);
      } else {
        await saveRun(res);   // saves the Preliminary score + starts the Claude write-up
        done.push(`${p.ticker} ${res.result ? res.result.investmentScore ?? '—' : 'no score'}`);
      }
    } catch (e) {
      failed.push(p.ticker);
      console.warn('[auto-research]', p.ticker, e?.message || e);
    }
  }
  if (plan.length) onDone?.({ done, failed });
  return { done, failed };
}
