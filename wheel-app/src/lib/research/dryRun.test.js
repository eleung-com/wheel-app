import { describe, it, expect } from 'vitest';
import { legacyV27, compareRow } from './dryRun';

// GOOGL 10-24, as v2.8 would produce it.
const r = {
  investmentScore: 70, verdict: 'Maybe',
  quality: { score: 83 }, upside: { score: 69 }, metrics: { operatingPe: 26.7 },
  value: { score: 56, parts: [
    { id: 'fmv', points: 43, note: '3.7% over fair value' },
    { id: 'pe_own', points: null, info: true, display: '26.7 vs 21.0' },
    { id: 'pe_peers', points: 62 }, { id: 'peg', points: 64 },
  ] },
};

describe('Part 8C dry run', () => {
  it('rebuilds the v2.7 score from the same run (GOOGL: 65 Maybe)', () => {
    expect(legacyV27(r)).toEqual({ value: 42, score: 65, verdict: 'Maybe' });
  });
  it('comparison row flags verdict flips', () => {
    const row = compareRow('GOOGL', r);
    expect(row).toMatchObject({ oldScore: 65, newScore: 70, oldValue: 42, newValue: 56, flip: false });
    const flipped = compareRow('X', { ...r, investmentScore: 76, verdict: 'Worth investing' });
    expect(flipped.flip).toBe(true);
  });
  it('no own-history P/E → v2.7 value from peers + PEG only', () => {
    const r2 = { ...r, value: { ...r.value, parts: r.value.parts.map((p) => (p.id === 'pe_own' ? { ...p, display: 'n/a' } : p)) } };
    expect(legacyV27(r2).value).toBe(63);
  });
});

import { quarterGaps, savedVsFresh } from './dryRun';
describe('Part 10A score check', () => {
  const q = ['2025-03-31', '2025-06-30', '2025-09-30', '2026-03-31', '2026-06-30'].map((end) => ({ end }));
  it('names the missing quarter', () => {
    expect(quarterGaps(q)).toEqual(['2025-09 → 2026-03']);
    expect(quarterGaps(q.slice(3))).toEqual([]);
  });
  it('compares the saved score with the fresh one', () => {
    const row = savedVsFresh('SPCX', { score: 65, verdict: 'Maybe', value: 0 }, { bundle: { input: { quarters: q } }, result: { investmentScore: 70, verdict: 'Maybe', value: { score: null }, metrics: {} } });
    expect(row).toMatchObject({ oldScore: 65, newScore: 70, flip: false, gaps: ['2025-09 → 2026-03'] });
  });
});
