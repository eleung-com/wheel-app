import React, { useEffect, useMemo, useState } from 'react';
import { evalSnippet } from '../../../lib/evalSummary';
import { NO_EARNINGS } from '../../../lib/signalEngine';
import { watchlistGroup, wlSortKey, fmvOf, fmvStale, DIVE } from '../../../lib/fairValue';
import { moveNoteFor } from '../../../lib/homeFeed';

// Part 3W (PRD claude/wheel-app-prd-part3w-watchlist-redesign): what to watch
// and why. Sections follow the LIVE price vs fair value (FMV Mid), with the
// same rule the daily Worker job uses for Dive-In (src/lib/fairValue.js).

const GROUPS = {
  ready: { name: 'Ready · Priority',          what: 'Good company, price at or under fair value. The Signals tab looks for trades here.' },
  close: { name: 'Close · Watch',             what: 'Good company, price within 10% of fair. Could turn Priority soon.' },
  wait:  { name: 'Waiting on price · Watch',  what: 'Good company, but more than 10% over fair. Nothing to do yet.' },
  todo:  { name: 'Needs a step',              what: 'Missing a score or a fair value, so it can’t be sorted yet.' },
  skip:  { name: 'Skip',                      what: 'App score says “Not worth it”.' },
  idx:   { name: 'Indexes',                   what: 'No score or fair value. LEAPS on XSP live in Signals.' },
};
const CHIPS = [['all', 'All'], ['ready', 'Ready'], ['close', 'Close'], ['wait', 'Waiting'], ['todo', 'Needs a step'], ['skip', 'Skip']];
const FOLDED = new Set(['skip', 'idx']);

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysTo = (iso, today) => Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
const money = (n) => (n == null ? '—' : n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${Number(n).toFixed(2)}`);
const mmdd = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');
const verdictTone = (v) => (v === 'Worth investing' ? 'g' : v === 'Maybe' ? 'a' : v ? 'r' : 'n');
const verdictShort = (v) => (v === 'Worth investing' ? 'Worth' : v || 'Unscored');

function FairBar({ fmv, price }) {
  const lowEnd = fmv.low ?? fmv.mid * 0.85;
  const highEnd = fmv.high ?? fmv.mid * 1.3;
  const lo = Math.min(lowEnd * 0.9, (price || lowEnd) * 0.97);
  const hi = Math.max(highEnd, (price || highEnd) * 1.03);
  const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const a = pos(lowEnd), m = pos(fmv.mid), f = pos(fmv.mid * 1.1);
  return (
    <>
      <div className="wl-bar" aria-hidden="true">
        <div className="wl-track">
          <span style={{ width: `${a}%`, background: 'var(--gd)' }} />
          <span style={{ width: `${m - a}%`, background: 'var(--gd2)' }} />
          <span style={{ width: `${f - m}%`, background: 'var(--ad)' }} />
          <span style={{ flex: 1, background: 'var(--rd)' }} />
        </div>
        {price != null && <div className="wl-mk" style={{ left: `calc(${pos(price)}% - 1px)` }} />}
      </div>
      <div className="wl-lbls">
        <span>Low <b>{money(fmv.low)}</b></span>
        <span>Fair <b>{money(fmv.mid)}</b></span>
        <span>High <b>{money(fmv.high)}</b></span>
      </div>
    </>
  );
}

function Card({ item, open, onToggle, ev, evalsLoading, onSaveNotes, onTrade, onResearch, onOverride, today }) {
  const { w, g, score, price } = item;
  const fmv = fmvOf(w);
  const [notes, setNotes] = useState(w.notes || '');
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (!open) { setMenu(false); setNotes(w.notes || ''); } }, [open, w.notes]);
  const snippet = evalSnippet(ev);
  const earnDays = w.earnings ? daysTo(w.earnings, today) : null;
  const move = moveNoteFor(w); // Part 6D: today's "why it moved", if any

  return (
    <div className={`wl-card wl-${g.group}${open ? ' open' : ''}`}>
      <button type="button" className="wl-head" onClick={onToggle} aria-expanded={open}>
        <div className="wl-top">
          <span className="wl-tk">{w.ticker}</span>
          <span className={`wl-pill ${verdictTone(score?.verdict)}`}>{score?.score ?? '—'} · {verdictShort(score?.verdict)}</span>
          {g.tag && <span className="wl-pill you">{g.tag}</span>}
          <span className="wl-px">{price != null ? money(price) : '—'}</span>
        </div>
        <div className="wl-why">{g.why}</div>
        {fmv ? <FairBar fmv={fmv} price={price} /> : null}
        <div className="wl-meta">
          {earnDays != null && earnDays >= 0 && (
            <span className={earnDays <= 14 ? 'warn' : ''}>
              {earnDays <= 14 ? `Earnings in ${earnDays}d` : `Earnings ${mmdd(w.earnings)} · ${earnDays}d`}
            </span>
          )}
          {fmv && <span className={fmvStale(fmv, today) ? 'warn' : ''}>Fair value {fmv.date ? `from ${mmdd(fmv.date)}` : 'undated'}{fmvStale(fmv, today) ? ' · stale' : ''}</span>}
        </div>
      </button>

      {move && (
        <div className={`wl-move ${move.pct != null && move.pct < 0 ? 'dn' : 'up'}`}>
          {move.pct != null && <b>{move.pct < 0 ? '▼' : '▲'} {Math.abs(move.pct).toFixed(1)}%: </b>}
          {move.text}
          {move.link && <a href={move.link} target="_blank" rel="noopener noreferrer">Top story →</a>}
        </div>
      )}

      {open && (
        <div className="wl-more">
          {score?.quality != null && (
            <div className="wl-qvu">
              <div><b>{score.quality}</b><small>Quality</small></div>
              <div><b>{score.value ?? 'n/a'}</b><small>Value</small></div>
              <div><b>{score.upside ?? 'n/a'}</b><small>Upside</small></div>
            </div>
          )}
          <div className="wl-eval">{snippet || (ev === undefined && evalsLoading ? 'Loading evaluation…' : 'No evaluation in Notion yet')}</div>
          <label className="wl-notes-l" htmlFor={`wl-notes-${w.ticker}`}>My notes</label>
          <textarea
            id={`wl-notes-${w.ticker}`}
            className="wl-notes"
            value={notes}
            placeholder="Add a note (saved to Notion)…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (w.notes || '')) onSaveNotes(w.ticker, notes); }}
          />
          <div className="wl-acts">
            <button type="button" className="wl-trade" onClick={() => onTrade(w.ticker)}>Trade</button>
            <button type="button" onClick={() => onResearch(w.ticker)}>Research</button>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Override</button>
          </div>
          {menu && (
            <div className="wl-ovr" role="group" aria-label="Override Dive-In">
              {[DIVE.PRIORITY, DIVE.WATCH, DIVE.SKIP].map((d) => (
                <button type="button" key={d} className={w.override === d ? 'on' : ''}
                  onClick={() => { setMenu(false); onOverride(w.ticker, d); }}>{d}</button>
              ))}
              <button type="button" disabled={!w.override} onClick={() => { setMenu(false); onOverride(w.ticker, null); }}>Automatic</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WatchlistPage({
  watchlist, isActive, evals = {}, evalsLoading, scores = null,
  onSaveNotes, onSyncNotion, onModalOpenChange, onTrade, onResearch, onOverride,
}) {
  const [filter, setFilter] = useState('all');
  const [openTicker, setOpenTicker] = useState(null);
  const today = todayIso();

  // Re-pull Notion whenever the tab is opened (notes / FMV change upstream).
  useEffect(() => { if (isActive) onSyncNotion?.(); }, [isActive, onSyncNotion]);
  // An open card holds an unsaved notes draft — pause background syncs meanwhile.
  useEffect(() => { onModalOpenChange?.(openTicker != null); }, [openTicker, onModalOpenChange]);

  const byGroup = useMemo(() => {
    const out = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, []]));
    for (const w of watchlist) {
      const score = scores ? scores[w.ticker] || null : null;
      const price = w.liveData?.price ?? null;
      const g = watchlistGroup({ row: w, score, price, isIndex: NO_EARNINGS.has(w.ticker), override: w.override });
      out[g.group].push({ w, g, score, price, pct: g.pct });
    }
    for (const k of ['ready', 'close', 'wait']) out[k].sort((a, b) => wlSortKey(a) - wlSortKey(b));
    for (const k of ['todo', 'skip', 'idx']) out[k].sort((a, b) => a.w.ticker.localeCompare(b.w.ticker));
    return out;
  }, [watchlist, scores]);

  const stocks = watchlist.filter((w) => !NO_EARNINGS.has(w.ticker)).length;
  const count = (k) => (k === 'all' ? stocks : byGroup[k].length);
  const shown = (k) => filter === 'all' || filter === k;

  const renderCards = (k) => (
    <div className="wl-grid">
      {byGroup[k].map((item) => (
        <Card key={item.w.ticker} item={item} today={today}
          open={openTicker === item.w.ticker}
          onToggle={() => setOpenTicker((t) => (t === item.w.ticker ? null : item.w.ticker))}
          ev={evals[item.w.ticker]} evalsLoading={evalsLoading}
          onSaveNotes={onSaveNotes} onTrade={onTrade} onResearch={onResearch} onOverride={onOverride} />
      ))}
    </div>
  );

  return (
    <div className="wl-page">
      <h1 className="wl-h1">Watchlist</h1>
      {scores == null && <div className="wl-note">Loading scores… sections update when they arrive.</div>}
      <div className="wl-chips" role="tablist">
        {CHIPS.map(([k, label]) => (
          <button type="button" key={k} role="tab" aria-selected={filter === k}
            className={`wl-chip c-${k}${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
            <span className="wl-dot" />{label} <b>{count(k)}</b>
          </button>
        ))}
      </div>

      {['ready', 'close', 'wait', 'todo'].map((k) => (shown(k) && byGroup[k].length > 0) && (
        <section key={k} className={`wl-sec wl-${k}`}>
          <div className="wl-sech"><h2>{GROUPS[k].name} · {byGroup[k].length}</h2><span>{GROUPS[k].what}</span></div>
          {renderCards(k)}
        </section>
      ))}

      {[...FOLDED].map((k) => (shown(k) || (k === 'idx' && filter === 'all')) && byGroup[k].length > 0 && (
        <section key={k} className={`wl-sec wl-${k}`}>
          <details open={filter === k}>
            <summary className="wl-sech"><h2>{GROUPS[k].name} · {byGroup[k].length} ▸</h2><span>{GROUPS[k].what}</span></summary>
            {k === 'skip' ? renderCards(k) : (
              <div className="wl-rows">
                {byGroup[k].map(({ w, price }) => (
                  <div key={w.ticker} className="wl-row">
                    <span className="wl-tk">{w.ticker}</span>
                    <span className="wl-r">{w.ticker === 'XSP' ? 'Index LEAPS — see Signals' : 'Market reference'}</span>
                    <span className="wl-px">{price != null ? money(price) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </details>
        </section>
      ))}

      {!watchlist.length && <div className="wl-empty">No watchlist tickers yet.</div>}
    </div>
  );
}
