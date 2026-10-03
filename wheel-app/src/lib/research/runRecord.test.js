import { describe, it, expect } from 'vitest';
import { dayKey, runStamp, runToRecord, cleanRecord, cleanDecision, rejectedBefore } from './runRecord.js';

describe('dayKey / runStamp (New York day)', () => {
  it('late-evening NY run stays on the NY day, not the UTC day', () => {
    expect(dayKey('2026-10-04T02:30:00.000Z')).toBe('2026-10-03'); // 10:30 PM EDT
    expect(dayKey('2026-10-03T14:00:00-04:00')).toBe('2026-10-03');
    expect(dayKey('nope')).toBe('');
  });
  it('runStamp', () => {
    expect(runStamp('2026-10-03T18:22:00.000Z')).toBe('10-03 2:22 PM');
  });
});

const scored = {
  ticker: 'UBER', ranAt: '2026-10-03T18:00:00.000Z',
  bundle: { input: { price: 81.2 }, financials: null, dataTags: [] },
  peers: { source: 'auto', used: [{ ticker: 'LYFT' }, { ticker: 'DASH' }] },
  result: {
    scoreType: 'Preliminary', version: 'v2.6', investmentScore: 71.5, verdict: 'Maybe',
    quality: { score: 80, checks: [{ label: 'Revenue', display: '4/4', color: 'green', points: 10 }], piotroski: { score: 7, passed: 7, run: 9 }, altmanZ: 3.1 },
    value: { score: 60, parts: [{ label: 'Op P/E vs own', display: '22 vs 28', points: 100 }] },
    upside: { score: 50, target: { value: 95, source: 'FMP' } },
    tags: [{ code: 'x', text: 'Weak peer comparison' }],
  },
};

describe('runToRecord', () => {
  it('maps a scored run', () => {
    const r = runToRecord(scored);
    expect(r).toMatchObject({ ticker: 'UBER', price: 81.2, scoreType: 'Preliminary', version: 'v2.6', investmentScore: 71.5,
      quality: 80, value: 60, upside: 50, verdict: 'Maybe', peersAuto: 'LYFT, DASH', targetSource: 'FMP' });
    expect(r.lines).toContain('Quality · Revenue: 4/4 → 10');
    expect(r.lines).toContain('Quality · Piotroski: 7 / 9');
    expect(r.lines).toContain('Flag · Weak peer comparison');
  });
  it('no-score run → verdict "No score" with the reasons as lines', () => {
    const r = runToRecord({ ticker: 'TM', ranAt: scored.ranAt, bundle: { dataTags: [{ text: 'No US SEC filings' }] }, peers: null, result: null });
    expect(r.verdict).toBe('No score');
    expect(r.investmentScore).toBeNull();
    expect(r.lines).toEqual(['No score: No US SEC filings']);
  });
});

describe('cleanRecord', () => {
  it('accepts a record and adds the NY day', () => {
    const c = cleanRecord(runToRecord(scored));
    expect(c.ok).toBe(true);
    expect(c.rec.day).toBe('2026-10-03');
  });
  it('rejects bad ticker / verdict / date', () => {
    expect(cleanRecord({ ...runToRecord(scored), ticker: 'drop table' }).ok).toBe(false);
    expect(cleanRecord({ ...runToRecord(scored), verdict: 'Buy!!' }).ok).toBe(false);
    expect(cleanRecord({ ...runToRecord(scored), runAt: 'x' }).ok).toBe(false);
    expect(cleanRecord(null).ok).toBe(false);
  });
  it('drops out-of-range scores and caps lines', () => {
    const c = cleanRecord({ ...runToRecord(scored), quality: 400, lines: Array(99).fill('a'.repeat(999)) });
    expect(c.rec.quality).toBeNull();
    expect(c.rec.lines.length).toBe(60);
    expect(c.rec.lines[0].length).toBe(300);
  });
});

describe('cleanDecision', () => {
  it('Reject needs a reason; tags filtered to the allowed set', () => {
    expect(cleanDecision({ decision: 'Reject', reason: '  ' }).ok).toBe(false);
    const c = cleanDecision({ decision: 'Reject', reason: 'debt', tags: ['Debt', 'Debt', 'Bogus'] });
    expect(c.d).toEqual({ decision: 'Reject', reason: 'debt', tags: ['Debt'] });
  });
  it('Watch and clear wipe reason + tags', () => {
    expect(cleanDecision({ decision: 'Watch', reason: 'x', tags: ['Debt'] }).d).toEqual({ decision: 'Watch', reason: '', tags: [] });
    expect(cleanDecision({ decision: null }).d).toEqual({ decision: null, reason: '', tags: [] });
    expect(cleanDecision({ decision: 'Buy' }).ok).toBe(false);
  });
});

describe('rejectedBefore', () => {
  const rows = [
    { pageId: 'c', decision: 'Reject' },
    { pageId: 'b', decision: 'Watch' },
    { pageId: 'a', decision: 'Reject', rejectReason: 'old' },
  ];
  it('newest Reject that is not the current run', () => {
    expect(rejectedBefore(rows, 'c').pageId).toBe('a');
    expect(rejectedBefore(rows, 'z').pageId).toBe('c');
    expect(rejectedBefore([], 'z')).toBeNull();
  });
});
