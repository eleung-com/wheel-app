import React from 'react';
import { dte, formatDateDisplay } from '../../../lib/utils';

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

export default function OptionsTable({ optPositions, onSelectPos, onEditPos }) {
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
              const isPut    = pos.type === 'short_put';
              const { days, pct } = dteInfo(pos.expiry, pos.enteredAt);
              const dteColor = days !== null && days <= 7 ? 'var(--r)' : days !== null && days <= 14 ? 'var(--a)' : null;
              const dteStr   = days !== null
                ? (pct !== null ? `${pct}% / ${days}d` : `${days}d`)
                : '—';
              const effectiveCurPrem = (pos._liveCurPrem !== undefined && pos._liveCurPrem !== null)
                ? pos._liveCurPrem : pos.curPrem;
              const pnl = effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem
                ? (pos.prem - effectiveCurPrem) * pos.qty * 100
                : null;
              const pctCap = effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem
                ? Math.round((1 - effectiveCurPrem / pos.prem) * 100)
                : null;
              const pnlColor   = pnl === null ? '' : pnl >= 0 ? 'color:var(--g)' : 'color:var(--r)';
              const curStr     = effectiveCurPrem !== undefined && effectiveCurPrem !== null ? `$${Number(effectiveCurPrem).toFixed(2)}` : '—';
              const pctCapStr  = pctCap !== null ? `${pctCap}%` : '—';

              return (
                <tr key={pos.id} onClick={() => onSelectPos(pos.id)}>
                  <td>
                    <div className="pos-ticker-cell">
                      <div className="pos-ticker-name">{pos.ticker}</div>
                      <span
                        title="Edit position"
                        style={{ fontSize: 11, color: 'var(--mu)', cursor: 'pointer', marginLeft: 4, lineHeight: 1 }}
                        onClick={e => { e.stopPropagation(); onEditPos(pos.id); }}
                      >✎</span>
                    </div>
                  </td>
                  <td><span className={`pos-type-pill ${isPut ? 'put' : 'call'}`}>{isPut ? 'Put' : 'Call'}</span></td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--bl)' }}>${pos.strike || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{formatDateDisplay(pos.expiry)}</td>
                  <td style={{ fontFamily: 'var(--mono)', ...(dteColor ? { color: dteColor } : {}) }}>
                    {dteStr}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--g)' }}>${pos.prem ? pos.prem.toFixed(2) : '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{curStr}</td>
                  <td style={{ fontFamily: 'var(--mono)', ...(pnl !== null ? { color: pnl >= 0 ? 'var(--g)' : 'var(--r)' } : {}) }}>
                    {pnl !== null ? `${pnl >= 0 ? '+' : ''} $${Math.abs(pnl).toFixed(0)}` : '—'}
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
