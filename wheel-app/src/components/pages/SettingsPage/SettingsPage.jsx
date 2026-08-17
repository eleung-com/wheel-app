import React, { useState } from 'react';
import CriteriaPage   from '../CriteriaPage/CriteriaPage';
import StrategiesTab  from '../ToolsPage/StrategiesTab';

/**
 * Settings absorbed the old Tools tab so both navs can carry the same five
 * destinations. The P&L and yield calculators moved onto the Add/Edit Position
 * form, where they project the position you're actually entering — so only the
 * Criteria and Strategies references live here now.
 */
const SUBTABS = [
  { id: 'criteria',   label: 'Criteria'   },
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
        {active === 'strategies' && <StrategiesTab onAddPosition={onAddPosition} />}
      </div>
    </div>
  );
}
