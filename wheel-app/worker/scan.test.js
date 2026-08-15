import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runScan } from './scan.js';
import { etDateString } from './marketHours.js';

const SHEET_URL = 'https://sheet.example/exec';
const ENV_BASE = {
  NOTION_TOKEN: 'ntn_fake',
  APP_SECRET: 's3cret',
  SHEET_URL,
  TRADIER_TOKEN: 'tradier_fake',
  TELEGRAM_BOT_TOKEN: 'bot_fake',
  TELEGRAM_CHAT_ID: '12345',
};

function fakeKV() {
  const store = new Map();
  return { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, store };
}

const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// A Wednesday, 14:00 UTC = 10:00 ET during EDT — safely inside market hours.
const OPEN_NOW = new Date(Date.UTC(2026, 6, 22, 14, 0));
// A Saturday — outside market hours regardless of time-of-day.
const CLOSED_NOW = new Date(Date.UTC(2026, 6, 25, 14, 0));

/** 25 flat daily bars at `price`, enough for fetchHistoryTradier + deriveIndicators. */
function flatHistory(price) {
  const day = (i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, close: price, high: price + 1, low: price - 1 });
  return { history: { day: Array.from({ length: 25 }, (_, i) => day(i)) } };
}

/**
 * An expiry that the shared dte() will report as exactly `n`. Anchored to the
 * real clock because dte() reads it directly rather than runScan's injectable
 * `now`, and offset by one because dte() counts expiry day itself as 1 DTE.
 */
function expiryForDte(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n - 1);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A short put that is far OTM and showing no premium capture, so the only thing
 * it can possibly trigger is the DTE nudge — never a roll or close signal.
 */
function quietPut(overrides = {}) {
  return {
    id: 1, ticker: 'TSLA', type: 'short_put', qty: 1, strike: 200,
    prem: 5, curPrem: 5, enteredAt: Date.parse('2026-06-01'),
    expiry: expiryForDte(21), account: 'Esther', ...overrides,
  };
}

let telegramCalls;
let telegramTexts;
let notionCalls;

function stubFetch({ watchlistPages = [], sheet = { positions: [], criteria: {} }, historyPrice = null, historyOk = true }) {
  telegramCalls = 0;
  notionCalls = 0;
  telegramTexts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('api.notion.com')) {
      notionCalls++;
      return jsonRes({ results: watchlistPages, has_more: false });
    }
    if (u.startsWith(SHEET_URL)) {
      return jsonRes(sheet);
    }
    if (u.includes('/v1/markets/history')) {
      if (!historyOk) return jsonRes({}, 500);
      return jsonRes(flatHistory(historyPrice));
    }
    if (u.includes('/v1/markets/quotes')) {
      return jsonRes({ quotes: {} }); // no quote override → fetchQ falls back to last close
    }
    if (u.includes('query1.finance.yahoo.com')) {
      return jsonRes({}, 500); // Yahoo fallback also down, for the total-failure test
    }
    if (u.includes('api.telegram.org')) {
      telegramCalls++;
      try { telegramTexts.push(JSON.parse(init.body).text); } catch (_) { /* shape asserted elsewhere */ }
      return jsonRes({ ok: true });
    }
    return jsonRes({});
  };
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('runScan', () => {
  it('is a no-op outside market hours — no network calls at all', async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return jsonRes({}); };
    await runScan(ENV_BASE, CLOSED_NOW);
    expect(called).toBe(false);
  });

  it('is a clean no-op when there is nothing flagged and nothing held', async () => {
    stubFetch({ watchlistPages: [], sheet: { positions: [], criteria: {} } });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
    expect(telegramCalls).toBe(0);
  });

  it('alerts once on a breached short put, then de-dupes the same ticker+type for the rest of the ET day', async () => {
    // Expiry sits well outside the manage window (dte() reads the real clock,
    // not OPEN_NOW) so this stays a pure roll-signal test with no DTE nudge.
    const positions = [{
      id: 1, ticker: 'TSLA', type: 'short_put', qty: 1, strike: 250,
      expiry: expiryForDte(60), enteredAt: Date.parse('2026-06-01'), prem: 5, curPrem: 5,
    }];
    stubFetch({ sheet: { positions, criteria: {} }, historyPrice: 240 });
    const kv = fakeKV();

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);
    expect(telegramCalls).toBe(1);
    expect(kv.store.has('TSLA|roll|2026-07-22')).toBe(true);

    // Re-run later the same ET day: condition still holds, but must stay silent.
    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, new Date(Date.UTC(2026, 6, 22, 19, 0)));
    expect(telegramCalls).toBe(1);
  });

  it('self-alerts exactly once when every ticker fetch fails, and does not repeat the self-alert same day', async () => {
    const positions = [{ id: 1, ticker: 'TSLA', type: 'short_put', qty: 1, strike: 250, expiry: expiryForDte(60) }];
    stubFetch({ sheet: { positions, criteria: {} }, historyOk: false });
    const kv = fakeKV();

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);
    expect(telegramCalls).toBe(1); // the self-alert, not a signal alert

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, new Date(Date.UTC(2026, 6, 22, 20, 0)));
    expect(telegramCalls).toBe(1); // still just the one self-alert for the day
  });

  it('propagates the shared PRIORITY watchlist filter through to the Notion-backed CSP path', async () => {
    // A non-Priority row must never reach fetchQ/buildSignals as a CSP candidate —
    // regression guard for the PRIORITY re-export now living in signalEngine.js.
    const page = {
      id: 'p1',
      created_time: '2026-01-01T00:00:00.000Z',
      properties: {
        Ticker: { title: [{ plain_text: 'AAPL' }] },
        'Dive-In': { select: { name: 'Watchlist' } },
      },
    };
    stubFetch({ watchlistPages: [page], sheet: { positions: [], criteria: {} } });
    const kv = fakeKV();
    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);
    expect(telegramCalls).toBe(0);
  });
});

describe('21-DTE management nudge', () => {
  it('fires exactly at the threshold and names the position', async () => {
    stubFetch({ sheet: { positions: [quietPut()], criteria: {} }, historyPrice: 240 });
    const kv = fakeKV();

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);

    expect(telegramCalls).toBe(1);
    expect(telegramTexts[0]).toContain('21-DTE — TSLA');
    expect(telegramTexts[0]).toContain('Short put');
    expect(telegramTexts[0]).toContain('$200 strike');
    expect(telegramTexts[0]).toContain('21 DTE');
    expect(kv.store.has(`manage-dte|1|${etDateString(OPEN_NOW)}`)).toBe(true);
  });

  it('stays silent one day outside the window', async () => {
    stubFetch({ sheet: { positions: [quietPut({ expiry: expiryForDte(22) })], criteria: {} }, historyPrice: 240 });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
    expect(telegramCalls).toBe(0);
  });

  it('stays silent on expiry day and after it', async () => {
    // dte() reports 1 on expiry day itself, and goes negative afterwards.
    for (const days of [1, -2]) {
      stubFetch({ sheet: { positions: [quietPut({ expiry: expiryForDte(days) })], criteria: {} }, historyPrice: 240 });
      await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
      expect(telegramCalls, `dte ${days}`).toBe(0);
    }
  });

  it('nudges at most once per ET day, then again the next day', async () => {
    stubFetch({ sheet: { positions: [quietPut()], criteria: {} }, historyPrice: 240 });
    const kv = fakeKV();

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);
    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, new Date(Date.UTC(2026, 6, 22, 19, 0)));
    expect(telegramCalls).toBe(1);

    // Next trading day (Thursday) — same still-open position must nudge again.
    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, new Date(Date.UTC(2026, 6, 23, 14, 0)));
    expect(telegramCalls).toBe(2);
  });

  it('sends one message per position, not per ticker', async () => {
    const positions = [
      quietPut({ id: 1, strike: 200 }),
      quietPut({ id: 2, strike: 190, expiry: expiryForDte(15) }),
    ];
    stubFetch({ sheet: { positions, criteria: {} }, historyPrice: 240 });
    const kv = fakeKV();

    await runScan({ ...ENV_BASE, ALERTS_KV: kv }, OPEN_NOW);

    expect(telegramCalls).toBe(2);
    expect(telegramTexts.some(t => t.includes('$200 strike'))).toBe(true);
    expect(telegramTexts.some(t => t.includes('$190 strike'))).toBe(true);
  });

  it('ignores positions that are no longer open', async () => {
    const positions = [
      quietPut({ id: 1, linkedId: 99 }),                       // opening row, already closed
      quietPut({ id: 2, type: 'btc' }),                        // the close row itself
      quietPut({ id: 3, type: 'shares', strike: undefined }),  // not an option
    ];
    stubFetch({ sheet: { positions, criteria: {} }, historyPrice: 240 });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
    expect(telegramCalls).toBe(0);
  });

  it('honours a custom manageDte from the sheet criteria', async () => {
    const positions = [quietPut({ expiry: expiryForDte(30) })];
    stubFetch({ sheet: { positions, criteria: { manageDte: 35 } }, historyPrice: 240 });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
    expect(telegramCalls).toBe(1);
    expect(telegramTexts[0]).toContain('35-DTE — TSLA');
  });

  it('does not nudge outside market hours', async () => {
    stubFetch({ sheet: { positions: [quietPut()], criteria: {} }, historyPrice: 240 });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, CLOSED_NOW);
    expect(telegramCalls).toBe(0);
  });

  it('still nudges when every market-data fetch fails', async () => {
    // The nudge is calendar-only, so a Tradier/Yahoo outage must not suppress it —
    // it runs before the quote pass and owns its own error handling.
    stubFetch({ sheet: { positions: [quietPut()], criteria: {} }, historyOk: false });
    await runScan({ ...ENV_BASE, ALERTS_KV: fakeKV() }, OPEN_NOW);
    expect(telegramTexts.some(t => t.includes('21-DTE — TSLA'))).toBe(true);
  });
});
