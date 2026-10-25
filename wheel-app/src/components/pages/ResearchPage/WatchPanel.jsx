import React, { useEffect, useState } from 'react';
import { evalSnippet } from '../../../lib/evalSummary';
import { DIVE } from '../../../lib/fairValue';

// Part 9D: the watchlist pieces on a stock page — my notes (saved to Notion),
// the Dive-In override and Notion's evaluation text.
export default function WatchPanel({ ticker, row, ev, evalsLoading, onSaveNotes, onOverride }) {
  const [notes, setNotes] = useState(row?.notes || '');
  // Reset only when the stock changes, so a background sync can't wipe a draft.
  useEffect(() => { setNotes(row?.notes || ''); }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) {
    return (
      <section className="rs2-card">
        <div className="rs2-h">Watchlist</div>
        <div className="rs-muted">Not on your watchlist — add {ticker} in TradingView to follow it here (notes, Dive-In and fair value come with it).</div>
      </section>
    );
  }
  const snippet = evalSnippet(ev);
  return (
    <section className="rs2-card">
      <div className="rs2-h">Watchlist</div>
      <div className="stk-dive">
        <span>Dive-In: <b>{row.diveIn || '—'}</b>{row.override ? ' · your call' : ' · automatic'}</span>
        <div className="wl-ovr" role="group" aria-label="Override Dive-In">
          {[DIVE.PRIORITY, DIVE.WATCH, DIVE.SKIP].map((d) => (
            <button type="button" key={d} className={row.override === d ? 'on' : ''} onClick={() => onOverride(ticker, d)}>{d}</button>
          ))}
          <button type="button" disabled={!row.override} onClick={() => onOverride(ticker, null)}>Automatic</button>
        </div>
      </div>
      <label className="wl-notes-l" htmlFor={`stk-notes-${ticker}`}>My notes</label>
      <textarea
        id={`stk-notes-${ticker}`}
        className="wl-notes"
        value={notes}
        placeholder="Add a note (saved to Notion)…"
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => { if (notes !== (row.notes || '')) onSaveNotes(ticker, notes); }}
      />
      <div className="wl-notes-l">Notion evaluation</div>
      <div className="wl-eval">{snippet || (ev === undefined && evalsLoading ? 'Loading evaluation…' : 'No evaluation in Notion yet')}</div>
    </section>
  );
}
