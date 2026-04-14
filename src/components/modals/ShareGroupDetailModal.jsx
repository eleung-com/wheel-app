import React from 'react';

export default function ShareGroupDetailModal({ ticker, positions, watchlist, onEditPos, onAddLot, onClose }) {
  const lots = positions.filter(p => p.type === 'shares' && p.ticker === ticker);
  if (!lots.length) return null;

  const totalQty  = lots.reduce((sum, p) => sum + p.qty, 0);
  const totalCost = lots.reduce((sum, p) => sum + (p.cost || 0) * p.qty, 0);
  const avgCost   = totalQty > 0 ? totalCost / totalQty : 0;
  const liveQ     = watchlist.find(w => w.ticker === ticker)?.liveData;
  const mktPrice  = liveQ?.price || null;
  const unrealPnl = mktPrice && avgCost > 0 ? (mktPrice - avgCost) * totalQty : null;
  const contracts = Math.floor(totalQty / 100);

  return (
    <>
      <div className="mtitle">{ticker} · Shares</div>

      <div className="dsec">
        <div className="dlbl">Summary</div>
        <div className="mgrid c2">
          <div className="met"><div className="met-l">Total shares</div><div className="met-v g" style={{ fontSize: 18 }}>{totalQty}</div></div>
          <div className="met"><div className="met-l">Avg cost basis</div><div className="met-v" style={{ fontFamily: 'var(--mono)' }}>{avgCost > 0 ? `$${avgCost.toFixed(2)}` : '—'}</div></div>
          <div className="met"><div className="met-l">Market price</div><div className="met-v" style={{ fontFamily: 'var(--mono)' }}>{mktPrice ? `$${mktPrice.toFixed(2)}` : '—'}</div></div>
          <div className="met">
            <div className="met-l">Unrealized P&amp;L</div>
            <div className="met-v" style={{ fontFamily: 'var(--mono)', color: unrealPnl === null ? undefined : unrealPnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
              {unrealPnl !== null ? `${unrealPnl >= 0 ? '+' : ''}$${Math.abs(unrealPnl).toFixed(0)}` : '—'}
            </div>
          </div>
          <div className="met"><div className="met-l">Covered call capacity</div><div className="met-v b">{contracts} contract{contracts !== 1 ? 's' : ''}</div></div>
          <div className="met"><div className="met-l">Lots</div><div className="met-v">{lots.length}</div></div>
        </div>
      </div>

      <div className="dsec">
        <div className="dlbl">Purchase Log</div>
        <table className="lot-table">
          <thead>
            <tr><th>Date</th><th>Shares</th><th>Cost/sh</th><th>Total</th><th></th></tr>
          </thead>
          <tbody>
            {[...lots].sort((a, b) => (a.enteredAt || 0) - (b.enteredAt || 0)).map(lot => (
              <tr key={lot.id}>
                <td>{lot.enteredAt ? new Date(lot.enteredAt).toLocaleDateString() : '—'}</td>
                <td>{lot.qty}</td>
                <td>{lot.cost > 0 ? `$${Number(lot.cost).toFixed(2)}` : '—'}</td>
                <td>{lot.cost > 0 ? `$${(lot.cost * lot.qty).toFixed(0)}` : '—'}</td>
                <td>
                  <button
                    className="lot-edit-btn"
                    onClick={e => { e.stopPropagation(); onEditPos(lot.id); }}
                  >Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lots.some(l => l.notes) && (
        <div className="dsec">
          <div className="dlbl">Notes</div>
          {lots.filter(l => l.notes).map(lot => (
            <div key={lot.id} style={{ fontSize: 12, color: 'var(--mu2)', fontStyle: 'italic', marginBottom: 4 }}>
              {lot.notes}
            </div>
          ))}
        </div>
      )}

      <button className="btn-p" onClick={() => onAddLot(ticker)} style={{ marginBottom: 0 }}>+ Add Another Lot</button>
      <button className="btn-s" onClick={onClose}>Close</button>
    </>
  );
}
