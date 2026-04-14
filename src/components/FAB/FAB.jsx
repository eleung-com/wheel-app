import React from 'react';

export default function FAB({ activePage, onClick }) {
  if (activePage === 'pg-signals') return null;
  return (
    <button className="fab" onClick={onClick}>+</button>
  );
}
