import { describe, it, expect } from 'vitest';
import { splitSections, rankTrades, SECTION } from './signalSections';

describe('Signals tab sections (Part 2C)', () => {
  it('puts every card type in the right section', () => {
    const sigs = ['maxloss', 'roll', 'close', 'cc', 'score_review', 'csp', 'csp_wait']
      .map((type, i) => ({ id: String(i), type }));
    const { manage, trades, waiting } = splitSections(sigs);
    expect(manage.map(s => s.type)).toEqual(['maxloss', 'roll', 'close', 'score_review', 'cc']);
    expect(trades.map(s => s.type)).toEqual(['csp']);
    expect(waiting.map(s => s.type)).toEqual(['csp_wait']);
  });

  it('ranks new trades by score, unscored last, ties by ATR drop', () => {
    const ranked = rankTrades([
      { id: 'u', score: null, atrDrop: 3 },
      { id: 'b', score: 68, atrDrop: 1 },
      { id: 'a', score: 84, atrDrop: 1 },
      { id: 'c', score: 68, atrDrop: 2 },
    ]);
    expect(ranked.map(s => s.id)).toEqual(['a', 'c', 'b', 'u']);
  });

  it('within Manage, sooner expiry first for the same action', () => {
    const { manage } = splitSections([{ id: '1', type: 'roll', days: 30 }, { id: '2', type: 'roll', days: 3 }]);
    expect(manage.map(s => s.id)).toEqual(['2', '1']);
  });

  it('ignores types that belong to no section', () => {
    expect(SECTION.unknown).toBeUndefined();
    expect(splitSections([{ type: 'unknown' }])).toEqual({ manage: [], trades: [], waiting: [] });
  });
});
