# Cloudflare Worker — wheel-tradier-proxy

`worker.js` is the source for the Worker deployed at
`https://wheel-tradier-proxy.esthercandy.workers.dev`.

It serves these jobs for the production app (GitHub Pages). The name is
historical — Tradier was retired 10-02-2026 — and is kept because the app's
URLs point at it.

| Route | Proxies to | Why |
|---|---|---|
| `/yf/*` | `query1.finance.yahoo.com` | Yahoo sends no CORS headers, so the browser can't fetch it directly. The Worker adds a browser User-Agent and returns the response with `Access-Control-Allow-Origin: *`. |
| `/notion/*` | `api.notion.com` | Holds the Notion token. The app is a public static site, so the token can never ship in the bundle — and Notion blocks browser calls anyway. |
| `/cboe/*` | `cdn.cboe.com/api/global/delayed_quotes` | Free delayed option chains with delta. No CORS upstream. Pure pass-through: the body is streamed back unparsed, so a multi-MB chain costs the Worker almost no CPU. |
| anything else | — | 404. |

## Notion routes

Back the app's watchlist. Two endpoints, both gated on an `x-app-secret` header
that must equal the `APP_SECRET` secret — the same secret the app already stores
for Apps Script.

| Method | Path | Does |
|---|---|---|
| `GET` | `/notion/watchlist` | Returns every Stock Scan Results page where `TV Lists` is non-empty, as `{pageId, ticker, notes, category, verdict, sector, diveIn, wheel, fundamentals, lastEval, earnings, addedAt}`. `diveIn` is the Dive-In select — rows reading `🔥 Priority` are the ones the Home news feed and the CSP signals use. `wheel` / `fundamentals` are the `Wheel (CSP)` and `Fundamentals` selects, shown as pills on signal cards. `earnings` is the next earnings date, read from the first present of the `Earnings Date` / `Earnings` / `Next Earnings` date properties — it feeds the Home news-tab earnings calendar. |
| `GET` | `/notion/eval?pageId=…` | The **latest evaluation** for one ticker: everything nested under the *first* toggle header on its page. Returns `{eval: {title, blocks} \| null}`, or `null` when the page has no toggle header. |
| `PATCH` | `/notion/page` | Body `{pageId, notes}`. Writes **only** the `Notes` property — never touches `scanner verdict`, `TV Lists`, `Dive-In`, or page content. A body with no `notes` is rejected. |

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
Cron Trigger in `wheel-app/wrangler.toml`. Every 30 minutes during US
market hours it:

1. Re-reads the Notion watchlist (`readWatchlist`, same code the `/notion/watchlist`
   route uses) and the Sheet's positions + saved screener criteria (`SHEET_URL` secret).
2. Fetches daily history + a live quote per ticker through `src/lib/marketData.js`
   — the same module the browser uses. The only difference is the injected
   *transport*: the Worker calls Yahoo and CBOE directly, while the browser
   routes through this Worker's `/yf` and `/cboe` proxies.
3. Runs the **shared** signal engine (`src/lib/signalEngine.js` — the same
   module `useScreener.js` imports) to build CSP / CC / Roll / Close signals.
   There is exactly one signal implementation; the Worker and the browser both
   import it, so they can never drift apart.
4. For each new signal (a `ticker|type|<ET date>` KV miss in `ALERTS_KV`),
   sends one Telegram DM and writes the KV key — de-dupe is "at most one alert
   per ticker+signal-type per ET calendar day," per the approved spec.

Because the engine's `ivr` field is an HV30 (realized-volatility) estimate,
not a real IV Rank, every Telegram message labels it "HV30 est."

### 21-DTE management nudge

A second, independent pass (`runDteNudges` in `scan.js`) that runs *before* the
market-data steps above, because it needs no market data at all — it's purely the
calendar. For every still-open option position it sends one Telegram DM per ET
day while the contract sits inside the management window:

| | |
|---|---|
| Fires when | `1 < dte <= criteria.manageDte` (default **21**) |
| Silent when | expiry day or later, outside market hours, position closed |
| One message per | **position**, not per ticker — two contracts on the same underlying each get their own |
| De-dupe key | `manage-dte\|<position id>\|<ET date>` in the same `ALERTS_KV` |
| Stops | automatically, when the position leaves the Sheet — no cleanup step |

`dte()` counts expiry day itself as `1`, which is why the floor is `dte > 1`
rather than `dte > 0`; the number in the message is the same one the dashboard
shows for that position.

The threshold lives in the Sheet's saved criteria as `manageDte` and is editable
at **Settings → Criteria → Exit Rules → Manage at DTE**. `parseCriteria` defaults
it to 21, so the nudge works correctly even before the key has ever been written
to the Sheet.

This pass is wrapped in its own `try/catch`: a failure here can't take down the
signal scan, and a market-data outage can't suppress the nudge.

**Market-hours guard** (`marketHours.js`): the cron fires on a wide UTC window
that covers both EST and EDT; `isMarketOpen()` does the real ET-and-holiday-aware
check, so firings outside actual trading hours are a silent no-op. The NYSE
holiday list needs a yearly top-up — see the comment at the top of that file.

**Failure handling:** a single ticker's fetch failing skips just that ticker
(the batch continues). If *every* ticker fetch fails in one run — Yahoo down
or blocking the Worker — the Worker sends one
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

### Option chains — CBOE (no secret)

Option chains come from CBOE's free delayed-quote file, one per underlying
(`/options/MU.json`; cash-settled indexes use `_XSP`, `_SPX`). It carries every
expiry with bid/ask and delta, ~15 minutes delayed. `marketData.js` downloads a
ticker's file once and reuses it for a few minutes, so pricing a position and
suggesting the next contract cost one download, not two.

**Watch:** in the scheduled scan the Worker parses the file itself. Big
chains (SPY ≈ 6 MB) may hit the free plan's per-request CPU limit. If alerts
start missing contracts for large tickers, check the Worker logs for
"exceeded CPU" — the fix is trimming work per run, or the $5/mo plan.

`TRADIER_TOKEN` is no longer read anywhere and can be deleted:
`npx wrangler secret delete TRADIER_TOKEN --name wheel-tradier-proxy`.

### Claude research routine (Research tab, P1.6)

After a run is saved, the Worker starts the "Stock Run Research" routine on
claude.ai/code (API trigger) with just `ticker` + `run_page_id`. The routine
writes its research into the Stock Runs row; the app re-scores to Final.
Routine instructions: `routines/stock-run-research.md`.

```bash
npx wrangler secret put ROUTINE_FIRE_URL --name wheel-tradier-proxy   # the routine's API trigger URL (…/routines/<id>/fire)
npx wrangler secret put ROUTINE_TOKEN    --name wheel-tradier-proxy   # the routine's token (sk-ant-oat01-…), shown once
```

Without them runs still save; the row just shows "Claude routine not set up yet".
Limits (Anthropic): 30 starts/hour per routine, 100/hour per account, plus a daily cap.

### Cloudflare Pages (the app's new home, 10-03)

The app is hosted on Cloudflare Pages at `https://wheel-app-67w.pages.dev`,
behind Cloudflare Access (email one-time code, one allowed email). The
Research tab's `/research` relay runs there as a Pages Function
(`functions/research/[[path]].js`, shared code in `worker/research.js`), so it
is protected by the same login. This Worker keeps the cron alerts, `/notify`,
`/notion`, `/watchlist-feed`, `/yf`, `/cboe` (and `/research` until the old
GitHub Pages site is switched off).

Pages project settings: root directory `wheel-app`, build command
`npm run build`, output `dist`, env `NODE_VERSION=20`. Secrets
(Settings → Variables and secrets, or `npx wrangler pages secret put NAME
--project-name <your Pages project name>`): `FMP_KEY`, `FINNHUB_KEY`, `SEC_CONTACT_EMAIL`,
`APP_SECRET` (optional second lock).

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

Run it from `wheel-app/`, which is where `wrangler.toml` lives (NOT the repo
root). It reads `main = "worker/worker.js"`,
bundles all of the above, and also registers the Cron Trigger and KV binding.

## Verifying

After deploying, both of these should return JSON (not a CORS or 4xx error):

```bash
# Yahoo route (no token needed)
curl 'https://wheel-tradier-proxy.esthercandy.workers.dev/yf/v8/finance/chart/AAPL?interval=1d&range=5d'

# CBOE route (no key) — large JSON with data.options[]
curl -s 'https://wheel-tradier-proxy.esthercandy.workers.dev/cboe/options/MU.json' | head -c 300

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
if you want to point a local run at the real Notion/Sheet/Telegram
without touching production KV state (or just accept that a local test run
sends a real Telegram DM and writes a real KV de-dupe key, like production would).
