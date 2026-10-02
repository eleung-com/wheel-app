#!/usr/bin/env node
// Live end-to-end check of src/lib/marketData.js against the real Yahoo + CBOE
// feeds — the exact code the app and the Worker run, with a plain-Node transport.
//
// Run from wheel-app/:   node scripts/verify-market-data.mjs [TICKER,TICKER,...]
// Read-only. No keys. Prints price, a suggested CSP and a suggested covered call.

import { fetchQ, fetchBestStrike, fetchOptionPrice } from '../src/lib/marketData.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const transport = {
  // Yahoo blocks home IPs, so go through the Worker's /yf route — the same path
  // the app uses in production.
  yahoo: (path, ms) => fetch('https://wheel-tradier-proxy.esthercandy.workers.dev/yf' + path, {
    signal: AbortSignal.timeout(ms),
  }),
  cboe: (path, ms) => fetch('https://cdn.cboe.com/api/global/delayed_quotes' + path, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms),
  }),
};

// Default criteria from the app: CSP 20–35Δ, 21–45 DTE; CC same band.
const tickers = (process.argv[2] || 'MU,AAPL,UBER,XSP').split(',').map((t) => t.trim().toUpperCase());
let ok = 0;
for (const t of tickers) {
  const q = await fetchQ(transport, t);
  const put = await fetchBestStrike(transport, t, 'put', 20, 35, 21, 45);
  const call = await fetchBestStrike(transport, t, 'call', 20, 35, 21, 45);
  // Round-trip: price the suggested put the way an open position is priced.
  const px = put ? await fetchOptionPrice(transport, { ticker: t, type: 'short_put', strike: put.strike, expiry: put.expiry }) : null;
  const fmt = (b) => (b ? `${b.expiry} $${b.strike} · Δ${b.delta?.toFixed(2)} · $${b.premium} · ${b.dte}d` : '—');
  const pass = !!q && !!put && px !== null;
  if (pass) ok++;
  console.log(`${pass ? '✅' : '❌'} ${t.padEnd(5)} price ${q ? '$' + q.price.toFixed(2) : '—'}`);
  console.log(`      CSP  ${fmt(put)}   (re-priced: ${px ?? '—'})`);
  console.log(`      CC   ${fmt(call)}`);
}
console.log(`\n${ok}/${tickers.length} tickers fully working`);
process.exit(ok === tickers.length ? 0 : 1);
