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
| `GET` | `/notion/watchlist` | Returns every Stock Scan Results page where `TV Lists` is non-empty, as `{pageId, ticker, notes, category, verdict, sector, diveIn, wheel, fundamentals, lastEval, earnings, addedAt}`. `diveIn` is the Dive-In select — rows reading `🔥 Priority` are the ones the Home news feed and the CSP signals use. `wheel` / `fundamentals` are the `Wheel (CSP)` and `Fundamentals` selects, shown as pills on signal cards. `earnings` is the next earnings date, read from the first present of the `Earnings Date` / `Earnings` / `Next Earnings` date properties — it feeds the Home news-tab earnings calendar. |
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

## Unattended Telegram alert scan

`scan.js` is a scheduled job, wired up via `scheduled()` in `worker.js` and the
Cron Trigger in `wrangler.toml` at the repo root. Every 30 minutes during US
market hours it:

1. Re-reads the Notion watchlist (`readWatchlist`, same code the `/notion/watchlist`
   route uses) and the Sheet's positions + saved screener criteria (`SHEET_URL` secret).
2. Fetches daily history + a live quote per ticker directly from Tradier (Yahoo
   fallback), the same way `useScreener.js` does in the browser — just without
   going through the `/yf` or Tradier-token proxy routes, since the Worker has
   its own `TRADIER_TOKEN` and isn't subject to browser CORS.
3. Runs the **shared** signal engine (`src/lib/signalEngine.js` — the same
   module `useScreener.js` imports) to build CSP / CC / Roll / Close signals.
   There is exactly one signal implementation; the Worker and the browser both
   import it, so they can never drift apart.
4. For each new signal (a `ticker|type|<ET date>` KV miss in `ALERTS_KV`),
   sends one Telegram DM and writes the KV key — de-dupe is "at most one alert
   per ticker+signal-type per ET calendar day," per the approved spec.

Because the engine's `ivr` field is an HV30 (realized-volatility) estimate,
not a real IV Rank, every Telegram message labels it "HV30 est."

**Market-hours guard** (`marketHours.js`): the cron fires on a wide UTC window
that covers both EST and EDT; `isMarketOpen()` does the real ET-and-holiday-aware
check, so firings outside actual trading hours are a silent no-op. The NYSE
holiday list needs a yearly top-up — see the comment at the top of that file.

**Failure handling:** a single ticker's fetch failing skips just that ticker
(the batch continues). If *every* ticker fetch fails in one run — both Tradier
and Yahoo down, or (if set) `TRADIER_TOKEN` expired — the Worker sends one
self-alert to Telegram and suppresses repeats for the rest of the ET day,
rather than paging on every run.

### Required secrets (new)

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --name wheel-tradier-proxy   # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID   --name wheel-tradier-proxy   # your DM chat id
npx wrangler secret put SHEET_URL          --name wheel-tradier-proxy   # your Apps Script webapp URL (same one in Settings → Sheet URL)
```

`NOTION_TOKEN` and `APP_SECRET` are already required by the `/notion/*` routes
above and are reused as-is by the scan — no new setup needed for those two.

### `TRADIER_TOKEN` — optional

Every Tradier call in `scan.js` (`fetchHistoryTradier`, `fetchQuote`,
`fetchBestStrike`) checks for `env.TRADIER_TOKEN` first and simply returns
`null` if it's not set — no error, no crash. Without it:

- Daily price history comes from Yahoo Finance instead (same free route the
  app's own charts already use in production, so it's a proven path).
- There's no live intraday quote refinement — price/change use Yahoo's most
  recent daily close, same as the browser does whenever its own Tradier call fails.
- There's no live options-chain lookup, so CSP/CC alerts show the generic
  delta/DTE range ("Sell put · 20–35Δ · 21–45d") instead of an exact strike
  and expiration — you'd look up the actual contract yourself off the alert.

To add it later: `npx wrangler secret put TRADIER_TOKEN --name wheel-tradier-proxy`.

### KV namespace (new)

The de-dupe store. Create it once, then paste the id it prints into
`wrangler.toml`'s `[[kv_namespaces]]` block:

```bash
npx wrangler kv namespace create ALERTS_KV
```

### Getting a Telegram chat id

1. Message [@BotFather](https://t.me/BotFather), `/newbot`, and copy the token → `TELEGRAM_BOT_TOKEN`.
2. Send your new bot any DM (e.g. "hi") so it's allowed to message you back.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id` from the response → `TELEGRAM_CHAT_ID`.

## Deploying an update

**Option A — Cloudflare dashboard (no tooling needed):**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → `wheel-tradier-proxy`
2. Click **Edit code**
3. Replace the entire contents with `worker.js` from this folder
4. Click **Deploy**

Note: the dashboard's inline editor only takes one file. Now that the Worker
is split across `worker.js`, `notion.js`, `scan.js`, `telegram.js`,
`marketHours.js`, and imports from `../src/lib/`, Option A no longer works —
use Wrangler.

**Option B — Wrangler CLI (required now that the Worker spans multiple files):**

```bash
npx wrangler deploy
```

This reads `wrangler.toml` at the repo root (`main = "worker/worker.js"`),
bundles all of the above, and also registers the Cron Trigger and KV binding.

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

### Testing the scan without waiting for a cron firing

```bash
npx wrangler dev --test-scheduled
# in another terminal:
curl "http://localhost:8787/__scheduled?cron=*/30+12-21+*+*+1-5"
```

Check the `wrangler dev` terminal output for `[scan] ...` log lines, and check
Telegram for the DM(s). Note this runs against whatever `.dev.vars` / secrets
your local Wrangler session has — see [Wrangler's docs on local secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
if you want to point a local run at the real Notion/Sheet/Tradier/Telegram
without touching production KV state (or just accept that a local test run
sends a real Telegram DM and writes a real KV de-dupe key, like production would).
