import React from 'react';

export default function SignalDetailModal({ signalId, signals, positions, onClose }) {
  const s = signals.find(sig => sig.id === signalId);
  if (!s) return null;

  const lbl = { csp: 'Cash-Secured Put', cc: 'Covered Call', roll: 'Roll Position', close: 'Buy to Close' }[s.type];

  // For roll/close signals, find the underlying position
  const posId = signalId ? parseInt(signalId.replace('roll-', '').replace('close-', '')) : null;
  const pos   = (s.type === 'roll' || s.type === 'close') ? positions.find(p => p.id === posId) : null;

  const contracts = s.contracts || 1;
  const total     = s.premEst ? (parseFloat(s.premEst) * contracts * 100).toFixed(0) : null;

  return (
    <>
      <div className="mtitle">{s.ticker} · {lbl}</div>

      <div className="dsec">
        <div className="dlbl">Suggested Action</div>
        <div className="sugg" style={{ margin: 0 }}>{s.suggestion}</div>
      </div>

      {s.type === 'csp' && !s.partial && (
        <div className="dsec">
          <div className="dlbl">Technical Snapshot</div>
          <div className="mgrid c3">
            <div className="met"><div className="met-l">IVR (est.)</div><div className="met-v b">{s.ivr !== null ? `${s.ivr}%` : '—'}</div></div>
            <div className="met"><div className="met-l">RSI-14</div><div className="met-v">{s.rsi != null ? s.rsi.toFixed(0) : '—'}</div></div>
            <div className="met"><div className="met-l">Stoch %K</div><div className="met-v">{s.stoch != null ? s.stoch.toFixed(0) : '—'}</div></div>
          </div>
        </div>
      )}

      {((s.type === 'csp' && !s.partial) || s.type === 'cc') && (
        <div className="dsec">
          <div className="dlbl">Premium Estimate</div>
          <div className="dgrid">
            <div className="met"><div className="met-l">Per contract (est.)</div><div className="met-v g">{s.premEst ? `$${s.premEst}` : '—'}</div></div>
            <div className="met"><div className="met-l">Total ({contracts} contract{contracts > 1 ? 's' : ''})</div><div className="met-v g">{total ? `$${total}` : '—'}</div></div>
          </div>
          <div className="mhint" style={{ marginTop: 8, marginBottom: 0 }}>Uses HV30. Verify actual chain in Fidelity before placing the order.</div>
        </div>
      )}

      {(s.type === 'roll' || s.type === 'close') && (
        <div className="dsec">
          <div className="dlbl">Position Details</div>
          <div className="mgrid c2">
            <div className="met"><div className="met-l">Strike</div><div className="met-v b">${s.strike}</div></div>
            <div className="met"><div className="met-l">DTE left</div><div className="met-v a">{s.days}d</div></div>
            <div className="met"><div className="met-l">Expiry</div><div className="met-v">{pos?.expiry || '—'}</div></div>
            <div className="met"><div className="met-l">% elapsed</div><div className="met-v">{s.pctT !== null && s.pctT !== '—' ? `${s.pctT}%` : '—'}</div></div>
            {s.pctCap !== null && <div className="met"><div className="met-l">Premium captured</div><div className="met-v g">{s.pctCap}%</div></div>}
            {pos?.prem && <div className="met"><div className="met-l">Collected</div><div className="met-v g">${Number(pos.prem).toFixed(2)}</div></div>}
          </div>
        </div>
      )}

      <div className="dsec">
        <div className="dlbl">Criteria Check</div>
        <div className="cpills">
          {(s.chks || []).map((ch, i) => (
            <span key={i} className={`cpill ${ch.ok ? 'pass' : 'fail'}`}>{ch.ok ? '✓' : '✗'} {ch.l}</span>
          ))}
        </div>
      </div>

      <button className="btn-s" onClick={onClose}>Close</button>
    </>
  );
}
