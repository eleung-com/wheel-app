import React from 'react';

const NAV_ITEMS = [
  { id: 'pg-signals',   icon: '📊', label: 'Signals'   },
  { id: 'pg-positions', icon: '📂', label: 'Positions' },
  { id: 'pg-watchlist', icon: '🔭', label: 'Watch'     },
  { id: 'pg-criteria',  icon: '⚙️', label: 'Criteria'  },
];

export default function BottomNav({ activePage, onSwitch }) {
  return (
    <div className="bnav">
      {NAV_ITEMS.map(item => (
        <div
          key={item.id}
          className={`bni${activePage === item.id ? ' active' : ''}`}
          onClick={() => onSwitch(item.id)}
        >
          <div className="bni-icon">{item.icon}</div>
          {item.label}
        </div>
      ))}
    </div>
  );
}
