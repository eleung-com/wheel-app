// Cloudflare Worker: wheel-tradier-proxy
//
// Routes:
//   /yf/*       → query1.finance.yahoo.com  (adds a browser User-Agent; Yahoo rejects
//                 bare server requests, and browsers can't call Yahoo directly due to CORS)
//   /notion/*   → api.notion.com            (holds NOTION_TOKEN server-side — the app is a
//                 public static site, so the token can never reach the client)
//   /*          → api.tradier.com           (swaps the x-tradier-token header for the
//                 Authorization header so the key never rides in a URL)
//
// Deploy: see worker/README.md. This file is the source of truth for the worker
// running at https://wheel-tradier-proxy.esthercandy.workers.dev

import { readWatchlist, readEval, updatePage, UUID_RE } from './notion.js';
import { runScan } from './scan.js';
import { sendTelegram } from './telegram.js';

const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';
const TRADIER_ORIGIN = 'https://api.tradier.com';

// Notion routes carry a shared secret, so unlike the finance proxies they are not
// open to any origin. Browsers enforce this; the secret is what stops everything else.
const ALLOWED_ORIGINS = [
  'https://eleung-com.github.io',
  'http://localhost:5173',
  'https://localhost:5173',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'x-tradier-token, accept, content-type',
  'Access-Control-Max-Age': '86400',
};

function notionCors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'x-app-secret, accept, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withCors(res) {
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // ── Notion ─────────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/notion/')) {
      const cors = notionCors(origin);

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      if (!env.NOTION_TOKEN) {
        return json({ error: 'NOTION_TOKEN secret is not set on the worker' }, 500, cors);
      }
      if (!env.APP_SECRET) {
        return json({ error: 'APP_SECRET secret is not set on the worker' }, 500, cors);
      }
      if (request.headers.get('x-app-secret') !== env.APP_SECRET) {
        return json({ error: 'unauthorized' }, 401, cors);
      }

      try {
        if (url.pathname === '/notion/watchlist' && request.method === 'GET') {
          return json({ watchlist: await readWatchlist(env) }, 200, cors);
        }

        if (url.pathname === '/notion/eval' && request.method === 'GET') {
          const pageId = url.searchParams.get('pageId') || '';
          if (!UUID_RE.test(pageId)) {
            return json({ error: 'pageId must be a Notion page UUID' }, 400, cors);
          }
          return json({ eval: await readEval(env, pageId) }, 200, cors);
        }

        if (url.pathname === '/notion/page' && request.method === 'PATCH') {
          const body = await request.json();
          if (!body || !UUID_RE.test(String(body.pageId || ''))) {
            return json({ error: 'pageId must be a Notion page UUID' }, 400, cors);
          }
          await updatePage(env, body.pageId, body);
          return json({ ok: true }, 200, cors);
        }

        return json({ error: 'unknown notion route' }, 404, cors);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502, cors);
      }
    }

    // ── Watchlist feed (read-only relay) ─────────────────────────────────────
    // Same pattern as the notify relay below: a random path segment
    // (WATCHLIST_FEED_TOKEN) instead of the real NOTION_TOKEN/APP_SECRET, for
    // callers that must never hold those — e.g. a cloud-hosted scheduled
    // routine. Read-only; returns exactly what /notion/watchlist returns, but
    // this token can't reach /notion/eval or /notion/page, and can't write.
    const WATCHLIST_FEED_PREFIX = '/watchlist-feed/';
    if (url.pathname.startsWith(WATCHLIST_FEED_PREFIX)) {
      if (!env.WATCHLIST_FEED_TOKEN) {
        return json({ error: 'WATCHLIST_FEED_TOKEN secret is not set on the worker' }, 500);
      }
      if (url.pathname.slice(WATCHLIST_FEED_PREFIX.length) !== env.WATCHLIST_FEED_TOKEN) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.NOTION_TOKEN) {
        return json({ error: 'NOTION_TOKEN secret is not set on the worker' }, 500);
      }
      try {
        return json({ watchlist: await readWatchlist(env) }, 200);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    // ── Notify relay ───────────────────────────────────────────────────────
    // A narrow, single-purpose endpoint: POST {text} here and it's relayed to
    // the same Telegram bot/chat the alert scan uses. Auth is a random path
    // segment (NOTIFY_RELAY_TOKEN) instead of the real TELEGRAM_BOT_TOKEN, so
    // callers that must never hold that token — e.g. a cloud-hosted scheduled
    // routine, which has no secret storage of its own — can still trigger a
    // send. If this token leaks, the only thing it can do is post messages to
    // this one chat; it can't read Notion, Sheets, or anything else.
    const NOTIFY_PREFIX = '/notify/';
    if (url.pathname.startsWith(NOTIFY_PREFIX)) {
      if (!env.NOTIFY_RELAY_TOKEN) {
        return json({ error: 'NOTIFY_RELAY_TOKEN secret is not set on the worker' }, 500);
      }
      if (url.pathname.slice(NOTIFY_PREFIX.length) !== env.NOTIFY_RELAY_TOKEN) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (request.method !== 'POST') {
        return json({ error: 'POST only' }, 405);
      }
      try {
        const body = await request.json();
        const text = String(body?.text || '').slice(0, 4000); // Telegram's own message cap is ~4096
        if (!text) return json({ error: 'text is required' }, 400);
        await sendTelegram(env, text);
        return json({ ok: true }, 200);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

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

  // Cron Trigger entry (see wrangler.toml [triggers]). Runs the unattended
  // signal scan and Telegram alert loop — see scan.js for the full pipeline.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  },
};
