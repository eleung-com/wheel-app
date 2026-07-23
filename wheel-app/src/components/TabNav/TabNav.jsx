import React from 'react';
import { NAV_ITEMS, navBadges } from '../../lib/nav';

const BADGE_CLASS = {
  'pg-signals':   'g',
  'pg-positions': 'b',
  'pg-watchlist': 'p',
};

export default function TabNav({ activePage, onSwitch, positions, watchlist, signals = [] }) {
  const badges = navBadges({ positions, watchlist, signals });

  return (
    <div className="nav">
      {NAV_ITEMS.map(t => (
        <div
          key={t.id}
          className={`tab${activePage === t.id ? ' active' : ''}`}
          onClick={() => onSwitch(t.id)}
        >
          {t.label}
          {badges[t.id] ? <span className={`bdg ${BADGE_CLASS[t.id]}`}>{badges[t.id]}</span> : null}
        </div>
      ))}
    </div>
  );
}
