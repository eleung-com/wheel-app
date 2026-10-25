// Part 9B (PRD claude/wheel-app-prd-part9-stocks-tab-assignment, approved 10-25):
// what an assignment does to your shares. Pure — tested.
//
//   Put (or put spread) assigned → you now own the shares: a new `shares` row,
//     cost = strike − premium (the basis the close form already works out).
//     The close row's rolledToId points at it, the same link exercised LEAPS use.
//   Call assigned → the shares are called away: oldest lots go first (FIFO,
//     El's Q2 answer), a lot that's only partly used just shrinks.

/** The shares row an assigned put creates. `close` = the close row (has sharesAcquired, costBasis). */
export function sharesFromAssignment(close, { id = Date.now() + 1 } = {}) {
  const qty = Number(close.sharesAcquired) || 0;
  if (qty <= 0) return null;
  const strike = close.longStrike != null ? `$${close.strike}/$${close.longStrike} spread` : `$${close.strike} put`;
  return {
    id,
    ticker: close.ticker,
    type: 'shares',
    qty,
    cost: Math.round((Number(close.costBasis) || 0) * 100) / 100,
    account: close.account || 'Esther',
    enteredAt: close.enteredAt || Date.now(),
    notes: `From assigned ${strike}`,
  };
}

/**
 * Remove `qty` shares of `ticker` (same account), oldest lot first.
 * A fully used lot is closed by stamping linkedId = closeId (the app's usual
 * "this row is closed" mark); a partly used lot keeps its remainder.
 * @returns {{ positions, removed, shortBy }}
 */
export function applyCalledAway(positions, { ticker, qty, account = 'Esther', closeId }) {
  let left = Math.abs(Number(qty) || 0);
  const lots = positions
    .filter((p) => p.type === 'shares' && !p.linkedId && p.ticker === ticker && (p.account || 'Esther') === account)
    .sort((a, b) => (a.enteredAt || 0) - (b.enteredAt || 0));
  const change = new Map();
  for (const lot of lots) {
    if (left <= 0) break;
    if (lot.qty <= left) { change.set(lot.id, { ...lot, linkedId: closeId }); left -= lot.qty; }
    else { change.set(lot.id, { ...lot, qty: lot.qty - left }); left = 0; }
  }
  return {
    positions: positions.map((p) => change.get(p.id) || p),
    removed: Math.abs(Number(qty) || 0) - left,
    shortBy: left,
  };
}

/** Assigned puts that never got their shares row (made before Part 9B). */
export function assignmentsMissingShares(positions) {
  const ids = new Set(positions.map((p) => p.id));
  return positions.filter((p) => p.type === 'assigned'
    && (Number(p.sharesAcquired) || 0) > 0
    && !(p.rolledToId && ids.has(p.rolledToId)));
}
