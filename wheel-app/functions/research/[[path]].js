// Cloudflare Pages Function: /research/* on the app's own address
// (wheel-app-67w.pages.dev). Same relay as the Worker's /research route, but
// behind Cloudflare Access with the rest of the site, so no cross-site cookie
// problem on Safari (decided 10-03).
//
// Pages project → Settings → Variables and secrets (encrypted):
//   FMP_KEY, FINNHUB_KEY, SEC_CONTACT_EMAIL — required
//   APP_SECRET — optional second lock; when set, requests must carry it
//                in x-app-secret (the app always sends it).

import { fetchResearch } from '../../worker/research.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: { 'content-type': 'application/json' } });
  }
  if (env.APP_SECRET && request.headers.get('x-app-secret') !== env.APP_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  // Never let a browser or shared cache keep relay answers outside the edge cache.
  return fetchResearch(new URL(request.url), env, { 'cache-control': 'private, no-store' });
}
