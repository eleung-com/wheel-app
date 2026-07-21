import React from 'react';

const ACTIVE_TYPES = new Set(['short_put', 'short_call']);

export default function TabNav({ activePage, onSwitch, positions, watchlist, signals = [] }) {
  const activeCount = positions.filter(p => ACTIVE_TYPES.has(p.type) && !p.linkedId).length;
  // Actionable signals only — partial "watching" cards don't count toward the badge
  const signalCount = signals.filter(s => !s.partial).length;

  const tabs = [
    { id: 'pg-history',   label: 'Overview',  badge: null,                     badgeClass: '' },
    { id: 'pg-signals',   label: 'Signals',   badge: signalCount || null,      badgeClass: 'g' },
    { id: 'pg-positions', label: 'Positions', badge: activeCount || null,      badgeClass: 'b' },
    { id: 'pg-watchlist', label: 'Watchlist', badge: watchlist.length || null, badgeClass: 'p' },
    { id: 'pg-tools',     label: 'Tools',     badge: null,                     badgeClass: '' },
    { id: 'pg-criteria',  label: 'Settings',  badge: null,                     badgeClass: '' },
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
