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
  isNum, median, mean, ttm, fcfOf, pctChange, cagr, negativeFcfStreak, piotroski, altmanZ, consecutiveRun,
} from './fundamentals.js';

const GREEN = 'green', YELLOW = 'yellow', RED = 'red', NA = 'na';
/** Part 8: which rules this score uses — input.rules ('v2.8' for the dry run) or what's live. */
const rulesOf = (input) => (input && input.rules) || R.LIVE_RULES;
const round1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);
/** Part 8/10: Value check 1 is price vs fair value from v2.8 on. */
const fmvRules = (input) => rulesOf(input) !== 'v2.7';

// ── Part 10 (v2.9): new listings ────────────────────────────────────────────
// Under 8 back-to-back quarters of SEC data (SPCX: public June 2026) — the
// 12-month vs 12-month checks can't run, so growth compares the newest quarters
// with the same quarters a year earlier. Yearly-only (synthetic) series are
// foreign filers with long histories, never "new".
export function isNewListing(quarters = []) {
  if (!quarters.length || quarters[0]?.synthetic) return false;
  return consecutiveRun(quarters) < R.NEW_LISTING_QUARTERS;
}

const DAY = 86400000;
const endMs = (q) => Date.parse(String(q?.end ?? '').slice(0, 10));
/** The quarter that ended about a year before `q` (365 ± 20 days), or null. */
function yearAgo(quarters, q) {
  const t = endMs(q);
  if (!Number.isFinite(t)) return null;
  return quarters.find((x) => Math.abs((t - endMs(x)) / DAY - 365) <= 20) || null;
}
/**
 * Newest quarters (up to 4) that have a year-earlier twin, both with `field`.
 * Stops at the first quarter without one, so the two sums cover the same months.
 */
export function sameQuartersYearAgo(quarters, field, max = 4) {
  let cur = 0, prev = 0, n = 0;
  const ends = [];
  for (let i = quarters.length - 1; i >= 0 && n < max; i--) {
    const q = quarters[i], twin = yearAgo(quarters, q);
    if (!twin || !isNum(q[field]) || !isNum(twin[field])) break;
    cur += q[field]; prev += twin[field]; n++; ends.unshift(String(q.end).slice(0, 7));
  }
  return n ? { cur, prev, n, ends } : null;
}

/**
 * The two periods every growth check compares. Normal: last 12 months vs the
 * 12 before. New listing: newest quarters vs the same quarters a year earlier.
 */
function periodsFor(q, newListing) {
  if (!newListing) {
    return {
      cur: (f) => ttm(q, f), prev: (f) => ttm(q, f, 4),
      label: 'last 12 months vs the 12 before', need: 'Needs 8 quarters',
    };
  }
  return {
    cur: (f) => sameQuartersYearAgo(q, f)?.cur ?? null,
    prev: (f) => sameQuartersYearAgo(q, f)?.prev ?? null,
    label: 'newest quarters vs the same quarters a year earlier (new listing)',
    need: 'Needs at least 1 quarter with a year-earlier match',
    span: (f) => { const w = sameQuartersYearAgo(q, f); return w ? `${w.n} quarter${w.n === 1 ? '' : 's'} (${w.ends.join(', ')}) vs a year earlier` : null; },
  };
}

// ── Individual quality checks ───────────────────────────────────────────────
// Each returns { id, label, color, value, display, rule, note? }. Points are
// assigned afterwards, once we know how many checks have usable data.

function checkRevenueGrowth(q, P) {
  const g = pctChange(P.cur('revenue'), P.prev('revenue'));
  const rule = `Revenue, ${P.label}: >8% green · 0–8% yellow · falling red`;
  if (g === null) return { id: 'revenue_growth', label: 'Revenue growth', color: NA, value: null, display: 'n/a', rule, note: `${P.need} of revenue` };
  const color = g > R.REVENUE_GROWTH.green ? GREEN : g >= R.REVENUE_GROWTH.yellow ? YELLOW : RED;
  return { id: 'revenue_growth', label: 'Revenue growth', color, value: round1(g), display: `${g >= 0 ? '+' : ''}${round1(g)}%`, rule, ...(P.span ? { note: P.span('revenue') } : {}) };
}

// Fix #5: operating income, not net income.
function checkOpIncomeGrowth(q, P) {
  const cur = P.cur('operatingIncome'), prev = P.prev('operatingIncome');
  const rule = `Operating income, ${P.label}: >5% green · 0–5% yellow · falling red (fix #5: not net income)`;
  const base = { id: 'op_income_growth', label: 'Operating income growth', rule };
  if (!isNum(cur) || !isNum(prev)) return { ...base, color: NA, value: null, display: 'n/a', note: `${P.need} of operating income` };
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
function checkMarginTrend(q, P) {
  const m = (pick) => {
    const oi = pick('operatingIncome'), rev = pick('revenue');
    return isNum(oi) && isNum(rev) && rev > 0 ? (oi / rev) * 100 : null;
  };
  const cur = m(P.cur), prev = m(P.prev);
  const rule = `Operating margin, ${P.label}: up >2 pts green · within ±2 pts yellow (flat) · down >2 pts red (fix #4)`;
  if (cur === null || prev === null) return { id: 'margin_trend', label: 'Operating margin trend', color: NA, value: null, display: 'n/a', rule, note: `${P.need} of revenue + operating income` };
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
function checkFcf(q, tags, P, newListing) {
  const rule = `Green = operating cash flow growing AND free cash flow positive · yellow = FCF positive but cash flow flat/falling · red = FCF negative (${newListing ? 'newest quarters' : 'last 12 months'}) (fix #10)`;
  const base = { id: 'fcf', label: 'Free cash flow', rule };
  const fcf = (() => {
    // New listing: the newest back-to-back quarters (up to 4) instead of a full year.
    const k = newListing ? Math.min(4, consecutiveRun(q)) : 4;
    const last = q.slice(-k).map(fcfOf);
    return k > 0 && last.length === k && last.every(isNum) ? last.reduce((a, b) => a + b, 0) : null;
  })();
  if (negativeFcfStreak(q) >= 2) tags.push({ code: 'fcf_negative_streak', text: `FCF negative ${negativeFcfStreak(q)} quarters in a row` });
  if (fcf === null) return { ...base, color: NA, value: null, display: 'n/a', note: 'Needs 4 quarters of cash flow + capex' };
  if (fcf <= 0) return { ...base, color: RED, value: fcf, display: 'FCF negative', note: 'Free cash flow ≤ 0 over the last 12 months' };
  const g = pctChange(P.cur('operatingCashFlow'), P.prev('operatingCashFlow'));
  if (g === null) return { ...base, color: YELLOW, value: fcf, display: 'FCF positive', note: 'Can’t measure cash-flow growth — scored as flat' };
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

function scoreQuality(input, peerList, tags, newListing = false) {
  const q = input.quarters || [];
  const P = periodsFor(q, newListing);
  const checks = [
    checkRevenueGrowth(q, P),
    checkOpIncomeGrowth(q, P),
    checkMarginTrend(q, P),
    checkDebt(input.balance, peerList, tags),
    checkFcf(q, tags, P, newListing),
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

/**
 * Part 10D: P/E for context. Trailing = 12 months when there are 4 back-to-back
 * quarters, else (new listing) the newest back-to-back quarters annualized.
 * @returns {{ pe, basis, loss }}
 */
export function trailingOpPe(input) {
  const pe = operatingPe(input);
  if (pe !== null) return { pe, basis: '12 months', loss: false };
  const q = input.quarters || [], mc = marketCapOf(input);
  const k = Math.min(4, consecutiveRun(q));
  const last = q.slice(-k).map((x) => x.operatingIncome);
  if (!isNum(mc) || k < 1 || !last.every(isNum)) return { pe: null, basis: null, loss: false };
  const yearly = (last.reduce((a, b) => a + b, 0) * 4) / k;
  if (yearly <= 0) return { pe: null, basis: `${k} quarter${k === 1 ? '' : 's'} annualized`, loss: true };
  return { pe: mc / yearly, basis: `${k} quarter${k === 1 ? '' : 's'} annualized`, loss: false };
}

/** Part 10D: forward P/E = price ÷ analysts' expected EPS for the next fiscal year. */
export function forwardPe(input) {
  const e = input.forwardEps;
  if (!e || !isNum(e.value) || !isNum(input.price) || input.price <= 0) return null;
  return e.value > 0 ? { pe: input.price / e.value, source: e.source || null, asOf: e.asOf || null } : { pe: null, loss: true, source: e.source || null, asOf: e.asOf || null };
}

/** Straight line: value at `fullAt` (or better) → 100, at `zeroAt` (or worse) → 0. */
const lerpPoints = (v, fullAt, zeroAt) => Math.round(Math.max(0, Math.min(100, ((zeroAt - v) / (zeroAt - fullAt)) * 100)));
/** v2.7: P/E vs a reference P/E, smooth (see rules.js PE_SCALE). */
const peBandPoints = (pe, ref) => lerpPoints(pe / ref, R.PE_SCALE.fullAt, R.PE_SCALE.zeroAt);

function scoreValue(input, opPe, peerList, tags, peerSource, newListing = false) {
  const parts = [];
  const nameOwn = 'Operating P/E vs own 5-yr median';
  const namePeer = 'Operating P/E vs peer median';
  const namePeg = 'PEG (operating)';
  const ruleBands = '25%+ cheaper = 100 · equal = 50 · 25%+ dearer = 0 · straight line between';

  if (opPe === null) {
    tags.push({ code: 'no_operating_profit', text: 'No operating profit — no P/E, can’t rank on value' });
    // Part 10: a new listing still gets price vs fair value when it has a loss.
    if (newListing && fmvRules(input)) {
      const fv = fairValuePart(input, tags, ruleBands);
      parts.push(fv, { id: 'pe_peers', label: `${namePeer} · info only`, info: true, points: null, display: 'n/a', rule: ruleBands, note: 'New listing — P/E is context only' },
        { id: 'peg', label: `${namePeg} · info only`, info: true, points: null, display: 'n/a', rule: ruleBands, note: 'New listing — P/E is context only' });
      return { score: fv.points ?? null, opPe: null, parts };
    }
    for (const [id, label] of [[fmvRules(input) ? 'fmv' : 'pe_own', fmvRules(input) ? 'Price vs fair value' : nameOwn], ['pe_peers', namePeer], ['peg', namePeg]]) {
      parts.push({ id, label, points: null, display: 'n/a', rule: ruleBands });
    }
    return { score: null, opPe: null, parts };
  }

  const v28 = fmvRules(input);
  // v2.8: price vs fair value (FMV Mid) — scored.
  if (v28) parts.push(fairValuePart(input, tags, ruleBands));

  // Own history: last 5 yearly op P/Es, negatives/zero left out (fix #2: median).
  // v2.8: shown as context only — no points. v2.7: scored.
  const hist = (input.opPeHistory || []).slice(-5).map((h) => h?.opPe).filter((v) => isNum(v) && v > 0);
  if (!v28) {
    if (hist.length >= R.OWN_PE_MIN_YEARS) {
      const med = median(hist);
      parts.push({ id: 'pe_own', label: nameOwn, points: peBandPoints(opPe, med), display: `${opPe.toFixed(1)} vs ${med.toFixed(1)}`, rule: ruleBands, note: `${hist.length} profitable years in the median` });
    } else {
      parts.push({ id: 'pe_own', label: nameOwn, points: null, display: 'n/a', rule: ruleBands, note: `Only ${hist.length} profitable year(s) of history` });
    }
  } else if (hist.length >= R.OWN_PE_MIN_YEARS) {
    const med = median(hist);
    parts.push({ id: 'pe_own', label: `${nameOwn} · info only`, points: null, info: true, display: `${opPe.toFixed(1)} vs ${med.toFixed(1)}`, rule: 'Shown for context since v2.8 — not scored', note: `${hist.length} profitable years in the median` });
  } else {
    parts.push({ id: 'pe_own', label: `${nameOwn} · info only`, points: null, info: true, display: 'n/a', rule: 'Shown for context since v2.8 — not scored', note: `Only ${hist.length} profitable year(s) of history` });
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

  // Part 10 (Q1, El 10-25): for a new listing the P/E parts are context only.
  if (newListing) {
    for (const p of parts) {
      if ((p.id === 'pe_peers' || p.id === 'peg') && !p.info) {
        Object.assign(p, { label: `${p.label} · info only`, info: true, points: null, note: `New listing — P/E is context only${p.note ? ` · ${p.note}` : ''}` });
      }
    }
  }
  const scored = parts.filter((p) => p.points !== null && !p.info);
  return { score: scored.length ? mean(scored.map((p) => p.points)) : null, opPe, parts };
}

/**
 * v2.8 Value check 1: price ÷ FMV Mid on the P/E-style line.
 * input.fairValue = { mid, low, high, date, source, stale } (from the watchlist row).
 */
function fairValuePart(input, tags, ruleBands) {
  const base = { id: 'fmv', label: 'Price vs fair value', rule: `Price ÷ fair value (FMV Mid): ${ruleBands}` };
  const fv = input.fairValue;
  if (!fv || !isNum(fv.mid) || fv.mid <= 0 || !isNum(input.price)) {
    tags.push({ code: 'no_fmv', text: 'No fair value yet — Value uses peers + PEG only' });
    return { ...base, points: null, display: 'n/a', note: 'Fills on the Monday eval' };
  }
  const ratio = input.price / fv.mid;
  if (ratio < R.FMV_SANITY.min || ratio > R.FMV_SANITY.max) {
    tags.push({ code: 'fmv_broken', text: `Fair value $${fv.mid.toFixed(2)} looks wrong vs price — left out` });
    return { ...base, points: null, display: 'n/a', note: 'Fair value outside 0.2×–5× the price' };
  }
  if (fv.stale) tags.push({ code: 'fmv_stale', text: `Fair value is stale (from ${fv.date || 'unknown date'})` });
  const pct = Math.round((ratio - 1) * 1000) / 10;
  return {
    ...base,
    points: lerpPoints(ratio, R.FMV_SCALE.fullAt, R.FMV_SCALE.zeroAt),
    display: `$${input.price.toFixed(2)} vs $${fv.mid.toFixed(2)}`,
    note: `${Math.abs(pct)}% ${pct <= 0 ? 'under' : 'over'} fair value${fv.date ? ` · from ${fv.date}` : ''}${fv.source ? ` · ${fv.source}` : ''}`,
    ratio, pct,
  };
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
 * @param {object|null} [input.fairValue]       v2.8: { mid, low, high, date, source, stale } — watchlist FMV
 */
export function scoreStock(input) {
  const tags = [];
  const peerList = input.peers?.list || [];
  const stage = input.stage === 'final' ? 'final' : 'preliminary';

  const newListing = isNewListing(input.quarters || []);
  if (newListing) tags.push({ code: 'new_listing', text: 'New listing: under 2 years of SEC data. Score uses limited history; verdict capped at Maybe' });
  const quality = scoreQuality(input, peerList, tags, newListing);
  const trailing = trailingOpPe(input);
  // A new listing's P/E is annualized from a few quarters — context only, never scored.
  const opPe = newListing ? trailing.pe : operatingPe(input);
  const value = scoreValue(input, opPe, peerList, tags, input.peers?.source || null, newListing);
  const upside = scoreUpside(input, tags);
  if (newListing) {
    const t = tags.find((x) => x.code === 'no_fmv');
    if (t) t.text = 'No fair value yet — new listing, so Value is n/a until the Monday eval sets one';
  }

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
  let { verdict, verdictReason } = verdictFor(investmentScore, isNum(quality.score) ? Math.round(quality.score) : null);
  // Part 10 (El 10-25, option A): a new listing can't reach "Worth investing".
  if (newListing && verdict === R.VERDICT.WORTH) {
    verdict = R.VERDICT.MAYBE;
    verdictReason = `Score ${investmentScore}, capped at Maybe: new listing with under 2 years of SEC data`;
  }
  const fwd = forwardPe(input);

  return {
    ticker: input.ticker,
    version: rulesOf(input),
    scoreType: stage === 'final' ? 'Final' : 'Preliminary',
    peerSource: input.peers?.source || null,
    investmentScore,
    verdict,
    verdictReason,
    weightsUsed,
    quality: { ...quality, score: isNum(quality.score) ? Math.round(quality.score) : null },
    value: { ...value, score: isNum(value.score) ? Math.round(value.score) : null },
    upside: { ...upside, score: isNum(upside.score) ? Math.round(upside.score) : null, pct: round1(upside.pct) },
    metrics: {
      marketCap: mc, operatingPe: opPe, reportedPe,
      trailingPe: trailing.pe, trailingBasis: trailing.basis, trailingLoss: trailing.loss,
      forwardPe: fwd?.pe ?? null, forwardLoss: !!fwd?.loss, forwardSource: fwd?.source ?? null, forwardAsOf: fwd?.asOf ?? null,
    },
    newListing,
    tags,
  };
}
