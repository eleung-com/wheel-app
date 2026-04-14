import React from 'react';

export default function SharesTable({ shareGroups, watchlist, onShowGroup }) {
  const keys = Object.keys(shareGroups).sort();
  if (!keys.length) return null;

  return (
    <>
      <div className="pos-section-hdr">
        <span style={{ background: 'var(--bl)' }}></span>Shares
      </div>
      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', overflow: 'hidden', marginBottom: 12 }}>
        <table className="pos-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Shares</th>
              <th>Avg Cost</th>
              <th>Mkt Price</th>
              <th>Lots</th>
            </tr>
          </thead>
          <tbody>
            {keys.map(key => {
              const g        = shareGroups[key];
              const avgCost  = g.totalQty > 0 ? g.totalCost / g.totalQty : 0;
              const lotLabel = `${g.lots.length} lot${g.lots.length > 1 ? 's' : ''}`;
              // Prefer live price dispatched by screener, then persisted sheet value, then watchlist liveData
              const liveQ    = watchlist.find(w => w.ticker === g.ticker)?.liveData;
              const rawPrice = g.lots[0]?._livePrice || g.lots[0]?.marketPrice || liveQ?.price || null;
              const mktPrice = rawPrice ? `$${Number(rawPrice).toFixed(2)}` : '—';

              return (
                <tr key={key} onClick={() => onShowGroup(g.ticker)}>
                  <td>
                    <div className="pos-ticker-cell">
                      <div className="pos-ticker-name">{g.ticker}</div>
                      <span className="pos-lot-badge">{lotLabel}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--g)' }}>{g.totalQty}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{avgCost > 0 ? `$${avgCost.toFixed(2)}` : '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{mktPrice}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mu2)' }}>{g.lots.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
