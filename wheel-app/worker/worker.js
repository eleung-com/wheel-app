// Cloudflare Worker: wheel-tradier-proxy
//
// Routes:
//   /yf/*       → query1.finance.yahoo.com  (adds a browser User-Agent; Yahoo rejects
//                 bare server requests, and browsers can't call Yahoo directly due to CORS)
//   /notion/*   → api.notion.com            (holds NOTION_TOKEN server-side — the app is a
//                 public static site, so the token can never reach the client).
//                 /notion/runs = Research tab history + Watch/Reject + Claude routine (stockRuns.js)
//   /research/* → SEC EDGAR, FMP, Finnhub for the Research tab ("Run a stock").
//                 Gated on x-app-secret like /notion; adds the SEC contact header
//                 and the FMP/Finnhub keys; edge-cached. Pure relay: the app does
//                 the parsing and scoring (decided 10-02, keeps every request tiny).
//   /cboe/*     → cdn.cboe.com/api/global/delayed_quotes (free delayed option chains
//                 with greeks; no CORS headers upstream, so the browser comes through here)
//   anything else → 404 (the Tradier proxy that lived here was retired 10-02-2026)
//
// Deploy: see worker/README.md. This file is the source of truth for the worker
// running at https://wheel-tradier-proxy.esthercandy.workers.dev

import { readWatchlist, readEval, updatePage, UUID_RE } from './notion.js';
import { saveRun, listRuns, setDecision, getRun, redoClaude } from './stockRuns.js';
import { runScan } from './scan.js';
import { sendTelegram } from './telegram.js';

const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';
const CBOE_ORIGIN    = 'https://cdn.cboe.com/api/global/delayed_quotes';

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
  'Access-Control-Allow-Headers': 'accept, content-type',
  'Access-Control-Max-Age': '86400',
};

function notionCors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

// ── Research relay targets ───────────────────────────────────────────────────
// /research/sec/files/…   → www.sec.gov/files/…   (ticker → CIK list)
// /research/sec/api/…     → data.sec.gov/api/…    (XBRL company concepts)
// /research/fmp/…         → financialmodelingprep.com/… + apikey
// /research/finnhub/…     → finnhub.io/… + token
// Only these upstream hosts are reachable, and only by path under them.
const SEC_UA = (email) => `wheel-desk research ${email}`;

export function researchTarget(url, env) {
  const rest = url.pathname.slice('/research/'.length);
  const q = new URLSearchParams(url.search);
  if (rest.startsWith('sec/')) {
    if (!env.SEC_CONTACT_EMAIL) return { error: 'SEC_CONTACT_EMAIL secret is not set on the worker', status: 500 };
    const p = rest.slice(4);
    const host = p.startsWith('files/') ? 'https://www.sec.gov/' : p.startsWith('api/') ? 'https://data.sec.gov/' : null;
    if (!host) return { error: 'unknown sec path', status: 404 };
    return {
      url: host + p,
      headers: { 'User-Agent': SEC_UA(env.SEC_CONTACT_EMAIL), Accept: 'application/json' },
      ttl: p.startsWith('files/') ? 86400 : 21600, // ticker list daily; filings every 6 h
    };
  }
  if (rest.startsWith('fmp/')) {
    if (!env.FMP_KEY) return { error: 'FMP_KEY secret is not set on the worker', status: 500 };
    q.set('apikey', env.FMP_KEY);
    return { url: `https://financialmodelingprep.com/${rest.slice(4)}?${q}`, headers: { Accept: 'application/json' }, ttl: 86400 };
  }
  if (rest.startsWith('finnhub/')) {
    if (!env.FINNHUB_KEY) return { error: 'FINNHUB_KEY secret is not set on the worker', status: 500 };
    q.set('token', env.FINNHUB_KEY);
    return { url: `https://finnhub.io/${rest.slice(8)}?${q}`, headers: { Accept: 'application/json' }, ttl: 86400 };
  }
  return { error: 'unknown research route', status: 404 };
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

        // Stock Runs (Research tab history + decisions, P1.5)
        if (url.pathname === '/notion/runs' && request.method === 'GET') {
          const limit = Number(url.searchParams.get('limit')) || undefined;
          return json({ runs: await listRuns(env, { ticker: url.searchParams.get('ticker') || '', limit }) }, 200, cors);
        }
        if (url.pathname === '/notion/runs' && request.method === 'POST') {
          return json(await saveRun(env, await request.json()), 200, cors);
        }
        // One run + Claude's write-up (the app polls this while Claude works, P1.6)
        if (url.pathname === '/notion/runs/one' && request.method === 'GET') {
          const pageId = url.searchParams.get('pageId') || '';
          if (!UUID_RE.test(pageId)) return json({ error: 'pageId must be a Notion page UUID' }, 400, cors);
          return json(await getRun(env, pageId), 200, cors);
        }
        // Start Claude again for a run ("Redo Claude research" / "Retry")
        if (url.pathname === '/notion/runs/claude' && request.method === 'POST') {
          const body = await request.json();
          if (!body || !UUID_RE.test(String(body.pageId || ''))) {
            return json({ error: 'pageId must be a Notion page UUID' }, 400, cors);
          }
          return json(await redoClaude(env, body.pageId), 200, cors);
        }
        if (url.pathname === '/notion/runs/decision' && request.method === 'PATCH') {
          const body = await request.json();
          if (!body || !UUID_RE.test(String(body.pageId || ''))) {
            return json({ error: 'pageId must be a Notion page UUID' }, 400, cors);
          }
          return json({ run: await setDecision(env, body) }, 200, cors);
        }

        return json({ error: 'unknown notion route' }, 404, cors);
      } catch (e) {
        return json({ error: String(e.message || e) }, e.status || 502, cors);
      }
    }

    // ── Research relay ───────────────────────────────────────────────────
    if (url.pathname.startsWith('/research/')) {
      const cors = notionCors(origin);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
      if (!env.APP_SECRET) return json({ error: 'APP_SECRET secret is not set on the worker' }, 500, cors);
      if (request.headers.get('x-app-secret') !== env.APP_SECRET) return json({ error: 'unauthorized' }, 401, cors);

      const target = researchTarget(url, env);
      if (target.error) return json({ error: target.error }, target.status, cors);
      try {
        const res = await fetch(target.url, {
          headers: target.headers,
          cf: { cacheTtl: target.ttl, cacheEverything: true },
        });
        return new Response(res.body, {
          status: res.status,
          headers: { 'content-type': res.headers.get('content-type') || 'application/json', ...cors },
        });
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

    // ── CBOE delayed option chains ──────────────────────────────────────
    // Pass-through only: the body is streamed back unparsed, so a multi-MB
    // chain costs this request almost no CPU. Parsing happens in the browser.
    if (url.pathname.startsWith('/cboe/')) {
      const target = CBOE_ORIGIN + url.pathname.slice(5) + url.search;
      const res = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*',
        },
      });
      return withCors(res);
    }

    return json({ error: 'unknown route' }, 404, CORS_HEADERS);
  },

  // Cron Trigger entry (see wrangler.toml [triggers]). Runs the unattended
  // signal scan and Telegram alert loop — see scan.js for the full pipeline.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env));
  },
};
