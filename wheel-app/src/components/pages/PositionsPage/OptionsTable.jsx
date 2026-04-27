import React from 'react';
import { formatDateDisplay } from '../../../lib/utils';

function dteInfo(expiry, enteredAt) {
  if (!expiry) return { days: null, pct: null };
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiryDate = new Date(expiry + 'T12:00:00');
  const days = Math.round((expiryDate - now) / 86400000);
  if (!enteredAt) return { days, pct: null };
  const entryDate = new Date(enteredAt);
  entryDate.setHours(0, 0, 0, 0);
  const totalDays = Math.round((expiryDate - entryDate) / 86400000);
  const elapsed   = Math.round((now - entryDate) / 86400000);
  const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : null;
  return { days, pct };
}

// Returns the highest-priority action badge for a position, or null
function getActionBadge(pos, days, timePct, pctCap, criteria) {
  if (days !== null && days <= 0) {
    return { label: 'Expired — close out', color: 'var(--r)' };
  }
  if (days !== null && days <= 5) {
    return { label: `Act now · ${days}d left`, color: 'var(--a)' };
  }
  const closePct    = criteria?.closePct    ?? 50;
  const closeDtePct = criteria?.closeDtePct ?? 50;
  if (pctCap !== null && timePct !== null && pctCap >= closePct && timePct >= closeDtePct) {
    return { label: `Early close · ${pctCap}% captured`, color: 'var(--g)' };
  }
  return null;
}

export default function OptionsTable({ optPositions, criteria, priceMap = {}, onSelectPos, onEditPos }) {
  if (!optPositions.length) return null;

  return (
    <>
      <div className="pos-section-hdr">
        <span style={{ background: 'var(--pu)' }}></span>Open Options
      </div>
      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', overflow: 'hidden', marginBottom: 12 }}>
        <div className="pos-table-wrap">
          <table className="pos-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Type</th>
                <th>Price</th>
                <th>Strike</th>
                <th>Expiry</th>
                <th>DTE</th>
                <th>Prem</th>
                <th>Curr</th>
                <th>P&amp;L</th>
                <th>Cap%</th>
              </tr>
            </thead>
            <tbody>
              {optPositions.map(pos => {
                const isPut = pos.type === 'short_put';
                const { days, pct: timePct } = dteInfo(pos.expiry, pos.enteredAt);
                const dteColor = days !== null && days <= 0 ? 'var(--r)' : days !== null && days <= 7 ? 'var(--r)' : days !== null && days <= 14 ? 'var(--a)' : null;
                const dteStr   = days !== null
                  ? (timePct !== null ? `${timePct}% / ${days}d` : `${days}d`)
                  : '—';
                const effectiveCurPrem = (pos._liveCurPrem !== undefined && pos._liveCurPrem !== null)
                  ? pos._liveCurPrem : pos.curPrem;
                const pnl = effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem
                  ? (pos.prem - effectiveCurPrem) * pos.qty * 100
                  : null;
                const pctCap = effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem
                  ? Math.round((1 - effectiveCurPrem / pos.prem) * 100)
                  : null;
                const curStr    = effectiveCurPrem !== undefined && effectiveCurPrem !== null ? `$${Number(effectiveCurPrem).toFixed(2)}` : '—';
                const pctCapStr = pctCap !== null ? `${pctCap}%` : '—';
                const badge     = getActionBadge(pos, days, timePct, pctCap, criteria);

                return (
                  <tr key={pos.id} onClick={() => onSelectPos(pos.id)}>
                    <td>
                      <div className="pos-ticker-cell">
                        <div>
                          <div className="pos-ticker-name">{pos.ticker}</div>
                          {badge && (
                            <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: badge.color, marginTop: 2, whiteSpace: 'nowrap' }}>
                              ● {badge.label}
                            </div>
                          )}
                        </div>
                        <button
                          title="Edit position"
                          style={{ fontSize: 13, color: 'var(--mu)', cursor: 'pointer', background: 'none', border: 'none', padding: '6px 4px', lineHeight: 1, alignSelf: 'flex-start', minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={e => { e.stopPropagation(); onEditPos(pos.id); }}
                        >✎</button>
                      </div>
                    </td>
                    <td><span className={`pos-type-pill ${isPut ? 'put' : 'call'}`}>{isPut ? 'Put' : 'Call'}</span></td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{priceMap[pos.ticker] != null ? `$${priceMap[pos.ticker].toFixed(2)}` : '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--bl)' }}>${pos.strike || '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{formatDateDisplay(pos.expiry)}</td>
                    <td style={{ fontFamily: 'var(--mono)', ...(dteColor ? { color: dteColor } : {}) }}>{dteStr}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--g)' }}>${pos.prem ? pos.prem.toFixed(2) : '—'}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{curStr}</td>
                    <td style={{ fontFamily: 'var(--mono)', ...(pnl !== null ? { color: pnl >= 0 ? 'var(--g)' : 'var(--r)' } : {}) }}>
                      {pnl !== null ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(0)}` : '—'}
                    </td>
                    <td>{pctCapStr}</td>
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
