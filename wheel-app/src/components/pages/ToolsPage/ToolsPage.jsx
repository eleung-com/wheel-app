import React, { useState } from 'react';
import PnLPage      from '../PnLPage/PnLPage';
import YieldCalc    from './YieldCalc';
import StrategiesTab from './StrategiesTab';

const SUBTABS = [
  { id: 'pnl',        label: 'P&L Calculator' },
  { id: 'yield',      label: 'Yield Calculator' },
  { id: 'strategies', label: 'Strategies' },
];

export default function ToolsPage({ onAddPosition }) {
  const [active, setActive] = useState('pnl');

  return (
    <div>
      {/* Subtab nav */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--b1)', marginBottom: 16, marginLeft: -12, marginRight: -12, paddingLeft: 12, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active === t.id ? '2px solid var(--g)' : '2px solid transparent',
              color: active === t.id ? 'var(--fg)' : 'var(--mu)',
              fontFamily: 'var(--sans)',
              fontSize: 11,
              fontWeight: 500,
              padding: '8px 14px 9px',
              minHeight: 44,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'color .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'pnl'        && <PnLPage />}
      {active === 'yield'      && <YieldCalc />}
      {active === 'strategies' && <StrategiesTab onAddPosition={onAddPosition} />}
    </div>
  );
}
