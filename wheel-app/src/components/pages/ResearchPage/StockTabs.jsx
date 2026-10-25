import React from 'react';

// Part 9D: the stock page's tabs (Overview · Claude's read · Peers · Charts · Notes & history).
export const STOCK_TABS = [
  ['overview', 'Overview'],
  ['claude', 'Claude’s read'],
  ['peers', 'Peers'],
  ['charts', 'Charts'],
  ['notes', 'Notes & history'],
];

export default function StockTabs({ tab, onTab }) {
  return (
    <div className="rs2-tabs stk-tabs" role="tablist">
      {STOCK_TABS.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{label}</button>
      ))}
    </div>
  );
}
