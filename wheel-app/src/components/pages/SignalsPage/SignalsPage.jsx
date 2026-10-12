import React, { useEffect } from 'react';
import { splitSections } from '../../../lib/signalSections';

// Part 2C (PRD v1.5 §4, mockup v2): three visually distinct sections.
//   ⚡ Manage      positions you hold — act on these first (wine header,
//                  cards lead with a colored action strip)
//   🆕 New trades  new money, ranked by Investment Score (blue header, cards
//                  lead with a big rank number)
//   ⏳ Waiting     setup fired but blocked — one-line rows, no cards
// The Notion evaluation lives in the tap-to-open detail view, not on the card.


const fmtPrice = (p) => (p != null ? `$${p.toFixed(2)}` : '—');
function Chg({ v }) {
  if (v == null) return null;
  return <span className={v > 0 ? 'up' : v < 0 ? 'dn' : ''}>{v > 0 ? '+' : ''}{v.toFixed(1)}%</span>;
}
const md = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };

function Pills({ chks }) {
  if (!chks?.length) return null;
  return (
    <div className="sx-pills">
      {chks.map((ch, i) => (
        <span key={i} className={`cpill ${ch.warn ? 'warn' : ch.ok ? 'pass' : 'fail'}`}>
          {ch.warn ? '⚠' : ch.ok ? '✓' : '✗'} {ch.l}
        </span>
      ))}
    </div>
  );
}

// ── Manage ────────────────────────────────────────────────────────────────

function posLabel(s) {
  if (s.type === 'cc') return `${s.sharesOwned} shares`;
  if (s.type === 'score_review') return '🔥 Priority';
  const kind = s.posType === 'put_spread' ? 'Put spread' : s.posType === 'short_call' ? 'Short call' : 'Short put';
  const strikes = s.longStrike != null ? `$${s.strike}/$${s.longStrike}` : `$${s.strike}`;
  return `${kind} ${strikes}`;
}

function stripFor(s) {
  switch (s.type) {
    case 'maxloss':      return ['Max loss', s.days != null ? `${s.days}d left` : ''];
    case 'roll':         return ['Roll', s.days != null ? `${s.days}d left` : ''];
    case 'close':        return ['Close early', s.pctCap != null ? `${s.pctCap}% captured` : ''];
    case 'cc':           return ['Sell call', `${s.contracts} contract${s.contracts > 1 ? 's' : ''}`];
    case 'score_review': return ['Score review', s.scoreAt ? `run ${md(s.scoreAt)}` : ''];
    default:             return [s.type, ''];
  }
}

function ManageCard({ s, onClick, onScoreReview, busy }) {
  const [act, right] = stripFor(s);
  return (
    <div className="sx-mcard" onClick={() => onClick(s.id)}>
      <div className={`sx-strip ${s.type}`}><span>{act}</span><span>{right}</span></div>
      <div className="sx-mbody">
        <div className="sx-mrow">
          <div>
            <div className="sx-tkr">{s.ticker}</div>
            <div className="sx-pos">{posLabel(s)}{s.type === 'score_review' && <> · now <b className="dn">{s.score != null ? Math.round(s.score) : '—'} · Not worth it</b></>}</div>
          </div>
          <div className="sx-px">{fmtPrice(s.price)}<br /><Chg v={s.chg} /></div>
        </div>
        <div className="sx-do">{s.suggestion}</div>
        {s.type === 'cc' && <Pills chks={s.chks} />}
        {s.type === 'score_review' && onScoreReview && (
          <div className="srv-btns" onClick={e => e.stopPropagation()}>
            <button type="button" className="srv-btn go" disabled={busy} onClick={() => onScoreReview(s, 'Watch')}>
              {busy ? <span className="spinner" /> : 'Move to 👀 Watch'}
            </button>
            <button type="button" className="srv-btn" disabled={busy} onClick={() => onScoreReview(s, 'Priority')}>Keep Priority</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── New trades ────────────────────────────────────────────────────────────

const VERDICT_SHORT = { 'Worth investing': 'Worth investing', Maybe: 'Maybe', 'Not worth it': 'Not worth it' };
const tone = (v) => (v == null ? '' : v >= 75 ? 'up' : v >= 55 ? 'am' : 'dn');

function TradeCard({ s, rank, onClick }) {
  const leaps = s.type === 'leaps';
  // The score lives in the corner, so its pill would just repeat it.
  const pills = (s.chks || []).filter(c => !(c.ok && /^Score \d/.test(c.l)));
  const scored = s.score != null;
  return (
    <div className={`sx-ncard ${s.type}`} onClick={() => onClick(s.id)}>
      <div className={`sx-rk${leaps ? ' leaps' : ''}`}>{s.index ? <span className="sx-rk-ix">{s.ticker}</span> : rank}<small>{leaps ? 'LEAPS' : 'CSP'}</small></div>
      <div className="sx-nb">
        <div className="sx-ntop">
          <div>
            <div className="sx-tkr">{s.ticker}</div>
            <div className="sx-pos">{fmtPrice(s.price)} <Chg v={s.chg} /> · {leaps ? 'Buy a LEAPS' : 'Sell a put'}</div>
          </div>
          <div className={`sx-score ${scored ? tone(s.score) : 'none'}`}>
            <b>{scored ? Math.round(s.score) : s.index ? '' : 'Unscored'}</b>
            {scored && <small>{VERDICT_SHORT[s.verdict] || s.verdict}{s.scoreType === 'Preliminary' ? ' · Prelim' : ''}</small>}
          </div>
        </div>
        <div className="sx-contract">{s.suggestion}</div>
        {s.fmv && (
          // Part 3E: price vs fair value (FMV Mid) from the Monday eval.
          <div className={`sx-fmv${s.fmvPct != null && s.fmvPct <= 0 ? ' under' : ''}`}>
            Fair ${s.fmv.mid >= 1000 ? Math.round(s.fmv.mid).toLocaleString() : s.fmv.mid.toFixed(2)}
            {s.fmvPct != null && <> · {Math.abs(s.fmvPct)}% {s.fmvPct <= 0 ? 'under' : 'over'}</>}
            {s.fmv.low != null && <> · buy below ${s.fmv.low >= 1000 ? Math.round(s.fmv.low).toLocaleString() : s.fmv.low.toFixed(2)}</>}
            {s.fmvStale && <span className="sx-stale">stale</span>}
          </div>
        )}
        <Pills chks={pills} />
        {(s.quality != null || s.value != null || s.upsideScore != null) && (
          <div className="sx-qvu">
            <div>Quality<b className={tone(s.quality)}>{s.quality != null ? Math.round(s.quality) : '—'}</b></div>
            <div>Value<b className={tone(s.value)}>{s.value != null ? Math.round(s.value) : '—'}</b></div>
            <div>Upside<b className={tone(s.upsideScore)}>{s.upsideScore != null ? Math.round(s.upsideScore) : '—'}</b></div>
          </div>
        )}
        <div className="sx-foot">
          <span>{[
            s.ivr != null ? `HV30 est ${s.ivr}` : null,
            leaps ? `${s.openLeaps ?? 0} LEAPS open` : null,
            s.index ? 'Index · no score' : s.scoreAt ? `run ${md(s.scoreAt)}` : s.unscored ? 'Never run in Research' : null,
          ].filter(Boolean).join(' · ')}</span>
          <span className="sx-more">Details →</span>
        </div>
      </div>
    </div>
  );
}

// ── Waiting ───────────────────────────────────────────────────────────────

function WaitRow({ s, onClick }) {
  return (
    <div className="sx-wrow" onClick={() => onClick(s.id)}>
      <span className="t">{s.ticker}</span>
      <span className={`sx-tag${s.type === 'leaps_wait' ? ' leaps' : ''}`}>{s.type === 'leaps_wait' ? 'LEAPS' : 'CSP'}</span>
      <span className="why">{s.waitReason}</span>
      <span className="s">{s.score != null ? Math.round(s.score) : '—'}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

function Section({ id, kind, title, sub, count, children }) {
  return (
    <section className={`sx-sec ${kind}`} id={id}>
      <div className="sx-sec-h">
        <div><div className="t">{title}</div><div className="sub">{sub}</div></div>
        <span className="c">{count}</span>
      </div>
      <div className="sx-sec-b">{children}</div>
    </section>
  );
}

const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export default function SignalsPage({ signals, lastRefresh, onShowDetail, onScoreReview, reviewBusyId }) {
  // Section headers stick just under the app header, whatever its height.
  useEffect(() => {
    const h = document.querySelector('.hdr')?.offsetHeight;
    if (h) document.documentElement.style.setProperty('--sx-top', `${h}px`);
  }, []);

  const { manage, trades, index, waiting } = splitSections(signals);
  const ago = lastRefresh ? Math.round((Date.now() - lastRefresh) / 60000) : null;

  return (
    <div className="sx">
      <div className="sx-sum">
        <button type="button" className="sx-chip m" onClick={() => jump('sec-manage')}><div className="v">{manage.length}</div><div className="l">Manage</div></button>
        <button type="button" className="sx-chip n" onClick={() => jump('sec-trades')}><div className="v">{trades.length + index.length}</div><div className="l">New trades</div></button>
        <button type="button" className="sx-chip w" onClick={() => jump('sec-waiting')}><div className="v">{waiting.length}</div><div className="l">Waiting</div></button>
      </div>

      <Section id="sec-manage" kind="manage" title="⚡ Manage" sub="Positions you hold. Act on these first" count={manage.length}>
        {manage.length
          ? manage.map(s => <ManageCard key={s.id} s={s} onClick={onShowDetail} onScoreReview={onScoreReview} busy={reviewBusyId === s.id} />)
          : <div className="sx-empty">Nothing to manage{lastRefresh ? ' right now' : ' yet'}.</div>}
      </Section>

      <Section id="sec-trades" kind="new" title="🆕 New trades" sub="New money · ranked by Investment Score" count={trades.length + index.length}>
        {trades.length
          ? trades.map((s, i) => <TradeCard key={s.id} s={s} rank={i + 1} onClick={onShowDetail} />)
          : <div className="sx-empty">No CSP or LEAPS setup on your Priority stocks right now.</div>}
        {index.length > 0 && (
          <div className="sx-idx">
            <div className="sx-idx-l">📌 Index · no score</div>
            {index.map(s => <TradeCard key={s.id} s={s} rank="" onClick={onShowDetail} />)}
          </div>
        )}
      </Section>

      <Section id="sec-waiting" kind="wait" title="⏳ Waiting" sub="Setup fired, but blocked. Not a trade today" count={waiting.length}>
        {waiting.length
          ? waiting.map(s => <WaitRow key={s.id} s={s} onClick={onShowDetail} />)
          : <div className="sx-empty">Nothing blocked.</div>}
      </Section>

      <div className="sx-legend">
        {ago !== null ? `Last screened ${ago < 1 ? 'just now' : `${ago}m ago`} · ` : ''}Telegram sends counts only
      </div>
    </div>
  );
}
