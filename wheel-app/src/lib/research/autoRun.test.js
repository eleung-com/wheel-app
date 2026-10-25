import { describe, it, expect } from 'vitest';
import { planAutoRuns } from './autoRun.js';

const now = Date.parse('2026-10-12T12:00:00Z');
const ago = (d) => new Date(now - d * 864e5).toISOString();
const isIndex = (t) => t === 'XSP';

describe('planAutoRuns (Part 4D)', () => {
  const wl = ['XSP', 'TER', 'NVDA', 'ADBE', 'OLD', 'NEW2', 'NEW3'].map((ticker) => ({ ticker }));
  const runs = [
    { ticker: 'NVDA', investmentScore: 91, status: 'Waiting on Claude', claudeWritten: ago(0.1), runAt: ago(1), pageId: 'n1' },
    { ticker: 'ADBE', investmentScore: 73, status: 'Final', claudeWritten: ago(1), runAt: ago(1) },
    { ticker: 'OLD', investmentScore: 60, status: 'Final', runAt: ago(120) },
    { ticker: 'OLD', investmentScore: 50, status: 'Final', runAt: ago(300) },
  ];
  it('finish first, then never-scored, then stale; max 3; skips indexes', () => {
    const plan = planAutoRuns(wl, runs, isIndex, { now });
    expect(plan.map((p) => `${p.ticker}:${p.kind}`)).toEqual(['NVDA:finish', 'TER:new', 'NEW2:new']);
  });
  it('stale (>90 days) when nothing else; recently tried skipped', () => {
    const plan = planAutoRuns(wl, runs, isIndex, { now, max: 10, tried: (t) => t === 'TER' });
    expect(plan.map((p) => p.ticker)).toEqual(['NVDA', 'NEW2', 'NEW3', 'OLD']);
  });
  it('nothing to do when all fresh + Final', () => {
    expect(planAutoRuns([{ ticker: 'ADBE' }], runs, isIndex, { now })).toEqual([]);
  });
  it('Part 8D: runs under older rules are re-scored (after new + finish), in place', () => {
    const r2 = [{ ticker: 'ADBE', investmentScore: 73, status: 'Final', claudeWritten: ago(1), runAt: ago(1), version: 'v2.7', pageId: 'a1' }];
    const plan = planAutoRuns([{ ticker: 'ADBE' }], r2, isIndex, { now });
    expect(plan).toEqual([{ ticker: 'ADBE', kind: 'rescore', row: r2[0] }]);
  });
  it('Part 8E: Not worth it + Quality ≥ 50 + price at/under fair value → rescue', () => {
    const r3 = [{ ticker: 'AMD', investmentScore: 44, verdict: 'Not worth it', quality: 70, status: 'Final', runAt: ago(5), version: 'v2.8', pageId: 'm1' }];
    const under = [{ ticker: 'AMD', fmvMid: 150, liveData: { price: 140 } }];
    const over = [{ ticker: 'AMD', fmvMid: 150, liveData: { price: 200 } }];
    expect(planAutoRuns(under, r3, isIndex, { now })[0].kind).toBe('rescue');
    expect(planAutoRuns(over, r3, isIndex, { now })).toEqual([]);
    const weak = [{ ...r3[0], quality: 40 }];
    expect(planAutoRuns(under, weak, isIndex, { now })).toEqual([]); // low quality: price can't save it
  });
});
