import { describe, it, expect } from 'vitest';
import { sharesFromAssignment, applyCalledAway, assignmentsMissingShares } from './assignment';

const close = { id: 10, ticker: 'UBER', type: 'assigned', posType: 'short_put', qty: 1, strike: 70, prem: 1.2, sharesAcquired: 100, costBasis: 68.8, account: 'Esther', enteredAt: 1000 };

describe('Part 9B assignment → shares', () => {
  it('assigned put makes a 100-share lot at strike − premium', () => {
    expect(sharesFromAssignment(close, { id: 11 })).toEqual({
      id: 11, ticker: 'UBER', type: 'shares', qty: 100, cost: 68.8, account: 'Esther', enteredAt: 1000, notes: 'From assigned $70 put',
    });
  });
  it('2 contracts → 200 shares; spreads say so; calls (negative) make nothing', () => {
    expect(sharesFromAssignment({ ...close, sharesAcquired: 200 }).qty).toBe(200);
    expect(sharesFromAssignment({ ...close, longStrike: 65 }).notes).toBe('From assigned $70/$65 spread');
    expect(sharesFromAssignment({ ...close, sharesAcquired: -100 })).toBeNull();
  });
  it('called away: oldest lot first, partial lot shrinks, others untouched', () => {
    const pos = [
      { id: 1, ticker: 'NVDA', type: 'shares', qty: 50, enteredAt: 1 },
      { id: 2, ticker: 'NVDA', type: 'shares', qty: 100, enteredAt: 2 },
      { id: 3, ticker: 'NVDA', type: 'shares', qty: 100, enteredAt: 3, account: 'Fam' },
      { id: 4, ticker: 'AMD', type: 'shares', qty: 100, enteredAt: 0 },
    ];
    const r = applyCalledAway(pos, { ticker: 'NVDA', qty: 100, closeId: 99 });
    expect(r.positions.find((p) => p.id === 1).linkedId).toBe(99); // used up → closed
    expect(r.positions.find((p) => p.id === 2).qty).toBe(50);       // 50 left
    expect(r.positions.find((p) => p.id === 3).qty).toBe(100);      // other account
    expect(r.positions.find((p) => p.id === 4).qty).toBe(100);      // other ticker
    expect(r.shortBy).toBe(0);
  });
  it('called away with too few shares → removes what is there, reports the gap', () => {
    const r = applyCalledAway([{ id: 1, ticker: 'X', type: 'shares', qty: 40 }], { ticker: 'X', qty: 100, closeId: 5 });
    expect(r.removed).toBe(40);
    expect(r.shortBy).toBe(60);
  });
  it('finds old assignments with no shares row', () => {
    const shares = { id: 11, ticker: 'UBER', type: 'shares', qty: 100 };
    expect(assignmentsMissingShares([close])).toEqual([close]);
    expect(assignmentsMissingShares([{ ...close, rolledToId: 11 }, shares])).toEqual([]);
    expect(assignmentsMissingShares([{ ...close, sharesAcquired: -100 }])).toEqual([]); // a call
  });
});
