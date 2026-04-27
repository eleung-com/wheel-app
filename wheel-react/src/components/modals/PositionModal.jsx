import React, { useState } from 'react';
import { normalizeDate, ACCOUNTS } from '../../lib/utils';

function initState(pos) {
  if (!pos) return {
    ticker: '', type: 'shares', qty: '', cost: '',
    openDate: '', strike: '', expiry: '', prem: '', curPrem: '', notes: '', account: 'Esther',
  };
  return {
    ticker:   pos.ticker,
    type:     pos.type,
    qty:      String(pos.qty),
    cost:     pos.cost != null ? String(pos.cost) : '',
    openDate: pos.enteredAt ? new Date(pos.enteredAt).toISOString().slice(0, 10) : '',
    strike:   pos.strike  != null ? String(pos.strike)  : '',
    expiry:   normalizeDate(pos.expiry),
    prem:     pos.prem    != null ? String(pos.prem)    : '',
    curPrem:  pos.curPrem != null ? String(pos.curPrem) : '',
    notes:    pos.notes   || '',
    account:  pos.account || 'Esther',
  };
}

export default function PositionModal({ editId, initialType, positions, onSave, onDelete, onClose }) {
  const pos = editId ? positions.find(p => p.id === editId) : null;
  const [f, setF] = useState(() => {
    const base = initState(pos);
    if (!editId && initialType) base.type = initialType;
    return base;
  });

  const isOpt = f.type !== 'shares';

  function set(key, val) { setF(prev => ({ ...prev, [key]: val })); }

  function handleTypeChange(e) {
    setF(prev => ({ ...prev, type: e.target.value }));
  }

  function handleSave() {
    const ticker = f.ticker.trim().toUpperCase();
    const qty    = parseFloat(f.qty);
    if (!ticker || !qty) { alert('Ticker and quantity are required.'); return; }

    const openDateVal = f.openDate;
    const enteredAt   = openDateVal
      ? new Date(openDateVal + 'T12:00:00').getTime()
      : (editId ? (pos?.enteredAt || Date.now()) : Date.now());

    const newPos = {
      id: editId || Date.now(),
      ticker, type: f.type, qty, notes: f.notes.trim(), account: f.account, enteredAt,
    };

    if (f.type === 'shares') {
      const cost = parseFloat(f.cost);
      newPos.cost = isNaN(cost) ? 0 : cost;
    } else {
      newPos.strike = parseFloat(f.strike) || 0;
      newPos.expiry = f.expiry || '';
      const prem = parseFloat(f.prem);
      if (isNaN(prem)) { alert('Premium collected is required.'); return; }
      newPos.prem = prem;
      newPos.cost = prem;
      const cp = parseFloat(f.curPrem);
      if (!isNaN(cp)) newPos.curPrem = cp;
    }

    onSave(newPos);
  }

  function handleDelete() {
    if (!confirm('Remove this position?')) return;
    onDelete(editId);
  }

  return (
    <>
      <div className="mtitle">{editId ? 'Edit Position' : 'Add Position'}</div>

      {/* Row 1: Ticker + Type */}
      <div className="mg2">
        <div>
          <div className="mlbl">Ticker</div>
          <input
            className="minput"
            placeholder="TSLA"
            maxLength={10}
            autoComplete="off"
            style={{ margin: 0, fontSize: 18, letterSpacing: 2 }}
            value={f.ticker}
            onChange={e => set('ticker', e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <div className="mlbl">Position type</div>
          <select className="msel" value={f.type} onChange={handleTypeChange} style={{ margin: 0 }}>
            <option value="shares">Shares (Long)</option>
            <option value="short_put">Short Put</option>
            <option value="short_call">Short Call</option>
          </select>
        </div>
      </div>

      {/* Row 2: Qty + Cost (shares only) */}
      <div className="mg2" style={{ marginTop: 9 }}>
        <div>
          <div className="mlbl">Qty / Contracts</div>
          <input className="minput norm" type="number" placeholder="100" style={{ margin: 0 }} value={f.qty} onChange={e => set('qty', e.target.value)} />
        </div>
        {!isOpt && (
          <div>
            <div className="mlbl">Cost basis / share</div>
            <input className="minput norm" type="number" placeholder="0.00" step="0.01" style={{ margin: 0 }} value={f.cost} onChange={e => set('cost', e.target.value)} />
          </div>
        )}
      </div>

      {/* Open date + Account */}
      <div className="mg2" style={{ marginTop: 9 }}>
        <div>
          <div className="mlbl">Open date <span style={{ color: 'var(--mu)', fontSize: 9 }}>— blank = today</span></div>
          <input className="minput norm" type="date" style={{ margin: 0, color: 'var(--tx)' }} value={f.openDate} onChange={e => set('openDate', e.target.value)} />
        </div>
        <div>
          <div className="mlbl">Account</div>
          <select className="msel" value={f.account} onChange={e => set('account', e.target.value)} style={{ margin: 0 }}>
            {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Options-only fields */}
      {isOpt && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--b1)' }}>
          <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 9 }}>Option details</div>
          <div className="mg2" style={{ marginBottom: 9 }}>
            <div>
              <div className="mlbl">Strike price</div>
              <input className="minput norm" type="number" placeholder="45.00" step="0.5" style={{ margin: 0 }} value={f.strike} onChange={e => set('strike', e.target.value)} />
            </div>
            <div>
              <div className="mlbl">Expiry date</div>
              <input className="minput norm" type="date" style={{ margin: 0, color: 'var(--tx)' }} value={f.expiry} onChange={e => set('expiry', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 9 }}>
            <div className="mlbl">Premium collected / share <span style={{ color: 'var(--mu)', fontSize: 9 }}>— e.g. $1.85 = $185 per contract</span></div>
            <input className="minput norm" type="number" placeholder="1.85" step="0.01" style={{ margin: 0 }} value={f.prem} onChange={e => set('prem', e.target.value)} />
          </div>
          <div>
            <div className="mlbl">Current option price <span style={{ color: 'var(--mu)', fontSize: 9 }}>— auto-fetched on ↻, override if needed</span></div>
            <input className="minput norm" type="number" placeholder="auto" step="0.01" style={{ margin: 0 }} value={f.curPrem} onChange={e => set('curPrem', e.target.value)} />
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ marginTop: 9 }}>
        <div className="mlbl">Notes <span style={{ color: 'var(--mu)', fontSize: 9 }}>— optional</span></div>
        <input className="minput norm" placeholder="e.g. assigned at 185, part of TSLA wheel" style={{ margin: 0 }} value={f.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn-p" onClick={handleSave}>Save Position</button>
        <button className="btn-s" onClick={onClose}>Cancel</button>
        {editId && (
          <button className="btn-s" onClick={handleDelete} style={{ color: 'var(--r)', borderColor: 'rgba(255,82,82,.3)' }}>
            Delete Position
          </button>
        )}
      </div>
    </>
  );
}
