import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSheetData, describeError } from './scan.js';

const env = { SHEET_URL: 'https://script.example/exec', APP_SECRET: 's' };
const okBody = JSON.stringify({ positions: [{ id: 1, ticker: 'QQQ', type: 'short_put', qty: 1 }], closedTrades: [], criteria: {} });
const ok = () => new Response(okBody, { status: 200 });
const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
const fast = { pauseMs: 0 };

afterEach(() => vi.unstubAllGlobals());

describe('scan-timeout fix: Sheet read', () => {
  it('works first time → one call', async () => {
    const f = vi.fn(async () => ok()); vi.stubGlobal('fetch', f);
    const d = await fetchSheetData(env, fast);
    expect(d.positions).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('times out once, then works → retried, no crash', async () => {
    let n = 0; const f = vi.fn(async () => (++n === 1 ? timeout() : ok())); vi.stubGlobal('fetch', f);
    const d = await fetchSheetData(env, fast);
    expect(d.positions).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('times out twice → clear message naming the step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => timeout()));
    await expect(fetchSheetData(env, fast)).rejects.toThrow('Sheet read failed after 2 tries (timed out)');
  });

  it('404 (mid-redeploy) is retried', async () => {
    let n = 0; const f = vi.fn(async () => (++n === 1 ? new Response('', { status: 404 }) : ok())); vi.stubGlobal('fetch', f);
    await fetchSheetData(env, fast);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('401-type errors are not retried', async () => {
    const f = vi.fn(async () => new Response('', { status: 403 })); vi.stubGlobal('fetch', f);
    await expect(fetchSheetData(env, fast)).rejects.toThrow('HTTP 403');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('script error (e.g. wrong secret) is reported, not retried', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 200 })); vi.stubGlobal('fetch', f);
    await expect(fetchSheetData(env, fast)).rejects.toThrow('Sheet read: Unauthorized');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('describeError turns the browser timeout text into "timed out"', () => {
    expect(describeError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe('timed out');
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});
