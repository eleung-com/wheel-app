import React from 'react';

/**
 * One nav definition for both bars. The top tabs (desktop) and the bottom bar
 * (mobile) used to disagree about what the app contains; they read from here now.
 */
export const NAV_ITEMS = [
  { id: 'pg-home',      label: 'Home',      icon: 'home'      },
  { id: 'pg-signals',   label: 'Signals',   icon: 'signals'   },
  { id: 'pg-positions', label: 'Positions', icon: 'positions' },
  { id: 'pg-watchlist', label: 'Watchlist', icon: 'watchlist' },
  { id: 'pg-settings',  label: 'Settings',  icon: 'settings'  },
];

const ACTIVE_TYPES = new Set(['short_put', 'short_call']);

export function navBadges({ positions = [], watchlist = [], signals = [] }) {
  return {
    // Partial "watching" cards aren't actionable, so they don't earn a badge.
    'pg-signals':   signals.length,
    'pg-positions': positions.filter(p => ACTIVE_TYPES.has(p.type) && !p.linkedId).length,
    'pg-watchlist': watchlist.length,
  };
}

const PATHS = {
  home:      ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h14V9.5'],
  signals:   ['M3 17l5-6 4 3 5-8 4 5'],
  positions: ['M3 7h6l2 2.5h10V19H3z'],
  watchlist: ['M20 20l-3.5-3.5'],
  settings:  ['M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'],
};

export function NavIcon({ name }) {
  return (
    <svg
      className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round"
    >
      {name === 'watchlist' && <circle cx="11" cy="11" r="7" />}
      {name === 'settings'  && <circle cx="12" cy="12" r="3" />}
      {(PATHS[name] || []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
