// Cloudflare Worker: wheel-tradier-proxy
//
// Two routes:
//   /yf/*  → query1.finance.yahoo.com  (adds a browser User-Agent; Yahoo rejects
//            bare server requests, and browsers can't call Yahoo directly due to CORS)
//   /*     → api.tradier.com           (swaps the x-tradier-token header for the
//            Authorization header so the key never rides in a URL)
//
// Deploy: see worker/README.md. This file is the source of truth for the worker
// running at https://wheel-tradier-proxy.esthercandy.workers.dev

const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';
const TRADIER_ORIGIN = 'https://api.tradier.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-tradier-token, accept, content-type',
  'Access-Control-Max-Age': '86400',
};

function withCors(res) {
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Yahoo Finance proxy ──────────────────────────────────────────────
    if (url.pathname.startsWith('/yf/')) {
      const target = YAHOO_ORIGIN + url.pathname.slice(3) + url.search;
      const res = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*',
          'Referer': 'https://finance.yahoo.com/',
        },
      });
      return withCors(res);
    }

    // ── Tradier proxy ────────────────────────────────────────────────────
    const token = request.headers.get('x-tradier-token');
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing x-tradier-token header' }), {
        status: 401,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      });
    }
    const res = await fetch(TRADIER_ORIGIN + url.pathname + url.search, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    return withCors(res);
  },
};
