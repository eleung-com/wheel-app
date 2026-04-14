import React from 'react';

export default function TabNav({ activePage, onSwitch, signals, positions, watchlist }) {
  const actionCount = signals.filter(s => s.type === 'roll' || s.type === 'close').length;
  const cspCount    = signals.filter(s => s.type === 'csp'  && !s.partial).length;
  const ccCount     = signals.filter(s => s.type === 'cc').length;
  const sigTotal    = actionCount + cspCount + ccCount;

  const tabs = [
    { id: 'pg-signals',   label: 'Signals',   badge: sigTotal,         badgeClass: 'g' },
    { id: 'pg-positions', label: 'Positions', badge: positions.length, badgeClass: 'b' },
    { id: 'pg-watchlist', label: 'Watchlist', badge: watchlist.length, badgeClass: 'p' },
    { id: 'pg-criteria',  label: 'Criteria',  badge: null,             badgeClass: ''  },
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
