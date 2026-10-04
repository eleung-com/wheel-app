import { describe, it, expect, afterEach } from 'vitest';
import {
  pickNextDate, needsCheck, targetRows, addDays, daysBetween, refreshEarnings,
} from './earnings.js';

const PRI = '🔥 Priority';
// Monday 2026-10-05, 14:00 UTC = 10:00 ET
const NOW = new Date(Date.UTC(2026, 9, 5, 14, 0));
const TODAY = '2026-10-05';

function fakeKV(init = {}) {
  const store = new Map(Object.entries(init));
  return { get: async k => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); }, store };
}
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Fake Finnhub + Notion. `cal` maps ticker → array of dates Finnhub returns. */
function mockNet(cal, { finnhubStatus = 200, notionStatus = 200 } = {}) {
  const calls = { finnhub: [], notion: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.host === 'finnhub.io') {
      const sym = u.searchParams.get('symbol');
      calls.finnhub.push(sym);
      if (finnhubStatus !== 200) return jsonRes({ error: 'x' }, finnhubStatus);
      return jsonRes({ earningsCalendar: (cal[sym] || []).map(date => ({ date, symbol: sym })) });
    }
    if (u.host === 'api.notion.com') {
      calls.notion.push({ path: u.pathname, body: JSON.parse(init.body) });
      return notionStatus === 200 ? jsonRes({ ok: true }) : jsonRes({ message: 'no' }, notionStatus);
    }
    throw new Error('unexpected ' + url);
  };
  return calls;
}

const row = (ticker, extra = {}) => ({ pageId: `p-${ticker}`, ticker, diveIn: PRI, earnings: '', earningsChecked: '', earningsLocked: false, ...extra });
const ENV = (kv) => ({ FINNHUB_KEY: 'fh', NOTION_TOKEN: 'n', ALERTS_KV: kv });

describe('date helpers', () => {
  it('addDays / daysBetween', () => {
    expect(addDays('2026-10-05', 14)).toBe('2026-10-19');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-05', '2026-10-19')).toBe(14);
  });
});

describe('pickNextDate', () => {
  it('takes the earliest date on or after today', () => {
    const body = { earningsCalendar: [{ date: '2027-01-27' }, { date: '2026-10-29' }, { date: '2026-07-30' }] };
    expect(pickNextDate(body, TODAY)).toBe('2026-10-29');
  });
  it('report day itself counts as upcoming', () => {
    expect(pickNextDate({ earningsCalendar: [{ date: TODAY }] }, TODAY)).toBe(TODAY);
  });
  it('null when nothing upcoming or body malformed', () => {
    expect(pickNextDate({ earningsCalendar: [{ date: '2026-07-30' }] }, TODAY)).toBeNull();
    expect(pickNextDate({}, TODAY)).toBeNull();
    expect(pickNextDate(null, TODAY)).toBeNull();
  });
});

describe('needsCheck', () => {
  it('locked is never checked, even on a full day', () => {
    expect(needsCheck(row('A', { earningsLocked: true }), TODAY, true)).toBe(false);
  });
  it('index/ETF skipped', () => {
    expect(needsCheck(row('XSP'), TODAY, true)).toBe(false);
  });
  it('daily: upcoming date is left alone; blank/past is asked', () => {
    expect(needsCheck(row('A', { earnings: '2026-11-04' }), TODAY, false)).toBe(false);
    expect(needsCheck(row('A'), TODAY, false)).toBe(true);
    expect(needsCheck(row('A', { earnings: '2026-07-27' }), TODAY, false)).toBe(true);
  });
  it('daily: waits 14 days after a "no date" check', () => {
    expect(needsCheck(row('A', { earningsChecked: '2026-09-25' }), TODAY, false)).toBe(false); // 10 days
    expect(needsCheck(row('A', { earningsChecked: '2026-09-21' }), TODAY, false)).toBe(true);  // 14 days
  });
  it('full day: upcoming dates are re-asked; 14-day wait still respected', () => {
    expect(needsCheck(row('A', { earnings: '2026-11-04' }), TODAY, true)).toBe(true);
    expect(needsCheck(row('A', { earningsChecked: '2026-09-30' }), TODAY, true)).toBe(false);
  });
});

describe('targetRows', () => {
  it('Priority or held, with a Notion page', () => {
    const wl = [row('A'), row('B', { diveIn: '👀 Watch' }), row('C', { diveIn: '👀 Watch' }), { ticker: 'D', diveIn: PRI }];
    expect(targetRows(wl, ['c']).map(r => r.ticker)).toEqual(['A', 'C']);
  });
});

describe('refreshEarnings', () => {
  it('full refresh (no KV history): fixes off-by-one, fills blank and past, stamps no-date', async () => {
    const kv = fakeKV();
    const wl = [
      row('MTSI', { earnings: '2026-11-05' }),
      row('AAPL', { earnings: '2026-10-29' }),
      row('TH'),
      row('AMKR', { earnings: '2026-07-27' }),
      row('NEW'),
      row('LOCK', { earnings: '2026-11-30', earningsLocked: true }),
    ];
    const calls = mockNet({ MTSI: ['2026-11-04'], AAPL: ['2026-10-29'], TH: ['2026-11-04', '2027-03-09'], AMKR: ['2026-10-26'] });
    const out = await refreshEarnings(ENV(kv), wl, [], NOW, { gapMs: 0 });

    expect(out.full).toBe(true);
    expect(calls.finnhub.sort()).toEqual(['AAPL', 'AMKR', 'MTSI', 'NEW', 'TH']);
    expect(out.updated).toEqual(['MTSI 2026-11-05→2026-11-04', 'TH —→2026-11-04', 'AMKR 2026-07-27→2026-10-26']);
    expect(out.noDate).toEqual(['NEW']);
    // Rows mutated so the same scan uses the new dates
    expect(wl[0].earnings).toBe('2026-11-04');
    // AAPL unchanged → no Notion write
    expect(calls.notion.map(c => c.path)).not.toContain('/v1/pages/p-AAPL');
    // Earnings Date write clears "checked"; no-date write stamps it
    const mt = calls.notion.find(c => c.path === '/v1/pages/p-MTSI').body.properties;
    expect(mt['Earnings Date']).toEqual({ date: { start: '2026-11-04' } });
    expect(mt['Earnings checked']).toEqual({ date: null });
    const nw = calls.notion.find(c => c.path === '/v1/pages/p-NEW').body.properties;
    expect(nw).toEqual({ 'Earnings checked': { date: { start: TODAY } } });
    expect(kv.store.get('earnings|last-full')).toBe(TODAY);
  });

  it('runs once per ET day', async () => {
    const kv = fakeKV();
    mockNet({ TH: ['2026-11-04'] });
    const wl = [row('TH')];
    expect((await refreshEarnings(ENV(kv), wl, [], NOW, { gapMs: 0 })).ran).toBe(true);
    const calls = mockNet({});
    expect((await refreshEarnings(ENV(kv), [row('X')], [], NOW, { gapMs: 0 })).ran).toBe(false);
    expect(calls.finnhub).toEqual([]);
  });

  it('non-full day: only blank/past asked', async () => {
    const kv = fakeKV({ 'earnings|last-full': '2026-10-02' }); // 3 days ago
    const calls = mockNet({ TH: ['2026-11-04'] });
    const out = await refreshEarnings(ENV(kv), [row('TH'), row('NVDA', { earnings: '2026-11-18' })], [], NOW, { gapMs: 0 });
    expect(out.full).toBe(false);
    expect(calls.finnhub).toEqual(['TH']);
  });

  it('Finnhub failure: logged, scan continues, day still marked', async () => {
    const kv = fakeKV();
    mockNet({}, { finnhubStatus: 429 });
    const out = await refreshEarnings(ENV(kv), [row('TH')], [], NOW, { gapMs: 0 });
    expect(out.failed).toEqual(['TH']);
    expect(kv.store.get('earnings|day|2026-10-05')).toBe('1');
    expect(kv.store.has('earnings|last-full')).toBe(false); // nothing succeeded → full retried next day
  });

  it('Notion write failure does not throw', async () => {
    mockNet({ TH: ['2026-11-04'] }, { notionStatus: 500 });
    const out = await refreshEarnings(ENV(fakeKV()), [row('TH')], [], NOW, { gapMs: 0 });
    expect(out.failed).toEqual(['TH']);
  });

  it('no FINNHUB_KEY → skipped, no calls', async () => {
    const calls = mockNet({});
    const out = await refreshEarnings({ ALERTS_KV: fakeKV() }, [row('TH')], [], NOW);
    expect(out.ran).toBe(false);
    expect(calls.finnhub).toEqual([]);
  });
});
