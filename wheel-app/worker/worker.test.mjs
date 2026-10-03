// Offline test of the worker's Notion routes. Stubs global fetch so no real
// token or network is involved; asserts on the requests the worker *would* make.
import worker from './worker.js';

const ENV = { NOTION_TOKEN: 'ntn_fake', APP_SECRET: 's3cret' };
const ORIGIN = 'https://eleung-com.github.io';

let calls = [];
function stubFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
}

const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function page(id, ticker, extra = {}) {
  return {
    id,
    created_time: '2026-05-12T00:00:00.000Z',
    properties: {
      Ticker: { title: [{ plain_text: ticker }] },
      Notes: { rich_text: extra.notes ? [{ plain_text: extra.notes }] : [] },
      'scanner verdict': { select: extra.verdict ? { name: extra.verdict } : null },
      sector: { select: extra.sector ? { name: extra.sector } : null },
      'Dive-In': { select: extra.diveIn ? { name: extra.diveIn } : null },
      'Wheel (CSP)': { select: extra.wheel ? { name: extra.wheel } : null },
      Fundamentals: { select: extra.fundamentals ? { name: extra.fundamentals } : null },
      'Last Eval Date': { date: extra.lastEval ? { start: extra.lastEval } : null },
      'Earnings Date': { date: extra.earnings ? { start: extra.earnings } : null },
    },
  };
}

// ── Notion block fixtures, shaped like the real Stock Scan Results pages ──────
const rich = (t) => [{ plain_text: t }];

/** A toggleable heading — the shape Notion returns for "# 07-21-2026" with the arrow on. */
const toggleHeading = (id, text) => ({
  id, type: 'heading_1', has_children: true,
  heading_1: { rich_text: rich(text), is_toggleable: true },
});

const tableRow = (...cells) => ({ type: 'table_row', table_row: { cells: cells.map(rich) } });

const req = (path, opts = {}) =>
  new Request('https://w.dev' + path, {
    method: opts.method || 'GET',
    headers: { Origin: ORIGIN, ...(opts.headers || {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

// ── Auth & CORS ──────────────────────────────────────────────────────────────
console.log('\nAuth and CORS');
{
  stubFetch(() => jsonRes({}));

  let r = await worker.fetch(req('/notion/watchlist', { method: 'OPTIONS' }), ENV);
  check('OPTIONS preflight → 204', r.status === 204, 'got ' + r.status);
  check('preflight allows PATCH',
    (r.headers.get('access-control-allow-methods') || '').includes('PATCH'));
  check('preflight echoes allowed origin',
    r.headers.get('access-control-allow-origin') === ORIGIN,
    'got ' + r.headers.get('access-control-allow-origin'));
  check('preflight allows x-app-secret header',
    (r.headers.get('access-control-allow-headers') || '').includes('x-app-secret'));

  r = await worker.fetch(req('/notion/watchlist'), ENV);
  check('no secret → 401', r.status === 401, 'got ' + r.status);
  check('no secret → Notion never called', calls.length === 0, calls.length + ' calls');

  r = await worker.fetch(req('/notion/watchlist', { headers: { 'x-app-secret': 'wrong' } }), ENV);
  check('wrong secret → 401', r.status === 401, 'got ' + r.status);
  check('wrong secret → Notion never called', calls.length === 0, calls.length + ' calls');

  r = await worker.fetch(req('/notion/watchlist', { headers: { 'x-app-secret': 's3cret' } }), {});
  check('missing NOTION_TOKEN → 500', r.status === 500, 'got ' + r.status);

  r = await worker.fetch(req('/notion/nope', { headers: { 'x-app-secret': 's3cret' } }), ENV);
  check('unknown notion route → 404', r.status === 404, 'got ' + r.status);
}

// ── GET /notion/watchlist ────────────────────────────────────────────────────
console.log('\nGET /notion/watchlist');
{
  let n = 0;
  stubFetch(() => {
    n++;
    return n === 1
      ? jsonRes({
          results: [
            page('p1', 'dell', { notes: 'cheap', category: 'Strong Candidate', verdict: 'Interested', sector: 'Technology', diveIn: '🔥 Priority', wheel: '✅', fundamentals: '⚠️', lastEval: '2026-07-21', earnings: '2026-09-03' }),
            page('p2', 'AAPL'),
          ],
          has_more: true, next_cursor: 'cur2',
        })
      : jsonRes({ results: [page('p3', 'GEV', { verdict: 'Interested' })], has_more: false });
  });

  const r = await worker.fetch(req('/notion/watchlist', { headers: { 'x-app-secret': 's3cret' } }), ENV);
  const body = await r.json();

  check('200 OK', r.status === 200, 'got ' + r.status);
  check('paginates via next_cursor', calls.length === 2, calls.length + ' calls');
  check('second page sends start_cursor',
    JSON.parse(calls[1].init.body).start_cursor === 'cur2');
  check('filters on TV Lists is_not_empty', (() => {
    const f = JSON.parse(calls[0].init.body).filter;
    return f.property === 'TV Lists' && f.multi_select.is_not_empty === true;
  })());
  check('sends Notion-Version header',
    calls[0].init.headers['Notion-Version'] === '2022-06-28');
  check('sends bearer token', calls[0].init.headers.Authorization === 'Bearer ntn_fake');

  check('returns all 3 rows', body.watchlist.length === 3, JSON.stringify(body.watchlist));
  const dell = body.watchlist.find(w => w.ticker === 'DELL');
  check('uppercases ticker', !!dell);
  check('carries pageId', dell.pageId === 'p1');
  check('flattens notes', dell.notes === 'cheap');
  check('no longer emits category', !('category' in dell), Object.keys(dell).join(','));
  check('flattens verdict', dell.verdict === 'Interested');
  check('flattens Dive-In', dell.diveIn === '🔥 Priority');
  check('flattens Wheel (CSP)', dell.wheel === '✅');
  check('flattens Fundamentals', dell.fundamentals === '⚠️');
  check('flattens Last Eval Date', dell.lastEval === '2026-07-21');
  check('flattens Earnings Date', dell.earnings === '2026-09-03');
  check('parses created_time → addedAt', typeof dell.addedAt === 'number' && dell.addedAt > 0);
  const aapl = body.watchlist.find(w => w.ticker === 'AAPL');
  check('empty notes → empty string', aapl.notes === '');
  check('null Dive-In → empty string', aapl.diveIn === '');
  check('null Wheel → empty string', aapl.wheel === '');
  check('null Last Eval Date → empty string', aapl.lastEval === '');
  check('null Earnings Date → empty string', aapl.earnings === '');
}

// ── Latest evaluation ────────────────────────────────────────────────────────
console.log('\nNotion /eval');
{
  const PID = '35e400a3-854e-8145-980d-c44e616eef8a';

  // Two evals on the page; only the newest (first) one may be read.
  stubFetch((url) => {
    if (url.endsWith(`/v1/blocks/${PID}/children?page_size=100`)) {
      return jsonRes({ results: [
        toggleHeading('h-new', '07-21-2026'),
        toggleHeading('h-old', '05-12-2026'),
      ] });
    }
    if (url.includes('/v1/blocks/h-new/children')) {
      return jsonRes({ results: [
        { id: 'b1', type: 'heading_2', heading_2: { rich_text: rich('🗳️ Verdict') } },
        { id: 't1', type: 'table', has_children: true, table: { has_column_header: true } },
        { id: 'b2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('Heavy leverage') } },
        { id: 'b3', type: 'paragraph', paragraph: { rich_text: rich('DELL: YES, wheel-ready.') } },
        { id: 'b4', type: 'paragraph', paragraph: { rich_text: rich('   ') } },
        { id: 'b5', type: 'divider', divider: {} },
      ] });
    }
    if (url.includes('/v1/blocks/t1/children')) {
      return jsonRes({ results: [
        tableRow('', '', ''),                                  // blank styled header
        tableRow('🎡 Wheel (CSP)', '✅ YES', 'IVR 94, earnings clear'),
      ] });
    }
    if (url.includes('/v1/blocks/h-old/children')) {
      return jsonRes({ results: [
        { id: 'x1', type: 'paragraph', paragraph: { rich_text: rich('OLD EVAL — must not appear') } },
      ] });
    }
    return jsonRes({ results: [] });
  });

  const r = await worker.fetch(req(`/notion/eval?pageId=${PID}`, { headers: { 'x-app-secret': 's3cret' } }), ENV);
  const body = await r.json();
  const ev = body.eval;

  check('200 OK', r.status === 200, 'got ' + r.status);
  check('title is the first toggle header', ev.title === '07-21-2026', ev.title);
  check('never opens the second toggle',
    !calls.some(c => c.url.includes('h-old')), calls.map(c => c.url).join('\n      '));
  check('older eval text absent', !JSON.stringify(ev).includes('must not appear'));

  const types = ev.blocks.map(b => b.type);
  check('keeps heading, table, bullet, text', types.join(',') === 'heading,table,bullet,text', types.join(','));
  check('drops blank paragraphs', !ev.blocks.some(b => b.type === 'text' && !b.text.trim()));
  check('drops dividers', !types.includes('divider'));

  const tbl = ev.blocks.find(b => b.type === 'table');
  check('drops the all-blank header row', tbl.rows.length === 1, JSON.stringify(tbl.rows));
  check('keeps table cell text', tbl.rows[0][2] === 'IVR 94, earnings clear');
  check('carries has_column_header', tbl.hasHeader === true);
}

// ── /eval guards ─────────────────────────────────────────────────────────────
{
  stubFetch(() => jsonRes({ results: [] }));
  let r = await worker.fetch(req('/notion/eval?pageId=not-a-uuid', { headers: { 'x-app-secret': 's3cret' } }), ENV);
  check('non-UUID pageId → 400', r.status === 400, 'got ' + r.status);
  check('bad pageId → Notion never called', calls.length === 0, calls.length + ' calls');

  r = await worker.fetch(req('/notion/eval', { headers: { 'x-app-secret': 's3cret' } }), ENV);
  check('missing pageId → 400', r.status === 400, 'got ' + r.status);

  const PID = '35e400a3-854e-8145-980d-c44e616eef8a';
  stubFetch(() => jsonRes({ results: [{ id: 'p', type: 'paragraph', paragraph: { rich_text: rich('no toggles here') } }] }));
  r = await worker.fetch(req(`/notion/eval?pageId=${PID}`, { headers: { 'x-app-secret': 's3cret' } }), ENV);
  const b = await r.json();
  check('page with no toggle header → null eval', r.status === 200 && b.eval === null, JSON.stringify(b));

  stubFetch(() => jsonRes({ results: [] }));
  r = await worker.fetch(req(`/notion/eval?pageId=${PID}`, { method: 'POST', headers: { 'x-app-secret': 's3cret' } }), ENV);
  check('POST to /eval → 404', r.status === 404, 'got ' + r.status);
}

// ── Notion upstream failure ──────────────────────────────────────────────────
console.log('\nUpstream failures');
{
  stubFetch(() => new Response('object_not_found', { status: 404 }));
  const r = await worker.fetch(req('/notion/watchlist', { headers: { 'x-app-secret': 's3cret' } }), ENV);
  const body = await r.json();
  check('Notion 404 → 502 with detail', r.status === 502 && /404/.test(body.error), JSON.stringify(body));
  check('error response still has CORS',
    r.headers.get('access-control-allow-origin') === ORIGIN);
}

// ── PATCH /notion/page ───────────────────────────────────────────────────────
console.log('\nPATCH /notion/page');
{
  const UUID = '35e400a3-854e-8145-980d-c44e616eef8a';

  stubFetch(() => jsonRes({ ok: true }));
  let r = await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: 'not-a-uuid', notes: 'x' },
  }), ENV);
  check('non-UUID pageId → 400', r.status === 400, 'got ' + r.status);
  check('non-UUID → Notion never called', calls.length === 0);

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, notes: 'hello' },
  }), ENV);
  check('notes patch → 200', r.status === 200, 'got ' + r.status);
  check('targets the right page', calls[0].url.endsWith('/v1/pages/' + UUID), calls[0].url);
  check('uses PATCH upstream', calls[0].init.method === 'PATCH');
  {
    const props = JSON.parse(calls[0].init.body).properties;
    check('notes → rich_text shape', props.Notes.rich_text[0].text.content === 'hello');
    check('does NOT touch App Category', !('App Category' in props), Object.keys(props).join(','));
    check('does NOT touch scanner verdict', !('scanner verdict' in props));
    check('does NOT touch TV Lists', !('TV Lists' in props));
  }

  // App Category was removed — the property never existed in the Notion database,
  // so every write 400'd and then wiped the edit by re-pulling. A patch carrying
  // only a category now has nothing to write and must be rejected outright rather
  // than reaching Notion.
  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, category: 'Monitoring' },
  }), ENV);
  check('category-only patch → not 200', r.status !== 200, 'got ' + r.status);
  check('category-only patch never reaches Notion', calls.length === 0, calls.length + ' call(s)');

  stubFetch(() => jsonRes({ ok: true }));
  await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, notes: '' },
  }), ENV);
  check('cleared notes → empty rich_text array',
    JSON.parse(calls[0].init.body).properties.Notes.rich_text.length === 0);

  stubFetch(() => jsonRes({ ok: true }));
  await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' },
    body: { pageId: UUID, notes: 'x'.repeat(3000) },
  }), ENV);
  check('notes truncated to Notion 2000-char cap',
    JSON.parse(calls[0].init.body).properties.Notes.rich_text[0].text.content.length === 2000);

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID },
  }), ENV);
  check('empty patch → 502 "nothing to update"', r.status === 502, 'got ' + r.status);
}

// ── Watchlist feed relay ─────────────────────────────────────────────────────
console.log('\nGET /watchlist-feed/:token');
{
  const FEED_ENV = { ...ENV, WATCHLIST_FEED_TOKEN: 'f33d' };

  stubFetch(() => jsonRes({ results: [page('p1', 'DELL', { diveIn: '🔥 Priority' })], has_more: false }));
  let r = await worker.fetch(req('/watchlist-feed/wrong-token'), FEED_ENV);
  check('wrong token → 401', r.status === 401, 'got ' + r.status);
  check('wrong token → Notion never called', calls.length === 0, calls.length + ' calls');

  stubFetch(() => jsonRes({ error: 'no NOTION_TOKEN' }, 500));
  r = await worker.fetch(req('/watchlist-feed/f33d'), { WATCHLIST_FEED_TOKEN: 'f33d' });
  check('missing NOTION_TOKEN secret → 500', r.status === 500, 'got ' + r.status);
  check('missing NOTION_TOKEN → Notion never called', calls.length === 0, calls.length + ' calls');

  stubFetch(() => jsonRes({ results: [page('p1', 'DELL', { diveIn: '🔥 Priority' })], has_more: false }));
  r = await worker.fetch(req('/watchlist-feed/f33d'), FEED_ENV);
  const body = await r.json();
  check('valid token → 200', r.status === 200, 'got ' + r.status);
  check('returns the same shape as /notion/watchlist', body.watchlist?.[0]?.ticker === 'DELL', JSON.stringify(body));
  check('no x-app-secret header required', !('x-app-secret' in (calls[0]?.init.headers || {})));
}

// ── Notify relay ──────────────────────────────────────────────────────────
console.log('\nPOST /notify/:token');
{
  const RELAY_ENV = { ...ENV, NOTIFY_RELAY_TOKEN: 'r3lay', TELEGRAM_BOT_TOKEN: 'bot_fake', TELEGRAM_CHAT_ID: '123' };

  stubFetch(() => jsonRes({ ok: true }));
  let r = await worker.fetch(req('/notify/wrong-token', { method: 'POST', body: { text: 'hi' } }), RELAY_ENV);
  check('wrong token → 401', r.status === 401, 'got ' + r.status);
  check('wrong token → Telegram never called', calls.length === 0, calls.length + ' calls');

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notify/r3lay', { method: 'GET' }), RELAY_ENV);
  check('GET → 405', r.status === 405, 'got ' + r.status);

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notify/r3lay', { method: 'POST', body: {} }), RELAY_ENV);
  check('missing text → 400', r.status === 400, 'got ' + r.status);
  check('missing text → Telegram never called', calls.length === 0, calls.length + ' calls');

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notify/r3lay', { method: 'POST', body: { text: 'Morning scan: 3 candidates' } }), RELAY_ENV);
  check('valid request → 200', r.status === 200, 'got ' + r.status);
  check('relays to Telegram sendMessage',
    calls[0].url === 'https://api.telegram.org/botbot_fake/sendMessage', calls[0]?.url);
  check('forwards the text', JSON.parse(calls[0].init.body).text === 'Morning scan: 3 candidates');
  check('forwards the configured chat id', JSON.parse(calls[0].init.body).chat_id === '123');

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notify/r3lay', { method: 'POST', body: { text: 'x'.repeat(5000) } }), RELAY_ENV);
  check('text truncated to 4000 chars', JSON.parse(calls[0].init.body).text.length === 4000);

  stubFetch(() => jsonRes({ ok: true }));
  r = await worker.fetch(req('/notify/r3lay', { method: 'POST', body: { text: 'hi' } }), ENV);
  check('missing NOTIFY_RELAY_TOKEN secret → 500', r.status === 500, 'got ' + r.status);
}

// ── No regression on the finance routes ──────────────────────────────────────
console.log('\nExisting routes still work');
{
  stubFetch(() => jsonRes({ chart: {} }));
  let r = await worker.fetch(new Request('https://w.dev/yf/v8/finance/chart/AAPL?range=5d'), ENV);
  check('yf route → 200', r.status === 200, 'got ' + r.status);
  check('yf strips the /yf prefix',
    calls[0].url === 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d', calls[0].url);
  check('yf sends browser UA', /Mozilla/.test(calls[0].headers?.['User-Agent'] || calls[0].init.headers['User-Agent']));

  stubFetch(() => jsonRes({ data: { options: [] } }));
  r = await worker.fetch(new Request('https://w.dev/cboe/options/MU.json'), ENV);
  check('cboe route → 200', r.status === 200, 'got ' + r.status);
  check('cboe maps to delayed_quotes',
    calls[0].url === 'https://cdn.cboe.com/api/global/delayed_quotes/options/MU.json', calls[0].url);
  check('cboe response carries CORS for the app', r.headers.get('Access-Control-Allow-Origin') === '*');

  stubFetch(() => jsonRes({ quotes: {} }));
  r = await worker.fetch(new Request('https://w.dev/v1/markets/quotes?symbols=AAPL', {
    headers: { 'x-tradier-token': 'tk' },
  }), ENV);
  check('retired tradier path → 404', r.status === 404, 'got ' + r.status);
  check('retired tradier path → no upstream call', calls.length === 0, calls.length + ' calls');
}

// ── Research relay ───────────────────────────────────────────────────────────
console.log('\nResearch relay');
{
  const RENV = { ...ENV, SEC_CONTACT_EMAIL: 'me@example.com', FMP_KEY: 'fmpk', FINNHUB_KEY: 'fhk' };
  const auth = { headers: { 'x-app-secret': 's3cret' } };

  stubFetch(() => jsonRes({}));
  let r = await worker.fetch(req('/research/sec/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json'), RENV);
  check('no secret → 401', r.status === 401, 'got ' + r.status);
  check('no secret → no upstream call', calls.length === 0);

  stubFetch(() => jsonRes({ units: {} }));
  r = await worker.fetch(req('/research/sec/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json', auth), RENV);
  check('sec concept → 200', r.status === 200, 'got ' + r.status);
  check('sec concept → data.sec.gov', calls[0].url === 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json', calls[0].url);
  check('sec sends contact User-Agent', calls[0].init.headers['User-Agent'] === 'wheel-desk research me@example.com');
  check('sec response has CORS for the app', r.headers.get('Access-Control-Allow-Origin') === ORIGIN);

  stubFetch(() => jsonRes({}));
  await worker.fetch(req('/research/sec/files/company_tickers.json', auth), RENV);
  check('ticker list → www.sec.gov', calls[0].url === 'https://www.sec.gov/files/company_tickers.json', calls[0].url);

  stubFetch(() => jsonRes({}));
  r = await worker.fetch(req('/research/sec/somewhere/else', auth), RENV);
  check('other sec path → 404, no call', r.status === 404 && calls.length === 0, 'got ' + r.status);

  stubFetch(() => jsonRes({}));
  r = await worker.fetch(req('/research/sec/api/x', auth), ENV);
  check('missing SEC_CONTACT_EMAIL → 500', r.status === 500, 'got ' + r.status);

  stubFetch(() => jsonRes([]));
  await worker.fetch(req('/research/fmp/stable/price-target-consensus?symbol=MU', auth), RENV);
  check('fmp adds apikey', calls[0].url === 'https://financialmodelingprep.com/stable/price-target-consensus?symbol=MU&apikey=fmpk', calls[0].url);

  stubFetch(() => jsonRes({}));
  await worker.fetch(req('/research/finnhub/api/v1/stock/peers?symbol=MU', auth), RENV);
  check('finnhub adds token', calls[0].url === 'https://finnhub.io/api/v1/stock/peers?symbol=MU&token=fhk', calls[0].url);

  stubFetch(() => jsonRes({}));
  r = await worker.fetch(req('/research/sec/api/x', { method: 'OPTIONS' }), RENV);
  check('preflight → 204 allowing x-app-secret', r.status === 204 && /x-app-secret/.test(r.headers.get('Access-Control-Allow-Headers')));
}

// ── Stock Runs (P1.5) ────────────────────────────────────────────────────────
console.log('\nStock Runs /notion/runs');
{
  const auth = { 'x-app-secret': 's3cret' };
  const RUNS_DB = '60a0a2a4-5833-487e-b8d4-80c509e5fcff';
  const runPage = (id, runAt, extra = {}) => ({
    id, parent: { type: 'database_id', database_id: RUNS_DB },
    properties: {
      Ticker: { title: [{ plain_text: 'UBER' }] },
      'Run date': { date: { start: runAt } },
      'Investment Score': { number: extra.score ?? 60 },
      Verdict: { select: { name: extra.verdict || 'Maybe' } },
      'Score type': { select: { name: 'Preliminary' } },
      Status: { select: { name: 'Waiting on Claude' } },
      'Scoring version': { rich_text: [{ plain_text: 'v2.6' }] },
      Decision: { select: extra.decision ? { name: extra.decision } : null },
      'Reject reason': { rich_text: extra.reason ? [{ plain_text: extra.reason }] : [] },
      'Reject tags': { multi_select: (extra.tags || []).map((name) => ({ name })) },
    },
  });
  const rec = {
    ticker: 'UBER', runAt: '2026-10-04T01:00:00.000Z', // 9 PM NY on 10-03
    price: 81.2, scoreType: 'Preliminary', version: 'v2.6', investmentScore: 72,
    quality: 80, value: 60, upside: 50, verdict: 'Maybe', peersAuto: 'LYFT', targetSource: 'FMP', lines: ['a', 'b'],
  };
  const PID_OLD = '11111111-1111-1111-1111-111111111111';
  const PID_SAME = '22222222-2222-2222-2222-222222222222';
  const PID_NEW = '33333333-3333-3333-3333-333333333333';

  // New day → create, with watchlist link + checks toggle
  stubFetch((url, init) => {
    if (url.endsWith(`/databases/${RUNS_DB}/query`)) return jsonRes({ results: [runPage(PID_OLD, '2026-09-20T15:00:00.000Z', { decision: 'Reject', reason: 'debt', score: 40 })] });
    if (url.includes('/databases/') && url.endsWith('/query')) return jsonRes({ results: [{ id: 'wl-page' }] });
    if (url.endsWith('/v1/pages') && init.method === 'POST') return jsonRes({ id: PID_NEW });
    if (url.endsWith(`/v1/pages/${PID_NEW}`) && init.method === 'PATCH') return jsonRes({});
    return jsonRes({}, 500);
  });
  let r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), ENV);
  let body = await r.json();
  check('POST new day → 200', r.status === 200, JSON.stringify(body));
  const create = calls.find((c) => c.url.endsWith('/v1/pages'));
  const cb = create && JSON.parse(create.init.body);
  check('creates in Stock Runs DB', cb?.parent?.database_id === RUNS_DB);
  check('links the watchlist row', cb?.properties?.['Watchlist link']?.relation?.[0]?.id === 'wl-page');
  check('never writes Decision on save', cb && !('Decision' in cb.properties));
  check('checks toggle with lines', cb?.children?.[0]?.type === 'toggle' && cb.children[0].toggle.children.length === 2);
  check('toggle titled in NY time', /^Checks · Preliminary · v2\.6 · 10-03 9:00 PM NY$/.test(cb?.children?.[0]?.toggle?.rich_text?.[0]?.text?.content), cb?.children?.[0]?.toggle?.rich_text?.[0]?.text?.content);
  check('history: new run first, old reject kept', body.history?.[0]?.pageId === PID_NEW && body.history?.[1]?.decision === 'Reject', JSON.stringify(body.history));
  check('replaced=false', body.replaced === false);

  // Same NY day → overwrite score fields, keep decision, swap checks toggle only
  stubFetch((url, init) => {
    if (url.endsWith(`/databases/${RUNS_DB}/query`)) return jsonRes({ results: [runPage(PID_SAME, '2026-10-03T14:00:00.000Z', { decision: 'Watch' })] });
    if (url.endsWith(`/v1/pages/${PID_SAME}`) && init.method === 'PATCH') return jsonRes({ id: PID_SAME });
    if (url.includes(`/v1/blocks/${PID_SAME}/children`) && (!init.method || init.method === 'GET')) {
      return jsonRes({ results: [
        { id: 'old-checks', type: 'toggle', toggle: { rich_text: [{ plain_text: 'Checks · Preliminary · v2.6 · 10-03 10:00 AM NY' }] } },
        { id: 'claude-text', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Claude write-up' }] } },
      ] });
    }
    if (url.endsWith('/v1/blocks/old-checks') && init.method === 'DELETE') return jsonRes({});
    if (url.endsWith(`/v1/blocks/${PID_SAME}/children`) && init.method === 'PATCH') return jsonRes({});
    return jsonRes({}, 500);
  });
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), ENV);
  body = await r.json();
  check('same day → 200 replaced', r.status === 200 && body.replaced === true && body.pageId === PID_SAME, JSON.stringify(body));
  check('same day → no new page', !calls.some((c) => c.url.endsWith('/v1/pages') && c.init.method === 'POST'));
  const upd = calls.find((c) => c.url.endsWith(`/v1/pages/${PID_SAME}`));
  check('overwrite leaves Decision alone', upd && !('Decision' in JSON.parse(upd.init.body).properties));
  check('decision kept in history', body.history?.[0]?.decision === 'Watch');
  check('deletes only the old checks toggle', calls.filter((c) => c.init.method === 'DELETE').map((c) => c.url.split('/').pop()).join() === 'old-checks');

  // Validation
  stubFetch(() => jsonRes({}));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: { ...rec, verdict: 'Buy' } }), ENV);
  check('bad verdict → 400, Notion untouched', r.status === 400 && calls.length === 0, 'got ' + r.status);
  r = await worker.fetch(req('/notion/runs', { method: 'POST', body: rec }), ENV);
  check('no secret → 401', r.status === 401);

  // GET history
  stubFetch(() => jsonRes({ results: [runPage(PID_OLD, '2026-09-20T15:00:00.000Z')] }));
  r = await worker.fetch(req('/notion/runs?ticker=uber&limit=5', { headers: auth }), ENV);
  body = await r.json();
  const q = JSON.parse(calls[0].init.body);
  check('GET filters by ticker (uppercased), newest first', q.filter?.title?.equals === 'UBER' && q.sorts?.[0]?.direction === 'descending' && q.page_size === 5);
  check('GET returns flat rows', body.runs?.[0]?.ticker === 'UBER' && body.runs[0].day === '2026-09-20', JSON.stringify(body));
  r = await worker.fetch(req('/notion/runs?ticker=bad%20one', { headers: auth }), ENV);
  check('GET bad ticker → 400', r.status === 400, 'got ' + r.status);

  // Decision
  stubFetch((url, init) => {
    if (url.endsWith(`/v1/pages/${PID_SAME}`) && !init.method) return jsonRes(runPage(PID_SAME, '2026-10-03T14:00:00.000Z'));
    if (url.endsWith(`/v1/pages/${PID_SAME}`) && init.method === 'PATCH') {
      return jsonRes(runPage(PID_SAME, '2026-10-03T14:00:00.000Z', { decision: 'Reject', reason: 'too much debt', tags: ['Debt'] }));
    }
    return jsonRes({}, 500);
  });
  r = await worker.fetch(req('/notion/runs/decision', { method: 'PATCH', headers: auth, body: { pageId: PID_SAME, decision: 'Reject', reason: 'too much debt', tags: ['Debt', 'Nope'] } }), ENV);
  body = await r.json();
  const dp = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body).properties;
  check('Reject → 200 + row back', r.status === 200 && body.run?.decision === 'Reject', JSON.stringify(body));
  check('Reject writes reason + only allowed tags', dp.Decision.select.name === 'Reject' && dp['Reject tags'].multi_select.map((t) => t.name).join() === 'Debt');

  stubFetch(() => jsonRes({}));
  r = await worker.fetch(req('/notion/runs/decision', { method: 'PATCH', headers: auth, body: { pageId: PID_SAME, decision: 'Reject', reason: '' } }), ENV);
  check('Reject without reason → 400, Notion untouched', r.status === 400 && calls.length === 0, 'got ' + r.status);

  stubFetch((url, init) => (init.method ? jsonRes({}) : jsonRes({ id: PID_SAME, parent: { database_id: '35c400a3-854e-80ff-9b36-fd7ddaa3a850' }, properties: {} })));
  r = await worker.fetch(req('/notion/runs/decision', { method: 'PATCH', headers: auth, body: { pageId: PID_SAME, decision: 'Watch' } }), ENV);
  check('page from another DB → 403, never patched', r.status === 403 && !calls.some((c) => c.init.method === 'PATCH'), 'got ' + r.status);

  stubFetch((url, init) => (init.method === 'PATCH' ? jsonRes(runPage(PID_SAME, '2026-10-03T14:00:00.000Z')) : jsonRes(runPage(PID_SAME, '2026-10-03T14:00:00.000Z'))));
  r = await worker.fetch(req('/notion/runs/decision', { method: 'PATCH', headers: auth, body: { pageId: PID_SAME, decision: null } }), ENV);
  const clr = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body).properties;
  check('clear → Decision null, reason + tags emptied', r.status === 200 && clr.Decision.select === null && clr['Reject reason'].rich_text.length === 0 && clr['Reject tags'].multi_select.length === 0);

  r = await worker.fetch(req('/notion/runs', { method: 'OPTIONS' }), ENV);
  check('preflight allows POST', /POST/.test(r.headers.get('access-control-allow-methods') || ''));
}

// ── Claude routine (P1.6) ───────────────────────────────────────────────────
console.log('\nClaude routine');
{
  const auth = { 'x-app-secret': 's3cret' };
  const RUNS_DB = '60a0a2a4-5833-487e-b8d4-80c509e5fcff';
  const CENV = { ...ENV, ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/r1/fire', ROUTINE_TOKEN: 'sk-ant-oat01-x' };
  const P = '44444444-4444-4444-4444-444444444444';
  const rowPage = (id, props = {}) => ({
    id, parent: { type: 'database_id', database_id: RUNS_DB },
    properties: {
      Ticker: { title: [{ plain_text: 'UBER' }] },
      'Run date': { date: { start: '2026-10-03T14:00:00.000Z' } },
      Status: { select: { name: props.status || 'Waiting on Claude' } },
      'Claude started': { date: props.started ? { start: props.started } : null },
      'Claude written': { date: props.written ? { start: props.written } : null },
      'Peers (Claude)': { rich_text: props.peers ? [{ plain_text: props.peers }] : [] },
      'Analyst target (Claude)': { number: props.target ?? null },
      Beats: { number: 6 }, 'Beat quarters': { number: 8 }, 'Beat stale': { checkbox: false },
      'Moat type': { select: { name: 'Scale' } },
    },
  });
  const rec = {
    ticker: 'UBER', runAt: '2026-10-03T18:00:00.000Z', price: 81, scoreType: 'Preliminary', version: 'v2.6',
    investmentScore: 70, quality: 80, value: 60, upside: 50, verdict: 'Maybe', peersAuto: 'LYFT', targetSource: '', lines: ['a'],
  };
  const base = (rows, extra) => (url, init) => {
    if (url.endsWith(`/databases/${RUNS_DB}/query`)) return jsonRes({ results: rows });
    if (url.includes('/databases/') && url.endsWith('/query')) return jsonRes({ results: [] });
    if (url.endsWith('/v1/pages') && init.method === 'POST') return jsonRes({ id: P });
    if (url.includes('/routines/')) return extra.fire ? extra.fire(url, init) : jsonRes({ type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_1' });
    if (url.includes(`/v1/blocks/${P}/children`) && !init.method) return jsonRes({ results: [] });
    if (url.endsWith(`/v1/pages/${P}`) && !init.method) return jsonRes(extra.page || rowPage(P));
    return jsonRes({});
  };
  const firstFire = () => calls.find((c) => c.url.includes('/routines/'));
  const markPatch = () => calls.filter((c) => c.url.endsWith(`/v1/pages/${P}`) && c.init.method === 'PATCH').map((c) => JSON.parse(c.init.body).properties).find((p) => p['Claude started'] || p['Error detail']);

  // New row → fire with ticker + id only, record session
  stubFetch(base([], {}));
  let r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), CENV);
  let body = await r.json();
  const f = firstFire();
  check('new row → routine fired', r.status === 200 && !!f && body.claude?.fired === true, JSON.stringify(body));
  check('fire: bearer + anthropic-version', f?.init.headers.Authorization === 'Bearer sk-ant-oat01-x' && f?.init.headers['anthropic-version'] === '2023-06-01');
  check('fire text = ticker + page id only', JSON.parse(f?.init.body || '{}').text === `ticker: UBER\nrun_page_id: ${P}`);
  const m = markPatch();
  check('row marked Waiting + Claude started + session', m?.Status?.select?.name === 'Waiting on Claude' && !!m['Claude started']?.date?.start && m['Claude session']?.url === 'https://claude.ai/code/session_1', JSON.stringify(m));
  check('history row carries Claude state', body.history?.[0]?.claudeSession === 'https://claude.ai/code/session_1' && body.history[0].status === 'Waiting on Claude');

  // Same day, research already written → reuse (no fire, Status untouched)
  stubFetch(base([rowPage(P, { written: '2026-10-03T14:10:00.000Z', status: 'Final' })], {}));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), CENV);
  body = await r.json();
  const upd = calls.find((c) => c.url.endsWith(`/v1/pages/${P}`) && c.init.method === 'PATCH');
  check('same day + Claude written → no fire', !firstFire() && body.claude?.fired === false, JSON.stringify(body.claude));
  check('same day re-save leaves Status alone', upd && !('Status' in JSON.parse(upd.init.body).properties));
  check('blank target source not written', upd && !('Target source' in JSON.parse(upd.init.body).properties));

  // Same day, Claude mid-run (<20 min) → no second fire
  const recent = new Date(Date.now() - 5 * 60000).toISOString();
  // Row dated now so it is the same New York day as the re-run.
  stubFetch(base([{ ...rowPage(P, { started: recent }), properties: { ...rowPage(P, { started: recent }).properties, 'Run date': { date: { start: recent } } } }], {}));
  await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: { ...rec, runAt: new Date().toISOString() } }), CENV);
  check('same day + Claude still running → no second fire', !firstFire());

  // Same day, earlier start timed out → fire again
  const old = new Date(Date.now() - 45 * 60000).toISOString();
  stubFetch(base([{ ...rowPage(P, { started: old }), properties: { ...rowPage(P, { started: old }).properties, 'Run date': { date: { start: old } } } }], {}));
  await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: { ...rec, runAt: new Date().toISOString() } }), CENV);
  check('same day + timed-out Claude → fired again', !!firstFire());

  // Rate limited → saved, row marked Error
  stubFetch(base([], { fire: () => jsonRes({ type: 'error' }, 429) }));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), CENV);
  body = await r.json();
  check('429 → save still 200, Claude busy', r.status === 200 && body.claude?.fired === false && /busy/.test(body.claude?.error), JSON.stringify(body.claude));
  check('429 → row Status Error + detail', markPatch()?.Status?.select?.name === 'Error' && /busy/.test(markPatch()['Error detail'].rich_text[0].text.content));

  // No routine secrets → runs still save
  stubFetch(base([], {}));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: rec }), ENV);
  body = await r.json();
  check('no routine secrets → saved, not set up', r.status === 200 && /not set up/.test(body.claude?.error || ''), JSON.stringify(body.claude));

  // Final save onto an exact row: no fire, Status Final, keeps run date
  stubFetch(base([rowPage(P, { written: '2026-10-03T14:10:00.000Z' })], {}));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: { ...rec, pageId: P, scoreType: 'Final', peersAuto: '', runAt: '2026-10-05T15:00:00.000Z' } }), CENV);
  body = await r.json();
  const fin = calls.find((c) => c.url.endsWith(`/v1/pages/${P}`) && c.init.method === 'PATCH');
  const fp = fin && JSON.parse(fin.init.body).properties;
  check('Final by pageId → 200, no fire, no new page', r.status === 200 && !firstFire() && !calls.some((c) => c.url.endsWith('/v1/pages') && c.init.method === 'POST'));
  check('Final sets Status + Score type Final', fp?.Status?.select?.name === 'Final' && fp?.['Score type']?.select?.name === 'Final');
  check('Final keeps original run date', fp?.['Run date']?.date?.start === '2026-10-03T14:00:00.000Z');
  check('Final does not blank auto peers', fp && !('Peers (auto)' in fp));

  stubFetch(base([], { page: { id: P, parent: { database_id: '35c400a3-854e-80ff-9b36-fd7ddaa3a850' }, properties: {} } }));
  r = await worker.fetch(req('/notion/runs', { method: 'POST', headers: auth, body: { ...rec, pageId: P, scoreType: 'Final' } }), CENV);
  check('Final onto a non-Stock-Runs page → 403', r.status === 403, 'got ' + r.status);

  // GET one → row + write-up without the checks toggle
  stubFetch((url, init) => {
    if (url.endsWith(`/v1/pages/${P}`)) return jsonRes(rowPage(P, { written: '2026-10-03T14:10:00.000Z', peers: 'LYFT, DASH' }));
    if (url.includes(`/v1/blocks/${P}/children`)) return jsonRes({ results: [
      { type: 'toggle', toggle: { rich_text: [{ plain_text: 'Checks · Preliminary' }] } },
      { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'What they do' }] } },
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Ride-hailing and delivery.' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Q2: 180M MAPCs' }] } },
    ] });
    return jsonRes({}, 500);
  });
  r = await worker.fetch(req(`/notion/runs/one?pageId=${P}`, { headers: auth }), CENV);
  body = await r.json();
  check('GET one → Claude fields', r.status === 200 && body.run?.peersClaude === 'LYFT, DASH' && body.run.beats === 6 && body.run.moatType === 'Scale', JSON.stringify(body.run));
  check('GET one → write-up minus checks toggle', body.writeup?.map((b) => b.type).join() === 'heading,text,bullet', JSON.stringify(body.writeup));
  r = await worker.fetch(req('/notion/runs/one?pageId=nope', { headers: auth }), CENV);
  check('GET one bad id → 400', r.status === 400);

  // Redo → clears Claude written, fires
  stubFetch(base([], { page: rowPage(P, { written: '2026-10-03T14:10:00.000Z' }) }));
  r = await worker.fetch(req('/notion/runs/claude', { method: 'POST', headers: auth, body: { pageId: P } }), CENV);
  body = await r.json();
  const rp = markPatch();
  check('redo → fired + Claude written cleared', r.status === 200 && body.claude?.fired && rp?.['Claude written']?.date === null && body.run?.claudeWritten === null, JSON.stringify(body));
}

// ── Cloudflare Pages move ───────────────────────────────────────────────────
console.log('\nCloudflare Pages');
{
  stubFetch(() => jsonRes({}));
  for (const [o, want] of [
    ['https://wheel-desk.pages.dev', true],
    ['https://abc123.wheel-desk.pages.dev', true],
    ['https://evil.pages.dev', false],
    ['https://wheel-desk.pages.dev.evil.com', false],
  ]) {
    const r = await worker.fetch(new Request('https://w.dev/notion/runs', { method: 'OPTIONS', headers: { Origin: o } }), ENV);
    const got = r.headers.get('access-control-allow-origin') === o;
    check(`notion CORS ${want ? 'allows' : 'refuses'} ${o}`, got === want, 'got ' + r.headers.get('access-control-allow-origin'));
  }

  const { onRequest } = await import('../functions/research/[[path]].js');
  const PENV = { FMP_KEY: 'fmpk', FINNHUB_KEY: 'fhk', SEC_CONTACT_EMAIL: 'x@y.z', APP_SECRET: 's3cret' };
  const preq = (path, headers = {}, method = 'GET') => ({ request: new Request('https://wheel-desk.pages.dev' + path, { method, headers }), env: PENV });

  stubFetch(() => jsonRes({ ok: 1 }));
  let r = await onRequest(preq('/research/sec/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json', { 'x-app-secret': 's3cret' }));
  check('pages fn: sec → 200 via data.sec.gov', r.status === 200 && calls[0].url.startsWith('https://data.sec.gov/api/'), calls[0]?.url);
  check('pages fn: SEC contact UA', /x@y\.z/.test(calls[0].init.headers['User-Agent']));
  check('pages fn: no browser caching', r.headers.get('cache-control') === 'private, no-store');

  stubFetch(() => jsonRes({}));
  r = await onRequest(preq('/research/finnhub/api/v1/stock/peers?symbol=MU', { 'x-app-secret': 's3cret' }));
  check('pages fn: finnhub adds token', calls[0].url === 'https://finnhub.io/api/v1/stock/peers?symbol=MU&token=fhk', calls[0].url);

  stubFetch(() => jsonRes({}));
  r = await onRequest(preq('/research/fmp/x', { 'x-app-secret': 'wrong' }));
  check('pages fn: wrong secret → 401, no upstream call', r.status === 401 && calls.length === 0);
  r = await onRequest(preq('/research/fmp/x', { 'x-app-secret': 's3cret' }, 'POST'));
  check('pages fn: POST → 405', r.status === 405);
  r = await onRequest(preq('/research/other/x', { 'x-app-secret': 's3cret' }));
  check('pages fn: unknown host → 404, no call', r.status === 404 && calls.length === 0);
  r = await onRequest({ request: new Request('https://wheel-desk.pages.dev/research/fmp/x'), env: { FMP_KEY: 'k' } });
  check('pages fn: no APP_SECRET set → Access is the lock, request allowed', r.status === 200);
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ` ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
