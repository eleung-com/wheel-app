import React, { useState } from 'react';
import { useAppContext } from '../store';
import { Plus, X, ArrowRight, Check } from 'lucide-react';

export default function PositionsPage() {
  const { positions, setPositions, history, setHistory, syncToSheet } = useAppContext();
  
  const [closeModal, setCloseModal] = useState(null); // stores the position object to close
  const [exitPrice, setExitPrice] = useState('');
  const [journal, setJournal] = useState('');

  // Editor Modal can represent an existing object (edit) or a placeholder (add)
  const [editorState, setEditorState] = useState(null); 
  const isEditing = editorState && !!editorState.id;

  const dte = (expiry) => {
    if (!expiry) return null;
    const now = new Date(); now.setHours(0,0,0,0);
    return Math.round((new Date(expiry + 'T12:00:00') - now) / 86400000);
  };

  const executeClose = () => {
    if (!closeModal) return;
    const qty = closeModal.qty || 100;
    const exitC = parseFloat(exitPrice);
    if (isNaN(exitC)) return alert('Must provide a valid exit price.');

    let pnl = 0;
    if (closeModal.type === 'shares') {
      pnl = (exitC - (closeModal.cost || 0)) * qty;
    } else {
      pnl = ((closeModal.prem || 0) - exitC) * qty * 100;
    }

    const closedItem = { ...closeModal, exitPrice: exitC, pnl, closedAt: Date.now(), journalNotes: journal };
    const newPositions = positions.filter(p => p.id !== closeModal.id);
    const newHistory = [...(history || []), closedItem];

    setPositions(newPositions);
    setHistory(newHistory);
    syncToSheet({ positions: newPositions, history: newHistory });
    setCloseModal(null);
  };

  const handleSaveEditor = (e) => {
    e.preventDefault();
    if (!editorState.ticker) return alert('Ticker is required');
    
    let newPositions;
    if (isEditing) {
      newPositions = positions.map(p => p.id === editorState.id ? { ...p, ...editorState } : p);
    } else {
      newPositions = [...positions, { ...editorState, id: Date.now(), enteredAt: Date.now() }];
    }

    setPositions(newPositions);
    syncToSheet({ positions: newPositions });
    setEditorState(null);
  };

  return (
    <div style={{ padding: '15px', color: 'var(--fg)', paddingBottom: '80px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Active Positions <span className="bdg b">{positions.length}</span></h2>
        <button className="btn-p" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditorState({ type: 'short_put', ticker: '', qty: 1, strike: '', expiry: '', prem: '' })}>
          <Plus size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/> Add Position
        </button>
      </div>

      {positions.length === 0 ? (
        <div className="empty" style={{ marginTop: '20px' }}>
          <div className="empty-icon">📂</div>
          <div className="empty-title">No Active Positions</div>
          <div className="empty-sub">Add shares or options to start tracking them.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {positions.map(pos => {
            const typeLabel = { shares:'🟦 Shares', short_put:'🟢 Put', short_call:'🟠 Call' }[pos.type] || pos.type;
            const days = dte(pos.expiry);
            const liveC = pos.curPrem !== undefined && pos.curPrem !== null ? pos.curPrem : pos.prem;
            const openPnl = pos.type === 'shares' 
              ? (liveC !== undefined && liveC !== null && pos.cost ? (liveC - pos.cost)*pos.qty : null)
              : (liveC !== undefined && liveC !== null && pos.prem ? (pos.prem - liveC)*pos.qty*100 : null);

            return (
              <div key={pos.id} className="pcard" style={{ padding: '12px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{pos.ticker}</div>
                    <div style={{ fontSize: '10px', color: 'var(--mu)', marginTop: '2px' }}>{typeLabel}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: openPnl >= 0 ? 'var(--g)' : openPnl < 0 ? 'var(--r)' : 'var(--mu)' }}>
                      {openPnl !== null ? (openPnl >= 0 ? '+' : '') + '$' + Math.abs(openPnl).toFixed(0) : '—'}
                    </div>
                    {pos.type !== 'shares' && <div style={{ fontSize: '10px', color: 'var(--mu)' }}>{days !== null ? days + 'd left' : ''}</div>}
                  </div>
                </div>

                {pos.type !== 'shares' ? (
                  <div className="mgrid c2" style={{ marginBottom: '6px' }}>
                     <div className="met"><div className="met-l">Strike</div><div className="met-v b" style={{ fontSize: '11px'}}>${pos.strike || '—'}</div></div>
                     <div className="met"><div className="met-l">Collected</div><div className="met-v g" style={{ fontSize: '11px'}}>${pos.prem !== undefined ? parseFloat(pos.prem).toFixed(2) : '—'}</div></div>
                     <div className="met"><div className="met-l">Current</div><div className="met-v" style={{ fontSize: '11px'}}>${liveC !== undefined && liveC !== null ? parseFloat(liveC).toFixed(2) : '—'}</div></div>
                     <div className="met"><div className="met-l">Expiry</div><div className="met-v" style={{ fontSize: '11px'}}>{pos.expiry || '—'}</div></div>
                  </div>
                ) : (
                  <div className="mgrid c2" style={{ marginBottom: '6px' }}>
                     <div className="met"><div className="met-l">Shares</div><div className="met-v g" style={{ fontSize: '11px'}}>{pos.qty}</div></div>
                     <div className="met"><div className="met-l">Basis</div><div className="met-v" style={{ fontSize: '11px'}}>${pos.cost !== undefined ? parseFloat(pos.cost).toFixed(2) : '—'}</div></div>
                     <div className="met"><div className="met-l">Current</div><div className="met-v" style={{ fontSize: '11px'}}>${liveC !== undefined && liveC !== null ? parseFloat(liveC).toFixed(2) : '—'}</div></div>
                  </div>
                )}
                
                <div style={{ marginTop: 'auto', display: 'flex', gap: '5px' }}>
                  <button onClick={() => setEditorState({ ...pos })} className="btn-s" style={{ padding: '6px', fontSize: '10px', flex: 1 }}>Edit</button>
                  <button onClick={() => { setCloseModal(pos); setExitPrice(liveC !== null ? liveC : ''); setJournal(''); }} className="btn-p" style={{ padding: '6px', fontSize: '10px', flex: 1, backgroundColor: 'var(--a)' }}>Close</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal Overlay */}
      {editorState && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <form onSubmit={handleSaveEditor} style={{ width: '320px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
             <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px' }}>{isEditing ? 'Edit Position' : 'New Position'}</h3>
             
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                   <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Ticker</label>
                   <input required type="text" value={editorState.ticker || ''} onChange={e => setEditorState({...editorState, ticker: e.target.value.toUpperCase()})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                </div>
                <div>
                   <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Type</label>
                   <select value={editorState.type || 'short_put'} onChange={e => setEditorState({...editorState, type: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }}>
                      <option value="short_put">Short Put</option>
                      <option value="short_call">Short Call</option>
                      <option value="shares">Shares</option>
                   </select>
                </div>
             </div>

             {editorState.type === 'shares' ? (
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Quantity</label>
                    <input type="number" value={editorState.qty || ''} onChange={e => setEditorState({...editorState, qty: parseFloat(e.target.value)})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Cost Basis</label>
                    <input type="number" step="0.01" value={editorState.cost || ''} onChange={e => setEditorState({...editorState, cost: parseFloat(e.target.value)})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                  </div>
               </div>
             ) : (
               <>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', margin: '0 0 4px 0' }}>Qty</label>
                      <input type="number" value={editorState.qty || ''} onChange={e => setEditorState({...editorState, qty: parseFloat(e.target.value)})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', margin: '0 0 4px 0' }}>Strike</label>
                      <input type="number" step="0.5" value={editorState.strike || ''} onChange={e => setEditorState({...editorState, strike: parseFloat(e.target.value)})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', margin: '0 0 4px 0' }}>Premium</label>
                      <input type="number" step="0.01" value={editorState.prem || ''} onChange={e => setEditorState({...editorState, prem: parseFloat(e.target.value)})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }} />
                    </div>
                 </div>
                 <div style={{ marginBottom: '15px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Expiry (YYYY-MM-DD)</label>
                    <input type="date" value={editorState.expiry || ''} onChange={e => setEditorState({...editorState, expiry: e.target.value})} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white', colorScheme: 'dark' }} />
                 </div>
               </>
             )}

             <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={() => setEditorState(null)} className="btn-s" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn-p" style={{ flex: 1 }}>Save</button>
             </div>
          </form>
        </div>
      )}

      {/* Close Position Modal overlay */}
      {closeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: '320px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
             <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px' }}>Close Trade: {closeModal.ticker}</h3>
             
             <div style={{ marginBottom: '12px' }}>
               <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>
                 {closeModal.type === 'shares' ? 'Sell Price (per share)' : 'Buy-to-Close Cost (per option)'}
               </label>
               <input 
                 type="number" 
                 value={exitPrice} 
                 onChange={e => setExitPrice(e.target.value)}
                 style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white' }}
                 placeholder="$0.00"
               />
             </div>

             <div style={{ marginBottom: '20px' }}>
               <label style={{ fontSize: '11px', color: 'var(--mu)', display: 'block', marginBottom: '4px' }}>Journal Notes & Analysis</label>
               <textarea 
                 value={journal} 
                 onChange={e => setJournal(e.target.value)}
                 style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'white', minHeight: '60px', fontSize: '12px' }}
                 placeholder="Why did you close this? How could it be better next time?"
               />
             </div>

             <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setEditorState(null)} className="btn-s" style={{ flex: 1 }}>Cancel</button>
                <button onClick={executeClose} className="btn-p" style={{ flex: 1 }}>Confirm Close</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
