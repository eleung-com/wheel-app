import React, { useEffect, useState } from 'react';
import { groupByDiveIn } from '../../../lib/watchlistOrder';
import { evalSnippet } from '../../../lib/evalSummary';
import EvalBody from '../SignalsPage/EvalBody';

// ── Dive-In ───────────────────────────────────────────────────────────────────
// The Notion triage call on each ticker, and the thing the whole tab is ordered
// by: it says whether this name is worth opening today. Priority is what the
// signals engine and the news feed both key on, so it earns the accent colour.

const DIVE_IN_STYLE = {
  '🔥 Priority': { color: 'var(--ac)', bg: 'var(--acd)' },
  '👀 Watch':    { color: 'var(--a)',  bg: 'var(--ad)'  },
  '— Skip':      { color: 'var(--mu)', bg: 'transparent' },
};

// ── Watchlist detail modal ────────────────────────────────────────────────────

function DetailModal({ entry, evaluation, evalsLoading, onClose, onSaveNotes }) {
  const [notes, setNotes] = useState(entry.notes || '');
  const price = entry.liveData?.price;

  function handleClose() {
    if (notes !== (entry.notes || '')) onSaveNotes(entry.ticker, notes);
    onClose();
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 32px)',
        background: 'var(--bg)', borderRadius: 'var(--rr)',
        border: '1px solid var(--b1)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--b1)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--mono)' }}>{entry.ticker}</span>
            {price != null && (
              <span style={{ fontSize: 13, color: 'var(--g)', fontFamily: 'var(--mono)' }}>${Number(price).toFixed(2)}</span>
            )}
          </div>
          <button onClick={handleClose} style={{
            background: 'none', border: 'none', color: 'var(--mu)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '0.6px', fontFamily: 'var(--sans)', marginBottom: 6 }}>
            Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— your own, synced to the Notion Notes field</span>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add notes about this ticker…"
            style={{
              width: '100%', minHeight: 80, fontSize: 13, lineHeight: 1.6,
              background: 'var(--s1)', border: '1px solid var(--b2)',
              borderRadius: 6, padding: '10px 12px', color: 'var(--fg)',
              fontFamily: 'var(--sans)', resize: 'vertical', outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          {/* The written evaluation from the ticker's Notion page body — the same
              content, and the same renderer, the Signals tab uses. Read-only:
              it's authored in Notion by the eval skill, not here. */}
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase',
            letterSpacing: '0.6px', fontFamily: 'var(--sans)', margin: '18px 0 0',
          }}>
            Latest evaluation <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— from Notion</span>
          </div>
          {/* .evl supplies the rule and spacing above the body; the modal's own
              scroller handles height, so no max-height class here. */}
          <div className="evl">
            <EvalBody evaluation={evaluation} loading={evalsLoading} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--b1)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={handleClose} style={{
            padding: '9px 20px', borderRadius: 6, border: 'none',
            background: 'var(--ac)', color: 'var(--ac-tx)', fontSize: 12,
            fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--sans)',
          }}>Save & Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WatchlistPage({ watchlist, isActive, evals = {}, evalsLoading, onSaveNotes, onSyncNotion, onModalOpenChange }) {
  const [modalTicker, setModalTicker] = useState(null);
  const modalEntry = modalTicker ? watchlist.find(w => w.ticker === modalTicker) : null;

  // Notes are edited in Notion as often as they are here, and Notion is
  // otherwise only read once at boot. Re-pull whenever the tab is opened so the
  // cards aren't showing a stale copy of something already rewritten upstream.
  useEffect(() => { if (isActive) onSyncNotion?.(); }, [isActive, onSyncNotion]);

  // A pull mid-edit would swap `entry.notes` under the open textarea and lose
  // the draft, so App pauses background syncing while the modal is up.
  useEffect(() => {
    onModalOpenChange?.(modalTicker != null);
  }, [modalTicker, onModalOpenChange]);

  const groups = groupByDiveIn(watchlist);

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '12px 0' }}>
      {groups.map(({ name, entries }) => {
        const dive = DIVE_IN_STYLE[name];
        return (
          <section key={name} style={{ marginBottom: 18 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid var(--b1)',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: dive ? dive.color : 'var(--mu)',
                textTransform: 'uppercase', letterSpacing: '0.7px', fontFamily: 'var(--sans)',
              }}>{name}</span>
              <span style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>{entries.length}</span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 10,
            }}>
              {entries.map(w => {
                const price = w.liveData?.price;
                const ev    = evals[w.ticker];
                // Your own note wins the preview slot when you've written one —
                // it's the more specific thing. Otherwise the eval's Bottom Line.
                const own     = w.notes?.trim();
                const snippet = own || evalSnippet(ev);
                // `undefined` means still queued or in flight; `null` means the
                // page was read and has no eval written. Only the latter is a
                // real "nothing here".
                const pending = ev === undefined && evalsLoading;

                return (
                  <div
                    key={w.ticker}
                    onClick={() => setModalTicker(w.ticker)}
                    style={{
                      background: 'var(--s1)',
                      border: '1px solid var(--b1)',
                      borderRadius: 'var(--rr)',
                      padding: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      transition: 'border-color .15s',
                    }}
                  >
                    {/* Ticker + price */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--mono)', lineHeight: 1 }}>{w.ticker}</span>
                      {price != null && (
                        <span style={{ fontSize: 11, color: 'var(--g)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>${Number(price).toFixed(2)}</span>
                      )}
                    </div>

                    {/* Eval date — says how current the text below it is */}
                    {ev?.title && !own && (
                      <span style={{
                        fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--mono)',
                        letterSpacing: '.2px',
                      }}>{ev.title}</span>
                    )}

                    {/* Preview: your note, else the eval's Bottom Line */}
                    <div style={{
                      fontSize: 11, color: snippet ? 'var(--mu2)' : 'var(--mu)',
                      fontFamily: 'var(--sans)', lineHeight: 1.4,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                      fontStyle: snippet ? 'normal' : 'italic',
                      marginTop: 'auto',
                    }}>
                      {snippet || (pending ? 'Loading evaluation…' : 'No evaluation in Notion yet')}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {!watchlist.length && (
        <div style={{ padding: '32px 0', color: 'var(--mu)', fontSize: 12, textAlign: 'center' }}>
          No watchlist tickers yet.
        </div>
      )}

      {modalEntry && (
        <DetailModal
          entry={modalEntry}
          evaluation={evals[modalEntry.ticker] || null}
          evalsLoading={evalsLoading}
          onClose={() => setModalTicker(null)}
          onSaveNotes={onSaveNotes}
        />
      )}
    </div>
  );
}
