import { tradierRequest, dte as calcDte } from './utils';

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

// Fetch the best-matching strike from a live Tradier option chain for signal generation.
// deltaMin/deltaMax are whole numbers (e.g. 10–15); Tradier returns decimals (e.g. -0.12 for puts).
// Returns { strike, expiry, dte, delta, premium } or null on failure.
export async function fetchBestStrike(ticker, optionType, deltaMin, deltaMax, dteMin, dteMax) {
  if (!tradierRequest('')) return null;

  try {
    // 1. Get available expiry dates
    const { url: expUrl, headers } = tradierRequest(
      `/v1/markets/options/expirations?symbol=${ticker}&includeAllRoots=true&strikes=false`
    );
    const expRes = await fetch(expUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (!expRes.ok) return null;
    const expData = await expRes.json();

    const rawDates = expData?.expirations?.date;
    if (!rawDates) return null;
    const dateArr = Array.isArray(rawDates) ? rawDates : [rawDates];

    // 2. Pick the Tradier expiry closest to the mid-DTE target.
    // Prefer dates within range first; if none exist, use the closest available date.
    const dteMid = (dteMin + dteMax) / 2;
    const allDated = dateArr
      .map(d => ({ date: d, dte: calcDte(d) }))
      .filter(d => d.dte !== null && d.dte > 0);

    if (!allDated.length) return null;

    const inRange = allDated.filter(d => d.dte >= dteMin && d.dte <= dteMax);
    const pool    = inRange.length ? inRange : allDated;
    const target  = pool.reduce((best, d) =>
      Math.abs(d.dte - dteMid) < Math.abs(best.dte - dteMid) ? d : best
    );

    // 3. Fetch option chain with greeks for that expiry
    const { url: chainUrl, headers: chainHdrs } = tradierRequest(
      `/v1/markets/options/chains?symbol=${ticker}&expiration=${target.date}&greeks=true`
    );
    const chainRes = await fetch(chainUrl, { headers: chainHdrs, signal: AbortSignal.timeout(10000) });
    if (!chainRes.ok) return null;
    const chainData = await chainRes.json();

    const rawOpts = chainData?.options?.option;
    if (!rawOpts) return null;

    const contracts = (Array.isArray(rawOpts) ? rawOpts : [rawOpts])
      .filter(o => o.option_type === optionType && o.greeks?.delta != null);

    if (!contracts.length) return null;

    // 4. Find the contract whose |delta| is closest to the target mid-delta.
    // Puts: Tradier delta is negative (e.g. -0.12 for a 12-delta put); criteria are positive.
    // Calls: Tradier delta is positive; criteria are positive.
    const deltaMid    = (deltaMin + deltaMax) / 2 / 100;
    const targetDelta = optionType === 'put' ? -deltaMid : deltaMid;
    const loDecimal   = optionType === 'put' ? -(deltaMax / 100) : (deltaMin / 100);
    const hiDecimal   = optionType === 'put' ? -(deltaMin / 100) : (deltaMax / 100);

    const deltaInRange  = contracts.filter(o => o.greeks.delta >= loDecimal && o.greeks.delta <= hiDecimal);
    const deltaPool     = deltaInRange.length ? deltaInRange : contracts;

    const best = deltaPool.reduce((b, o) =>
      Math.abs(o.greeks.delta - targetDelta) < Math.abs(b.greeks.delta - targetDelta) ? o : b
    );

    const bid = best.bid ?? null, ask = best.ask ?? null;
    const premium = (bid !== null && ask !== null && bid > 0 && ask > 0)
      ? parseFloat(((bid + ask) / 2).toFixed(2))
      : (best.last > 0 ? parseFloat(best.last.toFixed(2)) : null);

    return {
      strike:  best.strike,
      expiry:  target.date,
      dte:     target.dte,
      delta:   best.greeks.delta,
      premium,
    };
  } catch (e) {
    return null;
  }
}
