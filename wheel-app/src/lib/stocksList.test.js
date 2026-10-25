import { describe, it, expect } from 'vitest';
import { groupStocks, filterGroups, searchAction, cleanQuery } from './stocksList';

const wl = [
  { ticker: 'UBER', fmvMid: 100, liveData: { price: 80 } },
  { ticker: 'MSFT', fmvMid: 400, liveData: { price: 420 } },
  { ticker: 'AAPL', fmvMid: 150, liveData: { price: 220 } },
  { ticker: 'SPY' },
];
const scores = { UBER: { verdict: 'Worth investing', score: 90 }, MSFT: { verdict: 'Maybe', score: 66 }, AAPL: { verdict: 'Not worth it', score: 36 } };

describe('stocks list (Part 9D)', () => {
  it('sorts the watchlist into the same sections as before', () => {
    const g = groupStocks(wl, scores, (t) => t === 'SPY');
    expect(g.ready.map((x) => x.w.ticker)).toEqual(['UBER']);
    expect(g.close.map((x) => x.w.ticker)).toEqual(['MSFT']);
    expect(g.skip.map((x) => x.w.ticker)).toEqual(['AAPL']);
    expect(g.idx.map((x) => x.w.ticker)).toEqual(['SPY']);
  });
  it('search filters by ticker, case-insensitive', () => {
    const g = filterGroups(groupStocks(wl, scores), ' ub ');
    expect(Object.values(g).flat().map((x) => x.w.ticker)).toEqual(['UBER']);
    expect(filterGroups(groupStocks(wl, scores), '').ready.length).toBe(1);
  });
  it('the button opens a watchlist stock and researches anything else', () => {
    expect(searchAction('uber', wl)).toBe('open');
    expect(searchAction('NVDA', wl)).toBe('research');
    expect(searchAction('', wl)).toBe(null);
    expect(searchAction('12!', wl)).toBe(null);
    expect(cleanQuery(' nvda ')).toBe('NVDA');
  });
});
