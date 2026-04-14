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
  if (!ticker || !strike) return null;
  const contractType = type === 'short_put' ? 'puts' : 'calls';

  // Strategy 1: fetch with specific expiry date (try ±1 day offsets)
  if (expiry) {
    const baseMs = new Date(expiry + 'T12:00:00').getTime();
    const offsets = [0, 86400000, -86400000, 172800000];
    for (const offset of offsets) {
      try {
        const ts  = Math.floor((baseMs + offset) / 1000);
        const url = `/yf/v7/finance/options/${ticker}?date=${ts}`;
        const r   = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const data = await r.json();
        const opts = data?.optionChain?.result?.[0]?.options?.[0];
        if (!opts) continue;
        const match = findContract(opts[contractType] || [], strike);
        const price = priceFromContract(match);
        if (price !== null) return price;
      } catch (e) { continue; }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Strategy 2: fetch without date, scan all available expiry dates
  try {
    const url = `/yf/v7/finance/options/${ticker}`;
    const r   = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const data   = await r.json();
      const result = data?.optionChain?.result?.[0];
      if (result) {
        const opts  = result.options?.[0];
        if (opts) {
          const match = findContract(opts[contractType] || [], strike);
          const price = priceFromContract(match);
          if (price !== null) return price;
        }
        if (expiry && result.expirationDates) {
          for (const ts of result.expirationDates) {
            try {
              const url2 = `/yf/v7/finance/options/${ticker}?date=${ts}`;
              const r2   = await fetch(url2, { signal: AbortSignal.timeout(8000) });
              if (!r2.ok) continue;
              const d2   = await r2.json();
              const opts2 = d2?.optionChain?.result?.[0]?.options?.[0];
              if (!opts2) continue;
              const match2 = findContract(opts2[contractType] || [], strike);
              const price2 = priceFromContract(match2);
              if (price2 !== null) return price2;
            } catch (e) { continue; }
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    }
  } catch (e) {}

  return null;
}
