import { describe, it, expect } from 'vitest';
import { earningsNote, buildSignals, PRIORITY } from './signalEngine';

// Part 2A (decided 10-04): for CSPs, earnings BLOCK. Dates are Finnhub-backed
// (worker/earnings.js), so unknown is never treated as safe.
//   block → on/before expiry, or no usable date    → card becomes csp_wait
//   warn  → within earnAfter (14) days after expiry → card fires with a pill
//   na    → index/ETF                               → gate doesn't apply
// Covered calls stay advisory: they still fire, with a pill.

const CR = { dteMax: 45, earnAfter: 14 };

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('earningsNote', () => {
  it('blocks when earnings land inside the contract', () => {
    const n = earningsNote(isoDaysFromNow(10), 30, CR);
    expect(n).toMatchObject({ known: true, block: true, warn: false });
  });

  it('blocks on expiry day itself, not the day after', () => {
    const days = earningsNote(isoDaysFromNow(30), null, CR).days;
    expect(earningsNote(isoDaysFromNow(30), days, CR).block).toBe(true);
    expect(earningsNote(isoDaysFromNow(30), days - 1, CR)).toMatchObject({ block: false, warn: true });
  });

  it('warns within 14 days after expiry, quiet beyond', () => {
    expect(earningsNote(isoDaysFromNow(40), 30, CR)).toMatchObject({ block: false, warn: true });
    expect(earningsNote(isoDaysFromNow(60), 30, CR)).toMatchObject({ block: false, warn: false });
  });

  it('honours a custom warn window', () => {
    expect(earningsNote(isoDaysFromNow(40), 30, { ...CR, earnAfter: 5 }).warn).toBe(false);
  });

  it('falls back to dteMax when no live strike was fetched (conservative)', () => {
    expect(earningsNote(isoDaysFromNow(40), null, CR).block).toBe(true);
    expect(earningsNote(isoDaysFromNow(40), null, { ...CR, dteMax: 21 }).block).toBe(false);
  });

  it('blocks on a missing or past date — unknown is not safe', () => {
    for (const v of ['', null, undefined, isoDaysFromNow(-5)]) {
      expect(earningsNote(v, 30, CR), String(v)).toMatchObject({ known: false, block: true, warn: false });
    }
  });

  it('never applies to index / ETF symbols', () => {
    expect(earningsNote('', 30, CR, 'XSP')).toMatchObject({ na: true, block: false, warn: false });
    expect(earningsNote('', 30, CR, 'spy').na).toBe(true);
  });
});

describe('CSP earnings gate in buildSignals', () => {
  const CRITERIA = {
    dropPct: 5, ma: 200, earnAfter: 14,
    rsiMin: 30, rsiMax: 40, stochBelow: 20, weeklyRsiMin: 40,
    ccRsiMin: 50, ccRsiMax: 70, ccStochAbove: 80,
    deltaMin: 20, deltaMax: 35, dteMin: 21, dteMax: 45,
    ccRallyPct: 5, ccDeltaMin: 15, ccDeltaMax: 25, ccDteMin: 21, ccDteMax: 35,
    closePct: 50, closeDtePct: 50,
  };
  const trigger = { price: 190, chg1d: -1, dropPct: 6, weekHigh: 200, aboveMa: true,
                    rsi: 35, rsiWeekly: 55, stochK: 18, stochKPrev: 12 };

  function cspWith(earnings, ticker = 'AAPL', strikeMap = {}) {
    const watchlist = [{ ticker, diveIn: PRIORITY, pageId: 'p1', earnings }];
    return buildSignals(watchlist, [], CRITERIA, { [ticker]: trigger }, strikeMap);
  }

  it('earnings before expiry → waiting card, with the date in the reason', () => {
    const [s] = cspWith(isoDaysFromNow(10));
    expect(s.type).toBe('csp_wait');
    expect(s.waitReason).toMatch(/^Earnings \d+\/\d+ — before expiry$/);
    expect(s.suggestion).toMatch(/^Waiting: /);
  });

  it('no date → waiting card "No earnings date"', () => {
    const [s] = cspWith('');
    expect(s.type).toBe('csp_wait');
    expect(s.waitReason).toBe('No earnings date');
  });

  it('uses the live contract expiry when a strike was fetched', () => {
    // Earnings in ~25 days: inside a 30-DTE contract, outside a 21-DTE one.
    const e = isoDaysFromNow(25);
    const live = (dte) => ({ 'AAPL:put': { strike: 180, dte, delta: -0.25, expiry: isoDaysFromNow(dte) } });
    expect(cspWith(e, 'AAPL', live(30))[0].type).toBe('csp_wait');
    const [s] = cspWith(e, 'AAPL', live(21));
    expect(s.type).toBe('csp');
    expect(s.chks.some(c => c.warn && /after expiry/.test(c.l))).toBe(true);
  });

  it('safely after expiry → normal card with a green earnings pill', () => {
    const [s] = cspWith(isoDaysFromNow(120));
    expect(s.type).toBe('csp');
    expect(s.chks.some(c => c.ok && /^Earnings \d+\/\d+$/.test(c.l))).toBe(true);
  });

  it('index tickers are never blocked by earnings', () => {
    const [s] = cspWith('', 'XSP');
    expect(s.type).toBe('csp');
    expect(s.chks.some(c => /Earnings/.test(c.l))).toBe(false);
  });

  it('covered calls stay advisory — fire with a pill', () => {
    const watchlist = [{ ticker: 'MSFT', diveIn: PRIORITY, earnings: isoDaysFromNow(5) }];
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    const ccTrigger = { price: 420, chg1d: 1, rallyPct: 6, weekLow: 396,
                        rsi: 62, stochK: 82, stochKPrev: 88 };
    const sigs = buildSignals(watchlist, positions, CRITERIA, { MSFT: ccTrigger });
    expect(sigs).toHaveLength(1);
    expect(sigs[0].type).toBe('cc');
    expect(sigs[0].chks.some(c => c.warn && /Earnings in/.test(c.l))).toBe(true);
  });
});
