import { describe, it, expect } from 'vitest';
import { earningsNote, buildSignals, PRIORITY } from './signalEngine';

// Audit 1.3 (Phase 3). The Criteria page has offered "Avoid earnings within N
// days" since before this file existed, `criteria.earn` was parsed and saved,
// and buildSignals never read it — the app implied a protection it did not have.
//
// Resolved as advisory by decision: earnings NEVER suppress a signal. These
// tests pin that down in both directions, because "warns correctly" and "still
// fires" are equally load-bearing.

const CR = { dteMax: 45, earn: 0 };

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('earningsNote', () => {
  it('warns when earnings land inside the contract', () => {
    const n = earningsNote(isoDaysFromNow(10), 30, CR);
    expect(n).toMatchObject({ known: true, warn: true });
    expect(n.days).toBeGreaterThanOrEqual(9);
    expect(n.days).toBeLessThanOrEqual(11);
  });

  it('stays quiet when earnings fall after expiry', () => {
    expect(earningsNote(isoDaysFromNow(60), 30, CR)).toMatchObject({ known: true, warn: false });
  });

  it('warns exactly at the boundary', () => {
    const days = earningsNote(isoDaysFromNow(30), null, CR).days;
    expect(earningsNote(isoDaysFromNow(30), days, CR).warn).toBe(true);
    expect(earningsNote(isoDaysFromNow(30), days - 1, CR).warn).toBe(false);
  });

  it('extends the window by the buffer', () => {
    const outside = earningsNote(isoDaysFromNow(40), 30, CR);
    expect(outside.warn).toBe(false);
    // same date, same contract, 14 days of buffer — now inside
    expect(earningsNote(isoDaysFromNow(40), 30, { ...CR, earn: 14 }).warn).toBe(true);
  });

  it('falls back to dteMax when no live strike was fetched', () => {
    // 40 days out, no dteTarget → measured against dteMax (45), so inside
    expect(earningsNote(isoDaysFromNow(40), null, CR).warn).toBe(true);
    expect(earningsNote(isoDaysFromNow(40), null, { ...CR, dteMax: 21 }).warn).toBe(false);
  });

  it('treats a missing date as unknown, not as safe', () => {
    for (const v of ['', null, undefined]) {
      expect(earningsNote(v, 30, CR), String(v)).toEqual({ known: false, days: null, warn: false });
    }
  });

  it('treats a stale past date as unknown rather than "safely far away"', () => {
    expect(earningsNote(isoDaysFromNow(-5), 30, CR).known).toBe(false);
    expect(earningsNote(isoDaysFromNow(-90), 30, CR).known).toBe(false);
  });
});

describe('earnings never suppress a signal', () => {
  const CRITERIA = {
    dropPct: 5, ma: 200, earn: 0,
    rsiMin: 30, rsiMax: 50, stochBelow: 20,
    ccRsiMin: 50, ccRsiMax: 70, ccStochAbove: 80,
    deltaMin: 20, deltaMax: 35, dteMin: 21, dteMax: 45,
    ccRallyPct: 5, ccDeltaMin: 15, ccDeltaMax: 25, ccDteMin: 21, ccDteMax: 35,
    closePct: 50, closeDtePct: 50,
  };
  const trigger = { price: 190, chg1d: -1, dropPct: 6, weekHigh: 200, aboveMa: true,
                    rsi: 42, stochK: 18, stochKPrev: 12 };

  function cspWith(earnings) {
    const watchlist = [{ ticker: 'AAPL', diveIn: PRIORITY, pageId: 'p1', earnings }];
    return buildSignals(watchlist, [], CRITERIA, { AAPL: trigger });
  }

  it('still fires with earnings tomorrow — and says so', () => {
    const sigs = cspWith(isoDaysFromNow(1));
    expect(sigs).toHaveLength(1);
    expect(sigs[0].earnWarn.warn).toBe(true);
    expect(sigs[0].chks.some(c => c.warn && /Earnings in/.test(c.l))).toBe(true);
  });

  it('fires with no pill at all when earnings are safely out', () => {
    const sigs = cspWith(isoDaysFromNow(120));
    expect(sigs).toHaveLength(1);
    expect(sigs[0].earnWarn).toMatchObject({ known: true, warn: false });
    expect(sigs[0].chks.some(c => c.warn)).toBe(false);
  });

  it('flags a missing date rather than passing it off as clear', () => {
    const sigs = cspWith('');
    expect(sigs).toHaveLength(1);
    expect(sigs[0].chks.some(c => c.warn && /No earnings date/.test(c.l))).toBe(true);
  });

  it('covered calls carry the same flag', () => {
    const watchlist = [{ ticker: 'MSFT', diveIn: PRIORITY, earnings: isoDaysFromNow(5) }];
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    const ccTrigger = { price: 420, chg1d: 1, rallyPct: 6, weekLow: 396,
                        rsi: 62, stochK: 82, stochKPrev: 88 };
    const sigs = buildSignals(watchlist, positions, CRITERIA, { MSFT: ccTrigger });
    expect(sigs).toHaveLength(1);
    expect(sigs[0].type).toBe('cc');
    expect(sigs[0].earnWarn.warn).toBe(true);
  });
});
