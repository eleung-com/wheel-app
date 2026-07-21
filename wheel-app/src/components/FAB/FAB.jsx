import React from 'react';

export default function FAB({ activePage, onClick }) {
  // Only render where the + has an action. Watchlist membership is curated in
  // Notion, so there is nothing to add there.
  if (activePage !== 'pg-positions') return null;
  return (
    <button className="fab" onClick={onClick}>+</button>
  );
}
