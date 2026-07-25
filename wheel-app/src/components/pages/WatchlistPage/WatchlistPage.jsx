import React, { useEffect, useRef, useState, useMemo, memo } from 'react';
import {
  useTvEmbed, parseTvEmbed, isAdvancedChart,
  DEFAULT_TV_SRC, DEFAULT_TV_CONFIG,
} from '../../../lib/tvEmbed';

// ── TradingView widgets ───────────────────────────────────────────────────────

function VixWidget() {
  const container = useRef();
  useEffect(() => {
    if (!container.current || container.current.querySelector('script')) return;
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: 'CAPITALCOM:VIX', colorTheme: 'dark',
      isTransparent: true, locale: 'en', width: '100%',
    });
    container.current.appendChild(script);
  }, []);
  return (
    <div className="tradingview-widget-container" ref={container} style={{ width: '100%' }}>
      <div className="tradingview-widget-container__widget" />
    </div>
  );
}

/**
 * @param embed  a parsed Settings → Chart override, or null for the built-in setup.
 *               Either way the selected pill wins on `symbol` — that's what keeps
 *               the pills driving the chart no matter what's been pasted in.
 */
function ChartWidget({ symbol, watchlistSymbols, embed }) {
  const container = useRef();
  useEffect(() => {
    const src = embed?.src    || DEFAULT_TV_SRC;
    const cfg = { ...(embed?.config || DEFAULT_TV_CONFIG), symbol };

    // The side panel only exists on the Advanced Chart, so only that widget gets
    // the watchlist injected — other widgets would just ignore the key anyway.
    if (isAdvancedChart(src)) cfg.watchlist = watchlistSymbols;

    // The chart fills a flex pane. TradingView's copied snippets carry a fixed
    // width/height from whatever size you previewed at, which would leave the
    // widget clipped or floating in the middle of the pane.
    delete cfg.width;
    delete cfg.height;
    cfg.autosize = true;

    const script = document.createElement('script');
    script.src = src;
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify(cfg);
    container.current.appendChild(script);
  }, []);
  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: '100%', width: '100%' }}>
      <div className="tradingview-widget-container__widget" style={{ height: 'calc(100% - 32px)', width: '100%' }} />
      <div className="tradingview-widget-copyright">
        <a href={`https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`} rel="noopener nofollow" target="_blank">
          <span className="blue-text">{symbol} chart</span>
        </a>
        <span className="trademark"> by TradingView</span>
      </div>
    </div>
  );
}

const MemoVix = memo(VixWidget);

// ── Shared UI pieces ──────────────────────────────────────────────────────────

function SubTabNav({ active, onChange }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--b1)', paddingLeft: 12, flexShrink: 0 }}>
      {[['chart', 'Chart'], ['details', 'Watchlist Details']].map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} style={{
          background: 'none', border: 'none',
          borderBottom: active === id ? '2px solid var(--g)' : '2px solid transparent',
          color: active === id ? 'var(--fg)' : 'var(--mu)',
          fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500,
          padding: '8px 14px 9px', cursor: 'pointer',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          whiteSpace: 'nowrap', transition: 'color .15s',
        }}>{label}</button>
      ))}
    </div>
  );
}

function TickerPills({ groups, selected, onSelect }) {
  return (
    <div style={{
      flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center',
      padding: '8px 12px', overflowX: 'auto',
      borderBottom: '1px solid var(--b1)', scrollbarWidth: 'none',
    }}>
      {groups.map(({ name, entries }, gi) => (
        <React.Fragment key={name}>
          <span style={{
            flexShrink: 0, fontSize: 8, fontWeight: 700, color: 'var(--mu)',
            textTransform: 'uppercase', letterSpacing: '0.7px', fontFamily: 'var(--sans)',
            paddingLeft: gi === 0 ? 0 : 8, borderLeft: gi === 0 ? 'none' : '1px solid var(--b1)',
            alignSelf: 'stretch', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
          }}>{name}</span>
          {entries.map(w => {
            const dive = DIVE_IN_STYLE[w.diveIn];
            return (
              <button key={w.ticker} onClick={() => onSelect(w.ticker)} style={{
                flexShrink: 0, padding: '4px 12px', borderRadius: 20,
                border: `1px solid ${selected === w.ticker ? 'var(--g)' : 'var(--b2)'}`,
                background: selected === w.ticker ? '#00ff0022' : 'transparent',
                color: selected === w.ticker ? 'var(--g)' : 'var(--mu)',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono)',
                cursor: 'pointer', letterSpacing: '0.3px', minHeight: 36, transition: 'all .15s',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 1, lineHeight: 1.1,
              }}>
                <span>{w.ticker}</span>
                {/* Dive-In under the symbol. Keeps its own colour when selected —
                    the green border already says which pill is active, so the
                    triage call shouldn't be recoloured by it. */}
                {dive && (
                  <span style={{
                    fontSize: 8, fontWeight: 600, color: dive.color,
                    fontFamily: 'var(--sans)', letterSpacing: '0.2px', whiteSpace: 'nowrap',
                  }}>{w.diveIn}</span>
                )}
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function NotesBar({ ticker, notes, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(notes);
  useEffect(() => { setDraft(notes); setEditing(false); }, [ticker, notes]);
  function commit() { setEditing(false); if (draft !== notes) onSave(ticker, draft); }
  return (
    <div style={{
      flexShrink: 0, padding: '8px 12px',
      borderBottom: '1px solid var(--b1)',
      display: 'flex', alignItems: 'flex-start', gap: 8, minHeight: 40,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, color: 'var(--mu)',
        textTransform: 'uppercase', letterSpacing: '0.6px',
        fontFamily: 'var(--sans)', marginTop: 3, flexShrink: 0,
      }}>{ticker}</span>
      {editing ? (
        <textarea autoFocus value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Escape') { setDraft(notes); setEditing(false); } }}
          placeholder="Add notes…"
          style={{
            flex: 1, fontSize: 12, lineHeight: 1.5,
            background: 'var(--s1)', border: '1px solid var(--b2)',
            borderRadius: 6, padding: '4px 8px', color: 'var(--fg)',
            fontFamily: 'var(--sans)', resize: 'none', outline: 'none', minHeight: 52,
          }}
        />
      ) : (
        <span onClick={() => setEditing(true)} style={{
          flex: 1, fontSize: 12, fontFamily: 'var(--sans)', lineHeight: 1.5, cursor: 'text',
          color: notes ? 'var(--fg)' : 'var(--mu)', fontStyle: notes ? 'normal' : 'italic',
        }}>{notes || 'Tap to add notes…'}</span>
      )}
    </div>
  );
}

// ── Category dropdown ─────────────────────────────────────────────────────────

function CategorySelect({ value, categories, onChange, onAddCategory, style = {} }) {
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState('');

  function handleChange(e) {
    if (e.target.value === '__add__') { setAdding(true); return; }
    onChange(e.target.value);
  }

  function commitNew() {
    const trimmed = newCat.trim();
    if (trimmed) { onAddCategory(trimmed); onChange(trimmed); }
    setAdding(false);
    setNewCat('');
  }

  if (adding) {
    return (
      <div style={{ display: 'flex', gap: 6, ...style }}>
        <input
          autoFocus
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitNew(); if (e.key === 'Escape') { setAdding(false); setNewCat(''); } }}
          placeholder="New category name"
          style={{
            flex: 1, fontSize: 11, padding: '4px 8px',
            background: 'var(--s1)', border: '1px solid var(--b2)',
            borderRadius: 6, color: 'var(--fg)', fontFamily: 'var(--sans)', outline: 'none',
          }}
        />
        <button onClick={commitNew} style={{
          padding: '4px 10px', borderRadius: 6, border: 'none',
          background: 'var(--ac)', color: 'var(--ac-tx)', fontSize: 11,
          fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--sans)',
        }}>Add</button>
        <button onClick={() => { setAdding(false); setNewCat(''); }} style={{
          padding: '4px 10px', borderRadius: 6,
          border: '1px solid var(--b2)', background: 'transparent',
          color: 'var(--mu)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--sans)',
        }}>✕</button>
      </div>
    );
  }

  return (
    <select value={value || ''} onChange={handleChange} style={{
      fontSize: 11, padding: '5px 8px',
      background: 'var(--s1)', border: '1px solid var(--b2)',
      borderRadius: 6, color: value ? 'var(--fg)' : 'var(--mu)',
      fontFamily: 'var(--sans)', cursor: 'pointer', outline: 'none',
      ...style,
    }}>
      <option value="">— Uncategorized —</option>
      {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
      <option value="__add__">+ Add category…</option>
    </select>
  );
}

// ── Watchlist detail modal ────────────────────────────────────────────────────

function DetailModal({ entry, categories, onClose, onSaveNotes, onSaveCategory, onAddCategory }) {
  const [notes,    setNotes]    = useState(entry.notes || '');
  const [category, setCategory] = useState(entry.category || '');
  const price = entry.liveData?.price;

  function handleClose() {
    if (notes    !== (entry.notes    || '')) onSaveNotes(entry.ticker, notes);
    if (category !== (entry.category || '')) onSaveCategory(entry.ticker, category);
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
        width: '100%', maxWidth: 480,
        background: 'var(--bg)', borderRadius: 'var(--rr)',
        border: '1px solid var(--b1)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--b1)',
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
        <div style={{ padding: '14px 16px' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '0.6px', fontFamily: 'var(--sans)', marginBottom: 6 }}>Category</div>
            <CategorySelect
              value={category}
              categories={categories}
              onChange={setCategory}
              onAddCategory={onAddCategory}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '0.6px', fontFamily: 'var(--sans)', marginBottom: 6 }}>Notes</div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this ticker…"
              style={{
                width: '100%', minHeight: 140, fontSize: 13, lineHeight: 1.6,
                background: 'var(--s1)', border: '1px solid var(--b2)',
                borderRadius: 6, padding: '10px 12px', color: 'var(--fg)',
                fontFamily: 'var(--sans)', resize: 'vertical', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--b1)', display: 'flex', justifyContent: 'flex-end' }}>
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

// ── Sector grouping ───────────────────────────────────────────────────────────
// Sector is the Notion select on each ticker page. Rows that haven't been given
// one collect at the bottom rather than disappearing.

export const UNCLASSIFIED = 'Unclassified';

/** watchlist → [{ name, entries }], biggest sector first, Unclassified last. */
function groupBySector(watchlist) {
  const byName = new Map();
  for (const w of watchlist) {
    const name = w.sector || UNCLASSIFIED;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(w);
  }
  return [...byName.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => {
      if (a.name === UNCLASSIFIED) return 1;
      if (b.name === UNCLASSIFIED) return -1;
      return b.entries.length - a.entries.length || a.name.localeCompare(b.name);
    });
}

// ── Dive-In ───────────────────────────────────────────────────────────────────
// The Notion triage call on each ticker, and the one thing worth showing on a
// card: it says whether this name is worth opening today. Priority is what the
// signals engine and the news feed both key on, so it earns the accent colour.

const DIVE_IN_STYLE = {
  '🔥 Priority': { color: 'var(--ac)', bg: 'var(--acd)' },
  '👀 Watch':    { color: 'var(--a)',  bg: 'var(--ad)'  },
  '— Skip':      { color: 'var(--mu)', bg: 'transparent' },
};

// ── Details subtab ────────────────────────────────────────────────────────────

function DetailsTab({ watchlist, categories, onSaveNotes, onSaveCategory, onAddCategory }) {
  const [modalTicker, setModalTicker] = useState(null);
  const modalEntry = modalTicker ? watchlist.find(w => w.ticker === modalTicker) : null;

  const groups = groupBySector(watchlist);

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '12px' }}>
      {groups.map(({ name, entries }) => (
        <section key={name} style={{ marginBottom: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 8, paddingBottom: 5, borderBottom: '1px solid var(--b1)',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: name === UNCLASSIFIED ? 'var(--mu)' : 'var(--fg)',
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
              const price   = w.liveData?.price;
              const dive    = DIVE_IN_STYLE[w.diveIn];
              const summary = w.notes?.trim();

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

                  {/* Dive-In pill */}
                  {dive ? (
                    <span style={{
                      alignSelf: 'flex-start',
                      fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                      background: dive.bg, color: dive.color, letterSpacing: '0.3px',
                      fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
                    }}>{w.diveIn}</span>
                  ) : (
                    <span style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--sans)', fontStyle: 'italic' }}>No dive-in set</span>
                  )}

                  {/* Notes summary */}
                  <div style={{
                    fontSize: 11, color: summary ? 'var(--mu2)' : 'var(--mu)',
                    fontFamily: 'var(--sans)', lineHeight: 1.4,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    fontStyle: summary ? 'normal' : 'italic',
                    marginTop: 'auto',
                  }}>
                    {summary || 'No notes'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!watchlist.length && (
        <div style={{ padding: '32px 0', color: 'var(--mu)', fontSize: 12, textAlign: 'center' }}>
          No watchlist tickers yet.
        </div>
      )}

      {modalEntry && (
        <DetailModal
          entry={modalEntry}
          categories={categories}
          onClose={() => setModalTicker(null)}
          onSaveNotes={onSaveNotes}
          onSaveCategory={onSaveCategory}
          onAddCategory={onAddCategory}
        />
      )}
    </div>
  );
}

// ── Chart subtab ──────────────────────────────────────────────────────────────

function ChartTab({ watchlist, onSaveNotes }) {
  const groups = groupBySector(watchlist);
  // TradingView's own watchlist panel takes a flat list, so hand it the tickers
  // in the same sector order the pills above are in.
  const symbols = groups.flatMap(g => g.entries.map(w => w.ticker));
  const [selected, setSelected] = useState(() => symbols[0] || 'SPY');
  const entry = watchlist.find(w => w.ticker === selected);
  const notes = entry?.notes ?? '';

  // Settings → Chart. A paste that doesn't parse falls back to the built-in
  // setup rather than blanking the chart; Settings is where the error is shown.
  const rawEmbed = useTvEmbed();
  const embed = useMemo(() => {
    if (!rawEmbed.trim()) return null;
    const r = parseTvEmbed(rawEmbed);
    return r.ok ? r : null;
  }, [rawEmbed]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TickerPills groups={groups} selected={selected} onSelect={setSelected} />
      <NotesBar ticker={selected} notes={notes} onSave={onSaveNotes} />
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--b1)' }}>
        <MemoVix />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* Remount on either input: TradingView bakes its settings in at load
            time, so a new pill or a newly pasted embed both need a fresh widget. */}
        <ChartWidget
          key={`${selected}|${rawEmbed}`}
          symbol={selected}
          watchlistSymbols={symbols}
          embed={embed}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WatchlistPage({ watchlist, categories = [], onSaveNotes, onSaveCategory, onSaveCategories }) {
  const [subtab, setSubtab] = useState('chart');

  function handleAddCategory(cat) {
    if (!categories.includes(cat)) onSaveCategories([...categories, cat]);
  }

  return (
    <div style={{
      margin: '-12px -12px 0', width: 'calc(100% + 24px)',
      height: 'calc(100vh - 93px)', display: 'flex', flexDirection: 'column',
    }}>
      <SubTabNav active={subtab} onChange={setSubtab} />

      {subtab === 'chart' && (
        <ChartTab watchlist={watchlist} onSaveNotes={onSaveNotes} />
      )}
      {subtab === 'details' && (
        <DetailsTab
          watchlist={watchlist}
          categories={categories}
          onSaveNotes={onSaveNotes}
          onSaveCategory={onSaveCategory}
          onAddCategory={handleAddCategory}
        />
      )}
    </div>
  );
}
