import { describe, it, expect } from 'vitest';
import { DEFAULT_CRITERIA, parseCriteria } from './utils';

describe('oscillator criteria defaults', () => {
  it('uses the agreed Stochastic levels, 30 for puts and 70 for calls', () => {
    expect(DEFAULT_CRITERIA.stochBelow).toBe(30);
    expect(DEFAULT_CRITERIA.ccStochAbove).toBe(70);
  });

  it('uses the RSI bands from the Strategies cards', () => {
    expect(DEFAULT_CRITERIA.rsiMin).toBe(30);
    expect(DEFAULT_CRITERIA.rsiMax).toBe(50);
    expect(DEFAULT_CRITERIA.ccRsiMin).toBe(50);
    expect(DEFAULT_CRITERIA.ccRsiMax).toBe(70);
  });

  it('parseCriteria agrees with DEFAULT_CRITERIA on an empty sheet', () => {
    const parsed = parseCriteria({});
    for (const k of ['rsiMin', 'rsiMax', 'stochBelow', 'ccRsiMin', 'ccRsiMax', 'ccStochAbove']) {
      expect(parsed[k], k).toBe(DEFAULT_CRITERIA[k]);
    }
  });

  it('keeps a saved value rather than overriding it with the default', () => {
    const parsed = parseCriteria({ stochBelow: 25, ccStochAbove: 85, rsiMax: 45 });
    expect(parsed.stochBelow).toBe(25);
    expect(parsed.ccStochAbove).toBe(85);
    expect(parsed.rsiMax).toBe(45);
  });

  it('keeps a saved 0 — the old `|| default` idiom would have discarded it', () => {
    expect(parseCriteria({ rsiMin: 0 }).rsiMin).toBe(0);
    expect(parseCriteria({ stochBelow: 0 }).stochBelow).toBe(0);
  });

  it('falls back when the sheet holds an empty string or junk', () => {
    expect(parseCriteria({ stochBelow: '' }).stochBelow).toBe(30);
    expect(parseCriteria({ stochBelow: 'n/a' }).stochBelow).toBe(30);
    expect(parseCriteria({ ccStochAbove: null }).ccStochAbove).toBe(70);
  });

  it('accepts numeric strings, which is how Google Sheets returns them', () => {
    expect(parseCriteria({ stochBelow: '35' }).stochBelow).toBe(35);
  });
});
