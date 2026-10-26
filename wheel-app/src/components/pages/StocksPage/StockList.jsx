import React, { useMemo, useState } from 'react';
import { NO_EARNINGS } from '../../../lib/signalEngine';
import { fmvOf, fmvStale } from '../../../lib/fairValue';
import { moveNoteFor } from '../../../lib/homeFeed';
import { groupStocks, filterGroups, cleanQuery, searchAction } from '../../../lib/stocksList';

// Part 9D (approved 10-25): the Stocks tab list — Watchlist sections + search.
// Tapping a card opens the stock page with its last SAVED run (no re-run).

const GROUPS = {
  ready: { name: 'Ready · Priority',          what: 'Good company, price at or under fair value. The Signals tab looks for trades here.' },
  close: { name: 'Close · Watch',             what: 'Good company, price within 10% of fair. Could turn Priority soon.' },
  wait:  { name: 'Waiting on price · Watch',  what: 'Good company, but more than 10% over fair. Nothing to do yet.' },
  todo:  { name: 'Needs a step',              what: 'Missing a score or a fair value, so it can’t be sorted yet.' },
  skip:  { name: 'Skip',                      what: 'App score says “Not worth it”.' },
  idx:   { name: 'Indexes',                   what: 'No score or fair value. LEAPS on XSP live in Signals.' },
};
const CHIPS = [['all', 'All'], ['ready', 'Ready'], ['close', 'Close'], ['wait', 'Waiting'], ['todo', 'Needs a step'], ['skip', 'Skip']];
const FOLDED = ['skip', 'idx'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysTo = (iso, today) => Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
const money = (n) => (n == null ? '—' : n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${Number(n).toFixed(2)}`);
const mmdd = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');
const verdictTone = (v) => (v === 'Worth investing' ? 'g' : v === 'Maybe' ? 'a' : v ? 'r' : 'n');
const verdictShort = (v) => (v === 'Worth investing' ? 'Worth' : v || 'Unscored');

export function FairBar({ fmv, price }) {
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

const pe1 = (v) => (v == null ? '—' : v >= 1000 ? `${Math.round(v / 100) / 10}k` : v >= 100 ? String(Math.round(v)) : v.toFixed(1));

/** Part 10D: P/E for context — trailing scaled to today's price, forward from Claude's EPS. */
export function peContext(score, price) {
  const trailing = score?.operatingPe != null && score?.priceAtRun > 0 && price != null
    ? score.operatingPe * (price / score.priceAtRun) : score?.operatingPe ?? null;
  const forward = score?.forwardEps > 0 && price != null ? price / score.forwardEps : null;
  return { trailing, forward };
}

/** Part 10F (El picked layout A, 10-25): one row per stock. */
function Row({ item, held, onOpen, today, disabled }) {
  const { w, g, score, price } = item;
  const fmv = fmvOf(w);
  const earnDays = w.earnings ? daysTo(w.earnings, today) : null;
  const soon = earnDays != null && earnDays >= 0 && earnDays <= 14;
  const move = moveNoteFor(w);
  const stale = fmv && fmvStale(fmv, today);
  const { trailing, forward } = peContext(score, price);
  const pct = g.pct;
  const pos = pct == null ? null : Math.max(3, Math.min(97, 55 + pct * 1.2)); // fair value sits at 55%
  return (
    <div className={`stk-row wl-${g.group}`}>
      <button type="button" className="stk-rowbtn" onClick={() => onOpen(w.ticker)} disabled={disabled} aria-label={`Open ${w.ticker}`}>
        <span className="stk-c-tk">
          <span className="wl-tk">{w.ticker}</span>
          {held && <span className="stk-held">● You hold</span>}
          {g.tag && <span className="wl-pill you">{g.tag}</span>}
          {score?.newListing && <span className="wl-pill new">New listing</span>}
        </span>
        <span className="stk-c-score"><span className={`wl-pill ${verdictTone(score?.verdict)}`}>{score?.score ?? '—'} · {verdictShort(score?.verdict)}</span></span>
        <span className="stk-c-px num">{price != null ? money(price) : '—'}</span>
        <span className="stk-c-vs">
          {pct != null ? (
            <>
              <span className={`stk-pct ${pct <= 0 ? 'g' : pct <= 10 ? 'a' : 'r'}`}>{Math.abs(pct)}% {pct <= 0 ? 'under' : 'over'}{stale ? ' · stale' : ''}</span>
              <span className="stk-meter" aria-hidden="true"><b /><i style={{ left: `${pos}%` }} /></span>
            </>
          ) : <span className="stk-why">{g.why}</span>}
        </span>
        <span className="stk-c-pe num" title="Operating P/E (trailing) · forward P/E — context only">
          {pe1(trailing)} <small>· {pe1(forward)} fwd</small>
        </span>
        <span className="stk-c-earn">{soon ? <span className="stk-earn">Earnings {earnDays === 0 ? 'today' : `${earnDays}d`}</span> : <span className="stk-dim">—</span>}</span>
      </button>
      {move && (
        <div className={`stk-move ${move.pct != null && move.pct < 0 ? 'dn' : 'up'}`}>
          {move.pct != null && <b>{move.pct < 0 ? '▼' : '▲'} {Math.abs(move.pct).toFixed(1)}%: </b>}
          {move.text}
          {move.link && <a href={move.link} target="_blank" rel="noopener noreferrer"> Top story →</a>}
        </div>
      )}
    </div>
  );
}

export default function StockList({ watchlist, scores, query, heldTickers, onOpen, onResearch, busy }) {
  const [filter, setFilter] = useState('all');
  const today = todayIso();
  const all = useMemo(() => groupStocks(watchlist, scores, (t) => NO_EARNINGS.has(t)), [watchlist, scores]);
  const byGroup = useMemo(() => filterGroups(all, query), [all, query]);
  const q = cleanQuery(query);
  const action = searchAction(q, watchlist);
  const stocks = watchlist.filter((w) => !NO_EARNINGS.has(w.ticker)).length;
  const count = (k) => (k === 'all' ? (q ? Object.values(byGroup).flat().length : stocks) : byGroup[k].length);
  const shown = (k) => filter === 'all' || filter === k;
  const any = Object.values(byGroup).some((xs) => xs.length);

  const renderCards = (k) => (
    <div className="stk-rows" role="list">
      <div className="stk-thead" aria-hidden="true"><span>Stock</span><span>Score</span><span className="r">Price</span><span>vs fair value</span><span>P/E · fwd</span><span className="r">Earnings</span></div>
      {byGroup[k].map((item) => (
        <Row key={item.w.ticker} item={item} today={today} held={heldTickers?.has(item.w.ticker)} onOpen={onOpen} disabled={busy} />
      ))}
    </div>
  );

  return (
    <div className="wl-page">
      {scores == null && <div className="wl-note">Loading scores… sections update when they arrive.</div>}

      {action === 'research' && (
        <div className="stk-new">
          <span><b>{q}</b> isn’t on your watchlist.</span>
          <button type="button" className="btn-p" onClick={() => onResearch(q)} disabled={busy}>Research {q}</button>
          <small>Runs the full research (about 20 s) and saves it. To follow it here, add it in TradingView.</small>
        </div>
      )}

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

      {FOLDED.map((k) => (shown(k) || (k === 'idx' && filter === 'all')) && byGroup[k].length > 0 && (
        <section key={k} className={`wl-sec wl-${k}`}>
          <details open={filter === k || !!q}>
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
      {watchlist.length > 0 && q && !any && action !== 'research' && <div className="wl-empty">Nothing matches “{q}”.</div>}
    </div>
  );
}
