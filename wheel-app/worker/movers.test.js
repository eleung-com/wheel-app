import { describe, it, expect, vi } from 'vitest';
import { parseDayMoves, pickNewMovers, moverPayload, runMovers, fireMoverRoutine, MAX_FIRES_PER_DAY } from './movers.js';

const PID = '35c400a3-854e-81d7-8b3b-e7bf9a894766';
const wl = [
  { ticker: 'GEV', pageId: PID },
  { ticker: 'NVDA', pageId: PID.replace('766', '767') },
  { ticker: 'UBER', pageId: PID.replace('766', '768') },
  { ticker: 'SPY', pageId: PID.replace('766', '769') },
];
const OPEN = new Date('2026-10-23T15:00:00Z'); // Fri 11:00 ET
const CLOSED = new Date('2026-10-24T15:00:00Z'); // Sat

function kvStub(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: vi.fn(async (k) => m.get(k) ?? null), put: vi.fn(async (k, v) => { m.set(k, v); }), m };
}
const spark = (closes) => new Response(JSON.stringify(Object.fromEntries(Object.entries(closes).map(([t, c]) => [t, { close: c }]))), { status: 200 });

describe('Part 6B mover detection', () => {
  it('day % from the last two closes', () => {
    expect(parseDayMoves({ GEV: { close: [900, 827.42, 769.5] } })).toEqual({ GEV: -7 });
    expect(parseDayMoves({ X: { close: [10] } })).toEqual({});
  });

  it('±5% or more, biggest first, indexes skipped', () => {
    const l = pickNewMovers(wl, { GEV: -7, NVDA: 5.2, UBER: 4.9, SPY: -6 });
    expect(l.map((m) => m.ticker)).toEqual(['GEV', 'NVDA']);
  });

  it('already summarized today → skipped unless the move doubled', () => {
    expect(pickNewMovers(wl, { GEV: -7 }, { GEV: 6 })).toHaveLength(0);
    expect(pickNewMovers(wl, { GEV: -12.5 }, { GEV: 6 })).toHaveLength(1);
  });

  it('payload is data-only lines', () => {
    const t = moverPayload('2026-10-23', { SPY: -1.24, QQQ: -2, SMH: 0.3 }, [{ ticker: 'GEV', pct: -7, pageId: PID }]);
    expect(t).toBe(`date: 2026-10-23\nmarket: SPY −1.2% · QQQ −2.0% · SMH +0.3%\nmovers:\nGEV -7.0 ${PID}`);
  });
});

describe('Part 6C runMovers', () => {
  const env = (kv) => ({ ALERTS_KV: kv, MOVER_ROUTINE_FIRE_URL: 'https://fire', MOVER_ROUTINE_TOKEN: 't' });

  it('does nothing when the market is closed', async () => {
    const f = vi.fn();
    expect(await runMovers(env(kvStub()), CLOSED, { readWatchlist: async () => wl, fetch: f })).toEqual({ skipped: 'market closed' });
    expect(f).not.toHaveBeenCalled();
  });

  it('fires ONE routine run for the batch and remembers it', async () => {
    const kv = kvStub();
    const calls = [];
    const f = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return url.startsWith('https://fire') ? new Response('{}', { status: 200 }) : spark({ GEV: [800, 744], NVDA: [100, 106], UBER: [50, 50.5], SPY: [700, 693] });
    });
    const r = await runMovers(env(kv), OPEN, { readWatchlist: async () => wl, fetch: f });
    expect(r).toEqual({ movers: ['GEV', 'NVDA'], fired: true });
    const fire = calls.filter((c) => c.url === 'https://fire');
    expect(fire).toHaveLength(1);
    expect(JSON.parse(fire[0].init.body).text).toContain('GEV -7.0');
    // second run, same moves → nothing new, no second fire
    const r2 = await runMovers(env(kv), OPEN, { readWatchlist: async () => wl, fetch: f });
    expect(r2).toEqual({ movers: [] });
    expect(calls.filter((c) => c.url === 'https://fire')).toHaveLength(1);
  });

  it('a failed fire marks nothing → retried next run', async () => {
    const kv = kvStub();
    let fail = true;
    const f = vi.fn(async (url) => (url.startsWith('https://fire')
      ? new Response('busy', { status: fail ? 500 : 200 })
      : spark({ GEV: [800, 744] })));
    const r = await runMovers(env(kv), OPEN, { readWatchlist: async () => wl, fetch: f });
    expect(r.fired).toBe(false);
    fail = false;
    expect((await runMovers(env(kv), OPEN, { readWatchlist: async () => wl, fetch: f })).fired).toBe(true);
  });

  it('stops after the daily fire cap', async () => {
    const kv = kvStub({ 'movers|fires|2026-10-23': String(MAX_FIRES_PER_DAY) });
    expect(await runMovers(env(kv), OPEN, { readWatchlist: async () => wl, fetch: vi.fn() })).toEqual({ skipped: 'daily fire cap' });
  });

  it('routine not set up → clear error, no crash', async () => {
    expect(await fireMoverRoutine({}, 'x')).toEqual({ ok: false, error: 'Mover Summary routine not set up yet' });
  });

  it('never throws, even if Notion fails', async () => {
    const r = await runMovers(env(kvStub()), OPEN, { readWatchlist: async () => { throw new Error('notion down'); }, fetch: vi.fn() });
    expect(r).toEqual({ error: 'notion down' });
  });
});
