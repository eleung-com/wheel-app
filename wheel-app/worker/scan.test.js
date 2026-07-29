import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runScan } from './scan.js';

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

let telegramCalls;
let notionCalls;

function stubFetch({ watchlistPages = [], sheet = { positions: [], criteria: {} }, historyPrice = null, historyOk = true }) {
  telegramCalls = 0;
  notionCalls = 0;
  globalThis.fetch = async (url) => {
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
    const positions = [{
      id: 1, ticker: 'TSLA', type: 'short_put', qty: 1, strike: 250,
      expiry: '2026-08-15', enteredAt: Date.parse('2026-06-01'), prem: 5, curPrem: 5,
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
    const positions = [{ id: 1, ticker: 'TSLA', type: 'short_put', qty: 1, strike: 250, expiry: '2026-08-15' }];
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
