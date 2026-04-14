import React from 'react';
import WatchlistCard from './WatchlistCard';

export default function WatchlistPage({ watchlist, criteria, onRemove }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="slabel" style={{ margin: 0 }}>CSP Watchlist</div>
        <div style={{ fontSize: 10, color: 'var(--mu)' }}>Screened live</div>
      </div>

      <div id="watch-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
        {watchlist.length === 0 ? (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="empty-icon">🔭</div>
            <div className="empty-title">No tickers</div>
            <div className="empty-sub">Tap + to add a ticker to screen.</div>
          </div>
        ) : (
          watchlist.map(w => (
            <WatchlistCard key={w.ticker} watch={w} criteria={criteria} onRemove={onRemove} />
          ))
        )}
      </div>
    </div>
  );
}
