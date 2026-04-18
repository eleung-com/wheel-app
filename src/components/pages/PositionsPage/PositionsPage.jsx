import React from 'react';
import { ACCOUNTS } from '../../../lib/utils';
import SharesTable from './SharesTable';
import OptionsTable from './OptionsTable';

function fmt(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function CapitalBar({ label, total, allocated }) {
  if (!total) return null;
  const available = Math.max(0, total - allocated);
  const pct = Math.min(100, total > 0 ? (allocated / total) * 100 : 0);
  const barColor = pct >= 90 ? 'var(--r)' : pct >= 70 ? 'var(--a)' : 'var(--g)';

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--mu2)', fontFamily: 'var(--mono)' }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
          <span style={{ color: barColor }}>{fmt(allocated)}</span>
          {' / '}
          {fmt(total)}
          {' · '}
          <span style={{ color: 'var(--g)' }}>{fmt(available)} free</span>
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--b1)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

export default function PositionsPage({ positions, watchlist, criteria, onSelectOptPos, onEditPos, onShowShareGroup }) {
  // Group shares by ticker
  const shareGroups = {};
  for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId)) {
    if (!shareGroups[pos.ticker]) {
      shareGroups[pos.ticker] = { ticker: pos.ticker, lots: [], totalQty: 0, totalCost: 0 };
    }
    shareGroups[pos.ticker].lots.push(pos);
    shareGroups[pos.ticker].totalQty  += pos.qty;
    shareGroups[pos.ticker].totalCost += (pos.cost || 0) * pos.qty;
  }

  // Only active option rows — exclude close entries and any opening row that has been linked (closed)
  const ACTIVE_OPTION_TYPES = new Set(['short_put', 'short_call']);
  const optPositions = positions.filter(p => ACTIVE_OPTION_TYPES.has(p.type) && !p.linkedId);

  // Capital allocation per account
  // Shares: qty * cost; Short puts: strike * qty * 100 (cash reserved); Short calls: 0 (covered)
  const capitalByAccount = {};
  for (const acct of ACCOUNTS) capitalByAccount[acct] = 0;

  for (const pos of positions.filter(p => p.type === 'short_put' && !p.linkedId && p.strike)) {
    const acct = pos.account || 'Esther';
    capitalByAccount[acct] = (capitalByAccount[acct] || 0) + pos.strike * pos.qty * 100;
  }

  const showCapital = criteria && (criteria.capitalEsther > 0 || criteria.capitalFam > 0);

  if (!positions.length) {
    return (
      <div id="pos-container">
        {showCapital && (
          <div style={{ marginBottom: 16 }}>
            {criteria.capitalEsther > 0 && <CapitalBar label="Esther" total={criteria.capitalEsther} allocated={0} />}
            {criteria.capitalFam    > 0 && <CapitalBar label="Fam"    total={criteria.capitalFam}    allocated={0} />}
          </div>
        )}
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">No positions</div>
          <div className="empty-sub">Tap + to add shares or an open short option.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {showCapital && (
        <div style={{ marginBottom: 12 }}>
          {criteria.capitalEsther > 0 && <CapitalBar label="Esther" total={criteria.capitalEsther} allocated={capitalByAccount['Esther'] || 0} />}
          {criteria.capitalFam    > 0 && <CapitalBar label="Fam"    total={criteria.capitalFam}    allocated={capitalByAccount['Fam']    || 0} />}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="slabel" style={{ margin: 0 }}>Open Positions</div>
        <div style={{ fontSize: 10, color: 'var(--mu)' }}>Tap row for details</div>
      </div>
      <div id="pos-container">
        <OptionsTable
          optPositions={optPositions}
          onSelectPos={onSelectOptPos}
          onEditPos={onEditPos}
        />
        <SharesTable
          shareGroups={shareGroups}
          watchlist={watchlist}
          onShowGroup={onShowShareGroup}
        />
      </div>
    </div>
  );
}
