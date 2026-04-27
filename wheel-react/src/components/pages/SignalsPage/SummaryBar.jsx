import React from 'react';

export default function SummaryBar({ signals }) {
  const actCount   = signals.filter(s => s.type === 'roll' || s.type === 'close').length;
  const cspCount   = signals.filter(s => s.type === 'csp'  && !s.partial).length;
  const ccCount    = signals.filter(s => s.type === 'cc').length;
  const closeCount = signals.filter(s => s.type === 'close').length;

  return (
    <div className="sumbar">
      <div className="chip"><div className="chip-v r">{actCount}</div><div className="chip-l">Act Now</div></div>
      <div className="chip"><div className="chip-v b">{cspCount}</div><div className="chip-l">CSP Entry</div></div>
      <div className="chip"><div className="chip-v g">{ccCount}</div><div className="chip-l">Cov. Call</div></div>
      <div className="chip"><div className="chip-v a">{closeCount}</div><div className="chip-l">Early Close</div></div>
    </div>
  );
}
