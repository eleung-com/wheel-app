// Every threshold the Investment Score uses, in one place. The scoring engine
// (scoring.js) reads only from here, so a rule change is a one-line edit plus a
// SCORING_VERSION bump. Old runs keep the version they were scored with (it is
// saved on each Notion "Stock Runs" row), so history stays explainable.
//
// Source of every number: PRD "Stock Research & Trade Ranker" v2.6, §6A and
// §6A-BUILD, plus the stock-watchlist-evaluator thresholds it builds on.

export const SCORING_VERSION = 'v2.5';

// ── Investment Score ─────────────────────────────────────────────────────────
// Quality 40% + Value 35% + Target upside 25%. A piece that is n/a (no P/E, no
// analyst coverage) is dropped and the remaining weights are scaled back to 100.
export const WEIGHTS = { quality: 0.40, value: 0.35, upside: 0.25 };

// Verdict cutoffs (decided 10-02), applied to the rounded score.
export const VERDICT = {
  WORTH: 'Worth investing',
  MAYBE: 'Maybe',
  NOT: 'Not worth it',
  NO_DATA: 'No score',
};
export const CUTOFFS = { worth: 75, maybe: 55 };

// Fix #1: quality under this → "Not worth it" whatever value and upside say.
export const QUALITY_FLOOR = 50;

// ── Quality (0–100) = evaluator checks (70) + Piotroski (30) ────────────────
export const QUALITY_POINTS = { checks: 70, piotroski: 30 };

// Revenue growth, TTM vs prior TTM, in %. Evaluator: >8 green, 0–8 yellow, <0 red.
export const REVENUE_GROWTH = { green: 8, yellow: 0 };

// Operating income growth (fix #5 replaces EPS growth). Evaluator: >5 green,
// 0–5 yellow, <0 red.
export const OP_INCOME_GROWTH = { green: 5, yellow: 0 };

// Fix #4: operating margin change smaller than ±2 points = flat (yellow).
export const MARGIN_FLAT_BAND_PTS = 2;

// Fix #6: D/E under 1.0 is always green. Fix #3: at 1.0+ compare to the peer
// AVERAGE — at/below = green, up to 1.5× = yellow, above = red.
export const DEBT = {
  alwaysGreenBelow: 1.0,
  peerYellowMultiple: 1.5,
  // Used only when no peer D/E is available at all (tagged "weak comparison").
  // These are the evaluator's original fixed bands.
  fallbackYellowMax: 2.0,
};

// Fix #10: "growing" operating cash flow means TTM growth above this (in %).
export const OCF_GROWING_ABOVE = 0;

// Fix #8: beat rate, adjusted EPS vs adjusted forecast, last 8 quarters.
// Evaluator: >75% green, 50–75% yellow, <50% red.
export const BEAT_RATE = { green: 75, yellow: 50, quarters: 8 };

// Piotroski needs at least this many of its 9 tests to have data; the score is
// then scaled from the tests that could be run (passed / run × 9).
export const PIOTROSKI_MIN_TESTS = 7;

// Altman Z below this → ⚠ tag only, never points (PRD: warning only).
export const ALTMAN_DANGER = 1.8;

// ── Value (0–100) = average of three parts, each 100 / 50 / 0 ───────────────
// Operating P/E (fix #9) vs own 5-yr median and vs peer median:
// at/below = 100 · up to 25% above = 50 · more = 0.
export const PE_BANDS = { halfPointsUpTo: 1.25 };
// Need at least this many positive yearly op P/Es to form an own-history median.
export const OWN_PE_MIN_YEARS = 2;
// Fix #7: fewer than this many usable peers → "weak comparison" tag.
export const MIN_PEERS = 3;
// PEG = operating P/E ÷ op-income growth % (3-yr, decided 10-02 as P1-4).
// <1 = 100 · 1–2 = 50 · >2 = 0.
export const PEG = { full: 1, half: 2, years: 3 };

// ── Target upside (0–100) ───────────────────────────────────────────────────
// 0% or below = 0 · 30%+ = 100 · straight line between.
export const UPSIDE_FULL_AT_PCT = 30;
