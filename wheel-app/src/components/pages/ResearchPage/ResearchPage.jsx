import React, { useCallback, useEffect, useRef, useState } from 'react';
import { runPreliminary, rescoreFinal } from '../../../lib/research/run';
import { researchTransport } from '../../../lib/research/researchTransport';
import { saveRun, loadRuns, loadRun, saveDecision, redoClaude } from '../../../lib/research/runStore';
import { runStamp, claudeState, claudeInputs } from '../../../lib/research/runRecord';
import ResearchResult from './ResearchResult';

// Research tab — "Run a stock" (PRD §6A-BUILD, P1.4–P1.6).
// Type a ticker → the app pulls SEC / Yahoo / FMP / Finnhub through the Worker
// relay, scores it with auto-peers (Preliminary) and shows the result. Every
// run is saved to Notion "Stock Runs" (same New York day = same row); the
// Worker then starts the Claude routine. While the result is open the app
// checks the row every 20 s; once Claude has written, the app re-scores with
// Claude's peers / target / beat rate and saves it as Final (P1.6).

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const POLL_MS = 20000;
const STEP_TEXT = {
  company: 'Reading SEC filings and prices…',
  peers: 'Checking peers…',
  scoring: 'Scoring…',
  final: 'Re-scoring with Claude’s peers…',
};
const VERDICT_TONE = { 'Worth investing': 'g', Maybe: 'a', 'Not worth it': 'r' };

/** Recent-runs label: decision first, then where Claude / the score stands. */
function rowTag(h) {
  if (h.decision === 'Priority') return 'Priority';
  if (h.decision === 'Watch') return 'Watch';
  if (h.decision === 'Reject') return 'Skipped';
  if (h.scoreType === 'Final') return 'Final';
  const cs = claudeState(h);
  if (cs === 'done') return 'Tap for Final';
  if (cs === 'waiting') return 'Claude…';
  return 'Prelim';
}

export default function ResearchPage({ showToast }) {
  const [ticker, setTicker] = useState('');
  const [status, setStatus] = useState({ running: false, step: null, startedAt: null });
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  // save: { state: 'saving' | 'saved' | 'error', pageId, history, error }
  const [save, setSave] = useState(null);
  // claude: { row, writeup } for the run on screen
  const [claude, setClaude] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [recent, setRecent] = useState({ rows: null, error: null });
  const runId = useRef(0);
  const finalizedFor = useRef(null); // `${pageId}|${claudeWritten}` already re-scored

  const refreshRecent = useCallback(() => {
    loadRuns({ limit: 15 })
      .then((rows) => setRecent({ rows, error: null }))
      .catch((e) => setRecent((r) => ({ rows: r.rows, error: String(e.message || e) })));
  }, []);

  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  useEffect(() => {
    if (!status.running) return undefined;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - status.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [status.running, status.startedAt]);

  const mergeHistoryRow = useCallback((row) => {
    setSave((s) => (s?.pageId === row.pageId
      ? { ...s, history: (s.history || []).map((h) => (h.pageId === row.pageId ? { ...h, ...row } : h)) }
      : s));
  }, []);

  async function persist(res, id) {
    setSave({ state: 'saving' });
    try {
      const out = await saveRun(res);
      if (id !== runId.current) return;
      setSave({ state: 'saved', pageId: out.pageId, history: out.history });
      setClaude({ row: out.history.find((h) => h.pageId === out.pageId) || null, writeup: [] });
      refreshRecent();
    } catch (e) {
      if (id !== runId.current) return;
      setSave({ state: 'error', error: String(e.message || e).slice(0, 140) });
    }
  }

  // ── Claude: poll while waiting; re-score to Final once it has written ──────
  const cState = claudeState(claude?.row);
  const pageId = save?.state === 'saved' ? save.pageId : null;

  const finalize = useCallback(async (row, id) => {
    const key = `${row.pageId}|${row.claudeWritten}`;
    if (finalizedFor.current === key) return;
    finalizedFor.current = key;
    if (!run?.result) return; // no-score run: show the write-up, nothing to re-score
    setFinalizing(true);
    try {
      const final = await rescoreFinal(researchTransport, run, claudeInputs(row));
      if (id !== runId.current) return;
      setRun(final);
      const out = await saveRun(final, { pageId: row.pageId });
      if (id !== runId.current) return;
      setSave((s) => ({ ...s, history: out.history }));
      setClaude((c) => ({ ...c, row: { ...c.row, status: 'Final', scoreType: 'Final' } }));
      refreshRecent();
      showToast?.(`${run.ticker}: Final score ${final.result.investmentScore ?? '—'} · ${final.result.verdict}`, '');
    } catch (e) {
      finalizedFor.current = null; // let the next poll try again
      if (id === runId.current) showToast?.(`Final re-score failed: ${String(e.message || e).slice(0, 80)}`, 'err');
    } finally {
      if (id === runId.current) setFinalizing(false);
    }
  }, [run, refreshRecent, showToast]);

  useEffect(() => {
    if (!pageId || !run) return undefined;
    if (cState !== 'waiting' && cState !== 'done') return undefined;
    const id = runId.current;
    let stop = false;
    async function tick() {
      try {
        const { run: row, writeup } = await loadRun(pageId);
        if (stop || id !== runId.current) return;
        setClaude({ row, writeup });
        mergeHistoryRow(row);
        if (claudeState(row) === 'done' && row.status !== 'Final') finalize(row, id);
      } catch { /* keep polling; a blip shouldn't end the wait */ }
    }
    // Done already (re-run reusing today's research): one read for the write-up.
    if (cState === 'done') {
      if (!claude?.writeup?.length || claude.row.status !== 'Final') tick();
      return () => { stop = true; };
    }
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
    // claude.writeup intentionally not a dependency: it's the result of tick().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, cState, run?.ticker, finalize, mergeHistoryRow]);

  async function redo() {
    if (!pageId) return;
    try {
      const out = await redoClaude(pageId);
      finalizedFor.current = null;
      setClaude({ row: out.run, writeup: [] });
      mergeHistoryRow(out.run);
      showToast?.(out.claude.fired ? 'Claude started — usually 3–10 min' : `Claude didn’t start: ${out.claude.error}`, out.claude.fired ? '' : 'err');
    } catch (e) {
      showToast?.(`Couldn’t start Claude: ${String(e.message || e).slice(0, 80)}`, 'err');
    }
  }

  // ── Runs ───────────────────────────────────────────────────────────────────
  async function start(raw, { finishPageId = null } = {}) {
    const t = String(raw || '').trim().toUpperCase();
    if (!TICKER_RE.test(t)) { setError('Enter a US ticker, e.g. UBER'); return; }
    const id = ++runId.current;
    finalizedFor.current = null;
    setError(null);
    setElapsed(0);
    setSave(null);
    setClaude(null);
    setStatus({ running: true, step: 'company', startedAt: Date.now() });
    try {
      const res = await runPreliminary(researchTransport, t, {
        onStep: (step) => { if (id === runId.current) setStatus((s) => ({ ...s, step })); },
      });
      if (id !== runId.current) return; // a newer run started
      setRun(res);
      if (!res.result) showToast?.(`${t}: no score — see why below`, 'err');
      if (finishPageId) {
        // Finishing an earlier run whose Claude research is in: no new row, no
        // new Claude run — the poll effect re-scores onto that row.
        const history = await loadRuns({ ticker: t });
        if (id !== runId.current) return;
        setSave({ state: 'saved', pageId: finishPageId, history });
        setClaude({ row: history.find((h) => h.pageId === finishPageId) || null, writeup: [] });
      } else {
        persist(res, id);
      }
    } catch (e) {
      if (id !== runId.current) return;
      setError(`Run failed: ${String(e?.message || e).slice(0, 120)}`);
    } finally {
      if (id === runId.current) setStatus({ running: false, step: null, startedAt: null });
    }
  }

  async function decide(d) {
    if (!save?.pageId) return false;
    try {
      const row = await saveDecision(save.pageId, d);
      mergeHistoryRow(row);
      refreshRecent();
      const pend = row?.diveIn?.pending ? ' — add it in TradingView; Dive-In updates after the sync' : ' — Dive-In updated';
      if (d.decision === 'Priority') showToast?.(`${run.ticker} → 🔥 Priority${pend}`, '');
      else if (d.decision === 'Watch') showToast?.(`${run.ticker} → 👀 Watch${pend}`, '');
      else if (d.decision === 'Reject') showToast?.(`${run.ticker} skipped — logged in Notion${row?.diveIn?.applied ? ', Dive-In set to Skip' : ''}`, '');
      else showToast?.('Decision cleared', '');
      return true;
    } catch (e) {
      showToast?.(`Not saved: ${String(e.message || e).slice(0, 80)}`, 'err');
      return false;
    }
  }

  if (run && !status.running) {
    return (
      <ResearchResult
        run={run}
        running={status.running}
        save={save}
        claude={claude}
        finalizing={finalizing}
        onRedoClaude={redo}
        onRetrySave={() => persist(run, runId.current)}
        onDecide={decide}
        onBack={() => { runId.current++; setRun(null); setSave(null); setClaude(null); }}
        onRerun={() => start(run.ticker)}
      />
    );
  }

  return (
    <div>
      <div className="greet">Research</div>
      <div className="greet-sub">Score any US stock. Claude adds peers and the story in a few minutes.</div>

      <form className="rs-runbox" onSubmit={(e) => { e.preventDefault(); start(ticker); }}>
        <input
          className="minput rs-input"
          placeholder="Ticker, e.g. UBER"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={10}
          disabled={status.running}
          aria-label="Ticker"
        />
        <button type="submit" className="btn-p rs-run" disabled={status.running || !ticker.trim()}>
          {status.running ? <span className="spinner" /> : 'Run'}
        </button>
      </form>

      {status.running && (
        <div className="rs-progress" role="status">
          <span className="spinner a" />{STEP_TEXT[status.step] || 'Working…'} <span className="rs-muted">{elapsed}s · usually 10–25s</span>
        </div>
      )}
      {error && <div className="rs-error" role="alert">{error}</div>}

      <div className="slabel">Recent runs · tap to run again</div>
      <div className="rs-hist">
        {recent.rows === null && !recent.error && <div className="rs-muted rs-hist-empty">Loading…</div>}
        {recent.error && !recent.rows && <div className="rs-muted rs-hist-empty">Couldn’t load from Notion: {recent.error}</div>}
        {recent.rows?.length === 0 && <div className="rs-muted rs-hist-empty">No runs yet. Type a ticker above.</div>}
        {(recent.rows || []).map((h) => {
          const tag = rowTag(h);
          const finish = tag === 'Tap for Final';
          return (
            <button type="button" key={h.pageId} className="rs-hrow" disabled={status.running}
              onClick={() => start(h.ticker, finish ? { finishPageId: h.pageId } : {})}>
              <b>{h.ticker}</b>
              <span className="rs-muted">{runStamp(h.runAt)}</span>
              <span className={`rs-hv ${VERDICT_TONE[h.verdict] || 'n'}`}>{h.investmentScore ?? '—'} · {h.verdict || '—'}</span>
              <span className={`rs-hd${finish ? ' go' : ''}`}>{tag}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
