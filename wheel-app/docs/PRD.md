# PRD — Wheel.desk: Signal Engine, Pine Parity, Telegram Alerts & Data Fixes

**Owner:** Esther · **Repo:** `eleung-com/wheel-app` · **Date:** 2026-07-10
**Constraints:** GitHub free plan, TradingView free plan, Tradier free sandbox/personal key, existing Cloudflare Worker (`wheel-tradier-proxy`), existing Telegram trading bot, Google Apps Script (GAS) backend.

---

## 1. Problem statement

1. The Signals tab never shows anything: `buildSignals()` and `fetchBestStrike()` exist in `src/lib/` but are **never called** — `SET_SIGNALS` is never dispatched, so `state.signals` is permanently empty.
2. Live prices break in production: `fetchQ()` calls `query1.finance.yahoo.com` directly from the browser on GitHub Pages; Yahoo does not send CORS headers, so every fetch fails silently and the app falls back to nothing.
3. The Pine script "Wheel — Sell Put Signal (Stoch + RSI + 50D Low)" runs only inside TradingView. TradingView **free plan cannot send webhooks**, so there is no path from TradingView alerts into the app. The Pine logic must be reimplemented in JS as the source of truth.
4. There is no notification delivery. Even a working Signals tab only shows signals when the app is open. Esther wants a **Telegram message to her existing trading bot** when a sell-put (or exit) condition triggers.
5. Refresh behavior is wrong: the app silently re-screens every 60 seconds while open (README incorrectly says 20 min). Desired behavior: **visual data refreshes only when the app is opened / brought back to foreground**; the **hourly watchlist check runs server-side** (GitHub Actions), independent of the app being open.

---

## 2. Architecture decision summary

| Concern | Decision | Why |
|---|---|---|
| Pine script signal | Reimplement in JS (shared library used by both app and background job) | TradingView free plan has no webhooks; app already computes TradingView-exact RSI (Wilder RMA) and Slow Stoch (14,3,3) |
| Hourly background check | **GitHub Actions scheduled workflow** running a Node script | Free (public repo: unlimited; private repo: ~380 min/month used of 2,000 free). Can reuse the repo's own indicator code — one source of truth |
| Notification channel | Telegram Bot API `sendMessage` to Esther's existing bot | Already set up; free; trivial from Node |
| Watchlist / criteria source for the job | Read from the Google Sheet via the existing GAS web-app endpoint | Watchlist already lives there; no duplication |
| Alert dedupe state | New `alerts_log` tab in the Google Sheet, written via GAS | Persistent, visible, no extra infra; mirrors Pine's one-alert-per-ticker-per-day guard |
| Yahoo CORS in production | Route through the existing Cloudflare Worker (add a `/yf/*` route proxying `query1.finance.yahoo.com` with a browser User-Agent) | Worker free tier (100k req/day) is far more than enough |
| In-app refresh | On load + on `visibilitychange` (tab/PWA foregrounded, data older than a threshold). Remove all `setInterval` polling | "No point refreshing if no one is looking" |

---

## 3. Workstreams

### WS-A — Wire up the signal engine (critical bug fix)

**Files:** `src/hooks/useScreener.js`, `src/App.jsx`

- In `runScreener()`, after `qmap` and `mergedPositions` are built:
  1. Determine CSP candidates (watchlist tickers passing all entry criteria) and CC candidates (share lots ≥100 with Stoch ≥ `ccStoch`).
  2. For each candidate, call `fetchBestStrike(ticker, 'put'|'call', deltaMin, deltaMax, dteMin, dteMax)` → build `strikeMap` keyed `"${ticker}:put"` / `"${ticker}:call"` (rate-limit ~450 ms apart, same as existing option fetches).
  3. Call `buildSignals(watchlist, mergedPositions, criteria, qmap, strikeMap)` and `dispatch({ type: 'SET_SIGNALS', payload: sigs })`.
- **Acceptance:** with a watchlist ticker that meets criteria, the Signals tab shows a CSP card with live strike/delta/premium; Roll/Close cards appear for breached or profitable positions; `lastRefresh` timestamp updates.

### WS-B — Fix live prices in production (Yahoo CORS **and rate limiting**)

**Files:** Cloudflare Worker (`wheel-tradier-proxy` — source now in `worker/worker.js`), `src/lib/indicators.js`

> **Finding (2026-07-10):** during implementation, Yahoo returned HTTP 429 for *all* chart requests
> from this network — direct, with browser UA, and with the fc.yahoo.com cookie workaround. Yahoo
> aggressively throttles unauthenticated clients, and the app's former 60-second polling loop is
> exactly the pattern that triggers it. CORS was therefore not the only production problem.

- **Primary history source is now Tradier** (`/v1/markets/history`, daily interval, 2y range) — an authenticated API with reliable limits (~120 req/min). Yahoo (`/v8/finance/chart`) remains as the keyless fallback only. Both paths normalize to `{ closes, highs, lows, dates }` and feed the same indicator math.
- Extend the Worker: requests matching `/yf/*` are proxied to `https://query1.finance.yahoo.com/*` with a desktop-browser `User-Agent`; response is returned with `Access-Control-Allow-Origin: *`. No token needed for this route. Worker source is checked in at `worker/worker.js` with deploy steps in `worker/README.md` — **the deployed Worker must be updated manually** (Cloudflare dashboard or wrangler).
- `indicators.js`: production Yahoo fallback base URL becomes `https://wheel-tradier-proxy.esthercandy.workers.dev/yf`; localhost keeps the Vite `/yf` proxy.
- **Implication for WS-D:** the GitHub Actions screener must also use Tradier for history (GitHub runner IPs are shared datacenter IPs — guaranteed Yahoo 429s). This makes the `TRADIER_KEY` repo secret effectively **required** for WS-D, not optional (it stays optional only for the strike-enrichment nicety).
- Surface failures: when `fetchQ` returns `null`, record the ticker + reason; the screener shows one summary toast (e.g. "3 tickers failed: XYZ, ABC…") instead of silence, and the watchlist card shows a stale/error pill.
- **Acceptance:** on the deployed GitHub Pages site with DevTools open, chart fetches return 200 and cards show today's prices; a bogus ticker produces a visible per-ticker error, not silence.

### WS-C — Pine-script parity signal logic

**Files:** `src/lib/indicators.js`, `src/lib/signals.js`, `src/lib/utils.js` (criteria), `src/components/pages/CriteriaPage/CriteriaPage.jsx`, `src/components/modals/SignalDetailModal.jsx`, new `tradingview/wheel_sell_put.pine`

Pine entry condition = **Stoch %K(14,3) < 20 AND RSI(14) < 35 AND today's low ≤ lowest low of last 50 bars**. Pine exit = RSI > 65 or 45 bars held.

1. **50-day-low gate**
   - `fetchQ()` additionally returns `atLow50` (`lows[last] <= min(lows.slice(-lowLen))`, adjusted lows, `lowLen` default 50) and `low50` (the level itself, for display).
   - New criteria fields: `lowLen` (default 50) and `useLowGate` (default **on**). Editable on the Criteria page.
   - `buildSignals()` CSP full-signal condition becomes `rsiOk && stochOk && (!useLowGate || atLowOk) && (maCheckEnabled ? maOk : true)`. Add a `maCheckEnabled` toggle (default on to preserve current behavior) — note the Pine script itself has **no** MA filter, so Esther can switch it off for exact parity.
   - The 50D-low check appears as a fourth pill in the checks list and in `SignalDetailModal`.
2. **Exit / take-profit signal (new signal type `exit`)**
   - For each open `short_put`: if `RSI > rsiExit` (new criteria field, default 65) **or** existing premium-capture rule fires, emit an exit signal ("RSI 68 > 65 — consider buying to close"). Existing `close` logic (premium-capture %) is kept; RSI exit is an additional trigger, matching the Pine strategy exit.
3. **Pine script archived in repo** at `tradingview/wheel_sell_put.pine` (verbatim, for manual TradingView chart use). A README note documents that JS is the notification source of truth and the Pine file is reference/visual-confirmation only.
- **Acceptance:** for a fixed OHLC fixture, JS signal fires on exactly the same bars as the Pine strategy in TradingView (spot-check 2–3 tickers/dates manually); the CSP card shows 4 pills (RSI, Stoch, 50D-low, MA if enabled).

### WS-D — Hourly background screener → Telegram (GitHub Actions)

**Files (new):** `.github/workflows/screener.yml` (repo root), `wheel-app/scripts/screener.mjs`, refactor of `src/lib/indicators.js`

1. **Refactor for Node reuse:** split `indicators.js` into pure math (`calcRSI`, `calcStoch`, `atLow50` — no browser globals) and a fetch layer whose base URLs are injectable. `fetchQ` currently reads `window.location` — the Node script passes its own base (direct Yahoo with UA header works server-side; Node 18+ has global `fetch`).
2. **`scripts/screener.mjs`** does, in order:
   - Guard: exit 0 if outside 9:30–16:00 ET Mon–Fri (cron is UTC and DST-shifted, so the script owns the ET check).
   - Read watchlist + criteria from the GAS web app (`GAS_URL`, `GAS_SECRET` from repo secrets — same params the app sends).
   - For each ticker: fetch 2y daily OHLC from Yahoo, compute RSI/Stoch/50D-low with the shared lib, evaluate the Pine entry condition using sheet criteria.
   - For open short puts (from the positions sheet): evaluate the exit condition (RSI > rsiExit).
   - **Dedupe:** read the `alerts_log` sheet tab; skip any ticker+signal-type already alerted today (ET date). Append new alerts to `alerts_log` via GAS.
   - **Notify:** for each new signal, `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage` to `TELEGRAM_CHAT_ID`. Message format:
     ```
     🟢 SELL PUT — NVDA @ $171.42
     RSI 32 (<35) · Stoch 14 (<20) · at 50D low ✓
     Suggested: 30–45 DTE, 20–35Δ
     ```
     and for exits: `🔴 CLOSE PUT — NVDA $165P exp 08/15 · RSI 68 > 65`.
   - Optionally enrich the entry message with `fetchBestStrike` via the Worker/Tradier (`TRADIER_KEY` secret) for a concrete strike/premium line; if the secret is absent (currently the case) or the fetch fails, degrade gracefully to the generic line — see §4.
3. **`screener.yml`:** `on: schedule: cron: '35 13-21 * * 1-5'` (hourly at :35, spans EDT/EST; script guard handles the edges) + `workflow_dispatch` for manual testing. Runs `node wheel-app/scripts/screener.mjs`, passing the repo secrets from §4 as env vars (`env: GAS_URL: ${{ secrets.GAS_URL }}` etc.). `TRADIER_KEY` is wired the same way but currently unset — the script treats it as optional.
4. **Free-tier check:** repo is public, so Actions minutes are unlimited/free. **Note:** GitHub disables cron on repos with no activity for 60 days; the regular commit cadence here makes that a non-issue, but document it.
- **Acceptance:** `workflow_dispatch` run posts a Telegram message for a ticker forced to pass (temporarily loosened thresholds); a second run the same day sends nothing (dedupe works); run logs show per-ticker evaluations.

### WS-E — In-app refresh: on-open only

**Files:** `src/App.jsx`, `src/hooks/useScreener.js`, `src/components/pages/SignalsPage/SignalsPage.jsx`, `README.md`

- Delete both `setInterval`s in `App.jsx` (currently 60 s screener + 60 min option prices — README's "20 min" is wrong; fix the doc too).
- Keep: screener run on boot, manual ↻ button.
- Add: `visibilitychange` listener — when the document becomes visible **and** `lastRefresh` is older than 10 minutes (configurable constant), trigger `runScreener(true)`.
- Update the Signals-page footer copy ("auto-refreshes every 20m") to "refreshes when you open the app · hourly Telegram alerts run in the background".
- **Acceptance:** with the app open and idle, no network traffic occurs after the initial screen; backgrounding the tab >10 min and returning triggers exactly one silent refresh.

### WS-F — Data accuracy & trust fixes

**Files:** `src/hooks/useScreener.js`, `src/components/pages/WatchlistPage/WatchlistCard.jsx`, `src/components/Header/Header.jsx`, `src/lib/utils.js`, `src/lib/indicators.js`

1. **Stale-data label:** when the market-closed cache path serves data, store `savedAt` into state and show "as of Fri 4:00 PM" (or "cached Xh ago") in the header/summary bar instead of presenting it as live.
2. **IVR honesty:** rename the pill to "IVR est." with a tooltip explaining it's an HV30-based heuristic. (Optional later: use Tradier `greeks.mid_iv` of the ATM contract for a real IV figure.)
3. **Stale comment fix:** `utils.js` `tradierRequest` comment claims the production key is a query param; the code actually sends an `x-tradier-token` header to the Cloudflare Worker (good). Fix the comment; verify the Worker never logs the token.
4. **Per-ticker error surfacing:** `fetchQ`/`fetchOptionPrice` currently swallow all errors → generic toast. Return/collect `{ticker, error}` and show a summary toast plus an error pill on the affected card.
- **Acceptance:** on a weekend, the header visibly says data is cached with a timestamp; an invalid ticker shows an error pill.

### WS-G — Tests (regression safety for the math)

**Files (new):** `wheel-app/vitest` dev-dep, `src/lib/__tests__/indicators.test.js`, `src/lib/__tests__/signals.test.js`, `src/lib/__tests__/utils.test.js`

- Unit-test `calcRSI` and `calcStoch` against reference values exported from TradingView for one ticker/date range (fixture JSON checked into the repo).
- Test `buildSignals`: full CSP signal, partial (2/3), 50D-low gate on/off, MA toggle, CC signal, roll on breach, exit on RSI, premium-capture close.
- Test `normalizeDate` (serials, ISO, M/D/YY) and `dte`.
- Add `npm test` to the Actions workflow as a gate before the screener job (or a separate CI workflow on push).
- **Acceptance:** `npm test` green locally and in CI.

---

## 4. Secrets & prerequisites

All secrets live as **GitHub Actions repository secrets** on `eleung-com/wheel-app`
(Settings → Secrets and variables → Actions). The workflow and `scripts/screener.mjs` read them
from the environment (`process.env.*`) — never hardcode them in source or workflow YAML.

| Secret | Used by | Status |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | WS-D — Telegram `sendMessage` | ✅ Added |
| `TELEGRAM_CHAT_ID` | WS-D — Telegram `sendMessage` | ✅ Added |
| `GAS_URL` | WS-D — read watchlist/criteria/positions, append `alerts_log` | ✅ Added |
| `GAS_SECRET` | WS-D — auth for GAS calls | ✅ Added |
| `TRADIER_KEY` | WS-D — price history for indicators (**required** — see WS-B finding: GitHub runner IPs get 429'd by Yahoo) + strike/premium enrichment (optional) | ⬜ Not added yet — **needed before WS-D ships** |

`TRADIER_KEY` is optional: the screener script must check for its presence and, when absent, skip
`fetchBestStrike` enrichment and send the generic suggestion line ("30–45 DTE, 20–35Δ") instead.
Alerts must never fail because this secret is missing. Enrichment turns on automatically once the
secret is added — no code change needed.

Remaining non-secret prerequisites:

| Item | Used by | Notes |
|---|---|---|
| One new GAS endpoint: read/append `alerts_log` tab | WS-D dedupe | Google Apps Script project |
| Repo visibility | WS-D minutes | Public — Actions minutes are unlimited/free |

---

## 5. Delivery order & sizing

| Phase | Workstreams | Rationale |
|---|---|---|
| 1 | **WS-A + WS-B** | Unbreaks the app: signals appear, production prices work. Everything else builds on this. |
| 2 | **WS-C** | Signal logic reaches Pine parity (50D low, exit rule) — must land before alerts so Telegram never sends wrong-criteria signals. |
| 3 | **WS-D** | Telegram alerting (the headline feature). Needs secrets + GAS `alerts_log` endpoint. |
| 4 | **WS-E + WS-F** | Refresh behavior + trust/accuracy polish. |
| 5 | **WS-G** | Tests land alongside 2–4 where possible; fixture-based indicator tests can start immediately. |

Each phase = one PR, tested at `localhost:5173` before push (per house rule), then verified on the deployed Pages site.

---

## 6. Out of scope (explicitly)

- TradingView webhooks or paid-plan features.
- Real-time (sub-hourly) alerting; hourly during market hours is the requirement.
- Web Push / PWA notifications (Telegram covers delivery).
- Replacing the IVR heuristic with true IV Rank (flagged as a future option in WS-F).
- Earnings-date filter (`earn` criteria field exists but has no data source — unchanged).
