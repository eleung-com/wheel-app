# Wheel.desk

Options wheel tracker: a React dashboard for what you hold and what the market
is offering, plus a Cloudflare Worker that watches the same conditions on a
schedule and messages Telegram when one fires. Trades are placed in Fidelity —
nothing here touches a broker.

## Commands

```bash
cd wheel-app
npm install       # first time
npm run dev       # http://localhost:5173
npm test          # unit tests (vitest)
npm run test:worker  # the Worker's offline harness (plain node)
npm run build     # production build → dist/
```

## Where things live

| Concern | Home | Why there |
|---|---|---|
| Watchlist membership, notes, evaluations, earnings dates | **Notion** (`Stock Scan Results`) | Where the research already happens. The app reads it and writes back only `Notes`. |
| Positions, closed trades, screening criteria | **Google Sheet** via an Apps Script web app | Predates the app; still the easiest thing to hand-edit. |
| Prices + history | **Yahoo**, via the Worker | Free and keyless. Yahoo 429s residential IPs, so every call goes through the Worker. |
| Option chains (strike, delta, premium) | **CBOE** delayed quotes, via the Worker | Free, no key, includes delta. ~15 min delayed — fine for 30–45 DTE entries placed by hand. Tradier was retired 10-02-2026 (account closed). |
| API credentials | **Cloudflare Worker** | The app is a public static site, so no token can ship in the bundle. |
| Alerts | **Telegram**, from the Worker's cron | The app only alerts you when it's open. The Worker doesn't need to be. |

## How a signal happens

1. **Entry (CSP / covered call).** A watchlist row flagged `🔥 Priority` in Notion,
   whose RSI(14) sits inside the criteria band and whose Stochastic %K is
   *turning* — up from below the level for puts, rolling over from above it for
   calls. Both are crossings, not levels: %K has to move while past the line.
2. **Exit (roll / close / max loss).** An open contract whose underlying has
   breached the short strike, or that has given back enough premium early
   enough to be worth buying back. A put credit spread below its *long* strike
   is at max loss and gets its own card, not another roll.
3. Strike and expiry come from the CBOE option chain — the contract nearest the
   middle of your target delta band and DTE range.

`src/lib/signalEngine.js` is the only implementation of that logic. Both the
browser and the Worker import it, so the dashboard and your alerts can never
disagree about what a signal is.

### Earnings are advisory

If a Notion earnings date falls inside the life of the contract, the card and
the alert say so. **Nothing is suppressed.** Selling through a print is a real
risk, but which side of it is worth taking is a judgement call, and the date is
hand-entered — a missing one shows as `⚠ No earnings date on file` rather than
silently reading as safe. The warn window is `Settings → Criteria → Warn if
earnings within`.

## Refresh behaviour

There is no polling loop. The app refreshes on load, when you bring it back to
the foreground after more than 10 minutes, and when you press ↻. Idle, it makes
no network calls at all — the Worker is what watches the market, every 30
minutes during market hours, and it messages you rather than the screen.

## Project structure

```
src/
├── main.jsx                  Entry point; mounts App in AppProvider + an error boundary
├── App.jsx                   Auth/boot flow, page routing, modal state, event handlers
├── index.css                 All styles (CSS custom properties, every class)
│
├── context/AppContext.jsx    Global state via useReducer + Context
│
├── hooks/
│   ├── useScreener.js        runScreener — fetch, build signals, publish
│   ├── useSheets.js          Apps Script read/write
│   ├── useNotion.js          Watchlist read + Notes write, via the Worker
│   ├── useEvals.js           Notion page-body evaluations, cached a day
│   ├── useNews.js            Yahoo news for Priority tickers, cached an hour
│   ├── useMarketStatus.js    NYSE open/closed
│   └── useToast.js           Transient notifications
│
├── lib/                      Pure logic — no React
│   ├── signalEngine.js       THE signal logic. Shared with the Worker.
│   ├── marketData.js         Every Yahoo/CBOE call, once, transport-injected
│   ├── browserTransport.js   The browser half of that contract
│   ├── oscillators.js        RSI (Wilder) + slow Stochastic, TradingView-exact
│   ├── optionYield.js        Return and annualised yield, incl. spread width
│   ├── utils.js              Criteria/position parsing, dates, open-position tests
│   ├── evalSummary.js        One-line preview from a Notion eval
│   └── watchlistOrder.js     Dive-In grouping and ordering
│
└── components/
    ├── pages/                Home (stats + news), Signals, Positions, Watchlist, Settings
    └── modals/               Position add/edit, close, share group, signal detail, help

worker/
├── worker.js       Routes: /yf, /cboe, /notion, /watchlist-feed, /notify
├── scan.js         The scheduled scan — same engine, Telegram delivery, KV de-dupe
├── notion.js       Watchlist + evaluation reads, Notes write
├── telegram.js     Message formatting
└── marketHours.js  ET + NYSE-holiday guard
```

## First-time setup

The app asks for an Apps Script web-app URL and a shared secret, stored in
`localStorage` on that device only — they are never in source. Market data
needs no key. Worker secrets are separate; see
[`worker/README.md`](worker/README.md).

## Deploying

The **app** deploys itself: pushing to `main` builds and publishes to GitHub
Pages (`.github/workflows/deploy-pages.yml`).

The **Worker** does not. After merging anything that touches `worker/` or
`src/lib/`:

```bash
cd wheel-app && npx wrangler deploy
```

CI posts a reminder on any PR that changes those paths. Skipping it leaves the
app and the alerts running different versions of the signal engine.
