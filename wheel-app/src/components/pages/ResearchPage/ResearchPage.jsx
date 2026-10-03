import React, { useCallback, useEffect, useRef, useState } from 'react';
import { runPreliminary } from '../../../lib/research/run';
import { researchTransport } from '../../../lib/research/researchTransport';
import { saveRun, loadRuns, saveDecision } from '../../../lib/research/runStore';
import { runStamp } from '../../../lib/research/runRecord';
import ResearchResult from './ResearchResult';

// Research tab — "Run a stock" (PRD §6A-BUILD, P1.4 + P1.5).
// Type a ticker → the app pulls SEC / Yahoo / FMP / Finnhub through the Worker
// relay, scores it with auto-peers (Preliminary) and shows the result. Every
// run is saved to Notion "Stock Runs" (same New York day = same row); history,
// Watch / Reject and the rejected-before banner read from there.
// Claude write-up + Final: P1.6.

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const STEP_TEXT = {
  company: 'Reading SEC filings and prices…',
  peers: 'Checking peers…',
  scoring: 'Scoring…',
};
const VERDICT_TONE = { 'Worth investing': 'g', Maybe: 'a', 'Not worth it': 'r' };

export default function ResearchPage({ showToast }) {
  const [ticker, setTicker] = useState('');
  const [status, setStatus] = useState({ running: false, step: null, startedAt: null });
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  // save: { state: 'saving' | 'saved' | 'error', pageId, history, error }
  const [save, setSave] = useState(null);
  const [recent, setRecent] = useState({ rows: null, error: null });
  const runId = useRef(0);

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

  async function persist(res, id) {
    setSave({ state: 'saving' });
    try {
      const out = await saveRun(res);
      if (id !== runId.current) return;
      setSave({ state: 'saved', pageId: out.pageId, history: out.history });
      refreshRecent();
    } catch (e) {
      if (id !== runId.current) return;
      setSave({ state: 'error', error: String(e.message || e).slice(0, 140) });
    }
  }

  async function start(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (!TICKER_RE.test(t)) { setError('Enter a US ticker, e.g. UBER'); return; }
    const id = ++runId.current;
    setError(null);
    setElapsed(0);
    setSave(null);
    setStatus({ running: true, step: 'company', startedAt: Date.now() });
    try {
      const res = await runPreliminary(researchTransport, t, {
        onStep: (step) => { if (id === runId.current) setStatus((s) => ({ ...s, step })); },
      });
      if (id !== runId.current) return; // a newer run started
      setRun(res);
      if (!res.result) showToast?.(`${t}: no score — see why below`, 'err');
      persist(res, id);
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
      setSave((s) => (s?.pageId === row.pageId
        ? { ...s, history: (s.history || []).map((h) => (h.pageId === row.pageId ? { ...h, ...row } : h)) }
        : s));
      refreshRecent();
      if (d.decision === 'Watch') showToast?.(`Watching ${run.ticker} — add it in TradingView`, '');
      else if (d.decision === 'Reject') showToast?.(`${run.ticker} rejected — logged in Notion`, '');
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
        onRetrySave={() => persist(run, runId.current)}
        onDecide={decide}
        onBack={() => { setRun(null); setSave(null); }}
        onRerun={() => start(run.ticker)}
      />
    );
  }

  return (
    <div>
      <div className="greet">Research</div>
      <div className="greet-sub">Score any US stock. Claude adds the story in a later update.</div>

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
        {(recent.rows || []).map((h) => (
          <button type="button" key={h.pageId} className="rs-hrow" onClick={() => start(h.ticker)} disabled={status.running}>
            <b>{h.ticker}</b>
            <span className="rs-muted">{runStamp(h.runAt)}</span>
            <span className={`rs-hv ${VERDICT_TONE[h.verdict] || 'n'}`}>{h.investmentScore ?? '—'} · {h.verdict || '—'}</span>
            <span className="rs-hd">{h.decision === 'Watch' ? 'Watch' : h.decision === 'Reject' ? 'Rejected' : h.scoreType === 'Final' ? 'Final' : 'Prelim'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
