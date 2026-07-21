# Cloudflare Worker — wheel-tradier-proxy

`worker.js` is the source for the Worker deployed at
`https://wheel-tradier-proxy.esthercandy.workers.dev`.

It serves two jobs for the production app (GitHub Pages):

| Route | Proxies to | Why |
|---|---|---|
| `/yf/*` | `query1.finance.yahoo.com` | Yahoo sends no CORS headers, so the browser can't fetch it directly. The Worker adds a browser User-Agent and returns the response with `Access-Control-Allow-Origin: *`. |
| everything else | `api.tradier.com` | Swaps the app's `x-tradier-token` header for the real `Authorization` header, keeping the key out of URLs. |

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
```

The deployed app at `eleung-com.github.io/wheel-app` depends on the `/yf` route —
if chart data is missing in production but works at localhost, re-check this Worker first.
