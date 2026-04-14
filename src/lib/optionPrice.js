import { getFinnhubKey } from './utils';

function findContract(contracts, strike) {
  if (!contracts || !contracts.length) return null;
  return contracts.find(c => Math.abs(c.strike - strike) < 0.01)
      || contracts.find(c => Math.abs(c.strike - strike) <= 0.50)
      || contracts.find(c => Math.abs(c.strike - strike) <= 1.00)
      || null;
}

function priceFromContract(c) {
  if (!c) return null;
  const bid = c.bid ?? null, ask = c.ask ?? null;
  if (bid !== null && ask !== null && bid > 0 && ask > 0) {
    return parseFloat(((bid + ask) / 2).toFixed(2));
  }
  if (c.lastPrice && c.lastPrice > 0) return parseFloat(c.lastPrice.toFixed(2));
  return null;
}

export async function fetchOptionPrice(ticker, type, strike, expiry) {
  const key = getFinnhubKey();
  if (!key || !ticker || !strike) return null;

  const contractType = type === 'short_put' ? 'PUT' : 'CALL';

  try {
    // Finnhub option chain — optionally pass expiry to narrow results
    let url = `/fh/api/v1/stock/option-chain?symbol=${ticker}&token=${key}`;
    if (expiry) url += `&expiration=${expiry}`;

    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();

    // data.data is array of { expirationDate, options: { PUT: [...], CALL: [...] } }
    const expiryGroups = data?.data || [];
    if (!expiryGroups.length) return null;

    // Prefer the exact expiry group; fall back to scanning all
    let groups = expiryGroups;
    if (expiry) {
      const exact = expiryGroups.filter(g => g.expirationDate === expiry);
      if (exact.length) groups = exact;
    }

    for (const group of groups) {
      const contracts = group.options?.[contractType] || [];
      const match = findContract(contracts, strike);
      const price = priceFromContract(match);
      if (price !== null) return price;
    }
  } catch (e) {}

  return null;
}
