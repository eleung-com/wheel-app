import { describe, it, expect } from 'vitest';
import {
  rsiWilder, stochastic, turningUpFrom, rollingOverFrom, rsiInBand,
} from './oscillators';

// Wilder's 33-close example from "New Concepts in Technical Trading Systems".
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
  46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  43.42, 42.66, 43.13,
];

describe('rsiWilder', () => {
  // The first value is fully hand-checkable: over closes[1..14] the gains sum
  // to 3.34 and the losses to 1.40, so RS = (3.34/14)/(1.40/14) = 2.385714 and
  // RSI = 100 - 100/(1 + 2.385714).
  it('matches the arithmetic for the seed value', () => {
    const rsi = rsiWilder(WILDER, 14);
    expect(rsi[14]).toBeCloseTo(100 - 100 / (1 + (3.34 / 14) / (1.40 / 14)), 10);
    expect(rsi[14]).toBeCloseTo(70.4641, 3);
  });

  it('is null until enough bars exist, then defined for every bar', () => {
    const rsi = rsiWilder(WILDER, 14);
    expect(rsi.slice(0, 14).every(v => v === null)).toBe(true);
    expect(rsi.slice(14).every(v => typeof v === 'number')).toBe(true);
    expect(rsi).toHaveLength(WILDER.length);
  });

  it('returns all nulls when given fewer bars than the period', () => {
    expect(rsiWilder([1, 2, 3], 14).every(v => v === null)).toBe(true);
    expect(rsiWilder([], 14)).toEqual([]);
  });

  it('uses Wilder smoothing, not an EMA — the two must not be interchangeable', () => {
    // The most likely regression is someone "simplifying" Wilder's alpha of
    // 1/period into a standard EMA's 2/(period+1). Compute both and assert they
    // actually diverge, rather than pinning a magic number that says nothing
    // about which method produced it.
    const emaRsi = (closes, period) => {
      const gains = [], losses = [];
      for (let i = 1; i < closes.length; i++) {
        const ch = closes[i] - closes[i - 1];
        gains.push(ch > 0 ? ch : 0);
        losses.push(ch < 0 ? -ch : 0);
      }
      const a = 2 / (period + 1);
      let g = gains.slice(0, period).reduce((x, y) => x + y, 0) / period;
      let l = losses.slice(0, period).reduce((x, y) => x + y, 0) / period;
      for (let i = period; i < gains.length; i++) {
        g = gains[i] * a + g * (1 - a);
        l = losses[i] * a + l * (1 - a);
      }
      return 100 - 100 / (1 + g / l);
    };

    const wilder = rsiWilder(WILDER, 14)[WILDER.length - 1];
    const ema    = emaRsi(WILDER, 14);
    // Both are plausible RSI values, so a loose range check would pass either.
    // The point is that they are measurably different numbers.
    expect(Math.abs(wilder - ema)).toBeGreaterThan(1);
  });

  it('produces a stable value for the last bar of the reference series', () => {
    // Regression pin, taken from this implementation's own output and
    // independently reproduced by the Python reference in outputs/.
    expect(rsiWilder(WILDER, 14)[32]).toBeCloseTo(37.7888, 3);
  });

  it('saturates at 100 when the window has no losses', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsiWilder(rising, 14)[29]).toBe(100);
  });

  it('pins to 0 when the window has no gains', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsiWilder(falling, 14)[29]).toBe(0);
  });

  it('reads 50 on a perfectly flat series rather than dividing by zero', () => {
    const flat = new Array(30).fill(42);
    expect(rsiWilder(flat, 14)[29]).toBe(50);
  });

  it('stays within 0..100 across a noisy series', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 50 + Math.sin(i / 3) * 10 + (i % 7));
    for (const v of rsiWilder(noisy, 14)) {
      if (v != null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
  });
});

describe('stochastic', () => {
  const highs  = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 18, 20];
  const lows   = [ 8,  9, 10,  9, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 16, 18];
  const closes = [ 9, 10, 11, 10, 12, 13, 12, 14, 15, 14, 16, 17, 16, 18, 17, 19];

  it('computes raw %K from the window high and low, hand-checked', () => {
    const { rawK } = stochastic(highs, lows, closes);
    // Bar 13: highest high over bars 0..13 is 19, lowest low is 8, close is 18.
    expect(rawK[13]).toBeCloseTo(((18 - 8) / (19 - 8)) * 100, 10);
    expect(rawK[13]).toBeCloseTo(90.9091, 3);
  });

  it('slows %K by averaging the last 3 raw readings', () => {
    const { rawK, k } = stochastic(highs, lows, closes);
    expect(k[15]).toBeCloseTo((rawK[13] + rawK[14] + rawK[15]) / 3, 10);
  });

  it('leaves %K and %D null until their windows fill', () => {
    const { rawK, k, d } = stochastic(highs, lows, closes);
    expect(rawK[12]).toBeNull();
    expect(rawK[13]).not.toBeNull();
    expect(k[14]).toBeNull();     // needs 3 raw values; only 2 exist by bar 14
    expect(k[15]).not.toBeNull();
    expect(d[15]).toBeNull();     // needs 3 slowed values
  });

  it('carries the previous reading when a window is perfectly flat', () => {
    const h = new Array(20).fill(5), l = new Array(20).fill(5), c = new Array(20).fill(5);
    const { rawK } = stochastic(h, l, c);
    expect(rawK[13]).toBe(50);    // neutral at the series start
    expect(rawK[19]).toBe(50);
  });

  it('reads 100 at the window high and 0 at the window low', () => {
    const n = 20;
    const h = Array.from({ length: n }, () => 10);
    const l = Array.from({ length: n }, () => 0);
    const atHigh = Array.from({ length: n }, () => 10);
    const atLow  = Array.from({ length: n }, () => 0);
    expect(stochastic(h, l, atHigh).rawK[19]).toBeCloseTo(100, 10);
    expect(stochastic(h, l, atLow).rawK[19]).toBeCloseTo(0, 10);
  });
});

describe('trigger conditions', () => {
  it('turningUpFrom needs the prior bar below the level AND a rise', () => {
    expect(turningUpFrom(18, 15, 20)).toBe(true);    // below 20, rising
    expect(turningUpFrom(14, 15, 20)).toBe(false);   // below 20 but falling
    expect(turningUpFrom(25, 22, 20)).toBe(false);   // rising but prior was above
    expect(turningUpFrom(15, 15, 20)).toBe(false);   // flat is not turning up
  });

  it('rollingOverFrom needs the prior bar above the level AND a fall', () => {
    expect(rollingOverFrom(82, 85, 80)).toBe(true);
    expect(rollingOverFrom(88, 85, 80)).toBe(false); // above but still rising
    expect(rollingOverFrom(70, 75, 80)).toBe(false); // falling but prior below
    expect(rollingOverFrom(85, 85, 80)).toBe(false);
  });

  it('treats unknown readings as not triggering, never as zero', () => {
    expect(turningUpFrom(null, 15, 20)).toBe(false);
    expect(turningUpFrom(18, null, 20)).toBe(false);
    expect(rollingOverFrom(null, null, 80)).toBe(false);
    expect(rsiInBand(null, 30, 50)).toBe(false);
  });

  it('rsiInBand is inclusive at both edges', () => {
    expect(rsiInBand(30, 30, 50)).toBe(true);
    expect(rsiInBand(50, 30, 50)).toBe(true);
    expect(rsiInBand(29.9, 30, 50)).toBe(false);
    expect(rsiInBand(50.1, 30, 50)).toBe(false);
  });
});
