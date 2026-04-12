import React, { useState } from 'react';
import { useAppContext } from '../store';
import { Plus, X } from 'lucide-react';

export default function WatchlistPage() {
  const { watchlist, setWatchlist, criteria, syncToSheet } = useAppContext();
  const [newTicker, setNewTicker] = useState('');

  const addTicker = (e) => {
    e.preventDefault();
    const tick = newTicker.trim().toUpperCase();
    if (!tick) return;
    if (watchlist.find(w => w.ticker === tick)) {
      alert('Already watching ' + tick);
      return;
    }
    
    const newW = [...watchlist, { ticker: tick, addedAt: Date.now(), liveData: null }];
    setWatchlist(newW);
    syncToSheet({ watchlist: newW });
    setNewTicker('');
  };

  const removeTicker = (ticker) => {
    const newW = watchlist.filter(w => w.ticker !== ticker);
    setWatchlist(newW);
    syncToSheet({ watchlist: newW });
  };

  return (
    <div style={{ padding: '15px', color: 'var(--fg)', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Watchlist <span className="bdg p">{watchlist.length}</span></h2>
      </div>

      <form onSubmit={addTicker} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <input 
          type="text" 
          placeholder="Add Ticker (e.g. AAPL)" 
          value={newTicker}
          onChange={e => setNewTicker(e.target.value)}
          style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white', textTransform: 'uppercase' }}
        />
        <button type="submit" className="btn-p" style={{ padding: '0 16px' }}><Plus size={18} /></button>
      </form>

      {watchlist.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔭</div>
          <div className="empty-title">No tickers</div>
          <div className="empty-sub">Tap + to add a ticker to screen.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {watchlist.map(w => {
            const d = w.liveData;
            let pills = [];
            let stTxt = '';
            let stObj = { color: 'var(--mu)', bg: 'rgba(255,255,255,0.1)' };

            if (!d) {
              pills = [{ l: 'Tap ↻ to screen', ok: false, warn: true }];
              stTxt = '⏳ No data yet — tap ↻ above';
            } else {
              const chks = [
                { l: `IVR ${d.ivrEst !== null ? d.ivrEst+'%' : '?'}`, ok: d.ivrEst !== null && d.ivrEst >= criteria.ivr },
                { l: `RSI ${d.rsiEst !== null ? d.rsiEst.toFixed(0) : '?'}`, ok: d.rsiEst !== null && d.rsiEst <= criteria.rsi },
                { l: `Stoch ${d.stochEst !== null ? d.stochEst.toFixed(0) : '?'}`, ok: d.stochEst !== null && d.stochEst <= criteria.stoch },
                { l: `${criteria.ma}MA`, ok: d.aboveMa !== false },
              ];
              pills = chks;

              const pass = chks.filter(c => c.ok).length;
              if (pass === 4) { stTxt = '✓ CSP ready'; stObj = { color: 'var(--g)', bg: 'rgba(0,255,0,0.1)' }; }
              else if (pass >= 2) { stTxt = `${pass}/4 met`; stObj = { color: 'var(--a)', bg: 'rgba(255,165,0,0.1)' }; }
              else { stTxt = `${pass}/4 met`; }
            }

            const price = d && d.price ? `$${d.price.toFixed(2)}` : '—';
            const chg1d = d && d.chg1d !== null ? d.chg1d : 0;
            const chgC = chg1d >= 0 ? 'var(--g)' : 'var(--r)';

            return (
              <div key={w.ticker} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'var(--bg2)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{w.ticker}</div>
                   <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--mu2)' }}>
                        {price} <span style={{ color: chgC }}>{chg1d >= 0 ? '+' : ''}{chg1d.toFixed(1)}%</span>
                      </span>
                      <X size={14} color="var(--mu)" style={{ cursor: 'pointer' }} onClick={() => removeTicker(w.ticker)} />
                   </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {pills.map((p, i) => (
                    <span key={i} style={{ 
                      fontSize: '9px', padding: '2px 6px', borderRadius: '4px', 
                      backgroundColor: p.warn ? 'rgba(255,165,0,0.2)' : (p.ok ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)'), 
                      color: p.warn ? 'var(--a)' : (p.ok ? 'var(--g)' : 'var(--r)') 
                    }}>
                      {p.warn ? '!' : (p.ok ? '✓' : '✗')} {p.l}
                    </span>
                  ))}
                </div>

                <div style={{ fontSize: '10px', marginTop: 'auto', paddingTop: '6px', color: stObj.color, fontWeight: 'bold' }}>
                  {stTxt}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
