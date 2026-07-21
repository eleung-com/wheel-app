import React from 'react';

export default function FAB({ activePage, onClick }) {
  // Only render where the + has an action: add position / add watchlist ticker
  if (activePage !== 'pg-positions' && activePage !== 'pg-watchlist') return null;
  return (
    <button className="fab" onClick={onClick}>+</button>
  );
}
