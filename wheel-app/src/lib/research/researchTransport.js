// Browser transport for the Research tab's data layer (companyData.js).
// SEC, FMP and Finnhub go through the Worker's /research relay (it holds the
// keys and the SEC contact header, gated on the app secret); Yahoo uses the
// same /yf route as the rest of the app. Dev: the Vite proxy forwards both.

import { WORKER_ORIGIN, yahooBase, getSecret } from '../utils';

const TIMEOUT_MS = 15000;

function researchBase() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? '/research' : `${WORKER_ORIGIN}/research`;
}

function relay(prefix) {
  return (path) => fetch(`${researchBase()}/${prefix}${path}`, {
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
