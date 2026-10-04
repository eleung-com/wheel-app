// Research scoring engine: "Is this stock worth investing in?"
//
// Pure math, no AI, no fetch. Same input → same output, every time. Answers
// ONLY the investment question — earnings dates, trend, IVR and dividends are
// trade-timing inputs and are deliberately absent (PRD §6A, decided 10-02).
//
// Input is the cleaned bundle the Worker's data layer assembles (P1.1/P1.3) plus
// whatever the Claude routine has filled in (peers, target, beat rate). See
// `scoreStock` for the exact shape.

import * as R from './rules.js';
import {
  isNum, median, mean, ttm, fcfOf, pctChange, cagr, negativeFcfStreak, piotroski, altmanZ,
} from './fundamentals.js';

const GREEN = 'green', YELLOW = 'yellow', RED = 'red', NA = 'na';
const round1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);

// ── Individual quality checks ───────────────────────────────────────────────
// Each returns { id, label, color, value, display, rule, note? }. Points are
// assigned afterwards, once we know how many checks have usable data.

function checkRevenueGrowth(q) {
  const g = pctChange(ttm(q, 'revenue'), ttm(q, 'revenue', 4));
  const rule = 'Revenue, last 12 months vs the 12 before: >8% green · 0–8% yellow · falling red';
  if (g === null) return { id: 'revenue_growth', label: 'Revenue growth', color: NA, value: null, display: 'n/a', rule, note: 'Needs 8 quarters of revenue' };
  const color = g > R.REVENUE_GROWTH.green ? GREEN : g >= R.REVENUE_GROWTH.yellow ? YELLOW : RED;
  return { id: 'revenue_growth', label: 'Revenue growth', color, value: round1(g), display: `${g >= 0 ? '+' : ''}${round1(g)}%`, rule };
}

// Fix #5: operating income, not net income.
function checkOpIncomeGrowth(q) {
  const cur = ttm(q, 'operatingIncome'), prev = ttm(q, 'operatingIncome', 4);
  const rule = 'Operating income, last 12 months vs the 12 before: >5% green · 0–5% yellow · falling red (fix #5: not net income)';
  const base = { id: 'op_income_growth', label: 'Operating income growth', rule };
  if (!isNum(cur) || !isNum(prev)) return { ...base, color: NA, value: null, display: 'n/a', note: 'Needs 8 quarters of operating income' };
  // A loss a year ago makes a % meaningless; judge the direction instead.
  if (prev <= 0) {
    return cur > 0
      ? { ...base, color: GREEN, value: null, display: 'turned profitable', note: 'Operating loss a year ago, profit now' }
      : { ...base, color: RED, value: null, display: 'operating loss', note: 'Operating loss in both periods' };
  }
  const g = pctChange(cur, prev);
  const color = g > R.OP_INCOME_GROWTH.green ? GREEN : g >= R.OP_INCOME_GROWTH.yellow ? YELLOW : RED;
  return { ...base, color, value: round1(g), display: `${g >= 0 ? '+' : ''}${round1(g)}%` };
}

// Fix #4 (±2 pt flat band) on operating margin (fix #5).
function checkMarginTrend(q) {
  const m = (off) => {
    const oi = ttm(q, 'operatingIncome', off), rev = ttm(q, 'revenue', off);
    return isNum(oi) && isNum(rev) && rev > 0 ? (oi / rev) * 100 : null;
  };
  const cur = m(0), prev = m(4);
  const rule = 'Operating margin change vs a year ago: up >2 pts green · within ±2 pts yellow (flat) · down >2 pts red (fix #4)';
  if (cur === null || prev === null) return { id: 'margin_trend', label: 'Operating margin trend', color: NA, value: null, display: 'n/a', rule, note: 'Needs 8 quarters of revenue + operating income' };
  const d = cur - prev;
  const color = d > R.MARGIN_FLAT_BAND_PTS ? GREEN : d < -R.MARGIN_FLAT_BAND_PTS ? RED : YELLOW;
  return { id: 'margin_trend', label: 'Operating margin trend', color, value: round1(d), display: `${d >= 0 ? '+' : ''}${round1(d)} pts`, rule, note: `${round1(prev)}% → ${round1(cur)}%` };
}

// Fix #6 (<1.0 always green) then fix #3 (vs peer average).
function checkDebt(balance, peerList, tags) {
  const rule = 'Debt ÷ equity: under 1.0 always green (fix #6). At 1.0+: vs peer average — at/below green · up to 1.5× yellow · above red (fix #3)';
  const base = { id: 'debt_to_equity', label: 'Debt-to-equity', rule };
  const debt = balance?.totalDebt, eq = balance?.equity;
  if (!isNum(debt) || !isNum(eq)) return { ...base, color: NA, value: null, display: 'n/a', note: 'Debt or equity missing' };
  if (eq <= 0) {
    tags.push({ code: 'negative_equity', text: 'Negative shareholder equity — debt-to-equity can’t be judged, check manually' });
    return { ...base, color: NA, value: null, display: 'neg. equity', note: 'Equity ≤ 0 (often heavy buybacks); left out of the score' };
  }
  const de = debt / eq;
  const display = de.toFixed(2);
  if (de < R.DEBT.alwaysGreenBelow) return { ...base, color: GREEN, value: de, display, note: 'Under 1.0 — peers not needed' };

  const peerDes = peerList.map((p) => p.debtToEquity).filter((v) => isNum(v) && v >= 0);
  if (!peerDes.length) {
    tags.push({ code: 'weak_comparison_debt', text: 'No peer debt data — debt judged on fixed 1.0 / 2.0 bands' });
    const color = de <= R.DEBT.fallbackYellowMax ? YELLOW : RED;
    return { ...base, color, value: de, display, note: 'Fallback bands: 1.0–2.0 yellow · >2.0 red' };
  }
  const avg = mean(peerDes);
  const color = de <= avg ? GREEN : de <= avg * R.DEBT.peerYellowMultiple ? YELLOW : RED;
  return { ...base, color, value: de, display, note: `Peer average ${avg.toFixed(2)} (${peerDes.length} peers)` };
}

// Fix #10: cash generation + positive FCF; capex shown separately by the UI.
function checkFcf(q, tags) {
  const rule = 'Green = operating cash flow growing AND free cash flow positive · yellow = FCF positive but cash flow flat/falling · red = FCF negative (last 12 months) (fix #10)';
  const base = { id: 'fcf', label: 'Free cash flow', rule };
  const fcf = (() => {
    const last4 = q.slice(-4).map(fcfOf);
    return last4.length === 4 && last4.every(isNum) ? last4.reduce((a, b) => a + b, 0) : null;
  })();
  if (negativeFcfStreak(q) >= 2) tags.push({ code: 'fcf_negative_streak', text: `FCF negative ${negativeFcfStreak(q)} quarters in a row` });
  if (fcf === null) return { ...base, color: NA, value: null, display: 'n/a', note: 'Needs 4 quarters of cash flow + capex' };
  if (fcf <= 0) return { ...base, color: RED, value: fcf, display: 'FCF negative', note: 'Free cash flow ≤ 0 over the last 12 months' };
  const g = pctChange(ttm(q, 'operatingCashFlow'), ttm(q, 'operatingCashFlow', 4));
  if (g === null) return { ...base, color: YELLOW, value: fcf, display: 'FCF positive', note: 'Can’t measure cash-flow growth (needs 8 quarters) — scored as flat' };
  const color = g > R.OCF_GROWING_ABOVE ? GREEN : YELLOW;
  return { ...base, color, value: fcf, display: `op cash ${g >= 0 ? '+' : ''}${round1(g)}%`, note: 'FCF positive' };
}

// Fix #8: adjusted vs adjusted, 8 quarters, stale → n/a.
function checkBeatRate(beat) {
  const rule = 'Adjusted EPS vs adjusted forecast, last 8 quarters: >75% green · 50–75% yellow · <50% red (fix #8)';
  const base = { id: 'beat_rate', label: 'Beat rate', rule };
  if (!beat) return { ...base, color: NA, value: null, display: 'pending', note: 'Filled by the Claude routine' };
  if (beat.stale || !isNum(beat.beats) || !isNum(beat.total) || beat.total <= 0) {
    return { ...base, color: NA, value: null, display: 'n/a', note: beat.stale ? 'Source more than 1 quarter behind' : 'No like-for-like adjusted numbers' };
  }
  const pct = (beat.beats / beat.total) * 100;
  const color = pct > R.BEAT_RATE.green ? GREEN : pct >= R.BEAT_RATE.yellow ? YELLOW : RED;
  return { ...base, color, value: round1(pct), display: `${beat.beats} of ${beat.total}` };
}

function scoreQuality(input, peerList, tags) {
  const q = input.quarters || [];
  const checks = [
    checkRevenueGrowth(q),
    checkOpIncomeGrowth(q),
    checkMarginTrend(q),
    checkDebt(input.balance, peerList, tags),
    checkFcf(q, tags),
    checkBeatRate(input.beatRate),
  ];
  // A check with no usable data is left out; the rest share its points.
  const usable = checks.filter((c) => c.color !== NA);
  const each = usable.length ? R.QUALITY_POINTS.checks / usable.length : 0;
  for (const c of checks) {
    c.maxPoints = c.color === NA ? 0 : each;
    c.points = c.color === GREEN ? each : c.color === YELLOW ? each / 2 : 0;
  }
  const checkPts = checks.reduce((s, c) => s + c.points, 0);

  const annual = input.annual || [];
  const pio = piotroski(annual[annual.length - 1], annual[annual.length - 2]);
  const pioPts = pio.score === null ? null : (pio.score / 9) * R.QUALITY_POINTS.piotroski;

  const z = altmanZ(annual[annual.length - 1], marketCapOf(input));
  if (isNum(z) && z < R.ALTMAN_DANGER) tags.push({ code: 'altman_danger', text: `Altman Z ${z.toFixed(1)} — below 1.8 (financial-distress zone)` });

  let score = null;
  if (usable.length && pioPts !== null) score = checkPts + pioPts;
  else if (usable.length) score = (checkPts / R.QUALITY_POINTS.checks) * 100; // no Piotroski → checks carry 100
  else if (pioPts !== null) score = (pio.score / 9) * 100;                     // no checks → Piotroski carries 100
  return { score, checkPoints: checkPts, piotroski: pio, piotroskiPoints: pioPts, altmanZ: z, checks };
}

// ── Value ──────────────────────────────────────────────────────────────────

function marketCapOf(input) {
  return isNum(input.price) && isNum(input.sharesOutstanding) ? input.price * input.sharesOutstanding : null;
}

/** Fix #9: operating P/E = market cap ÷ operating income (last 12 months), no tax adjustment. */
export function operatingPe(input) {
  const mc = marketCapOf(input), oi = ttm(input.quarters || [], 'operatingIncome');
  return isNum(mc) && isNum(oi) && oi > 0 ? mc / oi : null;
}

/** Straight line: value at `fullAt` (or better) → 100, at `zeroAt` (or worse) → 0. */
const lerpPoints = (v, fullAt, zeroAt) => Math.round(Math.max(0, Math.min(100, ((zeroAt - v) / (zeroAt - fullAt)) * 100)));
/** v2.7: P/E vs a reference P/E, smooth (see rules.js PE_SCALE). */
const peBandPoints = (pe, ref) => lerpPoints(pe / ref, R.PE_SCALE.fullAt, R.PE_SCALE.zeroAt);

function scoreValue(input, opPe, peerList, tags, peerSource) {
  const parts = [];
  const nameOwn = 'Operating P/E vs own 5-yr median';
  const namePeer = 'Operating P/E vs peer median';
  const namePeg = 'PEG (operating)';
  const ruleBands = '25%+ cheaper = 100 · equal = 50 · 25%+ dearer = 0 · straight line between';

  if (opPe === null) {
    tags.push({ code: 'no_operating_profit', text: 'No operating profit — no P/E, can’t rank on value' });
    for (const [id, label] of [['pe_own', nameOwn], ['pe_peers', namePeer], ['peg', namePeg]]) {
      parts.push({ id, label, points: null, display: 'n/a', rule: ruleBands });
    }
    return { score: null, opPe: null, parts };
  }

  // Own history: last 5 yearly op P/Es, negatives/zero left out (fix #2: median).
  const hist = (input.opPeHistory || []).slice(-5).map((h) => h?.opPe).filter((v) => isNum(v) && v > 0);
  if (hist.length >= R.OWN_PE_MIN_YEARS) {
    const med = median(hist);
    parts.push({ id: 'pe_own', label: nameOwn, points: peBandPoints(opPe, med), display: `${opPe.toFixed(1)} vs ${med.toFixed(1)}`, rule: ruleBands, note: `${hist.length} profitable years in the median` });
  } else {
    parts.push({ id: 'pe_own', label: nameOwn, points: null, display: 'n/a', rule: ruleBands, note: `Only ${hist.length} profitable year(s) of history` });
  }

  // Peers (fix #7): negative/zero op P/E excluded, median used.
  let peerPes = peerList.map((p) => p.opPe).filter((v) => isNum(v) && v > 0);
  if (peerSource === 'auto') {
    // Auto-peer outlier rule (v2.6): P/E > 3× the stock's own is left out.
    const cap = opPe * R.AUTO_PEERS.outlierMultiple;
    const outliers = peerList.filter((p) => isNum(p.opPe) && p.opPe > cap).map((p) => p.ticker);
    peerPes = peerPes.filter((v) => v <= cap);
    if (outliers.length) tags.push({ code: 'peer_outliers', text: `Left out as P/E outliers (>3× this stock's): ${outliers.join(', ')}` });
    if (peerPes.length < R.AUTO_PEERS.minSensible) {
      tags.push({ code: 'auto_peers_insufficient', text: `${peerPes.length ? `Only ${peerPes.length}` : 'No'} sensible auto-peer${peerPes.length === 1 ? '' : 's'} — peer comparison waits for Claude's peers` });
      parts.push({ id: 'pe_peers', label: namePeer, points: null, display: 'n/a', rule: ruleBands, note: 'Fewer than 3 sensible auto-peers' });
      peerPes = null;
    }
  }
  if (peerPes === null) {
    // handled above (auto-peers too thin)
  } else if (peerPes.length >= R.MIN_PEERS) {
    const med = median(peerPes);
    parts.push({ id: 'pe_peers', label: namePeer, points: peBandPoints(opPe, med), display: `${opPe.toFixed(1)} vs ${med.toFixed(1)}`, rule: ruleBands, note: `${peerPes.length} peers` });
  } else if (peerPes.length) {
    // v2.7: too few to trust a median — left out rather than scored.
    tags.push({ code: 'weak_comparison', text: `Only ${peerPes.length} usable peer(s) — peer comparison left out` });
    parts.push({ id: 'pe_peers', label: namePeer, points: null, display: 'n/a', rule: ruleBands, note: `Only ${peerPes.length} peer(s) with a positive operating P/E (need ${R.MIN_PEERS})` });
  } else {
    tags.push({ code: 'weak_comparison', text: 'No usable peers — peer comparison left out' });
    parts.push({ id: 'pe_peers', label: namePeer, points: null, display: 'n/a', rule: ruleBands, note: 'No peers with a positive operating P/E' });
  }

  // PEG on 3-yr compound op-income growth (P1-4: trailing, pure math).
  const g = pegGrowth(input);
  const pegRule = 'Operating P/E ÷ 3-yr yearly op-income growth %: ≤0.5 = 100 · ≥2 = 0 · straight line between';
  if (g === null) {
    parts.push({ id: 'peg', label: namePeg, points: null, display: 'n/a', rule: pegRule, note: 'Needs 3 years of operating income, starting positive' });
  } else if (g <= 0) {
    parts.push({ id: 'peg', label: namePeg, points: 0, display: 'no growth', rule: pegRule, note: `Op income growth ${round1(g)}%/yr` });
  } else {
    const peg = opPe / g;
    const points = lerpPoints(peg, R.PEG.fullAt, R.PEG.zeroAt);
    parts.push({ id: 'peg', label: namePeg, points, display: peg.toFixed(2), rule: pegRule, note: `Op P/E ${opPe.toFixed(1)} ÷ ${round1(g)}%/yr` });
  }

  const scored = parts.filter((p) => p.points !== null);
  return { score: scored.length ? mean(scored.map((p) => p.points)) : null, opPe, parts };
}

/** 3-yr compound op-income growth: TTM now vs TTM 3 years ago, else fiscal years. */
function pegGrowth(input) {
  const q = input.quarters || [];
  const viaQ = cagr(ttm(q, 'operatingIncome', 12), ttm(q, 'operatingIncome'), R.PEG.years);
  if (viaQ !== null) return viaQ;
  const a = input.annual || [];
  if (a.length < R.PEG.years + 1) return null;
  return cagr(a[a.length - 1 - R.PEG.years]?.operatingIncome, a[a.length - 1]?.operatingIncome, R.PEG.years);
}

// ── Upside ─────────────────────────────────────────────────────────────────

function scoreUpside(input, tags) {
  const t = input.analystTarget;
  if (!t || !isNum(t.value) || !isNum(input.price) || input.price <= 0) {
    tags.push({ code: 'no_target', text: 'No analyst target yet — upside left out' });
    return { score: null, pct: null, target: t || null };
  }
  const pct = ((t.value - input.price) / input.price) * 100;
  const score = Math.max(0, Math.min(100, (pct / R.UPSIDE_FULL_AT_PCT) * 100));
  return { score, pct, target: t };
}

// ── Verdict ────────────────────────────────────────────────────────────────

/** Fix #1 floor first, then the 75 / 55 cutoffs. Both inputs already rounded. */
export function verdictFor(investmentScore, qualityScore) {
  if (!isNum(investmentScore) || !isNum(qualityScore)) {
    return { verdict: R.VERDICT.NO_DATA, verdictReason: 'Not enough company data to score' };
  }
  if (qualityScore < R.QUALITY_FLOOR) {
    return { verdict: R.VERDICT.NOT, verdictReason: `Quality ${qualityScore} is under the ${R.QUALITY_FLOOR} floor (fix #1)` };
  }
  if (investmentScore >= R.CUTOFFS.worth) return { verdict: R.VERDICT.WORTH, verdictReason: `Score ${investmentScore} ≥ ${R.CUTOFFS.worth}` };
  if (investmentScore >= R.CUTOFFS.maybe) return { verdict: R.VERDICT.MAYBE, verdictReason: `Score ${investmentScore} is ${R.CUTOFFS.maybe}–${R.CUTOFFS.worth - 1}` };
  return { verdict: R.VERDICT.NOT, verdictReason: `Score ${investmentScore} < ${R.CUTOFFS.maybe}` };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Score one stock.
 *
 * @param {object} input
 * @param {string} input.ticker
 * @param {'preliminary'|'final'} [input.stage]  final once the Claude routine has written back
 * @param {number} input.price                   latest price
 * @param {number} input.sharesOutstanding
 * @param {object[]} input.quarters              single-quarter figures, oldest → newest (≤20):
 *        { end, revenue, operatingIncome, netIncome, operatingCashFlow, capex }
 * @param {object} input.balance                 latest balance sheet: { totalDebt, equity }
 * @param {object[]} input.annual                fiscal years, oldest → newest:
 *        { fy, revenue, grossProfit, operatingIncome, netIncome, operatingCashFlow, totalAssets,
 *          totalLiabilities, currentAssets, currentLiabilities, longTermDebt, retainedEarnings,
 *          sharesOutstanding }
 * @param {object[]} input.opPeHistory           [{ year, opPe }] — year-end market cap ÷ FY op income
 * @param {object} input.peers                   { source: 'auto'|'claude', list: [{ ticker, opPe, debtToEquity }] }
 * @param {object|null} input.analystTarget      { value, source, asOf }
 * @param {object|null} input.beatRate           { beats, total, stale } — null = not known yet
 */
export function scoreStock(input) {
  const tags = [];
  const peerList = input.peers?.list || [];
  const stage = input.stage === 'final' ? 'final' : 'preliminary';

  const quality = scoreQuality(input, peerList, tags);
  const opPe = operatingPe(input);
  const value = scoreValue(input, opPe, peerList, tags, input.peers?.source || null);
  const upside = scoreUpside(input, tags);

  // Reported (net-income) P/E — shown only, never scored (fix #9).
  const mc = marketCapOf(input);
  const ni = ttm(input.quarters || [], 'netIncome');
  const reportedPe = isNum(mc) && isNum(ni) && ni > 0 ? mc / ni : null;

  const pieces = [['quality', quality.score], ['value', value.score], ['upside', upside.score]]
    .filter(([, s]) => isNum(s));
  const weightSum = pieces.reduce((s, [k]) => s + R.WEIGHTS[k], 0);
  const weightsUsed = Object.fromEntries(pieces.map(([k]) => [k, R.WEIGHTS[k] / weightSum]));

  let investmentScore = null;
  if (isNum(quality.score)) investmentScore = Math.round(pieces.reduce((sum, [k, v]) => sum + v * weightsUsed[k], 0));
  const { verdict, verdictReason } = verdictFor(investmentScore, isNum(quality.score) ? Math.round(quality.score) : null);

  return {
    ticker: input.ticker,
    version: R.SCORING_VERSION,
    scoreType: stage === 'final' ? 'Final' : 'Preliminary',
    peerSource: input.peers?.source || null,
    investmentScore,
    verdict,
    verdictReason,
    weightsUsed,
    quality: { ...quality, score: isNum(quality.score) ? Math.round(quality.score) : null },
    value: { ...value, score: isNum(value.score) ? Math.round(value.score) : null },
    upside: { ...upside, score: isNum(upside.score) ? Math.round(upside.score) : null, pct: round1(upside.pct) },
    metrics: { marketCap: mc, operatingPe: opPe, reportedPe },
    tags,
  };
}
