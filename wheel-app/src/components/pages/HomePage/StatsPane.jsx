import React from 'react';
import { formatDateDisplay } from '../../../lib/utils';
import { bookStats } from '../../../lib/bookStats';

// Part 6E (Home layout v2, approved 10-24): "your book" — a compact dark panel
// so your own numbers stand apart from the market prices. Premium at risk was
// dropped; Performance (charts + trade log) opens in place.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const money = (n) => '$' + Math.round(Math.abs(n)).toLocaleString();
const moneyK = (n) => (Math.abs(n) >= 10000 ? `$${(Math.abs(n) / 1000).toFixed(1)}k` : money(n));

function greeting(d) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Roll / close signals — the positions that need a decision. */
export function attentionOf(signals) {
  return (signals || []).filter(s => s.type === 'roll' || s.type === 'close');
}

export default function StatsPane({
  positions, closedTrades, criteria, signals, account, onAccount, onOpenPerformance,
}) {
  const now = new Date();
  const s = bookStats({ positions, closedTrades, criteria, account, now });
  const attention = attentionOf(signals);
  const next = s.next;

  return (
    <section className="book" aria-label="Your book">
      <div className="book-top">
        <div className="book-hi">
          <b>{greeting(now)}, Esther</b>
          <span>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {attention.length > 0
              ? ` · ${attention.length} ${attention.length === 1 ? 'position needs' : 'positions need'} a look`
              : ' · nothing needs a decision'}
          </span>
        </div>
        <div className="book-acct" role="group" aria-label="Account">
          {[['all', 'All'], ['Esther', 'Esther'], ['Fam', 'Fam']].map(([id, label]) => (
            <button key={id} type="button" className={account === id ? 'on' : ''} aria-pressed={account === id} onClick={() => onAccount(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="book-stats">
        <div className="bs">
          <div className="bs-l">Capital deployed</div>
          <div className="bs-v">{s.deployedPct === null ? '—' : `${s.deployedPct}%`}</div>
          {s.deployedPct !== null && <div className="bs-meter"><i style={{ width: `${Math.min(s.deployedPct, 100)}%` }} /></div>}
          <div className="bs-s">{s.deployedPct === null ? 'Set capital in Settings' : s.inLeaps > 0 ? `incl. ${moneyK(s.inLeaps)} in LEAPS` : 'cash-secured puts'}</div>
        </div>
        <div className="bs">
          <div className="bs-l">Realized · {MONTHS[now.getMonth()]}</div>
          <div className={`bs-v${s.realized > 0 ? ' pos' : s.realized < 0 ? ' neg' : ''}`}>{s.realized < 0 ? '−' : s.realized > 0 ? '+' : ''}{money(s.realized)}</div>
          <div className="bs-s">{s.monthTradeCount} closed {s.monthTradeCount === 1 ? 'trade' : 'trades'}</div>
        </div>
        <div className="bs">
          <div className="bs-l">Next expiry</div>
          <div className="bs-v">{next ? `${next.d}d` : '—'}</div>
          <div className="bs-s">
            {next
              ? `${next.ticker} ${next.type === 'put_spread' ? `$${next.strike}/$${next.longStrike} PCS` : `$${next.strike}${next.type === 'short_put' ? 'P' : 'C'}`} · ${formatDateDisplay(next.expiry)}`
              : 'No open options'}
          </div>
        </div>
        <div className="bs">
          <div className="bs-l">Win rate</div>
          <div className="bs-v">{s.winRate === null ? '—' : `${s.winRate}%`}</div>
          <div className="bs-s">all time · {s.closedCount} closed</div>
        </div>
      </div>

      {/* Part 9E: charts + trade log moved to Positions → History & performance. */}
      {onOpenPerformance && (
        <button type="button" className="book-more" onClick={onOpenPerformance}>Performance details ›</button>
      )}
    </section>
  );
}

/** Part 6E: "Needs attention" as its own small card (right column on desktop). */
export function AttentionCard({ signals, onShowSignal }) {
  const attention = attentionOf(signals);
  return (
    <section className="hcard h-attn">
      <div className="hcard-h"><h3>Needs attention</h3><small>{attention.length ? 'tap for details' : ''}</small></div>
      {attention.length === 0
        ? <div className="hcard-empty">Nothing needs a decision right now.</div>
        : attention.map(s => (
          <button type="button" className="attn-row" key={s.id} onClick={() => onShowSignal(s.id)}>
            <i className={`adot${s.type === 'roll' ? ' hot' : ''}`} />
            <span className="attn-txt"><b>{s.ticker}{s.strike ? ` $${s.strike}` : ''}</b> — {s.suggestion}</span>
            <span className="attn-chev">›</span>
          </button>
        ))}
    </section>
  );
}
