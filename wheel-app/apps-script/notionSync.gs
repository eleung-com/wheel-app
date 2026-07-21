/**
 * Notion → Watchlist sync
 * ═══════════════════════
 * Mirrors the tickers tagged in the "TV Lists" property of the Notion
 * "Stock Scan Results" database into the Watchlist tab of this sheet.
 *
 * Self-contained: append this to the existing Apps Script project. It does not
 * touch doGet/doPost — the app keeps reading the sheet exactly as it does now.
 *
 * Setup (once):
 *   1. Create an internal integration at https://www.notion.so/my-integrations
 *      and copy its secret (starts with "ntn_" or "secret_").
 *   2. In Notion, open the Stock Scan Results database → ••• → Connections →
 *      add that integration. Without this the API returns 404.
 *   3. Project Settings → Script Properties → add NOTION_TOKEN = <the secret>.
 *   4. Run notionWatchlistPreview() and read the log. It writes nothing.
 *   5. When the plan looks right, run syncNotionWatchlist().
 *   6. Optional: run installNotionSyncTrigger() to sync daily at ~6am.
 *
 * Direction is one-way. Notion is the source of truth; this never writes to Notion.
 */

// ── Config ───────────────────────────────────────────────────────────────────

const NOTION_DB_ID    = '35c400a3-854e-80ff-9b36-fd7ddaa3a850'; // Stock Scan Results
const NOTION_VERSION  = '2022-06-28';
const WATCHLIST_TAB   = 'Watchlist';

// Rows are selected by TV Lists being non-empty. Category comes from the
// scanner verdict when the ticker has one, so research judgements carry over.
const VERDICT_CATEGORY = {
  'Interested': 'Strong Candidate',
  'Maybe':      'Monitoring',
  'Skip':       'Avoid',
};
const DEFAULT_CATEGORY = 'Watchlist';

// ── Notion ───────────────────────────────────────────────────────────────────

function notionToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) throw new Error('NOTION_TOKEN script property is not set — see setup step 3.');
  return t;
}

/** Every page where TV Lists is non-empty → [{ ticker, category, sector, lists }] */
function fetchNotionTickers_() {
  const out = [];
  let cursor = null;

  do {
    const body = {
      page_size: 100,
      filter: { property: 'TV Lists', multi_select: { is_not_empty: true } },
    };
    if (cursor) body.start_cursor = cursor;

    const res = UrlFetchApp.fetch(
      'https://api.notion.com/v1/databases/' + NOTION_DB_ID + '/query',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + notionToken_(),
          'Notion-Version': NOTION_VERSION,
        },
        payload: JSON.stringify(body),
        muteHttpExceptions: true,
      }
    );

    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error(
        'Notion API returned ' + code + ': ' + res.getContentText().slice(0, 400) +
        (code === 404
          ? '\n\n404 usually means the integration has not been added to the database (setup step 2).'
          : '')
      );
    }

    const json = JSON.parse(res.getContentText());
    json.results.forEach(function (page) {
      const p       = page.properties || {};
      const title   = (p['Ticker'] && p['Ticker'].title) || [];
      const ticker  = title.map(function (t) { return t.plain_text; }).join('').trim().toUpperCase();
      if (!ticker) return;

      const verdict = p['scanner verdict'] && p['scanner verdict'].select
        ? p['scanner verdict'].select.name : '';
      const sector  = p['sector'] && p['sector'].select ? p['sector'].select.name : '';
      const lists   = ((p['TV Lists'] && p['TV Lists'].multi_select) || [])
        .map(function (o) { return o.name; });

      out.push({
        ticker:   ticker,
        category: VERDICT_CATEGORY[verdict] || DEFAULT_CATEGORY,
        sector:   sector,
        lists:    lists,
      });
    });

    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);

  // De-dupe, first occurrence wins.
  const seen = {};
  return out.filter(function (r) {
    if (seen[r.ticker]) return false;
    seen[r.ticker] = true;
    return true;
  });
}

// ── Sheet ────────────────────────────────────────────────────────────────────

function norm_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Locate the Watchlist tab and its columns by header name, so this keeps
 * working if columns get reordered or new ones are added.
 */
function readWatchlist_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WATCHLIST_TAB);
  if (!sheet) throw new Error('No sheet tab named "' + WATCHLIST_TAB + '".');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1) throw new Error('The ' + WATCHLIST_TAB + ' tab is empty — expected a header row.');

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  headers.forEach(function (h, i) {
    const n = norm_(h);
    if (n === 'ticker')                      col.ticker   = i + 1;
    else if (n === 'category')               col.category = i + 1;
    else if (n === 'notes')                  col.notes    = i + 1;
    else if (n === 'addedat' || n === 'added') col.addedAt = i + 1;
  });
  if (!col.ticker) {
    throw new Error('No "Ticker" column found in ' + WATCHLIST_TAB +
                    '. Headers seen: ' + headers.join(' | '));
  }

  const rows = [];
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    values.forEach(function (r, i) {
      const ticker = String(r[col.ticker - 1] || '').trim().toUpperCase();
      if (!ticker) return;
      rows.push({
        row:      i + 2,
        ticker:   ticker,
        category: col.category ? String(r[col.category - 1] || '') : '',
      });
    });
  }

  return { sheet: sheet, col: col, rows: rows, lastCol: lastCol };
}

/** Diff Notion against the sheet. Pure — computes, never writes. */
function planSync_() {
  const notion = fetchNotionTickers_();
  const wl     = readWatchlist_();

  const bySheet  = {};
  wl.rows.forEach(function (r) { bySheet[r.ticker] = r; });
  const byNotion = {};
  notion.forEach(function (r) { byNotion[r.ticker] = r; });

  const adds = notion.filter(function (r) { return !bySheet[r.ticker]; });

  const updates = notion.filter(function (r) {
    const cur = bySheet[r.ticker];
    return cur && wl.col.category && cur.category !== r.category;
  }).map(function (r) {
    return { ticker: r.ticker, row: bySheet[r.ticker].row,
             from: bySheet[r.ticker].category, to: r.category };
  });

  const removes = wl.rows.filter(function (r) { return !byNotion[r.ticker]; });

  return { notion: notion, wl: wl, adds: adds, updates: updates, removes: removes };
}

// ── Entry points ─────────────────────────────────────────────────────────────

/** Dry run. Writes nothing — read the execution log, then run syncNotionWatchlist(). */
function notionWatchlistPreview() {
  const p = planSync_();
  const L = [];

  L.push('Notion tickers tagged in TV Lists: ' + p.notion.length);
  L.push('Rows currently in the ' + WATCHLIST_TAB + ' tab: ' + p.wl.rows.length);
  L.push('');
  L.push('ADD (' + p.adds.length + ')');
  p.adds.forEach(function (r) {
    L.push('  + ' + r.ticker + '  → ' + r.category + (r.sector ? '  [' + r.sector + ']' : ''));
  });
  L.push('');
  L.push('RECATEGORIZE (' + p.updates.length + ')');
  p.updates.forEach(function (u) {
    L.push('  ~ ' + u.ticker + '  ' + (u.from || '(blank)') + ' → ' + u.to);
  });
  L.push('');
  L.push('REMOVE (' + p.removes.length + ')  ⚠ these rows get deleted, including any notes');
  p.removes.forEach(function (r) {
    L.push('  - ' + r.ticker + '  (row ' + r.row + ')');
  });

  if (!p.wl.col.category) {
    L.push('');
    L.push('Note: no "Category" column found, so categories will not be written.');
  }

  Logger.log(L.join('\n'));
  return L.join('\n');
}

/** Apply the plan: add new tickers, recategorize, delete rows Notion no longer lists. */
function syncNotionWatchlist() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another sync is already running.');

  try {
    const p     = planSync_();
    const sheet = p.wl.sheet;
    const col   = p.wl.col;

    // Recategorize in place.
    if (col.category) {
      p.updates.forEach(function (u) {
        sheet.getRange(u.row, col.category).setValue(u.to);
      });
    }

    // Delete bottom-up so earlier row numbers stay valid.
    p.removes.slice().sort(function (a, b) { return b.row - a.row; })
      .forEach(function (r) { sheet.deleteRow(r.row); });

    // Append new tickers, carrying down any per-row formulas (e.g. GOOGLEFINANCE
    // price) from the row above so new rows aren't missing live data.
    if (p.adds.length) {
      const templateRow = sheet.getLastRow();
      const formulas = templateRow >= 2
        ? sheet.getRange(templateRow, 1, 1, p.wl.lastCol).getFormulas()[0]
        : [];

      p.adds.forEach(function (r) {
        const row = sheet.getLastRow() + 1;
        sheet.getRange(row, col.ticker).setValue(r.ticker);
        if (col.category) sheet.getRange(row, col.category).setValue(r.category);
        if (col.addedAt)  sheet.getRange(row, col.addedAt).setValue(Date.now());

        formulas.forEach(function (f, i) {
          if (!f) return;
          const c = i + 1;
          if (c === col.ticker || c === col.category || c === col.addedAt) return;
          sheet.getRange(templateRow, c).copyTo(sheet.getRange(row, c)); // adjusts refs
        });
      });
    }

    SpreadsheetApp.flush();

    const msg = 'Notion sync: +' + p.adds.length + ' added, ~' + p.updates.length +
                ' recategorized, -' + p.removes.length + ' removed.';
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/** Run the sync every morning at ~6am. Safe to call twice — replaces any existing trigger. */
function installNotionSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNotionWatchlist') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNotionWatchlist').timeBased().atHour(6).everyDays(1).create();
  Logger.log('Daily 6am trigger installed.');
}
