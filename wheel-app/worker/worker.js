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

const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';
const TRADIER_ORIGIN = 'https://api.tradier.com';
const NOTION_ORIGIN  = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

// Stock Scan Results
const NOTION_DB_ID = '35c400a3-854e-80ff-9b36-fd7ddaa3a850';

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

// ── Notion helpers ───────────────────────────────────────────────────────────

function notionFetch(env, path, init) {
  return fetch(NOTION_ORIGIN + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
      ...(init && init.headers),
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function plain(rich) {
  return (rich || []).map((t) => t.plain_text).join('');
}

/** Every page where TV Lists is non-empty, flattened for the app. */
async function readWatchlist(env) {
  const rows = [];
  let cursor = null;

  do {
    const body = {
      page_size: 100,
      filter: { property: 'TV Lists', multi_select: { is_not_empty: true } },
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const res = await notionFetch(env, `/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`notion query ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();
    for (const page of data.results) {
      const p = page.properties || {};
      const ticker = plain(p.Ticker && p.Ticker.title).trim().toUpperCase();
      if (!ticker) continue;

      rows.push({
        pageId:   page.id,
        ticker,
        notes:    plain(p.Notes && p.Notes.rich_text),
        category: p['App Category'] && p['App Category'].select
          ? p['App Category'].select.name : '',
        verdict:  p['scanner verdict'] && p['scanner verdict'].select
          ? p['scanner verdict'].select.name : '',
        // Drives which tickers the news feed pulls — '🔥 Priority' rows lead it.
        diveIn:   p['Dive-In'] && p['Dive-In'].select
          ? p['Dive-In'].select.name : '',
        // Shown as pills on the signal cards. These ride along on the query the
        // watchlist already makes, so they cost nothing extra and still render
        // when the (much more expensive) page-body fetch fails.
        wheel:    p['Wheel (CSP)'] && p['Wheel (CSP)'].select
          ? p['Wheel (CSP)'].select.name : '',
        fundamentals: p.Fundamentals && p.Fundamentals.select
          ? p.Fundamentals.select.name : '',
        lastEval: p['Last Eval Date'] && p['Last Eval Date'].date
          ? p['Last Eval Date'].date.start : '',
        sector:   p.sector && p.sector.select ? p.sector.select.name : '',
        addedAt:  Date.parse(page.created_time) || null,
      });
    }

    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return rows;
}

// ── Latest evaluation ────────────────────────────────────────────────────────
// Each ticker page is a stack of toggle headers, newest first, whose titles are
// eval dates ("# 07-21-2026"). The newest evaluation is therefore everything
// nested under the FIRST toggle header on the page. Nothing below that first
// header is read, so older evals never leak into the app.

const EVAL_MAX_BLOCKS = 60;   // guards against an unusually long eval
const EVAL_MAX_TABLES = 6;    // each table costs an extra round trip

async function blockChildren(env, id) {
  const res = await notionFetch(env, `/v1/blocks/${id}/children?page_size=100`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`notion blocks ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.results || [];
}

/** A toggle block, or a heading with the toggle arrow turned on. */
function isToggleHeader(b) {
  if (b.type === 'toggle') return true;
  const h = b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3';
  return h && b[b.type] && b[b.type].is_toggleable === true;
}

async function readEval(env, pageId) {
  const top    = await blockChildren(env, pageId);
  const header = top.find(isToggleHeader);
  if (!header) return null;

  const title = plain(header[header.type].rich_text);
  const kids  = header.has_children ? await blockChildren(env, header.id) : [];

  const blocks = [];
  let tables = 0;

  for (const b of kids.slice(0, EVAL_MAX_BLOCKS)) {
    switch (b.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        blocks.push({ type: 'heading', text: plain(b[b.type].rich_text) });
        break;
      case 'paragraph': {
        const text = plain(b.paragraph.rich_text);
        if (text.trim()) blocks.push({ type: 'text', text });
        break;
      }
      case 'quote':
        blocks.push({ type: 'text', text: plain(b.quote.rich_text) });
        break;
      case 'bulleted_list_item':
        blocks.push({ type: 'bullet', text: plain(b.bulleted_list_item.rich_text) });
        break;
      case 'numbered_list_item':
        blocks.push({ type: 'bullet', text: plain(b.numbered_list_item.rich_text) });
        break;
      case 'table': {
        if (!b.has_children || tables >= EVAL_MAX_TABLES) break;
        tables++;
        const rowBlocks = await blockChildren(env, b.id);
        const rows = rowBlocks
          .filter(r => r.type === 'table_row')
          .map(r => (r.table_row.cells || []).map(plain))
          // Notion tables often carry an empty first row when the header is
          // styled but unfilled — dropping blank rows keeps the app's table honest.
          .filter(cells => cells.some(c => c.trim()));
        if (rows.length) {
          blocks.push({ type: 'table', hasHeader: !!(b.table && b.table.has_column_header), rows });
        }
        break;
      }
      default:
        break; // dividers, images, embeds — not part of the written evaluation
    }
  }

  return { title, blocks };
}

/** Patch only the two properties the app owns. Nothing else is ever written. */
async function updatePage(env, pageId, patch) {
  const properties = {};

  if (typeof patch.notes === 'string') {
    // Notion caps a single rich_text chunk at 2000 chars.
    const content = patch.notes.slice(0, 2000);
    properties.Notes = { rich_text: content ? [{ text: { content } }] : [] };
  }

  if (typeof patch.category === 'string') {
    properties['App Category'] = patch.category ? { select: { name: patch.category } } : { select: null };
  }

  if (!Object.keys(properties).length) throw new Error('nothing to update');

  const res = await notionFetch(env, `/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`notion patch ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
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
