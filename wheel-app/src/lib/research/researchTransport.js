// Browser transport for the Research tab's data layer (companyData.js).
// SEC, FMP and Finnhub go through the /research relay (it holds the keys and
// the SEC contact header, gated on the app secret): a Pages Function on
// Cloudflare Pages, the Worker on the old GitHub Pages site. Yahoo uses the
// same /yf route as the rest of the app. Dev: the Vite proxy forwards both.

import { WORKER_ORIGIN, yahooBase, getSecret } from '../utils';

const TIMEOUT_MS = 15000;

// Cloudflare Pages (and localhost via the Vite proxy) serve /research on the
// app's own address — behind Cloudflare Access on Pages. Only the old GitHub
// Pages site still goes to the Worker's copy of the relay.
function researchBase() {
  return window.location.hostname.endsWith('github.io') ? `${WORKER_ORIGIN}/research` : '/research';
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
