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
      'App Category': { select: extra.category ? { name: extra.category } : null },
      'scanner verdict': { select: extra.verdict ? { name: extra.verdict } : null },
      sector: { select: extra.sector ? { name: extra.sector } : null },
      'Dive-In': { select: extra.diveIn ? { name: extra.diveIn } : null },
      'Wheel (CSP)': { select: extra.wheel ? { name: extra.wheel } : null },
      Fundamentals: { select: extra.fundamentals ? { name: extra.fundamentals } : null },
      'Last Eval Date': { date: extra.lastEval ? { start: extra.lastEval } : null },
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
            page('p1', 'dell', { notes: 'cheap', category: 'Strong Candidate', verdict: 'Interested', sector: 'Technology', diveIn: '🔥 Priority', wheel: '✅', fundamentals: '⚠️', lastEval: '2026-07-21' }),
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
  check('flattens category', dell.category === 'Strong Candidate');
  check('keeps verdict separate from category', dell.verdict === 'Interested');
  check('flattens Dive-In', dell.diveIn === '🔥 Priority');
  check('flattens Wheel (CSP)', dell.wheel === '✅');
  check('flattens Fundamentals', dell.fundamentals === '⚠️');
  check('flattens Last Eval Date', dell.lastEval === '2026-07-21');
  check('parses created_time → addedAt', typeof dell.addedAt === 'number' && dell.addedAt > 0);
  const aapl = body.watchlist.find(w => w.ticker === 'AAPL');
  check('empty notes → empty string', aapl.notes === '');
  check('null select → empty string', aapl.category === '');
  check('null Dive-In → empty string', aapl.diveIn === '');
  check('null Wheel → empty string', aapl.wheel === '');
  check('null Last Eval Date → empty string', aapl.lastEval === '');
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

  stubFetch(() => jsonRes({ ok: true }));
  await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, category: 'Monitoring' },
  }), ENV);
  {
    const props = JSON.parse(calls[0].init.body).properties;
    check('category → select shape', props['App Category'].select.name === 'Monitoring');
    check('does NOT touch Notes', !('Notes' in props), Object.keys(props).join(','));
  }

  stubFetch(() => jsonRes({ ok: true }));
  await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, notes: '' },
  }), ENV);
  check('cleared notes → empty rich_text array',
    JSON.parse(calls[0].init.body).properties.Notes.rich_text.length === 0);

  stubFetch(() => jsonRes({ ok: true }));
  await worker.fetch(req('/notion/page', {
    method: 'PATCH', headers: { 'x-app-secret': 's3cret' }, body: { pageId: UUID, category: '' },
  }), ENV);
  check('cleared category → select null',
    JSON.parse(calls[0].init.body).properties['App Category'].select === null);

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

// ── No regression on the finance routes ──────────────────────────────────────
console.log('\nExisting routes still work');
{
  stubFetch(() => jsonRes({ chart: {} }));
  let r = await worker.fetch(new Request('https://w.dev/yf/v8/finance/chart/AAPL?range=5d'), ENV);
  check('yf route → 200', r.status === 200, 'got ' + r.status);
  check('yf strips the /yf prefix',
    calls[0].url === 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d', calls[0].url);
  check('yf sends browser UA', /Mozilla/.test(calls[0].headers?.['User-Agent'] || calls[0].init.headers['User-Agent']));

  stubFetch(() => jsonRes({ quotes: {} }));
  r = await worker.fetch(new Request('https://w.dev/v1/markets/quotes?symbols=AAPL'), ENV);
  check('tradier without token → 401', r.status === 401, 'got ' + r.status);

  stubFetch(() => jsonRes({ quotes: {} }));
  r = await worker.fetch(new Request('https://w.dev/v1/markets/quotes?symbols=AAPL', {
    headers: { 'x-tradier-token': 'tk' },
  }), ENV);
  check('tradier with token → 200', r.status === 200, 'got ' + r.status);
  check('tradier swaps to Authorization header',
    calls[0].init.headers.Authorization === 'Bearer tk');
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ` ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
