# Wheel.desk — React / Vite

Options wheel strategy tracker. Migrated from a single HTML file to a React + Vite project. Functionality and UI are identical to the original.

## Commands

```bash
npm install       # install dependencies
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the production build locally
```

## Project structure

```
src/
├── main.jsx               Entry point — mounts App inside AppProvider
├── App.jsx                Root component: auth/boot flow, page routing, modal state, all event handlers
├── index.css              All global styles (CSS custom properties, resets, every class from the original)
│
├── context/
│   └── AppContext.jsx     Global state (watchlist, positions, signals, criteria) via useReducer + Context
│
├── hooks/
│   ├── useToast.js        Toast visibility + auto-dismiss timer
│   ├── useMarketStatus.js NYSE market open/closed/weekend, 30-second poll
│   ├── useSheets.js       Google Sheets read/write (sheetRead, sheetWriteViaGet, syncFromSheet)
│   └── useScreener.js     runScreener (fetch all tickers → build signals → persist), refreshOptionPrices
│
├── lib/                   Pure functions — no React
│   ├── utils.js           dte(), suggestStrike(), parseCriteria(), parsePositions(), localStorage keys
│   ├── indicators.js      fetchQ() — Yahoo Finance daily OHLCV → RSI-14, Stoch %K, IVR estimate, MA
│   ├── optionPrice.js     fetchOptionPrice() — Yahoo options chain, multi-strategy expiry lookup
│   └── signals.js         buildSignals() — CSP / Covered Call / Roll / Close signal generation
│
└── components/
    ├── AuthGate/          Setup form (first device) + login form (returning user)
    ├── BootScreen/        Full-screen loading spinner shown during initial sheet read
    ├── Header/            Sticky header: logo, market status dot, sync status, action buttons
    ├── TabNav/            Top scrollable tab bar with badge counts
    ├── BottomNav/         Fixed bottom nav (mobile)
    ├── FAB/               Floating + button (hidden on Signals tab)
    ├── Toast/             Transient notification strip
    │
    ├── pages/
    │   ├── SignalsPage/   SummaryBar (4 chips) + SignalCard grid, sectioned by type
    │   ├── PositionsPage/ SharesTable (grouped by ticker, avg cost) + OptionsTable (P&L, DTE, progress)
    │   ├── WatchlistPage/ WatchlistCard grid with IVR/RSI/Stoch/MA pass-fail pills
    │   └── CriteriaPage/  Settings form — all screening thresholds, persisted on every change
    │
    └── modals/
        ├── ModalOverlay          Shared slide-up overlay with backdrop-click-to-close
        ├── AddWatchModal         Ticker input
        ├── PositionModal         Add/edit form — shares vs options fields toggled by type
        ├── SignalDetailModal     Technical snapshot + premium estimate + criteria check
        ├── ShareGroupDetailModal Lot table, unrealized P&L, Add Another Lot
        └── HelpModal             Static help text
```

## Data flow

1. On load, `App.jsx` checks `localStorage` for credentials and session key to decide between `setup → login → booting → app`.
2. During boot, `useSheets.sheetRead()` fetches all data from the Google Apps Script web app. Results are dispatched into `AppContext`.
3. All mutations (add/remove watchlist, save/delete position, update criteria) dispatch to `AppContext` then immediately call `sheetWriteViaGet()` with the updated state snapshot.
4. `runScreener()` fetches Yahoo Finance data for all unique tickers, updates `liveData` on watchlist entries, fetches live option prices, then calls `buildSignals()` and dispatches `SET_SIGNALS`.
5. Auto-refresh: screener every 20 min, option prices every 60 min, sheet pull every 5 min — all only during NYSE market hours (9:30–16:00 ET, Mon–Fri).

## First-time setup

The app requires a Google Apps Script web app as its backend. On first visit, enter the Apps Script URL and a shared secret key. These are stored in `localStorage` on the device only — they are never in source code.
