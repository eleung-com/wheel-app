import { describe, it, expect } from 'vitest';
import { parseStrip, pickMovers, nyDate, moveNoteFor } from './homeFeed';

describe('Part 6A market strip', () => {
  it('uses the last two daily closes for price + day %', () => {
    const rows = parseStrip({
      QQQ: { close: [709.8, 718.36, 717.63, 725.2, 704.47] },
      '^VIX': { close: [17.31, 16.68, 19.03] },
    });
    const qqq = rows.find(r => r.label === 'QQQ');
    expect(qqq.price).toBe(704.47);
    expect(qqq.chgPct).toBe(-2.9);
    expect(rows.find(r => r.label === 'VIX').chgPct).toBe(14.1);
  });
  it('missing data → nulls, never a crash', () => {
    const rows = parseStrip({});
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.price === null && r.chgPct === null)).toBe(true);
    expect(parseStrip(null)).toHaveLength(4);
  });
});

describe('Part 6A today’s movers', () => {
  const today = '2026-10-23';
  const wl = [
    { ticker: 'AAA', liveData: { price: 10, chg1d: -7.24 } },
    { ticker: 'BBB', liveData: { price: 20, chg1d: 5.0 }, moveNote: 'Buyback', moveNoteDate: today, moveLink: 'https://x' },
    { ticker: 'CCC', liveData: { price: 30, chg1d: 4.9 } },
    { ticker: 'SMH', liveData: { price: 40, chg1d: -6 } },
    { ticker: 'DDD', liveData: { price: 50, chg1d: 6 }, moveNote: 'Old news', moveNoteDate: '2026-10-22' },
    { ticker: 'EEE' },
  ];
  it('only ±5% or more, biggest first, indexes skipped', () => {
    expect(pickMovers(wl, new Set(), today).map(m => m.ticker)).toEqual(['AAA', 'DDD', 'BBB']);
  });
  it('shows a Claude note only when it is dated today', () => {
    const m = pickMovers(wl, new Set(), today);
    expect(m.find(x => x.ticker === 'BBB').note).toBe('Buyback');
    expect(m.find(x => x.ticker === 'BBB').link).toBe('https://x');
    expect(m.find(x => x.ticker === 'DDD').note).toBeNull();
  });
  it('flags held tickers', () => {
    expect(pickMovers(wl, new Set(['AAA']), today)[0].held).toBe(true);
  });
  it('nyDate is YYYY-MM-DD', () => {
    expect(nyDate(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-22'); // 11pm NY the day before
  });
});

describe('Part 6D watchlist card move note', () => {
  const today = '2026-10-23';
  it('today → shown with its % and link', () => {
    expect(moveNoteFor({ moveNote: 'Guidance cut', moveNoteDate: today, movePct: -7.2, moveLink: 'https://x' }, today))
      .toEqual({ text: 'Guidance cut', pct: -7.2, link: 'https://x' });
  });
  it('yesterday or empty → nothing', () => {
    expect(moveNoteFor({ moveNote: 'Old', moveNoteDate: '2026-10-22' }, today)).toBeNull();
    expect(moveNoteFor({ moveNoteDate: today }, today)).toBeNull();
    expect(moveNoteFor(null, today)).toBeNull();
  });
  it('falls back to the live % when Move % is blank', () => {
    expect(moveNoteFor({ moveNote: 'x', moveNoteDate: today, liveData: { chg1d: 5.04 } }, today).pct).toBe(5);
  });
});

describe('Home and Watchlist match (10-24)', () => {
  const today = '2026-10-23';
  it('a stock with a note today shows on Home even if the live move is now under 5%', () => {
    const wl = [{ ticker: 'GEV', liveData: { price: 815, chg1d: -1.5 }, moveNote: 'test', moveNoteDate: today, movePct: -6 }];
    const m = pickMovers(wl, new Set(), today);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ ticker: 'GEV', note: 'test', chg: -1.5 });
  });
  it('note today but no live price yet → uses Move %', () => {
    const m = pickMovers([{ ticker: 'GEV', moveNote: 'x', moveNoteDate: today, movePct: -6 }], new Set(), today);
    expect(m[0].chg).toBe(-6);
  });
  it('old note + small move → not shown', () => {
    expect(pickMovers([{ ticker: 'GEV', liveData: { chg1d: -1 }, moveNote: 'x', moveNoteDate: '2026-10-01' }], new Set(), today)).toHaveLength(0);
  });
});
