import { tradierRequest } from './utils';

export async function fetchOptionPrice(ticker, type, strike, expiry) {
  const req = tradierRequest('');
  if (!req || !ticker || !strike || !expiry) return null;

  const optionType = type === 'short_put' ? 'put' : 'call';

  try {
    // Fetch the option chain for the specific expiry date
    const { url, headers } = tradierRequest(`/v1/markets/options/chains?symbol=${ticker}&expiration=${expiry}&greeks=false`);
    const r   = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;

    const data = await r.json();
    const raw  = data?.options?.option;
    if (!raw) return null;

    // Tradier returns object (not array) when only one contract
    const contracts = (Array.isArray(raw) ? raw : [raw])
      .filter(o => o.option_type === optionType);

    // Find closest strike
    const match = contracts.find(o => Math.abs(o.strike - strike) < 0.01)
      || contracts.find(o => Math.abs(o.strike - strike) <= 0.50)
      || contracts.find(o => Math.abs(o.strike - strike) <= 1.00);

    if (!match) return null;

    const bid = match.bid ?? null, ask = match.ask ?? null;
    if (bid !== null && ask !== null && bid > 0 && ask > 0) {
      return parseFloat(((bid + ask) / 2).toFixed(2));
    }
    if (match.last && match.last > 0) return parseFloat(match.last.toFixed(2));
    return null;
  } catch (e) {
    return null;
  }
}
