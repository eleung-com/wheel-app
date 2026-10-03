// Stock Runs (Notion) — save runs, read history, record Watch / Reject (P1.5).
//
//   saveRun(env, body)          one row per ticker per New York day: a same-day
//                               re-run overwrites the score fields (decided 10-03)
//                               but never your Watch / Reject. Returns the row id
//                               + that ticker's history (newest first).
//   listRuns(env, {ticker})     history for one ticker, or the most recent runs.
//   setDecision(env, body)      Watch / Reject (reason required) / clear. Only
//                               rows of the Stock Runs database can be touched.
//
// The page body gets one toggle, "Checks · …", with the checks in words. A
// same-day re-run swaps that toggle and leaves anything else on the page alone
// (the Claude write-up lands there in P1.6).

import { notionFetch, plain, NOTION_DB_ID } from './notion.js';
import { cleanRecord, cleanDecision, dayKey, runStamp, TICKER_RE } from '../src/lib/research/runRecord.js';

export const STOCK_RUNS_DB = '60a0a2a4-5833-487e-b8d4-80c509e5fcff';
const STOCK_RUNS_DS = 'cca96b9f-921e-4439-bc01-df52119197cf';
const CHECKS_PREFIX = 'Checks ·';
const HISTORY_MAX = 20;

const bare = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const text = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);

async function ok(res, what) {
  if (res.ok) return res.json();
  const detail = await res.text();
  throw new Error(`notion ${what} ${res.status}: ${detail.slice(0, 300)}`);
}

/** A Stock Runs page → the flat row the app uses. */
export function parseRunPage(page) {
  const p = page.properties || {};
  const sel = (k) => (p[k] && p[k].select ? p[k].select.name : null);
  const n = (k) => (p[k] && typeof p[k].number === 'number' ? p[k].number : null);
  const runAt = p['Run date'] && p['Run date'].date ? p['Run date'].date.start : null;
  return {
    pageId: page.id,
    ticker: plain(p.Ticker && p.Ticker.title).trim().toUpperCase(),
    runAt,
    day: runAt ? dayKey(runAt) : '',
    investmentScore: n('Investment Score'),
    quality: n('Quality'),
    value: n('Value'),
    upside: n('Upside'),
    verdict: sel('Verdict'),
    scoreType: sel('Score type'),
    status: sel('Status'),
    version: plain(p['Scoring version'] && p['Scoring version'].rich_text),
    price: n('Price at run'),
    decision: sel('Decision'),
    rejectReason: plain(p['Reject reason'] && p['Reject reason'].rich_text),
    rejectTags: (p['Reject tags'] && p['Reject tags'].multi_select || []).map((t) => t.name),
  };
}

async function queryRuns(env, { ticker, limit }) {
  const body = {
    page_size: Math.min(Math.max(1, limit || HISTORY_MAX), 50),
    sorts: [{ property: 'Run date', direction: 'descending' }],
    ...(ticker ? { filter: { property: 'Ticker', title: { equals: ticker } } } : {}),
  };
  const data = await ok(await notionFetch(env, `/v1/databases/${STOCK_RUNS_DB}/query`, {
    method: 'POST', body: JSON.stringify(body),
  }), 'runs query');
  return (data.results || []).map(parseRunPage);
}

export async function listRuns(env, { ticker = '', limit } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  if (t && !TICKER_RE.test(t)) throw Object.assign(new Error('bad ticker'), { status: 400 });
  return queryRuns(env, { ticker: t, limit });
}

/** Score fields only — Decision / Reject reason / Reject tags are never written here. */
function scoreProps(rec) {
  return {
    Ticker: { title: text(rec.ticker) },
    'Run date': { date: { start: rec.runAt } },
    Status: { select: { name: 'Waiting on Claude' } },
    'Investment Score': { number: rec.investmentScore },
    Quality: { number: rec.quality },
    Value: { number: rec.value },
    Upside: { number: rec.upside },
    Verdict: { select: { name: rec.verdict } },
    'Score type': { select: { name: rec.scoreType } },
    'Scoring version': { rich_text: text(rec.version) },
    'Peers (auto)': { rich_text: text(rec.peersAuto) },
    'Price at run': { number: rec.price },
    'Target source': { rich_text: text(rec.targetSource) },
  };
}

function checksBlock(rec) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: text(`${CHECKS_PREFIX} ${rec.scoreType} · ${rec.version || 'rules ?'} · ${runStamp(rec.runAt)} NY`),
      children: (rec.lines.length ? rec.lines : ['(no checks)']).map((l) => ({
        object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: text(l) },
      })),
    },
  };
}

/** Stock Scan Results page for this ticker, if it's on the watchlist. */
async function watchlistPageId(env, ticker) {
  const data = await ok(await notionFetch(env, `/v1/databases/${NOTION_DB_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({ page_size: 1, filter: { property: 'Ticker', title: { equals: ticker } } }),
  }), 'watchlist lookup');
  return data.results && data.results[0] ? data.results[0].id : null;
}

async function replaceChecks(env, pageId, rec) {
  const kids = await ok(await notionFetch(env, `/v1/blocks/${pageId}/children?page_size=100`), 'blocks');
  const old = (kids.results || []).filter((b) => b.type === 'toggle' && plain(b.toggle.rich_text).startsWith(CHECKS_PREFIX));
  for (const b of old.slice(0, 5)) {
    await ok(await notionFetch(env, `/v1/blocks/${b.id}`, { method: 'DELETE' }), 'block delete');
  }
  await ok(await notionFetch(env, `/v1/blocks/${pageId}/children`, {
    method: 'PATCH', body: JSON.stringify({ children: [checksBlock(rec)] }),
  }), 'blocks append');
}

export async function saveRun(env, body) {
  const c = cleanRecord(body);
  if (!c.ok) throw Object.assign(new Error(c.error), { status: 400 });
  const rec = c.rec;

  const history = await queryRuns(env, { ticker: rec.ticker, limit: HISTORY_MAX });
  const same = history.find((r) => r.day === rec.day);
  let pageId, replaced = false;

  if (same) {
    pageId = same.pageId;
    replaced = true;
    await ok(await notionFetch(env, `/v1/pages/${pageId}`, {
      method: 'PATCH', body: JSON.stringify({ properties: scoreProps(rec) }),
    }), 'run update');
    await replaceChecks(env, pageId, rec);
  } else {
    const props = scoreProps(rec);
    // Watchlist link is a nice-to-have; a failed lookup never blocks the save.
    const wl = await watchlistPageId(env, rec.ticker).catch(() => null);
    if (wl) props['Watchlist link'] = { relation: [{ id: wl }] };
    const page = await ok(await notionFetch(env, '/v1/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: STOCK_RUNS_DB }, properties: props, children: [checksBlock(rec)] }),
    }), 'run create');
    pageId = page.id;
  }

  // Return history with this run in it, without a second query (Notion's
  // search index can lag a write by a few seconds).
  const mine = {
    ...(same || {}),
    pageId, ticker: rec.ticker, runAt: rec.runAt, day: rec.day,
    investmentScore: rec.investmentScore, quality: rec.quality, value: rec.value, upside: rec.upside,
    verdict: rec.verdict, scoreType: rec.scoreType, status: 'Waiting on Claude', version: rec.version, price: rec.price,
    decision: same ? same.decision : null,
    rejectReason: same ? same.rejectReason : '',
    rejectTags: same ? same.rejectTags : [],
  };
  const rows = [mine, ...history.filter((r) => r.pageId !== pageId)]
    .sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
  return { pageId, replaced, history: rows };
}

export async function setDecision(env, body) {
  const pageId = String(body && body.pageId || '');
  const c = cleanDecision(body);
  if (!c.ok) throw Object.assign(new Error(c.error), { status: 400 });

  // Only Stock Runs rows: the app secret must not become a general Notion writer.
  const page = await ok(await notionFetch(env, `/v1/pages/${pageId}`), 'page read');
  const parent = page.parent || {};
  const inDb = bare(parent.database_id) === bare(STOCK_RUNS_DB) || bare(parent.data_source_id) === bare(STOCK_RUNS_DS);
  if (!inDb) throw Object.assign(new Error('not a Stock Runs row'), { status: 403 });

  const { decision, reason, tags } = c.d;
  const updated = await ok(await notionFetch(env, `/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      properties: {
        Decision: { select: decision ? { name: decision } : null },
        'Reject reason': { rich_text: text(reason) },
        'Reject tags': { multi_select: tags.map((name) => ({ name })) },
      },
    }),
  }), 'decision update');
  return parseRunPage(updated);
}
