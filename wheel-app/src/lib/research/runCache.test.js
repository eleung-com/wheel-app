import { describe, it, expect } from 'vitest';
import { cacheRun, cachedRun, CACHE_MAX } from './runCache';

function mem() { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; }

describe('Part 9C run cache', () => {
  it('stores and returns a run by pageId', () => {
    const storage = mem();
    cacheRun('p1', { ticker: 'GOOGL', result: { investmentScore: 70 } }, { storage });
    expect(cachedRun('p1', { storage }).result.investmentScore).toBe(70);
    expect(cachedRun('nope', { storage })).toBeNull();
  });
  it('keeps only the newest CACHE_MAX runs', () => {
    const storage = mem();
    for (let i = 0; i < CACHE_MAX + 3; i++) cacheRun(`p${i}`, { i }, { storage, now: i });
    expect(cachedRun('p0', { storage })).toBeNull();
    expect(cachedRun(`p${CACHE_MAX + 2}`, { storage })).toEqual({ i: CACHE_MAX + 2 });
  });
  it('never throws: broken storage or no storage', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(cacheRun('p', { a: 1 }, { storage: bad })).toBe(false);
    expect(cachedRun('p', { storage: bad })).toBeNull();
    expect(cachedRun('p', { storage: null })).toBeNull();
  });
});
