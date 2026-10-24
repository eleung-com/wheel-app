import React, { useRef, useState } from 'react';
import { runDryRun } from '../../../lib/research/dryRun';
import { loadRuns } from '../../../lib/research/runStore';
import { researchTransport } from '../../../lib/research/researchTransport';
import { NO_EARNINGS } from '../../../lib/signalEngine';

// Part 8C: preview the Value change (v2.7 → v2.8) on the whole watchlist.
// Re-scores in memory only — nothing is saved, Dive-In and Signals don't change.
const TONE = { 'Worth investing': 'var(--g)', Maybe: 'var(--a)', 'Not worth it': 'var(--r)' };

export default function ScoringPreview({ watchlist }) {
  const [rows, setRows] = useState([]);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState(null);
  const stop = useRef(false);

  async function start() {
    stop.current = false; setRows([]); setErr(null); setProg({ i: 0, n: 0, t: null });
    let runs = [];
    try { runs = await loadRuns({ limit: 50 }); } catch (e) { setErr(`Couldn’t load your saved runs: ${e.message}`); setProg(null); return; }
    await runDryRun({
      transport: researchTransport, watchlist, runs, isIndex: (t) => NO_EARNINGS.has(t),
      onRow: (r) => setRows((rs) => [...rs, r]),
      onProgress: (i, n, t) => setProg({ i, n, t }),
      shouldStop: () => stop.current,
    });
  }

  const running = prog && prog.t;
  const flips = rows.filter((r) => r.flip).length;
  const sorted = [...rows].sort((a, b) => (b.flip - a.flip) || ((b.newScore ?? -1) - (b.oldScore ?? -1)) - ((a.newScore ?? -1) - (a.oldScore ?? -1)));

  return (
    <div className="sp">
      <div className="slabel">Value change preview · v2.7 → v2.8</div>
      <p className="sp-p">
        Re-scores every watchlist stock that has a score, twice from the same fresh data: the current rule (own 5-year P/E)
        and the new one (price vs fair value). <b>Nothing is saved</b>, and Dive-In, Signals and alerts stay as they are.
        Takes about 10–20 seconds per stock.
      </p>
      <div className="sp-acts">
        {!running
          ? <button type="button" className="btn-p" onClick={start}>{rows.length ? 'Run again' : 'Run the comparison'}</button>
          : <button type="button" className="btn-s" onClick={() => { stop.current = true; }}>Stop</button>}
        {prog && <span className="sp-prog">{running ? `${prog.i + 1} of ${prog.n} · ${prog.t}…` : `Done · ${rows.length} stocks · ${flips} verdict change${flips === 1 ? '' : 's'}`}</span>}
      </div>
      {err && <div className="sp-err">{err}</div>}
      {rows.length > 0 && (
        <div className="sp-tbl">
          <table>
            <thead><tr><th>Ticker</th><th className="num">Value</th><th className="num">Score</th><th>Verdict</th><th className="sp-fv">Fair value</th></tr></thead>
            <tbody>
              {sorted.map((r) => r.error ? (
                <tr key={r.ticker}><td>{r.ticker}</td><td colSpan={4} className="sp-muted">Couldn’t run: {r.error}</td></tr>
              ) : (
                <tr key={r.ticker} className={r.flip ? 'flip' : ''}>
                  <td><b>{r.ticker}</b></td>
                  <td className="num">{r.oldValue ?? '—'} → <b>{r.newValue ?? '—'}</b></td>
                  <td className="num">{r.oldScore ?? '—'} → <b>{r.newScore ?? '—'}</b></td>
                  <td>
                    <span style={{ color: TONE[r.oldVerdict] || 'var(--mu)' }}>{r.oldVerdict}</span>
                    {r.flip && <> → <b style={{ color: TONE[r.newVerdict] || 'var(--mu)' }}>{r.newVerdict}</b></>}
                  </td>
                  <td className="sp-fv sp-muted">{r.fmvNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
