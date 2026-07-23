import React, { useState } from 'react';
import CriteriaPage   from '../CriteriaPage/CriteriaPage';
import PnLPage        from '../PnLPage/PnLPage';
import YieldCalc      from '../ToolsPage/YieldCalc';
import StrategiesTab  from '../ToolsPage/StrategiesTab';

/**
 * Settings absorbed the old Tools tab so both navs can carry the same five
 * destinations. The calculators were never settings, but they are reference
 * material you reach for occasionally — which is what this tab is now.
 */
const SUBTABS = [
  { id: 'criteria',   label: 'Criteria'   },
  { id: 'pnl',        label: 'P&L Calc'   },
  { id: 'yield',      label: 'Yield Calc' },
  { id: 'strategies', label: 'Strategies' },
];

export default function SettingsPage({ criteria, onSave, onRefresh, onPull, onAddPosition }) {
  const [active, setActive] = useState('criteria');

  return (
    <div>
      <div className="subtabs" role="tablist" aria-label="Settings sections">
        {SUBTABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? 'on' : ''}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="subpane">
        {active === 'criteria' && (
          <CriteriaPage
            criteria={criteria}
            onSave={onSave}
            onRefresh={onRefresh}
            onPull={onPull}
          />
        )}
        {active === 'pnl'        && <PnLPage />}
        {active === 'yield'      && <YieldCalc />}
        {active === 'strategies' && <StrategiesTab onAddPosition={onAddPosition} />}
      </div>
    </div>
  );
}
