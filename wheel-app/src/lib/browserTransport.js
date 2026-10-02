// The browser half of the marketData transport contract.
//
// Neither source is callable directly from a page: Yahoo and CBOE send no CORS
// headers, and Yahoo rate-limits residential IPs. Both therefore go through the
// Cloudflare Worker, which sets the User-Agent they expect. utils.js already
// knows how to address it in dev vs production; this just adapts that to the
// shape marketData.js expects.

import { yahooBase, cboeBase } from './utils';

export const browserTransport = {
  async yahoo(path, timeoutMs) {
    return fetch(`${yahooBase()}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  },

  async cboe(path, timeoutMs) {
    return fetch(`${cboeBase()}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  },
};
