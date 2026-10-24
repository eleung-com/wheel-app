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
