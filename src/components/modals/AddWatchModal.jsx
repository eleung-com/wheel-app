import React, { useState } from 'react';

export default function AddWatchModal({ watchlist, onAdd, onClose }) {
  const [ticker, setTicker] = useState('');

  function handleAdd() {
    const v = ticker.trim().toUpperCase();
    if (!v) return;
    if (watchlist.find(w => w.ticker === v)) {
      alert('Already watching ' + v);
      return;
    }
    onAdd(v);
    setTicker('');
  }

  return (
    <>
      <div className="mtitle">Add to Watchlist</div>
      <input
        className="minput"
        placeholder="AAPL"
        maxLength={10}
        autoComplete="off"
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        autoFocus
      />
      <div className="mhint">Screener checks IVR, RSI, Stochastic &amp; MA against this ticker on every refresh.</div>
      <button className="btn-p" onClick={handleAdd}>Add Ticker</button>
      <button className="btn-s" onClick={onClose}>Cancel</button>
    </>
  );
}
