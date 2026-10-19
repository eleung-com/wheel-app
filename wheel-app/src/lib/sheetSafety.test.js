import { describe, it, expect } from 'vitest';
import { assignSafeIds, idWarning, parsePositions, parseClosedTrades, FIXED_ID_BASE } from './utils';

// Rows as Apps Script returns them (screenshot of the Positions tab, 10-18).
const qqqOpen  = { id: 1776138410472, ticker: 'QQQ', type: 'short_put', qty: 1, cost: 9.6, strike: 535, expiry: '2026-05-01', prem: 9.6, enteredAt: 1774627200000 };
const qqqClose = { id: 1776138471189, ticker: 'QQQ', type: 'btc', qty: 1, cost: 0, strike: 535, expiry: '2026-05-01', prem: 9.6, enteredAt: 1776182400000, posType: 'short_put', closePrice: 0.84, pnl: 8 };
const smhOpen  = { id: 1776048455135, ticker: 'SMH', type: 'short_put', qty: 1, cost: 8.64, strike: 435, expiry: '2026-05-01', prem: 8.64, enteredAt: 1774627200000 };

describe('Part 5F — no row is ever silently dropped', () => {
  it('normal sheet: every row kept, ids unchanged, no warning', () => {
    const out = parsePositions([qqqClose, qqqOpen, smhOpen]);
    expect(out.map(p => p.id)).toEqual([qqqClose.id, qqqOpen.id, smhOpen.id]);
    expect(idWarning([qqqClose, qqqOpen, smhOpen], [])).toBeNull();
  });

  it('several blank-id rows are ALL kept (used to collapse into one)', () => {
    const raw = [qqqOpen, { ...smhOpen, id: '' }, { ...smhOpen, id: '', strike: 430 }, { ...smhOpen, id: null, strike: 425 }];
    const out = parsePositions(raw);
    expect(out).toHaveLength(4);
    expect(new Set(out.map(p => p.id)).size).toBe(4);
    expect(idWarning(raw, [])).toMatch(/3 rows had no ID/);
  });

  it('stand-in ids are stable across loads (same rows → same ids)', () => {
    const raw = [qqqOpen, { ...smhOpen, id: '' }];
    expect(parsePositions(raw).map(p => p.id)).toEqual(parsePositions(raw).map(p => p.id));
    expect(parsePositions(raw)[1].id).toBe(FIXED_ID_BASE + 1);
  });

  it('stand-in ids never collide with real ids', () => {
    const raw = [{ ...qqqOpen, id: FIXED_ID_BASE + 1 }, { ...smhOpen, id: '' }];
    const ids = parsePositions(raw).map(p => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('same id, different trade → both kept, first keeps its id, warned', () => {
    const raw = [qqqOpen, { ...smhOpen, id: qqqOpen.id }];
    const out = parsePositions(raw);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(qqqOpen.id);
    expect(out[1].id).not.toBe(qqqOpen.id);
    expect(idWarning(raw, [])).toMatch(/shared an ID/);
  });

  it('exact duplicate row (true copy) → one kept, reported', () => {
    const raw = [qqqOpen, { ...qqqOpen }];
    expect(parsePositions(raw)).toHaveLength(1);
    expect(idWarning(raw, [])).toMatch(/exact duplicate/);
  });

  it('rows without a ticker are still ignored (blank sheet lines)', () => {
    expect(parsePositions([qqqOpen, { id: '', ticker: '' }])).toHaveLength(1);
    expect(idWarning([qqqOpen, { id: '', ticker: '' }], [])).toBeNull();
  });

  it('closed trades get the same protection', () => {
    const t = { id: '', ticker: 'QQQ', posType: 'short_put', closeType: 'btc', qty: 1 };
    const out = parseClosedTrades([t, { ...t, ticker: 'SMH' }]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map(r => r.id)).size).toBe(2);
    expect(idWarning([], [t])).toMatch(/1 row had no ID/);
  });

  it('linkedId on a close row is untouched', () => {
    const close = { ...qqqClose, linkedId: qqqOpen.id };
    expect(parsePositions([qqqOpen, close])[1].linkedId).toBe(qqqOpen.id);
  });

  it('assignSafeIds does not mutate the input', () => {
    const raw = [{ ...smhOpen, id: '' }];
    assignSafeIds(raw);
    expect(raw[0].id).toBe('');
  });
});
