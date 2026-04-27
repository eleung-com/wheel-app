import React, { useEffect, useRef } from 'react';

function TVTechAnalysis({ ticker }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
    script.async = true;
    script.textContent = JSON.stringify({
      interval:         '1D',
      width:            '100%',
      isTransparent:    true,
      height:           250,
      symbol:           ticker,
      showIntervalTabs: false,
      displayMode:      'single',
      locale:           'en',
      colorTheme:       'dark',
    });
    containerRef.current.appendChild(script);

    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
  }, [ticker]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}

export default function WatchlistCard({ watch: w, onRemove, onEditNotes }) {
  return (
    <div className="witem" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 10 }}>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div className="wtkr" style={{ fontSize: 15 }}>{w.ticker}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <a href={`https://www.tradingview.com/chart/?symbol=${w.ticker}`} target="_blank" rel="noreferrer"
            title="Open in TradingView"
            style={{ color: 'var(--mu)', fontSize: 10, textDecoration: 'none', fontFamily: 'var(--mono)', padding: '2px 4px', letterSpacing: '-0.3px' }}>TV</a>
          <button onClick={() => onEditNotes && onEditNotes(w.ticker)} title="Edit notes"
            style={{ background: 'none', border: 'none', color: w.notes ? 'var(--bl)' : 'var(--mu)', fontSize: 13, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>✎</button>
          <button onClick={() => onRemove(w.ticker)} title="Remove"
            style={{ background: 'none', border: 'none', color: 'var(--mu)', fontSize: 16, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* TradingView Technical Analysis widget */}
      <TVTechAnalysis ticker={w.ticker} />

      {/* Notes */}
      {w.notes && (
        <div style={{ fontSize: 10, color: 'var(--mu2)', borderTop: '1px solid var(--b1)', paddingTop: 5, width: '100%', lineHeight: 1.4 }}>
          {w.notes}
        </div>
      )}
    </div>
  );
}
