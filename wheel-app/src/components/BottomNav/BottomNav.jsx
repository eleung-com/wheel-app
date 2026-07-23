import React from 'react';
import { NAV_ITEMS, NavIcon, navBadges } from '../../lib/nav';

export default function BottomNav({ activePage, onSwitch, positions, watchlist, signals }) {
  const badges = navBadges({ positions, watchlist, signals });

  return (
    <nav className="bnav">
      {NAV_ITEMS.map(item => (
        <button
          key={item.id}
          type="button"
          className={`bni${activePage === item.id ? ' active' : ''}`}
          aria-current={activePage === item.id ? 'page' : undefined}
          onClick={() => onSwitch(item.id)}
        >
          <NavIcon name={item.icon} />
          {item.label}
          {badges[item.id] ? <span className="bni-badge">{badges[item.id]}</span> : null}
        </button>
      ))}
    </nav>
  );
}
