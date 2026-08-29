import { describe, it, expect } from 'vitest';
import { isOpenPosition, isPriceableOption, CLOSE_TYPES } from './utils';

// Regression guard for audit 2.2 (fixed Phase 2).
//
// Closing a trade leaves TWO rows: the close row (btc/expired/assigned/rolled)
// and the original opening row, now stamped with a linkedId. Both keep their
// ticker, strike and expiry. The screener used to filter option rows with
// `p.type !== 'shares' && p.expiry && p.strike`, which excluded neither — so
// every option ever closed was re-priced on every run, forever, and every
// ticker ever traded kept costing a 2-year history fetch.

const openPut = {
  id: 1, ticker: 'NVDA', type: 'short_put', qty: 1, strike: 100, expiry: '2026-10-16',
};

describe('isOpenPosition', () => {
  it('accepts a live option and a live share lot', () => {
    expect(isOpenPosition(openPut)).toBe(true);
    expect(isOpenPosition({ id: 2, ticker: 'MSFT', type: 'shares', qty: 100 })).toBe(true);
  });

  it('rejects every close row type', () => {
    for (const type of CLOSE_TYPES) {
      const closeRow = { ...openPut, id: 9, type, linkedId: 1 };
      expect(isOpenPosition(closeRow), type).toBe(false);
    }
  });

  it('rejects an opening row that has been closed out', () => {
    // The half most easily missed: type is still short_put, strike and expiry
    // are still set. Only linkedId says it is finished.
    expect(isOpenPosition({ ...openPut, linkedId: 99 })).toBe(false);
  });

  it('needs BOTH halves — either test alone leaks a row', () => {
    const closeRow  = { ...openPut, id: 9, type: 'btc', linkedId: 1 };
    const closedOpen = { ...openPut, linkedId: 9 };
    // linkedId alone would pass the close row through if it lacked one
    expect(isOpenPosition({ ...closeRow, linkedId: undefined })).toBe(false);
    // CLOSE_TYPES alone would pass the stamped opening row through
    expect(CLOSE_TYPES.has(closedOpen.type)).toBe(false);
    expect(isOpenPosition(closedOpen)).toBe(false);
  });

  it("keeps a roll's replacement contract, which is a fresh open row", () => {
    expect(isOpenPosition({ ...openPut, id: 12, strike: 95, expiry: '2026-11-20' })).toBe(true);
  });

  it('is safe on null/undefined', () => {
    expect(isOpenPosition(null)).toBe(false);
    expect(isOpenPosition(undefined)).toBe(false);
  });
});

describe('isPriceableOption', () => {
  it('accepts an open contract with a strike and expiry', () => {
    expect(isPriceableOption(openPut)).toBe(true);
  });

  it('rejects shares — there is no chain to price', () => {
    expect(isPriceableOption({ id: 2, ticker: 'MSFT', type: 'shares', qty: 100 })).toBe(false);
  });

  it('rejects closed contracts even though they still carry strike and expiry', () => {
    expect(isPriceableOption({ ...openPut, linkedId: 9 })).toBe(false);
    expect(isPriceableOption({ ...openPut, id: 9, type: 'btc', linkedId: 1 })).toBe(false);
  });

  it('rejects a contract missing strike or expiry', () => {
    expect(isPriceableOption({ ...openPut, expiry: '' })).toBe(false);
    expect(isPriceableOption({ ...openPut, strike: undefined })).toBe(false);
  });

  it('a closed trade history costs nothing to screen', () => {
    // One open put plus a year of closed trades: only the open one is fetched.
    const closed = Array.from({ length: 40 }, (_, i) => ([
      { ...openPut, id: 100 + i, linkedId: 200 + i },
      { ...openPut, id: 200 + i, type: 'btc', linkedId: 100 + i },
    ])).flat();
    const all = [openPut, ...closed];
    expect(all).toHaveLength(81);
    expect(all.filter(isPriceableOption)).toEqual([openPut]);
    expect(all.filter(isOpenPosition)).toEqual([openPut]);
  });
});
