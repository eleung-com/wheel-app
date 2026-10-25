import React, { useCallback, useEffect, useRef, useState } from 'react';
import { runPreliminary, rescoreFinal } from '../../../lib/research/run';
import { researchTransport } from '../../../lib/research/researchTransport';
import { saveRun, loadRuns, loadRun, saveDecision, redoClaude } from '../../../lib/research/runStore';
import { runStamp, claudeState, claudeInputs } from '../../../lib/research/runRecord';
import ResearchResult from './ResearchResult';
import SavedSummary from './SavedSummary';
import { cacheRun, cachedRun } from '../../../lib/research/runCache';
import { fairValueInput } from '../../../lib/research/resultView';
import StockList from '../StocksPage/StockList';
import WatchPanel from './WatchPanel';
import { cleanQuery, searchAction } from '../../../lib/stocksList';

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

// Part 9D (approved 10-25): this is now the Stocks tab — watchlist list +
// search on top; a stock opens its last SAVED run (no re-run); only the search
// box's Research button and "Re-run with fresh data" start a new run.
export default function ResearchPage({
  showToast, openRequest = null, watchlist = [], scores = null, positions = [],
  evals = {}, evalsLoading = false, onSaveNotes, onOverride, onTrade,
  isActive = false, onSyncNotion, onModalOpenChange,
}) {
  // v2.8: the score reads fair value from the watchlist; a ref so callbacks
  // always see the latest rows without re-creating themselves.
  const watchlistRef = useRef(watchlist);
  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);
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
  // Part 9C: a past run opened as saved. fromSaved = full data from this
  // device's cache; summary = only what Notion saved (other device).
  const [fromSaved, setFromSaved] = useState(false);
  const [summary, setSummary] = useState(null); // { row, writeup, loading }
  const [opening, setOpening] = useState(null); // ticker being opened
  const runId = useRef(0);
  const finalizedFor = useRef(null); // `${pageId}|${claudeWritten}` already re-scored

  const refreshRecent = useCallback(() => {
    loadRuns({ limit: 15 })
      .then((rows) => setRecent({ rows, error: null }))
      .catch((e) => setRecent((r) => ({ rows: r.rows, error: String(e.message || e) })));
  }, []);

  useEffect(() => { refreshRecent(); }, [refreshRecent]);

  // Part 9D: another tab (Signals) asked to open a stock here.
  useEffect(() => {
    if (!openRequest?.ticker || status.running) return;
    openTicker(openRequest.ticker);
  }, [openRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-pull Notion whenever the tab is opened (notes / FMV change upstream).
  useEffect(() => { if (isActive) onSyncNotion?.(); }, [isActive, onSyncNotion]);
  // A stock page holds a notes draft — pause background watchlist syncs meanwhile.
  const detailOpen = !!(run || summary);
  useEffect(() => { onModalOpenChange?.(detailOpen); }, [detailOpen, onModalOpenChange]);

  const heldTickers = React.useMemo(() => {
    const s = new Set();
    for (const p of positions || []) if (!p.linkedId) s.add(p.ticker);
    return s;
  }, [positions]);

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
      cacheRun(out.pageId, res); // 9C: open it later without re-running
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
      const final = await rescoreFinal(researchTransport, { ...run, fairValue: run.fairValue ?? fairValueInput(run.ticker, watchlistRef.current) }, claudeInputs(row));
      if (id !== runId.current) return;
      setRun(final);
      const out = await saveRun(final, { pageId: row.pageId });
      cacheRun(row.pageId, final);
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
    setFromSaved(false);
    setSummary(null);
    setError(null);
    setElapsed(0);
    setSave(null);
    setClaude(null);
    setStatus({ running: true, step: 'company', startedAt: Date.now() });
    try {
      const res = await runPreliminary(researchTransport, t, {
        fairValue: fairValueInput(t, watchlistRef.current), // v2.8
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

  // ── Part 9C: open a past run as saved — never re-runs ─────────────────────
  async function openSaved(h, knownHistory = null) {
    const id = ++runId.current;
    finalizedFor.current = null;
    setError(null);
    const cached = cachedRun(h.pageId);
    if (cached) {
      // Full data on this device: the normal result screen, as saved.
      setRun(cached);
      setFromSaved(true);
      setSummary(null);
      setSave({ state: 'saved', pageId: h.pageId, history: knownHistory || [h] });
      setClaude({ row: h, writeup: [] }); // the poll effect loads the write-up once
      if (!knownHistory) loadRuns({ ticker: h.ticker }).then((history) => { if (id === runId.current) setSave((s) => ({ ...s, history })); }).catch(() => {});
      return;
    }
    // Another device's run: show what Notion saved.
    setRun(null);
    setFromSaved(false);
    setSave({ state: 'saved', pageId: h.pageId, history: knownHistory || [h] });
    setSummary({ row: h, writeup: [], loading: true });
    if (!knownHistory) loadRuns({ ticker: h.ticker }).then((history) => { if (id === runId.current) setSave((s) => ({ ...s, history })); }).catch(() => {});
    try {
      const { run: row, writeup } = await loadRun(h.pageId);
      if (id === runId.current) setSummary({ row: { ...h, ...row }, writeup, loading: false });
    } catch {
      if (id === runId.current) setSummary((x) => (x ? { ...x, loading: false } : x));
    }
  }

  // Part 9D: tap a stock → its latest saved run (or "no research yet").
  async function openTicker(raw) {
    const t = cleanQuery(raw);
    if (!t) return;
    const id = ++runId.current;
    setError(null);
    setOpening(t);
    try {
      const rows = await loadRuns({ ticker: t, limit: 10 });
      if (id !== runId.current) return;
      if (rows.length) {
        await openSaved(rows[0], rows);
      } else {
        setRun(null); setFromSaved(false); setSave(null); setClaude(null);
        setSummary({ row: { ticker: t }, none: true, writeup: [], loading: false });
      }
    } catch (e) {
      if (id === runId.current) setError(`Couldn’t open ${t}: ${String(e.message || e).slice(0, 100)}`);
    } finally {
      setOpening((o) => (o === t ? null : o));
    }
  }

  function backToList() {
    runId.current++;
    setRun(null); setSave(null); setClaude(null); setFromSaved(false); setSummary(null);
  }

  async function decide(d) {
    if (!save?.pageId) return false;
    try {
      const row = await saveDecision(save.pageId, d);
      mergeHistoryRow(row);
      setSummary((x) => (x && x.row.pageId === row.pageId ? { ...x, row: { ...x.row, ...row } } : x));
      refreshRecent();
      const pend = row?.diveIn?.pending ? ' — add it in TradingView; Dive-In updates after the sync' : ' — Dive-In updated';
      const tk = run?.ticker || summary?.row?.ticker || '';
      if (d.decision === 'Priority') showToast?.(`${tk} → 🔥 Priority${pend}`, '');
      else if (d.decision === 'Watch') showToast?.(`${tk} → 👀 Watch${pend}`, '');
      else if (d.decision === 'Reject') showToast?.(`${tk} skipped — logged in Notion${row?.diveIn?.applied ? ', Dive-In set to Skip' : ''}`, '');
      else showToast?.('Decision cleared', '');
      return true;
    } catch (e) {
      showToast?.(`Not saved: ${String(e.message || e).slice(0, 80)}`, 'err');
      return false;
    }
  }

  const panelFor = (tk) => {
    const row = watchlist.find((w) => w.ticker === tk) || null;
    return (
      <WatchPanel ticker={tk} row={row} ev={evals[tk]} evalsLoading={evalsLoading}
        onSaveNotes={onSaveNotes} onOverride={onOverride} />
    );
  };

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
        onBack={backToList}
        onRerun={() => start(run.ticker)}
        watchlist={watchlist}
        fromSaved={fromSaved}
        notesPanel={panelFor(run.ticker)}
        onTrade={onTrade}
        onOpenRun={(h, rows) => openSaved(h, rows)}
      />
    );
  }

  if (summary && !status.running) {
    const h = summary.row;
    const canFinish = !summary.none && claudeState(h) === 'done' && h.scoreType !== 'Final';
    return (
      <SavedSummary
        row={h}
        writeup={summary.writeup}
        loading={summary.loading}
        save={save}
        running={status.running}
        onDecide={decide}
        onRerun={() => start(h.ticker)}
        onFinish={canFinish ? () => start(h.ticker, { finishPageId: h.pageId }) : null}
        onBack={backToList}
        none={!!summary.none}
        notesPanel={panelFor(h.ticker)}
        onTrade={onTrade}
        onOpenRun={(x, rows) => openSaved(x, rows)}
      />
    );
  }

  const action = searchAction(ticker, watchlist);
  const busy = status.running || !!opening;
  function submit(e) {
    e.preventDefault();
    if (action === 'open') openTicker(ticker);
    else start(ticker);
  }

  return (
    <div>
      <div className="greet">Stocks</div>
      <div className="greet-sub">Your watchlist, and research on any US stock. Tap a stock to see its saved research.</div>

      <form className="rs-runbox" onSubmit={submit}>
        <input
          className="minput rs-input"
          placeholder="Search your stocks, or type any ticker to research it…"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={10}
          aria-label="Search or research a ticker"
        />
        <button type="submit" className="btn-p rs-run" disabled={busy || !action}>
          {status.running ? <span className="spinner" /> : action === 'open' ? 'Open' : 'Research'}
        </button>
      </form>

      {status.running && (
        <div className="rs-progress" role="status">
          <span className="spinner a" />{STEP_TEXT[status.step] || 'Working…'} <span className="rs-muted">{elapsed}s · usually 10–25s</span>
        </div>
      )}
      {opening && !status.running && <div className="rs-progress" role="status"><span className="spinner a" />Opening {opening}…</div>}
      {error && <div className="rs-error" role="alert">{error}</div>}

      <StockList watchlist={watchlist} scores={scores} query={ticker} heldTickers={heldTickers}
        onOpen={openTicker} onResearch={(t) => start(t)} busy={busy} />

      <details className="stk-recent">
        <summary className="slabel">Recent research · tap to open as saved</summary>
        <div className="rs-hist">
          {recent.rows === null && !recent.error && <div className="rs-muted rs-hist-empty">Loading…</div>}
          {recent.error && !recent.rows && <div className="rs-muted rs-hist-empty">Couldn’t load from Notion: {recent.error}</div>}
          {recent.rows?.length === 0 && <div className="rs-muted rs-hist-empty">No runs yet. Type a ticker above.</div>}
          {(recent.rows || []).map((h) => {
            const tag = rowTag(h);
            const finish = tag === 'Tap for Final'; // opens as saved; Final updates from there
            return (
              <button type="button" key={h.pageId} className="rs-hrow" disabled={busy}
                onClick={() => openSaved(h)}>
                <b>{h.ticker}</b>
                <span className="rs-muted">{runStamp(h.runAt)}</span>
                <span className={`rs-hv ${VERDICT_TONE[h.verdict] || 'n'}`}>{h.investmentScore ?? '—'} · {h.verdict || '—'}</span>
                <span className={`rs-hd${finish ? ' go' : ''}`}>{tag}</span>
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
