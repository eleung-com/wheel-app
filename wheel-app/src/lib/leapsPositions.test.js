import { describe, it, expect } from 'vitest';
import { buildSignals, LEAPS_REVIEW_DAYS, LEAPS_URGENT_DAYS } from './signalEngine';
import { splitSections } from './signalSections';
import { parsePositions, isOpenPosition } from './utils';
import { leapsCloseDetails } from '../components/modals/ClosePositionModal';
import { leapsPnl } from '../components/pages/PositionsPage/LeapsTable';
import { dteDue } from '../../worker/scan.js';

const iso = (days) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const leaps = (days, extra = {}) => ({ id: 7, ticker: 'NVDA', type: 'long_call', qty: 1, strike: 185, expiry: iso(days), prem: 75.68, ...extra });

describe('LEAPS review card (Part 4C)', () => {
  it('none above 180 days; review at ≤180; urgent at ≤90; in Manage', () => {
    expect(buildSignals([], [leaps(400)], {}, {}).filter(s => s.type === 'leaps_review')).toHaveLength(0);
    const [r] = buildSignals([], [leaps(170)], {}, {}).filter(s => s.type === 'leaps_review');
    expect(r.urgent).toBe(false);
    expect(r.days).toBeLessThanOrEqual(LEAPS_REVIEW_DAYS);
    const [u] = buildSignals([], [leaps(60, { _liveCurPrem: 90.5 })], {}, {}).filter(s => s.type === 'leaps_review');
    expect(u.urgent).toBe(true);
    expect(u.days).toBeLessThanOrEqual(LEAPS_URGENT_DAYS);
    expect(u.pnlPct).toBe(20);
    expect(splitSections([u]).manage).toHaveLength(1);
  });
  it('closed LEAPS give no card; no roll/close cards for LEAPS', () => {
    const sigs = buildSignals([], [leaps(30, { linkedId: 99 })], {}, {});
    expect(sigs).toHaveLength(0);
    const open = buildSignals([], [leaps(5)], {}, { NVDA: { price: 150 } });
    expect(open.map(s => s.type)).toEqual(['leaps_review']);
  });
});

describe('LEAPS positions (Part 4A/4B)', () => {
  it('long_call round-trips the Sheet; stc / exercised rows count as closes', () => {
    const [p] = parsePositions([{ id: 1, ticker: 'NVDA', type: 'long_call', qty: 1, strike: 185, expiry: '2028-06-16', prem: 75.68 }]);
    expect(p.type).toBe('long_call');
    expect(isOpenPosition(p)).toBe(true);
    const [c] = parsePositions([{ id: 2, ticker: 'NVDA', type: 'stc', posType: 'long_call', linkedId: 1, pnl: 500 }]);
    expect(isOpenPosition(c)).toBe(false);
    const [e] = parsePositions([{ id: 3, ticker: 'NVDA', type: 'exercised', posType: 'long_call', linkedId: 1 }]);
    expect(isOpenPosition(e)).toBe(false);
  });
  it('P/L on a bought call', () => {
    expect(leapsPnl({ prem: 50, qty: 2, _liveCurPrem: 60 })).toEqual({ cur: 60, paid: 50, pnl: 2000, pct: 20 });
    expect(leapsPnl({ prem: 50, qty: 1 }).pnl).toBeNull();
  });
  it('close details: sold, expired, exercised → shares, rolled → new LEAPS', () => {
    const pos = leaps(100, { qty: 2, prem: 50, account: 'Fam' });
    expect(leapsCloseDetails(pos, 'stc', { price: 65, closeDateTs: 1 }).pnl).toBe(3000);
    expect(leapsCloseDetails(pos, 'expired', { closeDateTs: 1 }).pnl).toBe(-10000);
    const ex = leapsCloseDetails(pos, 'exercised', { closeDateTs: 1 });
    expect(ex.newPosition).toMatchObject({ type: 'shares', qty: 200, cost: 235, account: 'Fam' });
    const ro = leapsCloseDetails(pos, 'rolled', { price: 60, closeDateTs: 1, roll: { strike: 200, expiry: '2029-01-19', paid: 70, qty: 2 } });
    expect(ro.pnl).toBe(2000);
    expect(ro.newPosition).toMatchObject({ type: 'long_call', strike: 200, prem: 70 });
  });
  it('Worker 21-day reminders skip LEAPS', () => {
    const due = dteDue([leaps(10), { id: 8, ticker: 'MU', type: 'short_put', qty: 1, strike: 900, expiry: iso(10), prem: 20 }], { manageDte: 21 }, new Date());
    expect(due).toHaveLength(1);
  });
});
