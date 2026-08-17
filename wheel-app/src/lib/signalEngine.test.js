import { describe, it, expect } from 'vitest';
import { dte, calcATR, deriveIndicators, buildSignals, PRIORITY } from './signalEngine';

const CRITERIA = {
  dropPct: 5, ma: 200,
  rsiMin: 30, rsiMax: 50, stochBelow: 20,
  ccRsiMin: 50, ccRsiMax: 70, ccStochAbove: 80,
  deltaMin: 20, deltaMax: 35, dteMin: 21, dteMax: 45,
  ccRallyPct: 5, ccDeltaMin: 15, ccDeltaMax: 25, ccDteMin: 21, ccDteMax: 35,
  closePct: 50, closeDtePct: 50,
};

// Build a local-calendar-date ISO string (dte parses "YYYY-MM-DDT12:00:00" as
// local time, so tests must avoid toISOString()'s UTC conversion).
function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('dte', () => {
  it('returns null for no expiry', () => {
    expect(dte('')).toBeNull();
    expect(dte(null)).toBeNull();
  });

  it('grows by exactly the calendar-day gap between two expiries', () => {
    const base = new Date();
    const plus5  = new Date(base); plus5.setDate(base.getDate() + 5);
    const plus15 = new Date(base); plus15.setDate(base.getDate() + 15);
    expect(dte(localIso(plus15)) - dte(localIso(plus5))).toBe(10);
  });

  it('is small and non-negative for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const d = dte(localIso(tomorrow));
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(2);
  });
});

describe('calcATR', () => {
  it('returns null when history is shorter than length + 1', () => {
    const closes = [10, 11, 12];
    expect(calcATR(closes, closes, closes, 14)).toBeNull();
  });

  it('computes a positive ATR for a simple ramp with real ranges', () => {
    const n = 20;
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const highs  = closes.map(c => c + 1);
    const lows   = closes.map(c => c - 1);
    const atr = calcATR(highs, lows, closes, 14);
    expect(atr).not.toBeNull();
    expect(atr).toBeGreaterThan(0);
  });

  it('returns null when every true range is zero', () => {
    const n = 20;
    const flat = Array.from({ length: n }, () => 100);
    expect(calcATR(flat, flat, flat, 14)).toBeNull();
  });
});

describe('deriveIndicators', () => {
  function bars(n, { start = 100, step = 0 } = {}) {
    const closes = Array.from({ length: n }, (_, i) => start + i * step);
    const highs  = closes.map(c => c + 1);
    const lows   = closes.map(c => c - 1);
    const dates  = closes.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    return { closes, highs, lows, dates };
  }

  it('flags aboveMa using the trailing MA window, falling back to a short window under 20 bars', () => {
    const hist = bars(25, { start: 100, step: 1 }); // rising: price 124 > MA of first 20-ish
    const price = hist.closes[hist.closes.length - 1];
    const result = deriveIndicators(hist, price, 0.1, 200);
    // fewer than 200 bars but >= 20 → uses full-series MA
    expect(result.aboveMa).toBe(true);
  });

  it('computes dropPct/rallyPct off the trailing 5-bar window', () => {
    const hist = bars(10, { start: 100, step: 0 });
    hist.highs[9] = 110; // most recent bar sets the week high
    hist.lows[5]  = 90;  // within the 5-bar lookback, sets the week low
    const price = 100;
    const result = deriveIndicators(hist, price, 0, 200);
    expect(result.weekHigh).toBe(110);
    expect(result.weekLow).toBe(90);
    expect(result.dropPct).toBeCloseTo((110 - 100) / 110 * 100, 5);
    expect(result.rallyPct).toBeCloseTo((100 - 90) / 90 * 100, 5);
  });

  it('omits ivrEst/hv30 under 22 bars and computes them once there is enough history', () => {
    const short = bars(21);
    expect(deriveIndicators(short, 100, 0, 200).ivrEst).toBeNull();
    expect(deriveIndicators(short, 100, 0, 200).hv30).toBeNull();

    const long = bars(30, { start: 100, step: 0.5 });
    const result = deriveIndicators(long, long.closes[29], 0, 200);
    expect(result.hv30).not.toBeNull();
    expect(result.ivrEst).not.toBeNull();
  });

  it('passes price/chg1d through and trims closes2m/dates2m to the last 45 bars', () => {
    const hist = bars(60);
    const result = deriveIndicators(hist, 999, 1.5, 200);
    expect(result.price).toBe(999);
    expect(result.chg1d).toBe(1.5);
    expect(result.closes2m.length).toBe(45);
    expect(result.dates2m.length).toBe(45);
  });
});

describe('buildSignals — CSP', () => {
  const watchlist = [{ ticker: 'AAPL', diveIn: PRIORITY, pageId: 'p1' }];
  // RSI inside 30–50, and %K rising from a prior bar below 20: the trigger.
  const trigger = { price: 190, chg1d: -1, dropPct: 6, weekHigh: 200, aboveMa: true,
                    rsi: 42, stochK: 18, stochKPrev: 12 };

  it('fires when Priority-flagged and both RSI and Stochastic trigger', () => {
    const sigs = buildSignals(watchlist, [], CRITERIA, { AAPL: trigger });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'csp', ticker: 'AAPL', rsi: 42, stochK: 18 });
  });

  it('does not fire when the row is not Priority-flagged', () => {
    const plain = [{ ticker: 'AAPL', diveIn: 'Watchlist' }];
    expect(buildSignals(plain, [], CRITERIA, { AAPL: trigger })).toHaveLength(0);
  });

  it('does not fire when RSI sits outside the band', () => {
    for (const rsi of [25, 55, 70]) {
      expect(buildSignals(watchlist, [], CRITERIA, { AAPL: { ...trigger, rsi } }),
        `rsi ${rsi}`).toHaveLength(0);
    }
  });

  it('does not fire when %K is below 20 but still falling', () => {
    const falling = { ...trigger, stochK: 12, stochKPrev: 18 };
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: falling })).toHaveLength(0);
  });

  it('does not fire when %K is rising but the prior bar was already above 20', () => {
    const late = { ...trigger, stochK: 45, stochKPrev: 30 };
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: late })).toHaveLength(0);
  });

  it('does not fire when RSI or Stochastic is unknown', () => {
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: { ...trigger, rsi: null } })).toHaveLength(0);
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: { ...trigger, stochK: null } })).toHaveLength(0);
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: { ...trigger, stochKPrev: null } })).toHaveLength(0);
  });

  it('no longer gates on the drop — a flat name still fires if the oscillators do', () => {
    const noDrop = { ...trigger, dropPct: 0.2 };
    expect(buildSignals(watchlist, [], CRITERIA, { AAPL: noDrop })).toHaveLength(1);
  });

  it('carries the drop and ATR through for display rather than as pills', () => {
    const sigs = buildSignals(watchlist, [], CRITERIA, { AAPL: { ...trigger, atrDrop: 2.4 } });
    expect(sigs[0].dropPct).toBe(6);
    expect(sigs[0].atrDrop).toBe(2.4);
    const labels = sigs[0].chks.map(c => c.l);
    expect(labels).toHaveLength(2);
    expect(labels.some(l => /Dive-In|week high|ATR/.test(l))).toBe(false);
    expect(labels[0]).toMatch(/^RSI /);
    expect(labels[1]).toMatch(/^%K /);
  });

  it('does not fire when a short put/call is already open on the ticker', () => {
    const positions = [{ id: 1, ticker: 'AAPL', type: 'short_put', qty: 1 }];
    expect(buildSignals(watchlist, positions, CRITERIA, { AAPL: trigger })).toHaveLength(0);
  });

  it('uses the live strike/dte from strikeMap when available', () => {
    const strikeMap = { 'AAPL:put': { strike: 185, dte: 30, delta: -0.25 } };
    const sigs = buildSignals(watchlist, [], CRITERIA, { AAPL: trigger }, strikeMap);
    expect(sigs[0].strike).toBe(185);
    expect(sigs[0].dteTarget).toBe(30);
    expect(sigs[0].suggestion).toContain('$185');
  });

  it('no longer tells you to go check the chart by hand', () => {
    const sigs = buildSignals(watchlist, [], CRITERIA, { AAPL: trigger });
    expect(sigs[0].suggestion).not.toContain('Confirm RSI');
  });
});

describe('buildSignals — Covered Call', () => {
  // Mirror of the CSP trigger: RSI inside 50–70, %K falling from above 80.
  const ccTrigger = { price: 420, chg1d: 1, rallyPct: 6, weekLow: 396,
                      rsi: 62, stochK: 82, stochKPrev: 88 };

  it('fires on a 100+ share lot when both RSI and Stochastic trigger', () => {
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    const sigs = buildSignals([], positions, CRITERIA, { MSFT: ccTrigger });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'cc', ticker: 'MSFT', contracts: 1, sharesOwned: 100, rsi: 62 });
  });

  it('uses the opposite Stochastic direction from the CSP side', () => {
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    // Rising from above 80 is the CSP-style direction — wrong for a call.
    const rising = { ...ccTrigger, stochK: 88, stochKPrev: 82 };
    expect(buildSignals([], positions, CRITERIA, { MSFT: rising })).toHaveLength(0);
    // Falling, but from a prior bar that never got above 80.
    const shallow = { ...ccTrigger, stochK: 70, stochKPrev: 75 };
    expect(buildSignals([], positions, CRITERIA, { MSFT: shallow })).toHaveLength(0);
  });

  it('does not fire when CC RSI is outside its band', () => {
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    for (const rsi of [40, 75]) {
      expect(buildSignals([], positions, CRITERIA, { MSFT: { ...ccTrigger, rsi } }),
        `rsi ${rsi}`).toHaveLength(0);
    }
  });

  it('no longer gates on the rally — a flat name still fires if the oscillators do', () => {
    const positions = [{ id: 10, ticker: 'MSFT', type: 'shares', qty: 100 }];
    const noRally = { ...ccTrigger, rallyPct: 0.3 };
    expect(buildSignals([], positions, CRITERIA, { MSFT: noRally })).toHaveLength(1);
  });

  it('requires at least 100 shares owned — 99 is not enough, 100 is', () => {
    const at99  = [{ id: 1, ticker: 'MSFT', type: 'shares', qty: 99 }];
    const at100 = [{ id: 1, ticker: 'MSFT', type: 'shares', qty: 100 }];
    expect(buildSignals([], at99,  CRITERIA, { MSFT: ccTrigger })).toHaveLength(0);
    expect(buildSignals([], at100, CRITERIA, { MSFT: ccTrigger })).toHaveLength(1);
  });

  it('floors the contract count to whole lots', () => {
    const lot = [{ id: 1, ticker: 'MSFT', type: 'shares', qty: 250 }];
    expect(buildSignals([], lot, CRITERIA, { MSFT: ccTrigger })[0].contracts).toBe(2);
  });

  it('does not fire under 100 shares or with a call already open', () => {
    expect(buildSignals([], [{ id: 1, ticker: 'MSFT', type: 'shares', qty: 50 }], CRITERIA,
      { MSFT: ccTrigger })).toHaveLength(0);
    const withCall = [
      { id: 1, ticker: 'MSFT', type: 'shares', qty: 100 },
      { id: 2, ticker: 'MSFT', type: 'short_call', qty: 1 },
    ];
    expect(buildSignals([], withCall, CRITERIA, { MSFT: ccTrigger })).toHaveLength(0);
  });
});

describe('buildSignals — Roll / Close', () => {
  function isoDaysFromNow(n) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  it('fires a roll signal when a short put is breached (price below strike)', () => {
    const positions = [{ id: 1, ticker: 'TSLA', type: 'short_put', strike: 250, expiry: isoDaysFromNow(20) }];
    const qmap = { TSLA: { price: 240, chg1d: -2 } };
    const sigs = buildSignals([], positions, CRITERIA, qmap);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'roll', ticker: 'TSLA' });
    expect(sigs[0].suggestion).toContain('Roll down & out');
  });

  it('fires a roll signal when a short call is breached (price above strike)', () => {
    const positions = [{ id: 1, ticker: 'TSLA', type: 'short_call', strike: 250, expiry: isoDaysFromNow(20) }];
    const qmap = { TSLA: { price: 260, chg1d: 2 } };
    const sigs = buildSignals([], positions, CRITERIA, qmap);
    expect(sigs[0].suggestion).toContain('Roll up & out');
  });

  it('fires a close signal once premium capture clears closePct with time remaining below closeDtePct', () => {
    // Entered 5 days ago targeting a 40-day-out expiry: only ~11% of time has
    // elapsed, well under closeDtePct(50) — the "captured most of the premium
    // fast, plenty of time left" case that redeploying capital is for.
    const positions = [{
      id: 1, ticker: 'NVDA', type: 'short_put', strike: 100,
      expiry: isoDaysFromNow(40), enteredAt: Date.now() - 5 * 86400000,
      prem: 2.0, curPrem: 0.5,
    }];
    const qmap = { NVDA: { price: 120, chg1d: 1 } };
    const sigs = buildSignals([], positions, CRITERIA, qmap);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'close', ticker: 'NVDA' });
  });

  it('does not fire close when premium capture is under threshold and price has not breached strike', () => {
    const positions = [{
      id: 1, ticker: 'NVDA', type: 'short_put', strike: 100,
      expiry: isoDaysFromNow(10), enteredAt: Date.now() - 30 * 86400000,
      prem: 2.0, curPrem: 1.8,
    }];
    const qmap = { NVDA: { price: 120, chg1d: 1 } };
    expect(buildSignals([], positions, CRITERIA, qmap)).toHaveLength(0);
  });

  it('prefers the live current premium (_liveCurPrem) over the stale sheet value', () => {
    const positions = [{
      id: 1, ticker: 'NVDA', type: 'short_put', strike: 100,
      expiry: isoDaysFromNow(40), enteredAt: Date.now() - 5 * 86400000,
      prem: 2.0, curPrem: 1.8, _liveCurPrem: 0.5,
    }];
    const qmap = { NVDA: { price: 120, chg1d: 1 } };
    const sigs = buildSignals([], positions, CRITERIA, qmap);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].type).toBe('close');
  });
});
