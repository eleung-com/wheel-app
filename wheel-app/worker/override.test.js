import { describe, it, expect, vi, afterEach } from 'vitest';
import { setDiveInOverride, OVERRIDE_KEY } from './stockRuns.js';

function memKV() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}
afterEach(() => vi.unstubAllGlobals());

describe('setDiveInOverride (Part 3W)', () => {
  it('sets Dive-In, stores the override with the latest run id', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push([String(url), init?.method, init?.body ? JSON.parse(init.body) : null]);
      if (String(url).includes('/databases/') && String(url).endsWith('/query')) {
        const b = JSON.parse(init.body);
        if (String(url).includes('35c400a3') && b.filter?.property === 'Ticker') return new Response(JSON.stringify({ results: [{ id: 'wl-1' }] }));
        return new Response(JSON.stringify({ results: [], has_more: false }));
      }
      return new Response('{}');
    }));
    const kv = memKV();
    const env = { NOTION_TOKEN: 't', ALERTS_KV: kv };
    const out = await setDiveInOverride(env, { ticker: 'nvda', diveIn: '👀 Watch' });
    expect(out).toEqual({ ok: true, ticker: 'NVDA', override: '👀 Watch' });
    const patch = calls.find(([u, m]) => u.endsWith('/v1/pages/wl-1') && m === 'PATCH');
    expect(patch[2].properties['Dive-In'].select.name).toBe('👀 Watch');
    const saved = JSON.parse(kv.m.get(OVERRIDE_KEY('NVDA')));
    expect(saved.diveIn).toBe('👀 Watch');
    expect(saved.runId).toBe('none');
  });
  it('null clears; bad input rejected', async () => {
    const kv = memKV(); kv.m.set(OVERRIDE_KEY('NVDA'), '{}');
    await setDiveInOverride({ ALERTS_KV: kv }, { ticker: 'NVDA', diveIn: null });
    expect(kv.m.has(OVERRIDE_KEY('NVDA'))).toBe(false);
    await expect(setDiveInOverride({ ALERTS_KV: kv }, { ticker: 'NVDA', diveIn: 'Maybe' })).rejects.toThrow('bad Dive-In');
    await expect(setDiveInOverride({ ALERTS_KV: kv }, { ticker: '!!', diveIn: null })).rejects.toThrow('bad ticker');
  });
});
