// Pure number helpers for the research scoring engine. No fetch, no globals —
// imported by both the browser and the Cloudflare Worker (explicit .js
// extensions for the same reason as signalEngine.js).
//
// Conventions used throughout:
//   • `quarters` are single-quarter figures (NOT year-to-date), oldest → newest.
//     The data layer (P1.1) is responsible for turning SEC's YTD / annual-only
//     numbers into single quarters before they get here.
//   • `capex` is a positive number (money spent).
//   • A missing figure is null/undefined, never 0. 0 is a real value.

import { PIOTROSKI_MIN_TESTS } from './rules.js';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function median(values) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function mean(values) {
  const xs = values.filter(isNum);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * Sum of `field` over 4 quarters ending `offset` quarters before the latest.
 * offset 0 = last twelve months (TTM), offset 4 = the twelve months before that.
 * Returns null if any of the 4 quarters is missing the field.
 */
export function ttm(quarters, field, offset = 0) {
  const end = quarters.length - offset;
  if (end < 4) return null;
  let sum = 0;
  for (let i = end - 4; i < end; i++) {
    const v = quarters[i]?.[field];
    if (!isNum(v)) return null;
    sum += v;
  }
  return sum;
}

/** Free cash flow for one quarter: operating cash flow − capex. */
export function fcfOf(q) {
  return isNum(q?.operatingCashFlow) && isNum(q?.capex) ? q.operatingCashFlow - q.capex : null;
}

/** % change from `prev` to `cur`. Null when prev is missing or not positive. */
export function pctChange(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

/**
 * Compound yearly growth in % from `start` to `end` over `years`.
 * Null when either end is missing or the start isn't positive (growth from a
 * loss has no meaningful rate). A positive start falling to ≤0 is −100%.
 */
export function cagr(start, end, years) {
  if (!isNum(start) || !isNum(end) || start <= 0 || years <= 0) return null;
  if (end <= 0) return -100;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

/** How many of the most recent quarters in a row had negative FCF. */
export function negativeFcfStreak(quarters) {
  let n = 0;
  for (let i = quarters.length - 1; i >= 0; i--) {
    const f = fcfOf(quarters[i]);
    if (!isNum(f) || f >= 0) break;
    n++;
  }
  return n;
}

const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

/**
 * Piotroski F-Score from the two most recent fiscal years.
 * Standard 9 tests; ROA uses end-of-year assets for both years (a common
 * simplification that avoids needing a third year of balance sheets).
 *
 * Companies don't all report every line (UBER has no gross profit line), so a
 * test without data is skipped rather than failed. If at least
 * PIOTROSKI_MIN_TESTS run, the score is scaled: passed / run × 9.
 *
 * @param {object} cur   latest fiscal year
 * @param {object} prev  fiscal year before it
 * @returns {{score:number|null, passed:number, run:number, tests:object[]}}
 */
export function piotroski(cur, prev) {
  if (!cur || !prev) return { score: null, passed: 0, run: 0, tests: [] };
  const roa = (y) => ratio(y.netIncome, y.totalAssets);
  const lev = (y) => ratio(y.longTermDebt, y.totalAssets);
  const cr = (y) => ratio(y.currentAssets, y.currentLiabilities);
  const gm = (y) => ratio(y.grossProfit, y.revenue);
  const at = (y) => ratio(y.revenue, y.totalAssets);
  const cmp = (a, b, fn) => (isNum(a) && isNum(b) ? fn(a, b) : null);

  const tests = [
    { id: 'roa_positive', label: 'Profitable (ROA > 0)', pass: cmp(roa(cur), 0, (a) => a > 0) },
    { id: 'cfo_positive', label: 'Operating cash flow > 0', pass: cmp(cur.operatingCashFlow, 0, (a) => a > 0) },
    { id: 'roa_up', label: 'ROA improved', pass: cmp(roa(cur), roa(prev), (a, b) => a > b) },
    { id: 'accruals', label: 'Cash flow > net income', pass: cmp(cur.operatingCashFlow, cur.netIncome, (a, b) => a > b) },
    { id: 'leverage_down', label: 'Long-term debt / assets fell', pass: cmp(lev(cur), lev(prev), (a, b) => a < b) },
    { id: 'current_ratio_up', label: 'Current ratio improved', pass: cmp(cr(cur), cr(prev), (a, b) => a > b) },
    { id: 'no_dilution', label: 'No new shares issued', pass: cmp(cur.sharesOutstanding, prev.sharesOutstanding, (a, b) => a <= b) },
    { id: 'gross_margin_up', label: 'Gross margin improved', pass: cmp(gm(cur), gm(prev), (a, b) => a > b) },
    { id: 'asset_turnover_up', label: 'Asset turnover improved', pass: cmp(at(cur), at(prev), (a, b) => a > b) },
  ];
  const ran = tests.filter((t) => t.pass !== null);
  const passed = ran.filter((t) => t.pass).length;
  const score = ran.length >= PIOTROSKI_MIN_TESTS ? (passed / ran.length) * 9 : null;
  return { score, passed, run: ran.length, tests };
}

/**
 * Original Altman Z-Score. EBIT ≈ operating income. Needs every input.
 * Z = 1.2·WC/TA + 1.4·RE/TA + 3.3·EBIT/TA + 0.6·MVE/TL + 1.0·Sales/TA
 */
export function altmanZ(y, marketCap) {
  const need = [y?.currentAssets, y?.currentLiabilities, y?.retainedEarnings, y?.operatingIncome,
    y?.totalLiabilities, y?.revenue, y?.totalAssets, marketCap];
  if (!need.every(isNum) || y.totalAssets <= 0 || y.totalLiabilities <= 0) return null;
  const ta = y.totalAssets;
  return 1.2 * ((y.currentAssets - y.currentLiabilities) / ta)
    + 1.4 * (y.retainedEarnings / ta)
    + 3.3 * (y.operatingIncome / ta)
    + 0.6 * (marketCap / y.totalLiabilities)
    + 1.0 * (y.revenue / ta);
}
