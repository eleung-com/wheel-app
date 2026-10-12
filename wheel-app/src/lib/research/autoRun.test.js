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
});
