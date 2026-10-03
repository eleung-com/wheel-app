// Browser side of Stock Runs (P1.5): save a run, read history, set Watch / Reject.
// Everything goes through the Worker's /notion/runs routes — the Notion key
// never reaches the app.

import { notionRequest } from '../utils';
import { runToRecord } from './runRecord.js';

const TIMEOUT_MS = 20000;

async function call(path, { method = 'GET', body } = {}) {
  const { url, headers } = notionRequest(path);
  const res = await fetch(url, {
    method,
    headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(data?.error || `Notion save failed (${res.status})`);
  return data;
}

/**
 * Save a run → { pageId, replaced, history, claude }.
 * pageId set = save onto that exact row (the Final re-score); otherwise the
 * Worker picks today's row for the ticker or creates one, and starts Claude.
 */
export function saveRun(run, { pageId = null } = {}) {
  return call('/runs', { method: 'POST', body: runToRecord(run, { pageId }) });
}

/** One run row + Claude's write-up blocks → { run, writeup }. */
export function loadRun(pageId) {
  return call(`/runs/one?${new URLSearchParams({ pageId })}`);
}

/** Start Claude again for a row → { run, claude }. */
export function redoClaude(pageId) {
  return call('/runs/claude', { method: 'POST', body: { pageId } });
}

/** History for one ticker, or the most recent runs when ticker is empty. */
export async function loadRuns({ ticker = '', limit = 20 } = {}) {
  const q = new URLSearchParams({ limit: String(limit), ...(ticker ? { ticker } : {}) });
  const data = await call(`/runs?${q}`);
  return data.runs || [];
}

/** decision: 'Watch' | 'Reject' | null (clear). Returns the updated row. */
export async function saveDecision(pageId, { decision, reason = '', tags = [] }) {
  const data = await call('/runs/decision', { method: 'PATCH', body: { pageId, decision, reason, tags } });
  return data.run;
}
