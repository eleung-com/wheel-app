import { describe, it, expect } from 'vitest';
import { buildSignals, OPEN_OPTION_TYPES } from './signalEngine';

// Audit 1.2 (Phase 4). Put credit spreads shipped in 414ce3d but `put_spread`
// appeared nowhere in signalEngine.js or worker/scan.js, so a breached spread
// produced no card and no Telegram alert. The only thing that ever fired on one
// was the calendar DTE nudge, which uses a different filter.

const CRITERIA = {
  dropPct: 5, ma: 200, earn: 0,
  rsiMin: 30, rsiMax: 50, stochBelow: 20,
  ccRsiMin: 50, ccRsiMax: 70, ccStochAbove: 80,
  deltaMin: 20, deltaMax: 35, dteMin: 21, dteMax: 45,
  ccRallyPct: 5, ccDeltaMin: 15, ccDeltaMax: 25, ccDteMin: 21, ccDteMax: 35,
  closePct: 50, closeDtePct: 50,
};

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 100/95 put credit spread, $5 wide, opened 10 days ago for $1.50 net credit. */
function spread(extra = {}) {
  return {
    id: 1, ticker: 'NVDA', type: 'put_spread', qty: 1,
    strike: 100, longStrike: 95, prem: 1.5,
    expiry: isoDaysFromNow(30), enteredAt: Date.now() - 10 * 86400000,
    ...extra,
  };
}

const sigsFor = (pos, price) => buildSignals([], [pos], CRITERIA, { NVDA: { price, chg1d: -1 } });

describe('put credit spreads reach the signal engine at all', () => {
  it('is one of the option types the roll/close pass evaluates', () => {
    expect(OPEN_OPTION_TYPES.has('put_spread')).toBe(true);
    expect(OPEN_OPTION_TYPES.has('short_put')).toBe(true);
    expect(OPEN_OPTION_TYPES.has('short_call')).toBe(true);
  });

  it('produces nothing while the underlying sits above the short strike', () => {
    expect(sigsFor(spread(), 110)).toHaveLength(0);
  });
});

describe('spread breach depth decides which card fires', () => {
  it('rolls when price is between the two strikes', () => {
    const sigs = sigsFor(spread(), 97);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'roll', ticker: 'NVDA', strike: 100, longStrike: 95, width: 5 });
    expect(sigs[0].suggestion).toMatch(/Roll down & out/);
  });

  it('flags max loss once price is below the LONG strike, not another roll', () => {
    const sigs = sigsFor(spread(), 90);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'maxloss', ticker: 'NVDA', longStrike: 95, width: 5 });
    expect(sigs[0].suggestion).toMatch(/max loss/i);
    expect(sigs[0].suggestion).toMatch(/don't roll on reflex/);
  });

  it('never emits both for the same position', () => {
    for (const price of [99, 97, 95.5, 94, 80]) {
      const types = sigsFor(spread(), price).map(s => s.type);
      expect(new Set(types).size, `price ${price}`).toBe(types.length);
      expect(types.filter(t => t === 'roll' || t === 'maxloss').length, `price ${price}`).toBeLessThanOrEqual(1);
    }
  });

  it('treats exactly at the long strike as a roll, not max loss', () => {
    // At the long strike the spread is not yet fully in the money.
    expect(sigsFor(spread(), 95)[0].type).toBe('roll');
    expect(sigsFor(spread(), 94.99)[0].type).toBe('maxloss');
  });

  it('falls back to plain short-put behaviour when longStrike is missing', () => {
    // A malformed row must not silently become a max-loss alert.
    const sigs = sigsFor(spread({ longStrike: undefined }), 80);
    expect(sigs[0].type).toBe('roll');
    expect(sigs[0].width).toBeUndefined();
  });
});

describe('roll and close cards carry days left (audit 4.4)', () => {
  it('states DTE in the roll suggestion and on a pill', () => {
    const sigs = sigsFor(spread(), 97);
    expect(sigs[0].days).toBeGreaterThan(0);
    expect(sigs[0].suggestion).toMatch(new RegExp(`${sigs[0].days}d left`));
    expect(sigs[0].chks.some(c => c.warn && /d left/.test(c.l))).toBe(true);
  });

  it('a short put breached near expiry says so too', () => {
    const pos = { id: 2, ticker: 'NVDA', type: 'short_put', qty: 1, strike: 100,
                  expiry: isoDaysFromNow(3), enteredAt: Date.now() - 40 * 86400000, prem: 2 };
    const sigs = buildSignals([], [pos], CRITERIA, { NVDA: { price: 95, chg1d: -2 } });
    expect(sigs[0].type).toBe('roll');
    expect(sigs[0].suggestion).toMatch(/\dd left/);
  });
});

describe('spread close signal uses the net credit', () => {
  it('fires on premium capture with the live net spread price', () => {
    // $1.50 credit, spread now worth $0.40 net → 73% captured, 33% of time gone
    const sigs = sigsFor(spread({ _liveCurPrem: 0.4 }), 110);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ type: 'close', pctCap: 73, longStrike: 95, width: 5 });
  });

  it('does not fire when the spread has barely decayed', () => {
    expect(sigsFor(spread({ _liveCurPrem: 1.3 }), 110)).toHaveLength(0);
  });
});
