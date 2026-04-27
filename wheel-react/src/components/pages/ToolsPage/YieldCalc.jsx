import React, { useState } from 'react';

function row(label, value) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0', borderBottom: '1px solid var(--b1)' }}>
      <span style={{ fontSize: 12, color: 'var(--mu2)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--fg)' }}>{value}</span>
    </div>
  );
}

export default function YieldCalc() {
  const [prem,    setPrem]    = useState('');
  const [strike,  setStrike]  = useState('');
  const [qty,     setQty]     = useState('1');
  const [dte,     setDte]     = useState('');

  const p  = parseFloat(prem)   || 0;
  const s  = parseFloat(strike) || 0;
  const q  = parseInt(qty)      || 1;
  const d  = parseFloat(dte)    || 0;

  const totalPrem     = p * q * 100;
  const collateral    = s * q * 100;
  const returnPct     = s > 0 ? (p / s) * 100 : null;
  const annualizedPct = s > 0 && d > 0 ? (p / s) * (365 / d) * 100 : null;

  const fmt   = n => n != null ? `${n.toFixed(2)}%` : '—';
  const fmtDollar = n => n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  function field(label, value, setter, placeholder, type = 'number') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 10, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
        <input
          type={type}
          value={value}
          onChange={e => setter(e.target.value)}
          placeholder={placeholder}
          style={{ background: 'var(--b1)', border: '1px solid var(--b2)', borderRadius: 6, padding: '8px 10px', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--mono)', width: '100%' }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="slabel">Annualized Yield Calculator</div>
      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          {field('Premium per contract ($)', prem, setPrem, '2.50')}
          {field('Strike price ($)', strike, setStrike, '45.00')}
          {field('Contracts (qty)', qty, setQty, '1')}
          {field('Days to expiry (DTE)', dte, setDte, '30')}
        </div>
      </div>

      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '0 14px', marginBottom: 14 }}>
        {row('Total premium collected',    fmtDollar(totalPrem))}
        {row('Capital at risk (collateral)', fmtDollar(collateral))}
        {row('Return on collateral',       fmt(returnPct))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '9px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--mu2)' }}>Annualized return</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: annualizedPct != null ? 'var(--g)' : 'var(--fg)', fontWeight: 600 }}>
            {fmt(annualizedPct)}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--mu)', lineHeight: 1.5 }}>
        Annualized = (premium ÷ strike) × (365 ÷ DTE) × 100
      </div>
    </div>
  );
}
