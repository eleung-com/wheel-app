import { describe, it, expect } from 'vitest';
import { decideDiveIn, fmvOf, fmvStale, vsMidPct, DIVE } from './fairValue.js';

const fmv = fmvOf({ fmvLow: 85, fmvMid: 100, fmvHigh: 130, fmvDate: '2026-10-12' });

describe('fmvOf / fmvStale / vsMidPct', () => {
  it('needs a positive Mid', () => {
    expect(fmvOf({ fmvMid: null })).toBeNull();
    expect(fmvOf({ fmvMid: 0 })).toBeNull();
    expect(fmv).toEqual({ low: 85, mid: 100, high: 130, date: '2026-10-12' });
  });
  it('stale after 10 days or undated', () => {
    expect(fmvStale(fmv, '2026-10-22')).toBe(false);
    expect(fmvStale(fmv, '2026-10-23')).toBe(true);
    expect(fmvStale({ mid: 1, date: null }, '2026-10-12')).toBe(true);
    expect(fmvStale(null, '2026-10-12')).toBe(false);
  });
  it('% vs Mid', () => {
    expect(vsMidPct(110, fmv)).toBe(10);
    expect(vsMidPct(92.5, fmv)).toBe(-7.5);
    expect(vsMidPct(null, fmv)).toBeNull();
  });
});

describe('decideDiveIn', () => {
  const d = (o) => decideDiveIn({ fmv, ...o });
  it('no score → leave alone', () => {
    expect(d({ current: DIVE.WATCH, verdict: null, price: 50 })).toBeNull();
    expect(d({ current: DIVE.PRIORITY, verdict: 'No score', price: 500 })).toBeNull();
  });
  it('Not worth it → Skip (once)', () => {
    expect(d({ current: DIVE.PRIORITY, verdict: 'Not worth it', price: 50 }).diveIn).toBe(DIVE.SKIP);
    expect(d({ current: DIVE.SKIP, verdict: 'Not worth it', price: 50 })).toBeNull();
  });
  it('good + price ≤ Mid → Priority (from Watch, Skip or blank)', () => {
    for (const current of [DIVE.WATCH, DIVE.SKIP, '']) {
      expect(d({ current, verdict: 'Maybe', price: 100 }).diveIn).toBe(DIVE.PRIORITY);
    }
    expect(d({ current: DIVE.PRIORITY, verdict: 'Worth investing', price: 90 })).toBeNull();
  });
  it('3% buffer: Priority stays until price > Mid + 3%', () => {
    expect(d({ current: DIVE.PRIORITY, verdict: 'Maybe', price: 103 })).toBeNull();
    expect(d({ current: DIVE.PRIORITY, verdict: 'Maybe', price: 103.01 }).diveIn).toBe(DIVE.WATCH);
    expect(d({ current: DIVE.WATCH, verdict: 'Maybe', price: 102 })).toBeNull();
    expect(d({ current: DIVE.SKIP, verdict: 'Maybe', price: 102 }).diveIn).toBe(DIVE.WATCH);
  });
  it('good but no FMV or no price → keep Priority/Watch, lift Skip/blank to Watch', () => {
    expect(decideDiveIn({ current: DIVE.PRIORITY, verdict: 'Maybe', price: 100, fmv: null })).toBeNull();
    expect(decideDiveIn({ current: DIVE.WATCH, verdict: 'Maybe', price: null, fmv })).toBeNull();
    expect(decideDiveIn({ current: DIVE.SKIP, verdict: 'Worth investing', price: 100, fmv: null }).diveIn).toBe(DIVE.WATCH);
    expect(decideDiveIn({ current: '', verdict: 'Worth investing', price: 100, fmv: null }).diveIn).toBe(DIVE.WATCH);
  });
});
