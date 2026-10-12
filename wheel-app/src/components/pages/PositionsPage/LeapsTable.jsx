import React from 'react';
import { formatDateDisplay } from '../../../lib/utils';
import { dte, LEAPS_REVIEW_DAYS, LEAPS_URGENT_DAYS } from '../../../lib/signalEngine';

// Part 4A (D3): open LEAPS (long calls). Paid = premium per share × 100 ×
// contracts; Now = live mid of the same contract (screener), when it priced.
export function leapsPnl(pos) {
  const cur = pos._liveCurPrem ?? pos.curPrem ?? null;
  const paid = pos.prem ?? null;
  const n = (pos.qty || 1) * 100;
  if (cur == null || paid == null) return { cur, paid, pnl: null, pct: null };
  return { cur, paid, pnl: Math.round((cur - paid) * n), pct: paid > 0 ? Math.round((cur / paid - 1) * 1000) / 10 : null };
}

const money = (n) => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function LeapsTable({ leaps, priceMap = {}, onSelectPos, onEditPos }) {
  if (!leaps.length) return null;
  return (
    <>
      <div className="pos-section-hdr">
        <span style={{ background: 'var(--bl)' }}></span>LEAPS
      </div>
      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', overflow: 'hidden', marginBottom: 12 }}>
        <div className="pos-table-wrap">
          <table className="pos-table leaps">
            <thead>
              <tr><th>LEAPS</th><th>Expiry</th><th>Paid → Now</th><th>P/L</th></tr>
            </thead>
            <tbody>
              {leaps.map(pos => {
                const days = dte(pos.expiry);
                const { cur, paid, pnl, pct } = leapsPnl(pos);
                const daysColor = days != null && days <= LEAPS_URGENT_DAYS ? 'var(--r)' : days != null && days <= LEAPS_REVIEW_DAYS ? 'var(--a)' : null;
                const badge = days != null && days <= LEAPS_URGENT_DAYS ? 'Act soon · sell or roll'
                  : days != null && days <= LEAPS_REVIEW_DAYS ? 'Review · roll or sell' : null;
                return (
                  <tr key={pos.id} onClick={() => onSelectPos(pos.id)}>
                    <td>
                      <div className="pos-ticker-cell">
                        <div>
                          <div className="pos-ticker-name">{pos.ticker} <span style={{ fontWeight: 600, color: 'var(--bl)', fontSize: 12 }}>${pos.strike}{pos.qty > 1 ? ` ×${pos.qty}` : ''}</span></div>
                          {badge && <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: daysColor, marginTop: 2, whiteSpace: 'nowrap' }}>● {badge}</div>}
                          {priceMap[pos.ticker] != null && <div style={{ fontSize: 9, color: 'var(--mu)', marginTop: 2 }}>stock ${priceMap[pos.ticker].toFixed(2)}</div>}
                        </div>
                        <button title="Edit position"
                          style={{ fontSize: 13, color: 'var(--mu)', cursor: 'pointer', background: 'none', border: 'none', padding: '6px 4px', lineHeight: 1, alignSelf: 'flex-start', minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={e => { e.stopPropagation(); onEditPos(pos.id); }}>✎</button>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {formatDateDisplay(pos.expiry)}
                      <div style={{ fontSize: 10, ...(daysColor ? { color: daysColor, fontWeight: 700 } : { color: 'var(--mu)' }) }}>{days != null ? `${days}d` : '—'}</div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      {paid != null ? `$${paid.toFixed(2)}` : '—'}
                      <div style={{ fontSize: 10, color: 'var(--mu2)' }}>→ {cur != null ? `$${cur.toFixed(2)}` : '—'}</div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: pnl == null ? 'var(--mu)' : pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
                      {pnl == null ? '—' : `${pnl >= 0 ? '+' : '−'}${money(pnl)}`}
                      {pct != null && <div style={{ fontSize: 9, fontWeight: 600 }}>{pct >= 0 ? '+' : ''}{pct}%</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
