// Stock Runs (Notion) — save runs, read history, record Watch / Reject (P1.5),
// and start the Claude research routine (P1.6).
//
//   saveRun(env, body)          one row per ticker per New York day: a same-day
//                               re-run overwrites the score fields (decided 10-03)
//                               but never your Watch / Reject or Claude's research.
//                               body.pageId set = save onto that exact row (the
//                               app's Final re-score). Starts Claude when the row
//                               has no research yet (reuse today's — El 10-03).
//   listRuns(env, {ticker})     history for one ticker, or the most recent runs.
//   getRun(env, pageId)         one row + Claude's write-up from the page body.
//   redoClaude(env, pageId)     start Claude again ("Redo" / "Retry").
//   setDecision(env, body)      Watch / Reject (reason required) / clear.
//
// Every write that names a page checks the page is a Stock Runs row first.
// The page body gets one toggle, "Checks · …", with the checks in words. A
// same-day re-run swaps that toggle and leaves anything else (Claude's
// write-up) alone.

import { notionFetch, plain, NOTION_DB_ID } from './notion.js';
import { cleanRecord, cleanDecision, dayKey, runStamp, TICKER_RE, CLAUDE_TIMEOUT_MIN } from '../src/lib/research/runRecord.js';

export const STOCK_RUNS_DB = '60a0a2a4-5833-487e-b8d4-80c509e5fcff';
const STOCK_RUNS_DS = 'cca96b9f-921e-4439-bc01-df52119197cf';
const CHECKS_PREFIX = 'Checks ·';
const HISTORY_MAX = 20;
const ROUTINE_VERSION = '2023-06-01';

const bare = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const text = (s) => (s ? [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] : []);
const httpError = (msg, status) => Object.assign(new Error(msg), { status });

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
  const d = (k) => (p[k] && p[k].date ? p[k].date.start : null);
  const t = (k) => plain(p[k] && p[k].rich_text);
  const runAt = d('Run date');
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
    version: t('Scoring version'),
    price: n('Price at run'),
    decision: sel('Decision'),
    rejectReason: t('Reject reason'),
    rejectTags: (p['Reject tags'] && p['Reject tags'].multi_select || []).map((x) => x.name),
    // Claude routine (P1.6)
    claudeStarted: d('Claude started'),
    claudeWritten: d('Claude written'),
    claudeSession: p['Claude session'] ? p['Claude session'].url || null : null,
    errorDetail: t('Error detail'),
    peersClaude: t('Peers (Claude)'),
    peerReasons: t('Peer reasons'),
    analystTargetClaude: n('Analyst target (Claude)'),
    targetSource: t('Target source'),
    beats: n('Beats'),
    beatQuarters: n('Beat quarters'),
    beatStale: !!(p['Beat stale'] && p['Beat stale'].checkbox),
    moatType: sel('Moat type'),
    moatStrength: sel('Moat strength'),
    oneTimeItems: !!(p['One-time items flag'] && p['One-time items flag'].checkbox),
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
  if (t && !TICKER_RE.test(t)) throw httpError('bad ticker', 400);
  return queryRuns(env, { ticker: t, limit });
}

/** Read a page and refuse anything that isn't a Stock Runs row. */
async function readRunPage(env, pageId) {
  const page = await ok(await notionFetch(env, `/v1/pages/${pageId}`), 'page read');
  const parent = page.parent || {};
  const inDb = bare(parent.database_id) === bare(STOCK_RUNS_DB) || bare(parent.data_source_id) === bare(STOCK_RUNS_DS);
  if (!inDb) throw httpError('not a Stock Runs row', 403);
  return page;
}

/**
 * Score fields only. Decision / reject fields and Claude's fields are never
 * written here. Blank Peers (auto) / Target source are skipped so a Final save
 * (Claude's peers) or a re-run without an FMP target can't wipe them.
 * status null = leave Status as it is.
 */
function scoreProps(rec, status) {
  const props = {
    Ticker: { title: text(rec.ticker) },
    'Run date': { date: { start: rec.runAt } },
    'Investment Score': { number: rec.investmentScore },
    Quality: { number: rec.quality },
    Value: { number: rec.value },
    Upside: { number: rec.upside },
    Verdict: { select: { name: rec.verdict } },
    'Score type': { select: { name: rec.scoreType } },
    'Scoring version': { rich_text: text(rec.version) },
    'Price at run': { number: rec.price },
  };
  if (status) props.Status = { select: { name: status } };
  if (rec.peersAuto) props['Peers (auto)'] = { rich_text: text(rec.peersAuto) };
  if (rec.targetSource) props['Target source'] = { rich_text: text(rec.targetSource) };
  return props;
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

async function pageBlocks(env, pageId) {
  const kids = await ok(await notionFetch(env, `/v1/blocks/${pageId}/children?page_size=100`), 'blocks');
  return kids.results || [];
}

async function replaceChecks(env, pageId, rec) {
  const old = (await pageBlocks(env, pageId))
    .filter((b) => b.type === 'toggle' && plain(b.toggle.rich_text).startsWith(CHECKS_PREFIX));
  for (const b of old.slice(0, 5)) {
    await ok(await notionFetch(env, `/v1/blocks/${b.id}`, { method: 'DELETE' }), 'block delete');
  }
  await ok(await notionFetch(env, `/v1/blocks/${pageId}/children`, {
    method: 'PATCH', body: JSON.stringify({ children: [checksBlock(rec)] }),
  }), 'blocks append');
}

// ── Claude routine (P1.6) ────────────────────────────────────────────────────
// POST {ROUTINE_FIRE_URL} with the routine's own token. The text carries only
// the ticker and the row id; the routine prompt treats it as data.

/** Fire the routine. Never throws: returns { ok, sessionUrl } or { ok:false, error }. */
export async function fireRoutine(env, ticker, pageId) {
  if (!env.ROUTINE_FIRE_URL || !env.ROUTINE_TOKEN) return { ok: false, error: 'Claude routine not set up yet' };
  try {
    const res = await fetch(env.ROUTINE_FIRE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ROUTINE_TOKEN}`,
        'anthropic-version': ROUTINE_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: `ticker: ${ticker}\nrun_page_id: ${pageId}` }),
    });
    if (res.status === 429) return { ok: false, error: 'Claude busy — retry later' };
    if (!res.ok) return { ok: false, error: `Claude routine ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, sessionUrl: data.claude_code_session_url || null };
  } catch (e) {
    return { ok: false, error: `Claude routine unreachable: ${String(e.message || e).slice(0, 120)}` };
  }
}

/** Start Claude for a row and record the outcome on it. Returns the Claude fields set. */
async function startClaude(env, ticker, pageId, { clearWritten = false } = {}) {
  const fired = await fireRoutine(env, ticker, pageId);
  const now = new Date().toISOString();
  const props = fired.ok
    ? {
      Status: { select: { name: 'Waiting on Claude' } },
      'Claude started': { date: { start: now } },
      'Claude session': { url: fired.sessionUrl },
      'Error detail': { rich_text: [] },
    }
    : {
      Status: { select: { name: 'Error' } },
      'Error detail': { rich_text: text(fired.error) },
    };
  if (clearWritten) props['Claude written'] = { date: null };
  await ok(await notionFetch(env, `/v1/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties: props }) }), 'claude mark');
  return fired.ok
    ? { fired: true, status: 'Waiting on Claude', claudeStarted: now, claudeSession: fired.sessionUrl, errorDetail: '', ...(clearWritten ? { claudeWritten: null } : {}) }
    : { fired: false, status: 'Error', errorDetail: fired.error, ...(clearWritten ? { claudeWritten: null } : {}) };
}

/** Same-day row: start Claude only if it has no research and isn't mid-run. */
function needsClaude(row, now = Date.now()) {
  if (!row) return true;
  if (row.claudeWritten) return false;
  if (row.status === 'Waiting on Claude' && row.claudeStarted
    && now - Date.parse(row.claudeStarted) < CLAUDE_TIMEOUT_MIN * 60000) return false;
  return true;
}

// ── Save ─────────────────────────────────────────────────────────────────────

export async function saveRun(env, body) {
  const c = cleanRecord(body);
  if (!c.ok) throw httpError(c.error, 400);
  const rec = c.rec;

  // Final re-score onto an exact row (may be an earlier day). No Claude start.
  if (rec.pageId) {
    const row = parseRunPage(await readRunPage(env, rec.pageId));
    if (row.ticker !== rec.ticker) throw httpError('ticker does not match that row', 400);
    const keepRunAt = { ...rec, runAt: row.runAt || rec.runAt };
    await ok(await notionFetch(env, `/v1/pages/${rec.pageId}`, {
      method: 'PATCH', body: JSON.stringify({ properties: scoreProps(keepRunAt, rec.scoreType === 'Final' ? 'Final' : null) }),
    }), 'run update');
    await replaceChecks(env, rec.pageId, keepRunAt);
    const history = await queryRuns(env, { ticker: rec.ticker, limit: HISTORY_MAX });
    const merged = history.map((h) => (h.pageId === rec.pageId
      ? { ...h, investmentScore: rec.investmentScore, quality: rec.quality, value: rec.value, upside: rec.upside,
        verdict: rec.verdict, scoreType: rec.scoreType, version: rec.version, ...(rec.scoreType === 'Final' ? { status: 'Final' } : {}) }
      : h));
    return { pageId: rec.pageId, replaced: true, history: merged, claude: { fired: false } };
  }

  const history = await queryRuns(env, { ticker: rec.ticker, limit: HISTORY_MAX });
  const same = history.find((r) => r.day === rec.day);
  let pageId, replaced = false;

  if (same) {
    pageId = same.pageId;
    replaced = true;
    // Status is left alone: Claude's state decides it (startClaude below, or the
    // app's Final re-score when today's research already exists).
    await ok(await notionFetch(env, `/v1/pages/${pageId}`, {
      method: 'PATCH', body: JSON.stringify({ properties: scoreProps(rec, null) }),
    }), 'run update');
    await replaceChecks(env, pageId, rec);
  } else {
    const props = scoreProps(rec, 'Scoring');
    // Watchlist link is a nice-to-have; a failed lookup never blocks the save.
    const wl = await watchlistPageId(env, rec.ticker).catch(() => null);
    if (wl) props['Watchlist link'] = { relation: [{ id: wl }] };
    const page = await ok(await notionFetch(env, '/v1/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: STOCK_RUNS_DB }, properties: props, children: [checksBlock(rec)] }),
    }), 'run create');
    pageId = page.id;
  }

  let claude = { fired: false };
  if (needsClaude(same)) claude = await startClaude(env, rec.ticker, pageId);

  // Return history with this run in it, without a second query (Notion's
  // search index can lag a write by a few seconds).
  const mine = {
    ...(same || {}),
    pageId, ticker: rec.ticker, runAt: rec.runAt, day: rec.day,
    investmentScore: rec.investmentScore, quality: rec.quality, value: rec.value, upside: rec.upside,
    verdict: rec.verdict, scoreType: rec.scoreType, version: rec.version, price: rec.price,
    status: same ? same.status : 'Scoring',
    decision: same ? same.decision : null,
    rejectReason: same ? same.rejectReason : '',
    rejectTags: same ? same.rejectTags : [],
    ...(rec.targetSource ? { targetSource: rec.targetSource } : {}),
    ...claude,
  };
  delete mine.fired;
  const rows = [mine, ...history.filter((r) => r.pageId !== pageId)]
    .sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
  return { pageId, replaced, history: rows, claude: { fired: claude.fired, error: claude.errorDetail || undefined } };
}

// ── Read one run + Claude's write-up ────────────────────────────────────────

/** Page body → simple blocks, skipping our "Checks ·" toggle. One level deep. */
function writeupBlocks(blocks) {
  const out = [];
  for (const b of blocks.slice(0, 80)) {
    const rt = b[b.type] && b[b.type].rich_text;
    const s = plain(rt);
    switch (b.type) {
      case 'heading_1': case 'heading_2': case 'heading_3':
        if (s.trim()) out.push({ type: 'heading', text: s });
        break;
      case 'paragraph': case 'quote': case 'callout':
        if (s.trim()) out.push({ type: 'text', text: s });
        break;
      case 'bulleted_list_item': case 'numbered_list_item':
        if (s.trim()) out.push({ type: 'bullet', text: s });
        break;
      default:
        break; // toggles (our checks), dividers, tables, embeds
    }
  }
  return out;
}

export async function getRun(env, pageId) {
  const row = parseRunPage(await readRunPage(env, pageId));
  const writeup = row.claudeWritten ? writeupBlocks(await pageBlocks(env, pageId)) : [];
  return { run: row, writeup };
}

export async function redoClaude(env, pageId) {
  const row = parseRunPage(await readRunPage(env, pageId));
  const claude = await startClaude(env, row.ticker, pageId, { clearWritten: true });
  const { fired, ...fields } = claude;
  return { run: { ...row, ...fields }, claude: { fired, error: claude.errorDetail || undefined } };
}

// ── Decisions ────────────────────────────────────────────────────────────────

export async function setDecision(env, body) {
  const pageId = String(body && body.pageId || '');
  const c = cleanDecision(body);
  if (!c.ok) throw httpError(c.error, 400);

  // Only Stock Runs rows: the app secret must not become a general Notion writer.
  await readRunPage(env, pageId);

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
