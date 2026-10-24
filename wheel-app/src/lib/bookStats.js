// Part 6E (Home layout v2, approved 10-24): the 4 numbers in the dark
// "your book" panel. Same math StatsPane / HistoryPage used before, pulled out
// so it can be tested. Premium at risk was dropped (El, 10-24).

import { dte, CLOSE_TYPES } from './utils';

const OPEN_OPT = new Set(['short_put', 'short_call', 'put_spread']);
const acctOf = (p) => p.account || 'Esther';
const inAcct = (p, account) => account === 'all' || acctOf(p) === account;

export function bookStats({ positions = [], closedTrades = [], criteria = {}, account = 'all', now = new Date() }) {
  const opts = positions.filter(p => OPEN_OPT.has(p.type) && !p.linkedId && inAcct(p, account));

  // Capital deployed = cash securing puts / spread width + premium paid on LEAPS.
  const secured = opts.reduce((s, p) => {
    if (p.type === 'short_put') return s + (p.strike || 0) * (p.qty || 1) * 100;
    if (p.type === 'put_spread' && p.strike != null && p.longStrike != null) return s + (p.strike - p.longStrike) * (p.qty || 1) * 100;
    return s;
  }, 0);
  const inLeaps = positions
    .filter(p => p.type === 'long_call' && !p.linkedId && inAcct(p, account))
    .reduce((s, p) => s + (p.prem || 0) * (p.qty || 1) * 100, 0);
  const capital = account === 'all'
    ? (criteria.capitalEsther || 0) + (criteria.capitalFam || 0)
    : account === 'Esther' ? (criteria.capitalEsther || 0) : (criteria.capitalFam || 0);
  const deployedPct = capital > 0 ? Math.round(((secured + inLeaps) / capital) * 100) : null;

  // Realized this calendar month (Closed Trades tab).
  const monthTrades = closedTrades.filter(t => {
    if (!t.closeDate || !inAcct(t, account)) return false;
    const d = new Date(t.closeDate);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const realized = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);

  // Next expiry among open options.
  const next = opts
    .map(p => ({ ...p, d: dte(p.expiry) }))
    .filter(p => p.d !== null && p.d >= 0)
    .sort((a, b) => a.d - b.d)[0] || null;

  // Win rate, all time — same rule as the Performance section: close rows,
  // account taken from the opening row, assignments/exercises not scored.
  const byId = {};
  positions.forEach(p => { byId[p.id] = p; });
  const closes = positions.filter(p => CLOSE_TYPES.has(p.type))
    .filter(e => account === 'all' || (byId[e.linkedId]?.account || e.account || 'Esther') === account);
  const scoreable = closes.filter(e => e.type !== 'assigned' && e.type !== 'exercised');
  const wins = scoreable.filter(e => e.pnl != null && e.pnl > 0).length;
  const winRate = scoreable.length ? Math.round((wins / scoreable.length) * 100) : null;

  return {
    deployedPct, inLeaps,
    realized, monthTradeCount: monthTrades.length,
    next, winRate, closedCount: closes.length,
  };
}
