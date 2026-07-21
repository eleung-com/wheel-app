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
| `GET` | `/notion/watchlist` | Returns every Stock Scan Results page where `TV Lists` is non-empty, as `{pageId, ticker, notes, category, verdict, sector, addedAt}`. |
| `PATCH` | `/notion/page` | Body `{pageId, notes?, category?}`. Writes **only** the `Notes` and `App Category` properties — never touches `scanner verdict`, `TV Lists`, or page content. |

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
```

The deployed app at `eleung-com.github.io/wheel-app` depends on the `/yf` route —
if chart data is missing in production but works at localhost, re-check this Worker first.
