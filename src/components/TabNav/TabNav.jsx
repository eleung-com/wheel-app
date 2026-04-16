import React from 'react';

const ACTIVE_TYPES = new Set(['shares', 'short_put', 'short_call']);
const CLOSE_TYPES  = new Set(['btc', 'expired', 'assigned', 'rolled']);

export default function TabNav({ activePage, onSwitch, signals, positions, watchlist }) {
  const actionCount  = signals.filter(s => s.type === 'roll' || s.type === 'close').length;
  const cspCount     = signals.filter(s => s.type === 'csp'  && !s.partial).length;
  const ccCount      = signals.filter(s => s.type === 'cc').length;
  const sigTotal     = actionCount + cspCount + ccCount;
  const activeCount  = positions.filter(p => ACTIVE_TYPES.has(p.type) && !p.linkedId).length;
  const historyCount = positions.filter(p => CLOSE_TYPES.has(p.type)).length;

  const tabs = [
    { id: 'pg-history',   label: 'Overview',  badge: null,                    badgeClass: ''  },
    { id: 'pg-signals',   label: 'Signals',   badge: sigTotal || null,        badgeClass: 'g' },
    { id: 'pg-positions', label: 'Positions', badge: activeCount || null,     badgeClass: 'b' },
    { id: 'pg-watchlist', label: 'Watchlist', badge: watchlist.length || null, badgeClass: 'p' },
    { id: 'pg-criteria',  label: 'Settings',  badge: null,                    badgeClass: ''  },
  ];

  return (
    <div className="nav">
      {tabs.map(t => (
        <div
          key={t.id}
          className={`tab${activePage === t.id ? ' active' : ''}`}
          onClick={() => onSwitch(t.id)}
        >
          {t.label}
          {t.badge !== null && (
            <span className={`bdg ${t.badgeClass}`}>{t.badge}</span>
          )}
        </div>
      ))}
    </div>
  );
}
