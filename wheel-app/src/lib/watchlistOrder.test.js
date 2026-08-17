import { describe, it, expect } from 'vitest';
import { groupByDiveIn, sortByDiveIn, groupName, UNTRIAGED } from './watchlistOrder';

const WL = [
  { ticker: 'ZM',   diveIn: '👀 Watch' },
  { ticker: 'AAPL', diveIn: '— Skip' },
  { ticker: 'NVDA', diveIn: '🔥 Priority' },
  { ticker: 'TSLA', diveIn: '' },
  { ticker: 'AMD',  diveIn: '🔥 Priority' },
  { ticker: 'BAC',  diveIn: '👀 Watch' },
  { ticker: 'XYZ',  diveIn: '🚀 Not a real option' },
  { ticker: 'ABC' },
];

describe('groupByDiveIn', () => {
  it('orders groups Priority, Watch, Untriaged, Skip', () => {
    expect(groupByDiveIn(WL).map(g => g.name))
      .toEqual(['🔥 Priority', '👀 Watch', UNTRIAGED, '— Skip']);
  });

  it('sorts alphabetically within each group', () => {
    expect(groupByDiveIn(WL).map(g => g.entries.map(e => e.ticker)))
      .toEqual([['AMD', 'NVDA'], ['BAC', 'ZM'], ['ABC', 'TSLA', 'XYZ'], ['AAPL']]);
  });

  it('buckets unknown and missing Dive-In values into Untriaged', () => {
    expect(groupName({ ticker: 'XYZ', diveIn: '🚀 Not a real option' })).toBe(UNTRIAGED);
    expect(groupName({ ticker: 'ABC' })).toBe(UNTRIAGED);
    expect(groupName({ ticker: 'A', diveIn: '' })).toBe(UNTRIAGED);
  });

  it('omits groups with no members rather than rendering empty headers', () => {
    expect(groupByDiveIn([{ ticker: 'X', diveIn: '— Skip' }]).map(g => g.name)).toEqual(['— Skip']);
    expect(groupByDiveIn([])).toEqual([]);
  });

  it('does not drop or duplicate any row', () => {
    const out = groupByDiveIn(WL).flatMap(g => g.entries.map(e => e.ticker));
    expect(out.length).toBe(WL.length);
    expect(new Set(out).size).toBe(WL.length);
  });
});

describe('sortByDiveIn', () => {
  it('flattens to the exact order evals should be fetched in', () => {
    expect(sortByDiveIn(WL).map(e => e.ticker))
      .toEqual(['AMD', 'NVDA', 'BAC', 'ZM', 'ABC', 'TSLA', 'XYZ', 'AAPL']);
  });

  it('puts every Priority ticker ahead of every Skip ticker', () => {
    const order = sortByDiveIn(WL).map(e => e.ticker);
    expect(Math.max(order.indexOf('AMD'), order.indexOf('NVDA')))
      .toBeLessThan(order.indexOf('AAPL'));
  });

  it('handles an empty watchlist', () => {
    expect(sortByDiveIn([])).toEqual([]);
  });
});
