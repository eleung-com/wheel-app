import React, { useEffect, useRef, useState } from 'react';
import { runPreliminary } from '../../../lib/research/run';
import { researchTransport } from '../../../lib/research/researchTransport';
import ResearchResult from './ResearchResult';

// Research tab — "Run a stock" (PRD §6A-BUILD, P1.4).
// Type a ticker → the app pulls SEC / Yahoo / FMP / Finnhub through the Worker
// relay, scores it with auto-peers (Preliminary) and shows the result.
// Saving runs, history, Watch/Reject: P1.5. Claude write-up + Final: P1.6.

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const STEP_TEXT = {
  company: 'Reading SEC filings and prices…',
  peers: 'Checking peers…',
  scoring: 'Scoring…',
};

export default function ResearchPage({ showToast }) {
  const [ticker, setTicker] = useState('');
  const [status, setStatus] = useState({ running: false, step: null, startedAt: null });
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const runId = useRef(0);

  useEffect(() => {
    if (!status.running) return undefined;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - status.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [status.running, status.startedAt]);

  async function start(raw) {
    const t = String(raw || '').trim().toUpperCase();
    if (!TICKER_RE.test(t)) { setError('Enter a US ticker, e.g. UBER'); return; }
    const id = ++runId.current;
    setError(null);
    setElapsed(0);
    setStatus({ running: true, step: 'company', startedAt: Date.now() });
    try {
      const res = await runPreliminary(researchTransport, t, {
        onStep: (step) => { if (id === runId.current) setStatus((s) => ({ ...s, step })); },
      });
      if (id !== runId.current) return; // a newer run started
      setRun(res);
      if (!res.result) showToast?.(`${t}: no score — see why below`, 'err');
    } catch (e) {
      if (id !== runId.current) return;
      setError(`Run failed: ${String(e?.message || e).slice(0, 120)}`);
    } finally {
      if (id === runId.current) setStatus({ running: false, step: null, startedAt: null });
    }
  }

  if (run && !status.running) {
    return (
      <ResearchResult
        run={run}
        running={status.running}
        onBack={() => setRun(null)}
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

      <div className="slabel">Recent runs</div>
      <div className="rs-claude rs-muted">Run history and your reject log arrive in the next update.</div>
    </div>
  );
}
