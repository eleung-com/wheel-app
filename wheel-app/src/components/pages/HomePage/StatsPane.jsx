import React from 'react';
import HistoryPage from '../HistoryPage/HistoryPage';
import { dte, formatDateDisplay } from '../../../lib/utils';

const OPEN_TYPES = new Set(['short_put', 'short_call']);
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

function money(n) {
  return '$' + Math.round(Math.abs(n)).toLocaleString();
}

function greeting(d) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Open contracts only — an option row with a linkedId has already been closed,
 * and the close row itself is a separate entry.
 */
function openOptions(positions, account) {
  return positions.filter(p =>
    OPEN_TYPES.has(p.type)
    && !p.linkedId
    && (account === 'all' || (p.account || 'Esther') === account)
  );
}

export default function StatsPane({
  positions, closedTrades, criteria, signals, account, onAccount, onShowSignal,
}) {
  const now  = new Date();
  const opts = openOptions(positions, account);

  // Premium collected on everything still open.
  const premAtRisk = opts.reduce((s, p) => s + (p.prem || 0) * (p.qty || 1) * 100, 0);
  const contracts  = opts.reduce((s, p) => s + (p.qty || 1), 0);

  // Deployed = cash securing the short puts. Shares are excluded: a covered
  // call needs no fresh capital, and this figure tracks options collateral, not
  // stock already held. Matches the Positions page's allocation bar.
  const secured = opts
    .filter(p => p.type === 'short_put')
    .reduce((s, p) => s + (p.strike || 0) * (p.qty || 1) * 100, 0);
  const capital = account === 'all'
    ? (criteria.capitalEsther || 0) + (criteria.capitalFam || 0)
    : account === 'Esther' ? (criteria.capitalEsther || 0) : (criteria.capitalFam || 0);
  const deployedPct = capital > 0
    ? Math.round((secured / capital) * 100)
    : null;

  // Realized this calendar month.
  const monthTrades = (closedTrades || []).filter(t => {
    if (!t.closeDate) return false;
    if (account !== 'all' && (t.account || 'Esther') !== account) return false;
    const d = new Date(t.closeDate);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const realized = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);

  // Soonest expiry still open.
  const dated = opts
    .map(p => ({ ...p, d: dte(p.expiry) }))
    .filter(p => p.d !== null && p.d >= 0)
    .sort((a, b) => a.d - b.d);
  const next = dated[0];

  // Roll and close signals are the ones with a decision attached to them.
  const attention = (signals || []).filter(s => s.type === 'roll' || s.type === 'close');

  return (
    <>
      <div>
        <h2 className="greet">{greeting(now)}, Esther</h2>
        <p className="greet-sub">
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {attention.length > 0
            ? ` · ${attention.length} ${attention.length === 1 ? 'position needs' : 'positions need'} a look`
            : ' · nothing needs a decision'}
        </p>
      </div>

      <div className="acctseg" role="group" aria-label="Account">
        {[['all', 'All accounts'], ['Esther', 'Esther'], ['Fam', 'Fam']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={account === id ? 'on' : ''}
            aria-pressed={account === id}
            onClick={() => onAccount(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="statgrid">
        <div className="stat">
          <div className="stat-l">Premium at risk</div>
          <div className="stat-v">{money(premAtRisk)}</div>
          <div className="stat-s">{contracts} open {contracts === 1 ? 'contract' : 'contracts'}</div>
        </div>

        <div className="stat">
          <div className="stat-l">Capital deployed</div>
          <div className="stat-v">{deployedPct === null ? '—' : `${deployedPct}%`}</div>
          {deployedPct === null
            ? <div className="stat-s">Set capital in Settings</div>
            : <div className="statmeter"><i style={{ width: `${Math.min(deployedPct, 100)}%` }} /></div>}
        </div>

        <div className="stat">
          <div className="stat-l">Realized · {MONTHS[now.getMonth()].slice(0, 3)}</div>
          <div className={`stat-v${realized > 0 ? ' g' : realized < 0 ? ' r' : ''}`}>
            {realized > 0 ? '+' : realized < 0 ? '−' : ''}{money(realized)}
          </div>
          <div className="stat-s">{monthTrades.length} closed {monthTrades.length === 1 ? 'trade' : 'trades'}</div>
        </div>

        <div className="stat">
          <div className="stat-l">Next expiry</div>
          <div className="stat-v">{next ? `${next.d}d` : '—'}</div>
          <div className="stat-s">
            {next
              ? `${next.ticker} $${next.strike}${next.type === 'short_put' ? 'P' : 'C'} · ${formatDateDisplay(next.expiry)}`
              : 'No open options'}
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <>
          <div className="slabel">Needs attention</div>
          <div className="attn">
            {attention.map(s => (
              <button
                type="button"
                className="attn-row"
                key={s.id}
                onClick={() => onShowSignal(s.id)}
              >
                <i className={`adot${s.type === 'roll' ? ' hot' : ''}`} />
                <span className="attn-txt">
                  <b>{s.ticker}{s.strike ? ` $${s.strike}` : ''}</b> — {s.suggestion}
                </span>
                <span className="attn-chev">›</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="slabel">Performance</div>
      <HistoryPage positions={positions} account={account} />
    </>
  );
}
