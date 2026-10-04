// Browser transport for the Research tab's data layer (companyData.js).
// SEC, FMP and Finnhub go through /research on the app's own address — a
// Cloudflare Pages Function behind Cloudflare Access that holds the keys and
// the SEC contact header. Yahoo uses the same /yf route as the rest of the app.
// Dev: the Vite proxy forwards both.

import { yahooBase, getSecret } from '../utils';

const TIMEOUT_MS = 15000;

function relay(prefix) {
  return (path) => fetch(`/research/${prefix}${path}`, {
    headers: { 'x-app-secret': getSecret(), Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export const researchTransport = {
  sec: relay('sec'),
  fmp: relay('fmp'),
  finnhub: relay('finnhub'),
  yahoo: (path) => fetch(`${yahooBase()}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
};
