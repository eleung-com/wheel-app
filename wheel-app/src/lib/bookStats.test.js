import { describe, it, expect } from 'vitest';
import { bookStats } from './bookStats';
import { dte } from './utils';

const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const positions = [
  { id: 1, ticker: 'UBER', type: 'short_put', qty: 1, strike: 70, prem: 1.2, expiry: iso(6) },
  { id: 2, ticker: 'NVDA', type: 'long_call', qty: 1, strike: 185, prem: 20, expiry: iso(400) },
  { id: 3, ticker: 'QQQ', type: 'short_put', qty: 1, strike: 535, prem: 9.6, expiry: '2026-05-01', linkedId: 4 },
  { id: 4, ticker: 'QQQ', type: 'btc', posType: 'short_put', pnl: 876, linkedId: 3 },
  { id: 5, ticker: 'SMH', type: 'btc', posType: 'short_put', pnl: -50, linkedId: 99, account: 'Fam' },
  { id: 6, ticker: 'AMD', type: 'assigned', posType: 'short_put', pnl: 0, linkedId: 98 },
];
const now = new Date();
const thisMonth = iso(0);
const closedTrades = [{ closeDate: thisMonth, pnl: 876 }, { closeDate: '2020-01-05', pnl: 999 }];

describe('Part 6E book stats', () => {
  const s = bookStats({ positions, closedTrades, criteria: { capitalEsther: 20000, capitalFam: 0 }, account: 'all', now });
  it('capital deployed = put cash + LEAPS paid', () => {
    expect(s.deployedPct).toBe(Math.round(((7000 + 2000) / 20000) * 100)); // 45
    expect(s.inLeaps).toBe(2000);
  });
  it('realized this month only', () => {
    expect(s.realized).toBe(876);
    expect(s.monthTradeCount).toBe(1);
  });
  it('next expiry = soonest open option', () => {
    expect(s.next.ticker).toBe('UBER');
    expect(s.next.d).toBe(dte(iso(6))); // same day count the app shows elsewhere
  });
  it('win rate skips assignments', () => {
    expect(s.winRate).toBe(50); // QQQ win, SMH loss, AMD assigned not scored
    expect(s.closedCount).toBe(3);
  });
  it('account filter', () => {
    const fam = bookStats({ positions, closedTrades, criteria: { capitalFam: 5000 }, account: 'Fam', now });
    expect(fam.winRate).toBe(0);
    expect(fam.next).toBeNull();
  });
  it('no capital set → null, no data → nulls', () => {
    expect(bookStats({}).deployedPct).toBeNull();
    expect(bookStats({}).winRate).toBeNull();
  });
});
