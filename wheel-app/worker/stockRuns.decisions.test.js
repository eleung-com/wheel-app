import { describe, it, expect, afterEach } from 'vitest';
import { applyPendingDecisions } from './stockRuns.js';

// Part 2B: decisions made in Research before TradingView synced the row.
const RUNS_DB = '60a0a2a4-5833-487e-b8d4-80c509e5fcff';
const WL_DB = '35c400a3-854e-80ff-9b36-fd7ddaa3a850';
const jsonRes = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const run = (id, ticker, decision, applied, at) => ({
  id, parent: { database_id: RUNS_DB },
  properties: {
    Ticker: { title: [{ plain_text: ticker }] },
    'Run date': { date: { start: at } },
    Decision: { select: decision ? { name: decision } : null },
    'Dive-In applied': { checkbox: applied },
  },
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(runs, watchlist) {
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith(`/databases/${RUNS_DB}/query`)) return jsonRes({ results: runs });
    if (u.endsWith(`/databases/${WL_DB}/query`)) {
      const t = JSON.parse(init.body).filter.title.equals;
      return jsonRes({ results: watchlist[t] ? [{ id: watchlist[t] }] : [] });
    }
    if (init.method === 'PATCH') { patches.push({ url: u, props: JSON.parse(init.body).properties }); return jsonRes({}); }
    return jsonRes({}, 404);
  };
  return patches;
}

describe('applyPendingDecisions', () => {
  it('applies the newest pending decision once the watchlist row exists', async () => {
    const patches = stub(
      [run('r1', 'CRWD', 'Priority', false, '2026-10-05T14:00:00Z')],
      { CRWD: 'wl-crwd' },
    );
    expect(await applyPendingDecisions({ NOTION_TOKEN: 'x' })).toEqual([{ ticker: 'CRWD', decision: 'Priority' }]);
    expect(patches[0]).toEqual({ url: 'https://api.notion.com/v1/pages/wl-crwd', props: { 'Dive-In': { select: { name: '🔥 Priority' } } } });
    expect(patches[1].props).toEqual({ 'Dive-In applied': { checkbox: true } });
  });

  it('waits when the row still is not on the watchlist', async () => {
    const patches = stub([run('r1', 'CRWD', 'Watch', false, '2026-10-05T14:00:00Z')], {});
    expect(await applyPendingDecisions({})).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('an older pending choice never overrides a newer applied one', async () => {
    const patches = stub([
      run('new', 'CRWD', 'Watch', true, '2026-10-06T14:00:00Z'),
      run('old', 'CRWD', 'Priority', false, '2026-10-05T14:00:00Z'),
    ], { CRWD: 'wl-crwd' });
    expect(await applyPendingDecisions({})).toEqual([]);
    expect(patches).toEqual([]);
  });

  it('Reject maps to — Skip', async () => {
    const patches = stub([run('r1', 'ABC', 'Reject', false, '2026-10-05T14:00:00Z')], { ABC: 'wl-abc' });
    await applyPendingDecisions({});
    expect(patches[0].props['Dive-In'].select.name).toBe('— Skip');
  });
});
