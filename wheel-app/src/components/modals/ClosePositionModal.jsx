import React, { useState } from 'react';
import { formatDateDisplay } from '../../lib/utils';

export default function ClosePositionModal({ posId, positions, onConfirm, onEdit, onClose }) {
  const pos = positions.find(p => p.id === posId);
  if (!pos) return null;

  const isPut  = pos.type === 'short_put';
  const today  = new Date().toISOString().slice(0, 10);

  const [closeType, setCloseType] = useState('btc');
  const [closeDate, setCloseDate] = useState(today);
  const [btcPrice,  setBtcPrice]  = useState('');
  // Rolled new-leg fields
  const [newType,   setNewType]   = useState(pos.type);
  const [newStrike, setNewStrike] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newPrem,   setNewPrem]   = useState('');
  const [newQty,    setNewQty]    = useState(String(pos.qty));

  const btcNum     = parseFloat(btcPrice);
  const newPremNum = parseFloat(newPrem);
  const newQtyNum  = parseFloat(newQty) || pos.qty;

  const premTotal    = pos.prem && pos.qty ? pos.prem * pos.qty * 100 : 0;
  const maxBtcFor50  = pos.prem ? pos.prem * 0.5 : null;

  // BTC
  const btcPnl      = !isNaN(btcNum) && pos.prem ? (pos.prem - btcNum) * pos.qty * 100 : null;
  const btcMeets50  = maxBtcFor50 !== null && !isNaN(btcNum) && btcNum <= maxBtcFor50;

  // Rolled
  const minNewPremFor50 = maxBtcFor50 !== null && !isNaN(btcNum)
    ? Math.max(0, btcNum - maxBtcFor50)
    : null;
  const rolledNetPnl = !isNaN(btcNum) && !isNaN(newPremNum) && pos.prem
    ? (pos.prem - btcNum + newPremNum) * pos.qty * 100
    : null;
  const rolledMeets50 = rolledNetPnl !== null && rolledNetPnl >= premTotal * 0.5;

  function handleConfirm() {
    const closeDateTs = new Date(closeDate + 'T12:00:00').getTime();

    if (closeType === 'btc') {
      if (isNaN(btcNum) || btcNum < 0) { alert('Enter the buy-to-close price.'); return; }
      onConfirm(pos.id, {
        closeType: 'btc',
        closeDate: closeDateTs,
        closePrice: btcNum,
        pnl: (pos.prem - btcNum) * pos.qty * 100,
      });

    } else if (closeType === 'expired') {
      onConfirm(pos.id, {
        closeType: 'expired',
        closeDate: closeDateTs,
        closePrice: 0,
        pnl: premTotal,
      });

    } else if (closeType === 'assigned') {
      onConfirm(pos.id, {
        closeType: 'assigned',
        closeDate: closeDateTs,
        closePrice: pos.strike || 0,
        pnl: 0,
        sharesAcquired: isPut ?  pos.qty * 100 : -(pos.qty * 100),
        costBasis: isPut
          ? (pos.strike - (pos.prem || 0))
          : (pos.strike + (pos.prem || 0)),
      });

    } else if (closeType === 'rolled') {
      const ns = parseFloat(newStrike);
      if (isNaN(btcNum)    || btcNum < 0)     { alert('Enter the BTC price.');      return; }
      if (isNaN(newPremNum)|| newPremNum <= 0) { alert('Enter the new premium.');    return; }
      if (isNaN(ns)        || ns <= 0)         { alert('Enter the new strike.');     return; }
      if (!newExpiry)                           { alert('Select the new expiry date.'); return; }

      onConfirm(pos.id, {
        closeType: 'rolled',
        closeDate: closeDateTs,
        closePrice: btcNum,
        pnl: (pos.prem - btcNum) * pos.qty * 100,
        newPosition: {
          id:        Date.now() + 1,
          ticker:    pos.ticker,
          type:      newType,
          qty:       newQtyNum,
          strike:    ns,
          expiry:    newExpiry,
          prem:      newPremNum,
          cost:      newPremNum,
          notes:     `Rolled from ${formatDateDisplay(pos.expiry)} $${pos.strike} ${isPut ? 'put' : 'call'}`,
          enteredAt: closeDateTs,
        },
      });
    }
  }

  const TYPES = [
    { key: 'btc',      label: 'Buy to Close' },
    { key: 'expired',  label: 'Expired'      },
    { key: 'assigned', label: 'Assigned'     },
    { key: 'rolled',   label: 'Rolled'       },
  ];

  const pillStyle = (active) => ({
    padding: '8px 0',
    borderRadius: 'var(--r)',
    border: `1px solid ${active ? 'var(--pu)' : 'var(--b1)'}`,
    background: active ? 'rgba(139,92,246,.15)' : 'var(--s2)',
    color: active ? 'var(--pu)' : 'var(--mu2)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  const infoBox = (borderColor = 'var(--b1)') => ({
    background: 'var(--s2)',
    border: `1px solid ${borderColor}`,
    borderRadius: 'var(--r)',
    padding: '9px 12px',
    fontSize: 11,
    marginBottom: 12,
  });

  return (
    <>
      <div className="mtitle">Close Position</div>

      {/* Summary */}
      <div style={{ ...infoBox(), marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15 }}>{pos.ticker}</span>
          <span className={`pos-type-pill ${isPut ? 'put' : 'call'}`}>{isPut ? 'Short Put' : 'Short Call'}</span>
        </div>
        <div style={{ display: 'flex', gap: 14, fontFamily: 'var(--mono)', color: 'var(--mu2)', flexWrap: 'wrap' }}>
          <span>Strike ${pos.strike || '—'}</span>
          <span>Exp {formatDateDisplay(pos.expiry)}</span>
          <span>{pos.qty} contract{pos.qty !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ marginTop: 4, fontFamily: 'var(--mono)', color: 'var(--g)' }}>
          ${pos.prem?.toFixed(2) || '—'}/share
          <span style={{ color: 'var(--mu)', marginLeft: 8 }}>= ${premTotal.toFixed(0)} collected</span>
        </div>
      </div>

      {/* Type selector */}
      <div className="mlbl" style={{ marginBottom: 6 }}>Close type</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
        {TYPES.map(t => (
          <button key={t.key} style={pillStyle(closeType === t.key)} onClick={() => setCloseType(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Close date (all types) */}
      <div style={{ marginBottom: 12 }}>
        <div className="mlbl">Close date</div>
        <input className="minput norm" type="date" style={{ margin: 0, color: 'var(--tx)' }}
          value={closeDate} onChange={e => setCloseDate(e.target.value)} />
      </div>

      {/* ── BTC ─────────────────────────────────────────────────── */}
      {closeType === 'btc' && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div className="mlbl">Buy-to-close price / share</div>
            <input className="minput norm" type="number" placeholder="0.00" step="0.01" style={{ margin: 0 }}
              value={btcPrice} onChange={e => setBtcPrice(e.target.value)} />
          </div>
          <div style={infoBox(btcMeets50 ? 'rgba(57,255,20,.25)' : 'var(--b1)')}>
            <div style={{ color: 'var(--mu)', marginBottom: 3 }}>50% profit target</div>
            <div style={{ fontFamily: 'var(--mono)' }}>
              Max close price: <span style={{ color: 'var(--g)' }}>
                {maxBtcFor50 !== null ? `$${maxBtcFor50.toFixed(2)}` : '—'}
              </span>
            </div>
            {btcPnl !== null && (
              <div style={{ fontFamily: 'var(--mono)', marginTop: 3 }}>
                P&amp;L: <span style={{ color: btcPnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
                  {btcPnl >= 0 ? '+' : ''}${btcPnl.toFixed(0)}
                </span>
                {btcMeets50 && <span style={{ color: 'var(--g)', marginLeft: 10 }}>✓ 50% met</span>}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Expired ─────────────────────────────────────────────── */}
      {closeType === 'expired' && (
        <div style={infoBox('rgba(57,255,20,.25)')}>
          <div style={{ color: 'var(--mu)', marginBottom: 4 }}>Option expired worthless — full profit</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--g)', fontSize: 16 }}>
            +${premTotal.toFixed(0)}
          </div>
          <div style={{ color: 'var(--mu)', marginTop: 2 }}>100% of ${premTotal.toFixed(0)} retained</div>
        </div>
      )}

      {/* ── Assigned ────────────────────────────────────────────── */}
      {closeType === 'assigned' && (
        <div style={infoBox()}>
          {isPut ? (
            <>
              <div style={{ color: 'var(--mu)', marginBottom: 4 }}>Short put assigned — shares acquired</div>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--tx)' }}>
                {pos.qty * 100} shares of {pos.ticker} @ ${pos.strike}
              </div>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--bl)', marginTop: 3 }}>
                Effective cost basis: ${(pos.strike - (pos.prem || 0)).toFixed(2)}/share
              </div>
              <div style={{ color: 'var(--mu)', marginTop: 6, fontSize: 10 }}>
                Add a shares position to continue tracking the wheel.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: 'var(--mu)', marginBottom: 4 }}>Short call assigned — shares called away</div>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--tx)' }}>
                {pos.qty * 100} shares of {pos.ticker} sold @ ${pos.strike}
              </div>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--g)', marginTop: 3 }}>
                Premium retained: +${((pos.prem || 0) * pos.qty * 100).toFixed(0)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Rolled ──────────────────────────────────────────────── */}
      {closeType === 'rolled' && (
        <>
          <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            Close leg
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="mlbl">BTC price / share</div>
            <input className="minput norm" type="number" placeholder="0.00" step="0.01" style={{ margin: 0 }}
              value={btcPrice} onChange={e => setBtcPrice(e.target.value)} />
          </div>

          <div style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, marginTop: 14 }}>
            New leg
          </div>
          <div className="mg2" style={{ marginBottom: 9 }}>
            <div>
              <div className="mlbl">Type</div>
              <select className="msel" style={{ margin: 0 }} value={newType} onChange={e => setNewType(e.target.value)}>
                <option value="short_put">Short Put</option>
                <option value="short_call">Short Call</option>
              </select>
            </div>
            <div>
              <div className="mlbl">Strike</div>
              <input className="minput norm" type="number" placeholder={pos.strike || '45.00'} step="0.5" style={{ margin: 0 }}
                value={newStrike} onChange={e => setNewStrike(e.target.value)} />
            </div>
          </div>
          <div className="mg2" style={{ marginBottom: 9 }}>
            <div>
              <div className="mlbl">Expiry</div>
              <input className="minput norm" type="date" style={{ margin: 0, color: 'var(--tx)' }}
                value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
            </div>
            <div>
              <div className="mlbl">Premium</div>
              <input className="minput norm" type="number" placeholder="1.85" step="0.01" style={{ margin: 0 }}
                value={newPrem} onChange={e => setNewPrem(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="mlbl">Contracts</div>
            <input className="minput norm" type="number" placeholder={pos.qty} style={{ margin: 0 }}
              value={newQty} onChange={e => setNewQty(e.target.value)} />
          </div>

          {/* Roll guidance */}
          <div style={infoBox(rolledMeets50 ? 'rgba(57,255,20,.25)' : 'var(--b1)')}>
            <div style={{ color: 'var(--mu)', marginBottom: 4 }}>Roll targets</div>
            {minNewPremFor50 !== null && (
              <div style={{ fontFamily: 'var(--mono)' }}>
                Min new prem for 50%: <span style={{ color: 'var(--g)' }}>${minNewPremFor50.toFixed(2)}</span>
              </div>
            )}
            {rolledNetPnl !== null && (
              <div style={{ fontFamily: 'var(--mono)', marginTop: 3 }}>
                Net P&amp;L: <span style={{ color: rolledNetPnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
                  {rolledNetPnl >= 0 ? '+' : ''}${rolledNetPnl.toFixed(0)}
                </span>
                {rolledMeets50 && <span style={{ color: 'var(--g)', marginLeft: 10 }}>✓ 50% met</span>}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <button className="btn-p" onClick={handleConfirm}>Confirm Close</button>
        <button className="btn-s" onClick={() => onEdit(posId)}>Edit Position</button>
        <button className="btn-s" onClick={onClose}>Cancel</button>
      </div>
    </>
  );
}
