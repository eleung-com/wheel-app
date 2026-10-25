// Part 9C (PRD claude/wheel-app-prd-part9-stocks-tab-assignment, approved 10-25):
// keep the full data of recent runs on this device, so tapping a past run
// opens it as saved — charts, peers, checks — without fetching anything.
// Per device by design (El, Q3 option A). Another device gets the saved
// summary from Notion instead.

const KEY = 'wd_runcache_v1';
export const CACHE_MAX = 12;                 // newest runs kept
const MAX_BYTES = 900 * 1024;                // one run that big is skipped

function read(storage) {
  try { return JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

/** Remember a run under its Notion pageId. Never throws. */
export function cacheRun(pageId, run, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!pageId || !run || !storage) return false;
  try {
    const body = JSON.stringify(run);
    if (body.length > MAX_BYTES) return false;
    const all = read(storage);
    all[pageId] = { savedAt: now, run };
    const keep = Object.entries(all).sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(0, CACHE_MAX);
    storage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
    return true;
  } catch { return false; } // full / private mode: just don't cache
}

/** The saved run for a pageId, or null. */
export function cachedRun(pageId, { storage = globalThis.localStorage } = {}) {
  if (!pageId || !storage) return null;
  return read(storage)[pageId]?.run || null;
}
