// The browser half of the marketData transport contract.
//
// Neither API is callable directly from a page: Tradier's key must not ship in
// a public bundle, and Yahoo sends no CORS headers and rate-limits residential
// IPs. Both therefore go through the Cloudflare Worker, which holds the
// credentials and sets the User-Agent Yahoo insists on. utils.js already knows
// how to address it in dev vs production; this just adapts that to the shape
// marketData.js expects.

import { tradierRequest, yahooBase } from './utils';

export const browserTransport = {
  async tradier(path, timeoutMs) {
    // null, not an error: no key saved in Settings is a configuration state,
    // not a failure, and marketData falls back to Yahoo accordingly.
    const req = tradierRequest(path);
    if (!req) return null;
    return fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(timeoutMs) });
  },

  async yahoo(path, timeoutMs) {
    return fetch(`${yahooBase()}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  },
};
