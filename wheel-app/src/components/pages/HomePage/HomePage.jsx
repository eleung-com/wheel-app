import React, { useState, useMemo } from 'react';
import StatsPane        from './StatsPane';
import NewsPane         from './NewsPane';
import EarningsCalendar from './EarningsCalendar';
import { useNews } from '../../../hooks/useNews';

const PRIORITY = '🔥 Priority';

export default function HomePage({
  positions, closedTrades, criteria, signals, watchlist, showToast, onShowSignal,
}) {
  const [tab, setTab]         = useState('stats');
  const [account, setAccount] = useState('all');

  // The news feed follows Dive-In, not the whole watchlist — Priority is the
  // subset worth 10 requests an hour.
  const priorityTickers = useMemo(
    () => watchlist.filter(w => w.diveIn === PRIORITY).map(w => w.ticker).sort(),
    [watchlist],
  );

  const { news, loading, refreshNews } = useNews(priorityTickers, showToast);

  // Any ticker with a still-open row (opening rows get a linkedId once closed).
  const heldTickers = useMemo(() => {
    const s = new Set();
    for (const p of positions) if (!p.linkedId) s.add(p.ticker);
    return s;
  }, [positions]);

  return (
    <>
      <div className="subtabs" role="tablist" aria-label="Home sections">
        <button
          type="button" role="tab" aria-selected={tab === 'stats'}
          className={tab === 'stats' ? 'on' : ''}
          onClick={() => setTab('stats')}
        >
          Stats
        </button>
        <button
          type="button" role="tab" aria-selected={tab === 'news'}
          className={tab === 'news' ? 'on' : ''}
          onClick={() => setTab('news')}
        >
          News
        </button>
      </div>

      <div className="subpane">
        {tab === 'stats' ? (
          <StatsPane
            positions={positions}
            closedTrades={closedTrades}
            criteria={criteria}
            signals={signals}
            account={account}
            onAccount={setAccount}
            onShowSignal={onShowSignal}
          />
        ) : (
          <>
            <EarningsCalendar watchlist={watchlist} heldTickers={heldTickers} />
            <NewsPane
              news={news}
              loading={loading}
              onRefresh={refreshNews}
              priorityTickers={priorityTickers}
            />
          </>
        )}
      </div>
    </>
  );
}
