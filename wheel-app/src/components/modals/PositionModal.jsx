import React, { useState } from 'react';
import { normalizeDate, ACCOUNTS } from '../../lib/utils';
import { buildPutSpreadLegs } from '../../lib/optionYield';
import YieldSummary from '../pages/ToolsPage/YieldSummary';
import { PnLChart, StatsBar } from '../pages/PnLPage/PnLChart';

function initState(pos) {
  if (!pos) return {
    ticker: '', type: 'shares', qty: '', cost: '',
    openDate: '', strike: '', expiry: '', prem: '', curPrem: '', notes: '', account: 'Esther',
    // Put-credit-spread fields (strike above holds the SHORT leg for spreads)
    longStrike: '', shortPrem: '', longPrem: '',
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
    // No longer editable — the screener fetches the live price on every refresh.
    // Carried through so editing a position doesn't wipe what the sheet has stored.
    curPrem:  pos.curPrem != null ? String(pos.curPrem) : '',
    notes:    pos.notes   || '',
    account:  pos.account || 'Esther',
    // Carried through so editing a spread never wipes the long leg / leg prems.
    longStrike: pos.longStrike != null ? String(pos.longStrike) : '',
    shortPrem:  pos.shortPrem  != null ? String(pos.shortPrem)  : '',
    longPrem:   pos.longPrem   != null ? String(pos.longPrem)   : '',
  };
}

export default function PositionModal({ editId, initialType, positions, onSave, onDelete, onClose }) {
  const pos = editId ? positions.find(p => p.id === editId) : null;
  const [f, setF] = useState(() => {
    const base = initState(pos);
    if (!editId && initialType) base.type = initialType;
    return base;
  });

  const isSpread    = f.type === 'put_spread';
  const isOpt       = f.type !== 'shares';       // any option strategy
  const isSingleOpt = isOpt && !isSpread;        // short_put / short_call

  // Live projection inputs — DTE runs from the open date (or today) to expiry.
  const openMs = f.openDate ? new Date(f.openDate + 'T12:00:00').getTime() : Date.now();
  const expMs  = f.expiry   ? new Date(f.expiry   + 'T12:00:00').getTime() : null;
  const dte    = expMs ? Math.max(0, Math.round((expMs - openMs) / 86400000)) : 0;

  // Spread-only derived values
  const shortPremNum = parseFloat(f.shortPrem);
  const longPremNum  = parseFloat(f.longPrem);
  const netCredit    = (!isNaN(shortPremNum) && !isNaN(longPremNum)) ? shortPremNum - longPremNum : NaN;
  const spreadValid  = isSpread
    && parseFloat(f.strike) > 0
    && parseFloat(f.longStrike) > 0
    && parseFloat(f.longStrike) < parseFloat(f.strike)
    && netCredit > 0;

  const showSingleProjection = isSingleOpt && parseFloat(f.strike) > 0 && parseFloat(f.prem) > 0;
  const showProjection = showSingleProjection || spreadValid;

  const legs = isSpread
    ? buildPutSpreadLegs({
        shortStrike: f.strike, longStrike: f.longStrike,
        shortPrem: f.shortPrem, longPrem: f.longPrem, qty: f.qty || '1',
      })
    : [{
        id: 1, action: 'sell',
        optType: f.type === 'short_call' ? 'call' : 'put',
        qty: f.qty || '1', strike: f.strike, premium: f.prem, expiry: f.expiry,
      }];

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

    } else if (isSpread) {
      const ss = parseFloat(f.strike);       // short strike (higher)
      const ls = parseFloat(f.longStrike);   // long strike (lower)
      const sp = parseFloat(f.shortPrem);
      const lp = parseFloat(f.longPrem);
      if (isNaN(ss) || ss <= 0) { alert('Short put strike is required.'); return; }
      if (isNaN(ls) || ls <= 0) { alert('Long put strike is required.'); return; }
      if (ls >= ss)             { alert('Long strike must be below the short strike for a put credit spread.'); return; }
      if (isNaN(sp) || sp <= 0) { alert('Short leg premium is required.'); return; }
      if (isNaN(lp) || lp <  0) { alert('Long leg premium is required.'); return; }
      const nc = sp - lp;
      if (nc <= 0) { alert('Net credit must be positive — short premium has to exceed long premium.'); return; }
      newPos.strike     = ss;   // short strike
      newPos.longStrike = ls;
      newPos.expiry     = f.expiry || '';
      newPos.shortPrem  = sp;
      newPos.longPrem   = lp;
      newPos.prem       = nc;   // net credit per share
      newPos.cost       = nc;

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
            autoFocus
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
            <option value="put_spread">Put Credit Spread</option>
          </select>
        </div>
      </div>

      {/* Row 2: Qty + Cost (shares only) */}
      <div className="mg2" style={{ marginTop: 9 }}>
        <div>
          <div className="mlbl">{isSpread ? 'Spreads / Contracts' : 'Qty / Contracts'}</div>
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

      {/* Single-leg option fields (short put / short call) */}
      {isSingleOpt && (
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
          <div>
            <div className="mlbl">Premium collected / share <span style={{ color: 'var(--mu)', fontSize: 9 }}>— e.g. $1.85 = $185 per contract</span></div>
            <input className="minput norm" type="number" placeholder="1.85" step="0.01" style={{ margin: 0 }} value={f.prem} onChange={e => set('prem', e.target.value)} />
          </div>
        </div>
      )}

      {/* Put credit spread fields */}
      {isSpread && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--b1)' }}>
          <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 9 }}>
            Put credit spread — sell higher strike, buy lower
          </div>
          <div className="mg2" style={{ marginBottom: 9 }}>
            <div>
              <div className="mlbl">Short strike <span style={{ color: 'var(--mu)', fontSize: 9 }}>— sell (higher)</span></div>
              <input className="minput norm" type="number" placeholder="45.00" step="0.5" style={{ margin: 0 }} value={f.strike} onChange={e => set('strike', e.target.value)} />
            </div>
            <div>
              <div className="mlbl">Long strike <span style={{ color: 'var(--mu)', fontSize: 9 }}>— buy (lower)</span></div>
              <input className="minput norm" type="number" placeholder="40.00" step="0.5" style={{ margin: 0 }} value={f.longStrike} onChange={e => set('longStrike', e.target.value)} />
            </div>
          </div>
          <div className="mg2" style={{ marginBottom: 9 }}>
            <div>
              <div className="mlbl">Short premium <span style={{ color: 'var(--mu)', fontSize: 9 }}>— received</span></div>
              <input className="minput norm" type="number" placeholder="1.85" step="0.01" style={{ margin: 0 }} value={f.shortPrem} onChange={e => set('shortPrem', e.target.value)} />
            </div>
            <div>
              <div className="mlbl">Long premium <span style={{ color: 'var(--mu)', fontSize: 9 }}>— paid</span></div>
              <input className="minput norm" type="number" placeholder="0.70" step="0.01" style={{ margin: 0 }} value={f.longPrem} onChange={e => set('longPrem', e.target.value)} />
            </div>
          </div>
          <div>
            <div className="mlbl">Expiry date <span style={{ color: 'var(--mu)', fontSize: 9 }}>— both legs</span></div>
            <input className="minput norm" type="date" style={{ margin: 0, color: 'var(--tx)' }} value={f.expiry} onChange={e => set('expiry', e.target.value)} />
          </div>
          {/* Live net-credit readout */}
          <div style={{ marginTop: 9, fontFamily: 'var(--mono)', fontSize: 12, color: netCredit > 0 ? 'var(--g)' : 'var(--mu)' }}>
            Net credit: {!isNaN(netCredit) ? `$${netCredit.toFixed(2)}/share` : '—'}
            {parseFloat(f.strike) > 0 && parseFloat(f.longStrike) > 0 && (
              <span style={{ color: 'var(--mu)', marginLeft: 8 }}>
                · width ${(parseFloat(f.strike) - parseFloat(f.longStrike)).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ marginTop: 9 }}>
        <div className="mlbl">Notes <span style={{ color: 'var(--mu)', fontSize: 9 }}>— optional</span></div>
        <input className="minput norm" placeholder="e.g. assigned at 185, part of TSLA wheel" style={{ margin: 0 }} value={f.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {/* Live yield + P&L projection */}
      {showProjection && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--b1)' }}>
          <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: '.5px', textTransform: 'uppercase', marginBottom: 9 }}>
            Projected yield{dte > 0 ? ` · ${dte} DTE` : ''}
          </div>
          {isSpread
            ? <YieldSummary spread={{ shortStrike: f.strike, longStrike: f.longStrike, shortPrem: f.shortPrem, longPrem: f.longPrem }} qty={f.qty} dte={dte} />
            : <YieldSummary prem={f.prem} strike={f.strike} qty={f.qty} dte={dte} />}

          <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: '.5px', textTransform: 'uppercase', margin: '14px 0 9px' }}>
            P&amp;L at expiry
          </div>
          <StatsBar legs={legs} />
          <PnLChart legs={legs} />
        </div>
      )}

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
