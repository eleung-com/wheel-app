// Stock Runs (Notion) — the shape of one saved run, shared by the app and the
// Worker so both sides agree on field names and rules (P1.5).
//
//   runToRecord(run)       app: a runPreliminary()/rescoreFinal() result → the
//                          small JSON the Worker saves. Nothing else leaves the app.
//   dayKey(iso)            the New York calendar day of a timestamp. "Same-day
//                          re-run overwrites" (decided 10-03) uses this on both sides.
//   cleanRecord(body)      Worker: validate + trim what the app sent.
//   cleanDecision(body)    Worker: validate a Watch / Reject / clear request.
//   rejectedBefore(rows)   app: the newest earlier Reject for the banner.
//   claudeState(row, now)  P1.6: none / waiting / done / failed for a saved run.
//   claudeInputs(row)      P1.6: Claude's peers, target and beat rate → rescoreFinal().

import { plainLines } from './explain.js';

export const RUN_TZ = 'America/New_York';
export const VERDICTS = ['Worth investing', 'Maybe', 'Not worth it', 'No score'];
export const SCORE_TYPES = ['Preliminary', 'Final'];
export const DECISIONS = ['Watch', 'Reject'];
export const REJECT_TAGS = ['Revenue', 'Debt', 'FCF', 'Moat', 'Valuation', 'Competition', 'Other'];
export const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

const MAX_LINE = 300;
const MAX_LINES = 60;
const MAX_REASON = 1000;
export const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/** Claude routine not done this long after it was started → "Claude step failed — Retry" (PRD §6). */
export const CLAUDE_TIMEOUT_MIN = 20;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** "2026-10-03" — the calendar day in New York for an ISO timestamp. */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: RUN_TZ });
}

/** "10-03 2:22 PM" in New York time, for headings and lists. */
export function runStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = dayKey(iso).slice(5);
  const t = d.toLocaleTimeString('en-US', { timeZone: RUN_TZ, hour: 'numeric', minute: '2-digit' });
  return `${day} ${t}`;
}

const pts = (p) => (p == null ? '—' : Number.isInteger(p) ? String(p) : p.toFixed(1));

/** Readable lines for the Notion page body (the checks, in words). */
function bodyLines(run) {
  const r = run.result;
  if (!r) return (run.bundle?.dataTags || []).map((t) => `No score: ${t.text}`);
  const out = plainLines(run).map((l) => l.text);
  for (const c of r.quality.checks) out.push(`Quality · ${c.label}: ${c.display} → ${c.color === 'na' ? 'n/a' : pts(c.points)}`);
  if (r.quality.piotroski?.score != null) out.push(`Quality · Piotroski: ${r.quality.piotroski.passed} / ${r.quality.piotroski.run}`);
  if (r.quality.altmanZ != null) out.push(`Quality · Altman Z: ${r.quality.altmanZ.toFixed(1)}`);
  for (const p of r.value.parts) out.push(`Value · ${p.label}: ${p.display} → ${pts(p.points)}`);
  if (r.upside.target) out.push(`Upside · target $${r.upside.target.value.toFixed(2)} (${r.upside.target.source || 'source n/a'}) → ${pts(r.upside.score)}`);
  for (const t of r.tags) out.push(`Flag · ${t.text}`);
  return out;
}

/**
 * The record the app sends to the Worker for one run.
 * @param {object} run  runPreliminary()/rescoreFinal() result
 */
export function runToRecord(run, { pageId = null } = {}) {
  const r = run.result;
  const peers = (run.peers?.used || []).map((p) => p.ticker).join(', ');
  return {
    ticker: run.ticker,
    runAt: run.ranAt,
    price: num(run.bundle?.input?.price),
    scoreType: r?.scoreType === 'Final' ? 'Final' : 'Preliminary',
    version: r?.version || '',
    investmentScore: num(r?.investmentScore),
    quality: num(r?.quality?.score),
    value: num(r?.value?.score),
    upside: num(r?.upside?.score),
    verdict: r ? r.verdict : 'No score',
    peersAuto: run.peers?.source === 'claude' ? '' : peers,
    targetSource: r?.upside?.target?.source || '',
    lines: bodyLines(run),
    ...(pageId ? { pageId } : {}),
  };
}

/** Worker side: validate the record. Returns { ok, rec } or { ok:false, error }. */
export function cleanRecord(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const ticker = str(body.ticker, 10).toUpperCase();
  if (!TICKER_RE.test(ticker)) return { ok: false, error: 'bad ticker' };
  const day = dayKey(body.runAt);
  if (!day) return { ok: false, error: 'bad runAt' };
  const verdict = VERDICTS.includes(body.verdict) ? body.verdict : null;
  if (!verdict) return { ok: false, error: 'bad verdict' };
  const scoreType = SCORE_TYPES.includes(body.scoreType) ? body.scoreType : 'Preliminary';
  const score = (v) => (isNum(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);
  return {
    ok: true,
    rec: {
      ticker,
      runAt: new Date(body.runAt).toISOString(),
      day,
      price: isNum(body.price) && body.price > 0 ? body.price : null,
      scoreType,
      version: str(body.version, 20),
      investmentScore: score(body.investmentScore),
      quality: score(body.quality),
      value: score(body.value),
      upside: score(body.upside),
      verdict,
      peersAuto: str(body.peersAuto, 200),
      targetSource: str(body.targetSource, 200),
      lines: (Array.isArray(body.lines) ? body.lines : []).slice(0, MAX_LINES).map((l) => str(l, MAX_LINE)).filter(Boolean),
      pageId: UUID_RE.test(String(body.pageId || '')) ? String(body.pageId) : null,
    },
  };
}

/**
 * Worker side: a decision change. decision null = clear.
 * Reject needs a reason (PRD §6A step 14). Returns { ok, d } or { ok:false, error }.
 */
export function cleanDecision(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const decision = body.decision == null || body.decision === '' ? null : body.decision;
  if (decision !== null && !DECISIONS.includes(decision)) return { ok: false, error: 'decision must be Watch, Reject or null' };
  const reason = decision === 'Reject' ? String(body.reason ?? '').trim().slice(0, MAX_REASON) : '';
  if (decision === 'Reject' && !reason) return { ok: false, error: 'a reason is required to reject' };
  const tags = decision === 'Reject'
    ? [...new Set((Array.isArray(body.tags) ? body.tags : []).filter((t) => REJECT_TAGS.includes(t)))]
    : [];
  return { ok: true, d: { decision, reason, tags } };
}

/** Newest Reject among the rows that isn't the run on screen (rows newest first). */
export function rejectedBefore(rows, currentPageId) {
  return (rows || []).find((r) => r.decision === 'Reject' && r.pageId !== currentPageId) || null;
}

/**
 * Where the Claude step stands for a saved run row.
 *   done     Claude wrote its research (Claude written is set)
 *   failed   routine couldn't start, reported an error, or ran past the timeout
 *   waiting  started, still inside the timeout
 *   none     never started (e.g. no routine configured yet)
 */
export function claudeState(row, now = Date.now()) {
  if (!row) return 'none';
  if (row.claudeWritten) return 'done';
  if (row.status === 'Error') return 'failed';
  if (!row.claudeStarted) return 'none';
  const age = now - Date.parse(row.claudeStarted);
  return age > CLAUDE_TIMEOUT_MIN * 60000 ? 'failed' : 'waiting';
}

/** Claude's findings on a row → the arguments rescoreFinal() takes. */
export function claudeInputs(row) {
  const peerTickers = String(row?.peersClaude || '')
    .split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter((t) => TICKER_RE.test(t)).slice(0, 6);
  const target = isNum(row?.analystTargetClaude) && row.analystTargetClaude > 0
    ? { value: row.analystTargetClaude, source: row.targetSource || 'Claude', asOf: row.claudeWritten ? dayKey(row.claudeWritten) : null }
    : null;
  const beatRate = isNum(row?.beatQuarters) && row.beatQuarters > 0 && isNum(row?.beats)
    ? { beats: row.beats, total: row.beatQuarters, stale: !!row.beatStale }
    : (row?.beatStale ? { beats: null, total: null, stale: true } : null);
  return { peerTickers, analystTarget: target, beatRate };
}
