import React from 'react';
import SharesTable from './SharesTable';
import OptionsTable from './OptionsTable';

export default function PositionsPage({ positions, watchlist, onSelectOptPos, onEditPos, onShowShareGroup }) {
  if (!positions.length) {
    return (
      <div id="pos-container">
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">No positions</div>
          <div className="empty-sub">Tap + to add shares or an open short option.</div>
        </div>
      </div>
    );
  }

  // Group shares by ticker
  const shareGroups = {};
  for (const pos of positions.filter(p => p.type === 'shares')) {
    if (!shareGroups[pos.ticker]) {
      shareGroups[pos.ticker] = { ticker: pos.ticker, lots: [], totalQty: 0, totalCost: 0 };
    }
    shareGroups[pos.ticker].lots.push(pos);
    shareGroups[pos.ticker].totalQty  += pos.qty;
    shareGroups[pos.ticker].totalCost += (pos.cost || 0) * pos.qty;
  }

  const optPositions = positions.filter(p => p.type !== 'shares');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="slabel" style={{ margin: 0 }}>Open Positions</div>
        <div style={{ fontSize: 10, color: 'var(--mu)' }}>Tap row for details</div>
      </div>
      <div id="pos-container">
        <OptionsTable
          optPositions={optPositions}
          onSelectPos={onSelectOptPos}
          onEditPos={onEditPos}
        />
        <SharesTable
          shareGroups={shareGroups}
          watchlist={watchlist}
          onShowGroup={onShowShareGroup}
        />
      </div>
    </div>
  );
}
