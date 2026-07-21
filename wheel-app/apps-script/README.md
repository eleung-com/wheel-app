# Apps Script

Server-side code that runs in the Google Apps Script project bound to the wheel
spreadsheet. Kept here so it's version-controlled — Apps Script itself has no
usable history.

## notionSync.gs — Notion → Watchlist

Mirrors tickers from the Notion **Stock Scan Results** database into the
**Watchlist** tab. One-way: Notion is the source of truth, nothing is ever
written back to Notion.

**Which tickers:** every page where the `TV Lists` property is non-empty —
i.e. anything synced from a TradingView list.

**Category mapping** — from the Notion `scanner verdict`, falling back to
`Watchlist` for tickers with no verdict:

| Notion verdict | App category     |
| -------------- | ---------------- |
| Interested     | Strong Candidate |
| Maybe          | Monitoring       |
| Skip           | Avoid            |
| *(none)*       | Watchlist        |

**Removals are destructive.** A ticker in the Watchlist tab that Notion no
longer lists gets its row deleted, along with any notes written in the app.
This is deliberate — the tab is an exact mirror of the Notion selection — but
it's why `notionWatchlistPreview()` exists. Run it first.

### Setup

1. Create an internal integration at <https://www.notion.so/my-integrations>,
   copy the secret.
2. Open the Stock Scan Results database in Notion → `•••` → **Connections** →
   add the integration. Skipping this makes the API return 404.
3. Apps Script → **Project Settings** → **Script Properties** → add
   `NOTION_TOKEN` = the secret. It lives only here; it is never sent to the
   browser, which matters because the app is a public static site.
4. Paste `notionSync.gs` into the project as a new file.
5. Run `notionWatchlistPreview()` and read the execution log — it writes nothing.
6. Once the plan looks right, run `syncNotionWatchlist()`.
7. Optional: `installNotionSyncTrigger()` for a daily 6am sync.

### Notes

- Columns are located by header name (`Ticker`, `Category`, `Notes`, `Added`),
  so reordering or adding columns won't break it.
- New rows copy any per-row formulas (e.g. `GOOGLEFINANCE` price) down from the
  row above, so appended tickers still get live data.
- `LockService` guards against a manual run and the trigger overlapping.
- The app needs no changes: it already reads the Watchlist tab on refresh.
