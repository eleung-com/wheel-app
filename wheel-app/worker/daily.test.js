import { describe, it, expect, vi } from 'vitest';
import { dueReport, overrideActive, parseSpark, updateDiveIns, fmvAfterEarnings, fireFmvRoutine } from './daily.js';
import { addTradingDays, isTradingDay } from './marketHours.js';
import { targetRows } from './earnings.js';
import { DIVE } from '../src/lib/fairValue.js';

function memKV(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

describe('trading days', () => {
  it('skips weekends and holidays', () => {
    expect(isTradingDay('2026-10-10')).toBe(false);      // Saturday
    expect(isTradingDay('2026-11-26')).toBe(false);      // Thanksgiving
    expect(addTradingDays('2026-10-15', 2)).toBe('2026-10-19'); // Thu → Mon
    expect(addTradingDays('2026-11-24', 2)).toBe('2026-11-27'); // over Thanksgiving
  });
});

describe('dueReport', () => {
  const base = { today: '2026-10-19', fmvDate: '2026-10-12' };
  it('fires 2 trading days after the report', () => {
    expect(dueReport({ ...base, notionDate: '2026-10-15' })).toBe('2026-10-15');
    expect(dueReport({ ...base, today: '2026-10-16', notionDate: '2026-10-15' })).toBeNull();
  });
  it('uses the KV last date once Notion moved to the next report', () => {
    expect(dueReport({ ...base, notionDate: '2027-01-20', lastDate: '2026-10-15' })).toBe('2026-10-15');
  });
  it('done once FMV date is after the report', () => {
    expect(dueReport({ ...base, notionDate: '2026-10-15', fmvDate: '2026-10-16' })).toBeNull();
    expect(dueReport({ ...base, notionDate: '2026-10-15', fmvDate: '2026-10-15' })).toBe('2026-10-15');
  });
  it('ignores old reports (Monday covers) and future dates', () => {
    expect(dueReport({ ...base, notionDate: '2026-09-01' })).toBeNull();
    expect(dueReport({ ...base, notionDate: '2026-10-28' })).toBeNull();
  });
});

describe('overrideActive', () => {
  const ov = { runId: 'r1', day: '2026-10-12' };
  it('holds for the same run and no newer FMV', () => {
    expect(overrideActive(ov, 'r1', '2026-10-12')).toBe(true);
    expect(overrideActive(ov, 'r2', '2026-10-12')).toBe(false);
    expect(overrideActive(ov, 'r1', '2026-10-19')).toBe(false);
    expect(overrideActive(null, 'r1', '')).toBe(false);
  });
});

describe('parseSpark', () => {
  it('takes the last close per symbol', () => {
    expect(parseSpark({ NVDA: { close: [229.284] }, X: { close: [] } })).toEqual({ NVDA: 229.28 });
  });
});

describe('earnings targetRows (Part 3)', () => {
  it('every non-Skip row plus held', () => {
    const wl = [
      { ticker: 'A', pageId: 'a', diveIn: DIVE.PRIORITY }, { ticker: 'B', pageId: 'b', diveIn: DIVE.WATCH },
      { ticker: 'C', pageId: 'c', diveIn: '' }, { ticker: 'D', pageId: 'd', diveIn: DIVE.SKIP },
      { ticker: 'E', pageId: 'e', diveIn: DIVE.SKIP },
    ];
    expect(targetRows(wl, ['E']).map((r) => r.ticker)).toEqual(['A', 'B', 'C', 'E']);
  });
});

describe('updateDiveIns', () => {
  it('applies the rule, skips index rows, respects overrides', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, init) => { calls.push([url, JSON.parse(init.body)]); return new Response('{}'); });
    vi.stubGlobal('fetch', fetchMock);
    const kv = memKV({ 'divein|override|C': JSON.stringify({ runId: 'rc', day: '2026-10-12' }) });
    const env = { ALERTS_KV: kv, NOTION_TOKEN: 't' };
    const wl = [
      { ticker: 'A', pageId: 'pa', diveIn: DIVE.WATCH, fmvMid: 100, fmvDate: '2026-10-12' },
      { ticker: 'B', pageId: 'pb', diveIn: DIVE.PRIORITY, fmvMid: 100, fmvDate: '2026-10-12' },
      { ticker: 'C', pageId: 'pc', diveIn: DIVE.PRIORITY, fmvMid: 100, fmvDate: '2026-10-12' },
      { ticker: 'XSP', pageId: 'px', diveIn: '' },
    ];
    const scores = { A: { verdict: 'Maybe', pageId: 'ra' }, B: { verdict: 'Not worth it', pageId: 'rb' }, C: { verdict: 'Maybe', pageId: 'rc' } };
    const out = await updateDiveIns(env, wl, scores, { A: 95, B: 95, C: 200 });
    expect(out.changed.map((s) => s.split(' ')[0])).toEqual(['A', 'B']);
    expect(out.kept).toEqual(['C']);
    expect(calls.map(([u, b]) => [u.split('/').pop(), b.properties['Dive-In'].select.name]))
      .toEqual([['pa', DIVE.PRIORITY], ['pb', DIVE.SKIP]]);
    vi.unstubAllGlobals();
  });
});

describe('fmvAfterEarnings', () => {
  it('fires once per day, max 3 tries, payload has 3 lines', async () => {
    const kv = memKV({ 'earnings|last|NFLX': '2026-10-15' });
    const env = { ALERTS_KV: kv, FMV_ROUTINE_FIRE_URL: 'https://x/fire', FMV_ROUTINE_TOKEN: 'tok' };
    const bodies = [];
    const f = vi.fn(async (u, init) => { bodies.push(JSON.parse(init.body).text); return new Response('{}'); });
    const wl = [
      { ticker: 'NFLX', pageId: 'pn', diveIn: DIVE.PRIORITY, earnings: '2027-01-20', fmvDate: '2026-10-12' },
      { ticker: 'SKIPPED', pageId: 'ps', diveIn: DIVE.SKIP, earnings: '2026-10-15' },
    ];
    for (let i = 0; i < 4; i++) await fmvAfterEarnings(env, wl, '2026-10-19', f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(bodies[0]).toBe('ticker: NFLX\npage_id: pn\nearnings_date: 2026-10-15');
    const last = await fmvAfterEarnings(env, wl, '2026-10-20', f);
    expect(last.gaveUp).toEqual(['NFLX']);
  });
  it('no secrets → not set up, no call', async () => {
    const f = vi.fn();
    expect(await fireFmvRoutine({}, 'A', 'p', '2026-10-15', f)).toEqual({ ok: false, error: 'FMV routine not set up' });
    expect(f).not.toHaveBeenCalled();
  });
});
