// Part 8C (PRD claude/wheel-app-prd-part8-value-vs-fair-value): v2.7 vs v2.8
// side by side, from the SAME fresh run, so the only difference is the rule.
// Nothing here writes anywhere — it's a preview El reviews before the switch.

import * as R from './rules.js';
import { verdictFor } from './scoring.js';
import { runPreliminary, rescoreFinal } from './run.js';
import { claudeInputs, scoreMap } from './runRecord.js';
import { fairValueInput } from './resultView.js';
import { nextQuarter } from './fundamentals.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const lerp = (v, fullAt, zeroAt) => Math.round(Math.max(0, Math.min(100, ((zeroAt - v) / (zeroAt - fullAt)) * 100)));

/**
 * What a v2.8 result would have scored under v2.7: own 5-yr P/E scored
 * (from its info line), the fair-value check ignored. Everything else equal.
 */
export function legacyV27(r) {
  if (!r) return null;
  const parts = r.value?.parts || [];
  const own = parts.find((p) => p.id === 'pe_own');
  let ownPts = null;
  if (own && own.display && own.display !== 'n/a' && isNum(r.metrics?.operatingPe)) {
    const med = Number(String(own.display).split(' vs ')[1]);
    if (isNum(med) && med > 0) ownPts = lerp(r.metrics.operatingPe / med, R.PE_SCALE.fullAt, R.PE_SCALE.zeroAt);
  }
  const kept = parts.filter((p) => (p.id === 'pe_peers' || p.id === 'peg') && p.points != null).map((p) => p.points);
  const vals = [...(ownPts != null ? [ownPts] : []), ...kept];
  const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const pieces = [['quality', r.quality?.score], ['value', value], ['upside', r.upside?.score]].filter(([, v]) => isNum(v));
  const wsum = pieces.reduce((s, [k]) => s + R.WEIGHTS[k], 0);
  const score = isNum(r.quality?.score) ? Math.round(pieces.reduce((s, [k, v]) => s + v * (R.WEIGHTS[k] / wsum), 0)) : null;
  const q = isNum(r.quality?.score) ? Math.round(r.quality.score) : null;
  return { value: value == null ? null : Math.round(value), score, verdict: verdictFor(score, q).verdict };
}

/** One comparison row from a v2.8 run result. */
export function compareRow(ticker, r) {
  const old = legacyV27(r);
  const fmv = (r?.value?.parts || []).find((p) => p.id === 'fmv');
  return {
    ticker,
    oldScore: old?.score ?? null, oldVerdict: old?.verdict ?? 'No score', oldValue: old?.value ?? null,
    newScore: r?.investmentScore ?? null, newVerdict: r?.verdict ?? 'No score', newValue: r?.value?.score ?? null,
    fmvNote: fmv?.points != null ? fmv.note : 'no fair value',
    flip: (old?.verdict ?? 'No score') !== (r?.verdict ?? 'No score'),
  };
}

/** Part 10A: gaps among the newest 12 quarters ("no quarter between 2025-09-30 and 2026-03-31"). */
export function quarterGaps(quarters = []) {
  const q = quarters.slice(-12), out = [];
  for (let i = 1; i < q.length; i++) if (!nextQuarter(q[i - 1], q[i])) out.push(`${String(q[i - 1].end).slice(0, 7)} → ${String(q[i].end).slice(0, 7)}`);
  return out;
}

/** Part 10A: the score saved in Notion vs a fresh re-score with today's rules. */
export function savedVsFresh(ticker, saved, res) {
  const r = res?.result || null;
  const gaps = quarterGaps(res?.bundle?.input?.quarters || []);
  const oldVerdict = saved?.verdict || 'No score', newVerdict = r?.verdict || 'No score';
  return {
    ticker,
    oldScore: saved?.score ?? null, oldVerdict, oldValue: saved?.value ?? null,
    newScore: r?.investmentScore ?? null, newVerdict, newValue: r?.value?.score ?? null,
    opPe: r?.metrics?.operatingPe ?? null,
    gaps,
    fmvNote: gaps.length ? `Missing quarter: ${gaps.join(', ')}` : 'No missing quarters',
    flip: oldVerdict !== newVerdict,
  };
}

/**
 * Re-score the watchlist in memory. Uses Claude's saved peers/target/beat rate
 * when the latest run has them (so it matches a Final), else Preliminary.
 * `onRow` streams rows as they finish; `shouldStop()` lets the screen cancel.
 */
export async function runDryRun({ transport, watchlist, runs, isIndex, onRow, onProgress = () => {}, shouldStop = () => false, pauseMs = 1200 }) {
  const latest = {};
  for (const r of runs || []) { const t = String(r.ticker || '').toUpperCase(); if (t && !latest[t]) latest[t] = r; }
  const scores = scoreMap(runs);
  const tickers = (watchlist || []).map((w) => w.ticker).filter((t) => !isIndex(t) && scores[t]);
  for (let i = 0; i < tickers.length; i++) {
    if (shouldStop()) break;
    const t = tickers[i];
    onProgress(i, tickers.length, t);
    try {
      let res = await runPreliminary(transport, t, { fairValue: fairValueInput(t, watchlist), rules: R.LIVE_RULES });
      const row = latest[t];
      if (res.result && row?.claudeWritten) res = await rescoreFinal(transport, res, claudeInputs(row));
      onRow(savedVsFresh(t, scores[t], res));
    } catch (e) {
      onRow({ ticker: t, error: String(e?.message || e).slice(0, 80) });
    }
    if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
  }
  onProgress(tickers.length, tickers.length, null);
}
