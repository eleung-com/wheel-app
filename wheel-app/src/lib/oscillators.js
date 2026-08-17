/**
 * RSI and Stochastic, matching what TradingView and Barchart show by default.
 *
 * RSI(14) uses Wilder smoothing — alpha = 1/period. A standard EMA uses
 * alpha = 2/(period+1). Same period, different numbers, and it is the single
 * most common reason a hand-rolled RSI disagrees with a charting site. If these
 * values ever drift from TradingView, check this first.
 *
 * Stochastic is the "slow" variant both sites default to: raw %K smoothed by
 * `slowing`, then %D as the average of that. %K reads the HIGH and LOW of each
 * bar, not closes.
 *
 * Both return arrays aligned to the input, with null until enough bars exist —
 * callers must treat null as "unknown", never as zero.
 */

/** Wilder-smoothed RSI. @returns number[] aligned to `closes`, null-padded. */
export function rsiWilder(closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;

  const gains = [], losses = [];
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1];
    gains.push(ch > 0 ? ch : 0);
    losses.push(ch < 0 ? -ch : 0);
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
  avgGain /= period;
  avgLoss /= period;

  // No losses in the window means RS is infinite; RSI saturates at 100 rather
  // than dividing by zero. The mirror case pins it at 0.
  const toRsi = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));

  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

/** Simple moving average over an array that may hold leading nulls. */
function sma(vals, period) {
  const out = new Array(vals.length).fill(null);
  for (let i = period - 1; i < vals.length; i++) {
    let sum = 0, ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (vals[j] == null) { ok = false; break; }
      sum += vals[j];
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

/**
 * Slow stochastic.
 * @returns { rawK, k, d } — `k` is the slowed %K, `d` its average.
 */
export function stochastic(highs, lows, closes, kPeriod = 14, slowing = 3, dPeriod = 3) {
  const n = closes.length;
  const rawK = new Array(n).fill(null);

  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j]  < ll) ll = lows[j];
    }
    const range = hh - ll;
    // A window with no range gives the close nowhere to sit. Convention is to
    // carry the previous reading; 50 is the neutral start when there isn't one.
    if (range === 0) rawK[i] = i > 0 && rawK[i - 1] != null ? rawK[i - 1] : 50;
    else rawK[i] = ((closes[i] - ll) / range) * 100;
  }

  const k = sma(rawK, slowing);
  return { rawK, k, d: sma(k, dPeriod) };
}

/**
 * "%K turning up from below `level`" — the CSP trigger.
 * A crossing test, not a level test: the prior bar must have been below the
 * level and %K must now be rising. Returns false when either bar is unknown.
 */
export function turningUpFrom(k, prevK, level) {
  if (k == null || prevK == null) return false;
  return prevK < level && k > prevK;
}

/**
 * "%K rolling over from above `level`" — the covered-call trigger.
 * Mirror of the above: prior bar above the level, %K now falling.
 */
export function rollingOverFrom(k, prevK, level) {
  if (k == null || prevK == null) return false;
  return prevK > level && k < prevK;
}

/** True when `rsi` sits inside [min, max]. False when unknown. */
export function rsiInBand(rsi, min, max) {
  if (rsi == null) return false;
  return rsi >= min && rsi <= max;
}
