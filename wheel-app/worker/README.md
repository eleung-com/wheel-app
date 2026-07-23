# Cloudflare Worker — wheel-tradier-proxy

`worker.js` is the source for the Worker deployed at
`https://wheel-tradier-proxy.esthercandy.workers.dev`.

It serves three jobs for the production app (GitHub Pages):

| Route | Proxies to | Why |
|---|---|---|
| `/yf/*` | `query1.finance.yahoo.com` | Yahoo sends no CORS headers, so the browser can't fetch it directly. The Worker adds a browser User-Agent and returns the response with `Access-Control-Allow-Origin: *`. |
| `/notion/*` | `api.notion.com` | Holds the Notion token. The app is a public static site, so the token can never ship in the bundle — and Notion blocks browser calls anyway. |
| everything else | `api.tradier.com` | Swaps the app's `x-tradier-token` header for the real `Authorization` header, keeping the key out of URLs. |

## Notion routes

Back the app's watchlist. Two endpoints, both gated on an `x-app-secret` header
that must equal the `APP_SECRET` secret — the same secret the app already stores
for Apps Script.

| Method | Path | Does |
|---|---|---|
| `GET` | `/notion/watchlist` | Returns every Stock Scan Results page where `TV Lists` is non-empty, as `{pageId, ticker, notes, category, verdict, sector, diveIn, wheel, fundamentals, lastEval, addedAt}`. `diveIn` is the Dive-In select — rows reading `🔥 Priority` are the ones the Home news feed and the CSP signals use. `wheel` / `fundamentals` are the `Wheel (CSP)` and `Fundamentals` selects, shown as pills on signal cards. |
| `GET` | `/notion/eval?pageId=…` | The **latest evaluation** for one ticker: everything nested under the *first* toggle header on its page. Returns `{eval: {title, blocks} \| null}`, or `null` when the page has no toggle header. |
| `PATCH` | `/notion/page` | Body `{pageId, notes?, category?}`. Writes **only** the `Notes` and `App Category` properties — never touches `scanner verdict`, `TV Lists`, or page content. |

### How `/notion/eval` reads a page

Each ticker page stacks its evaluations newest-first under toggle headers titled
by date (`# 07-21-2026`). The route reads the children of the **first** toggle
header only, so older evaluations further down the page are never returned —
there is a test asserting the second toggle is never even fetched.

`blocks` is a flattened list the app renders directly. Each entry is one of:

| `type` | Shape | From |
|---|---|---|
| `heading` | `{text}` | `heading_1/2/3` |
| `text` | `{text}` | `paragraph`, `quote` (blank ones dropped) |
| `bullet` | `{text}` | `bulleted_list_item`, `numbered_list_item` |
| `table` | `{hasHeader, rows: string[][]}` | `table` + its `table_row` children |

Dividers, images and embeds are skipped. Each table costs an extra Notion round
trip, so a page is capped at `EVAL_MAX_TABLES` tables and `EVAL_MAX_BLOCKS`
blocks. Rows where every cell is blank are dropped — Notion tables often carry
an empty styled header row. The app caches each result for 24h, keyed by page id
and stamped with `lastEval`, so rewriting an eval invalidates it early.

Unlike the finance routes, these restrict `Access-Control-Allow-Origin` to the
Pages origin and localhost. That stops other sites' JavaScript from using the
endpoint; the shared secret is what stops everything else. Note the secret does
live in your browser's localStorage, so treat it as a speed bump rather than
real authentication — anyone holding it can read and edit these two properties.

### Required secrets

Set both in the dashboard under **Settings → Variables and Secrets**, or via CLI:

```bash
npx wrangler secret put NOTION_TOKEN --name wheel-tradier-proxy   # ntn_… from notion.so/my-integrations
npx wrangler secret put APP_SECRET   --name wheel-tradier-proxy   # same value as the app's saved secret
```

The Notion integration must also be added to the Stock Scan Results database
(`•••` → **Connections**), or every call returns 404.

## Deploying an update

**Option A — Cloudflare dashboard (no tooling needed):**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → `wheel-tradier-proxy`
2. Click **Edit code**
3. Replace the entire contents with `worker.js` from this folder
4. Click **Deploy**

**Option B — Wrangler CLI:**

```bash
npx wrangler deploy worker/worker.js --name wheel-tradier-proxy
```

## Verifying

After deploying, both of these should return JSON (not a CORS or 4xx error):

```bash
# Yahoo route (no token needed)
curl 'https://wheel-tradier-proxy.esthercandy.workers.dev/yf/v8/finance/chart/AAPL?interval=1d&range=5d'

# Tradier route (needs your key)
curl -H 'x-tradier-token: YOUR_KEY' \
  'https://wheel-tradier-proxy.esthercandy.workers.dev/v1/markets/quotes?symbols=AAPL'

# Notion route (needs your app secret) — should list ~29 tickers
curl -H 'x-app-secret: YOUR_SECRET' \
  'https://wheel-tradier-proxy.esthercandy.workers.dev/notion/watchlist'

# Latest evaluation for one ticker — pageId comes from the watchlist response
curl -H 'x-app-secret: YOUR_SECRET' \
  'https://wheel-tradier-proxy.esthercandy.workers.dev/notion/eval?pageId=PAGE_UUID'
```

The deployed app at `eleung-com.github.io/wheel-app` depends on the `/yf` route —
if chart data is missing in production but works at localhost, re-check this Worker first.
