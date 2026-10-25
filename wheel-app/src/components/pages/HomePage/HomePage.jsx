import React, { useState, useMemo } from 'react';
import StatsPane, { AttentionCard } from './StatsPane';
import NewsPane         from './NewsPane';
import EarningsCalendar from './EarningsCalendar';
import MarketStrip      from './MarketStrip';
import MoversPane       from './MoversPane';
import { useNews } from '../../../hooks/useNews';
import { useMarketStrip } from '../../../hooks/useMarketStrip';
import { pickMovers } from '../../../lib/homeFeed';
import { NO_EARNINGS } from '../../../lib/signalEngine';

const PRIORITY = '🔥 Priority';

// Part 6A (approved 10-23): one scroll, news first — market strip → today's
// movers → earnings → news → stats. The old Stats / News sub-tabs are gone.
export default function HomePage({
  positions, closedTrades, criteria, signals, watchlist, showToast, onShowSignal, lastRefresh, onOpenPerformance,
}) {
  const [account, setAccount] = useState('all');

  // The news feed follows Dive-In, not the whole watchlist — Priority is the
  // subset worth 10 requests an hour.
  const priorityTickers = useMemo(
    () => watchlist.filter(w => w.diveIn === PRIORITY).map(w => w.ticker).sort(),
    [watchlist],
  );

  const { news, loading, refreshNews } = useNews(priorityTickers, showToast);
  const strip = useMarketStrip(lastRefresh);

  // Any ticker with a still-open row (opening rows get a linkedId once closed).
  const heldTickers = useMemo(() => {
    const s = new Set();
    for (const p of positions) if (!p.linkedId) s.add(p.ticker);
    return s;
  }, [positions]);

  const movers = useMemo(() => pickMovers(watchlist, heldTickers), [watchlist, heldTickers]);
  const pricedCount = useMemo(
    () => watchlist.filter(w => !NO_EARNINGS.has(w.ticker) && typeof w.liveData?.chg1d === 'number').length,
    [watchlist],
  );

  // Part 6E (Home layout v2, approved 10-24): your book (dark) → market
  // chips → two columns on desktop (movers + news | earnings + attention).
  // On a phone the columns dissolve and CSS `order` stacks the cards:
  // movers → earnings → needs attention → news.
  return (
    <div className="home">
      <StatsPane
        positions={positions}
        closedTrades={closedTrades}
        criteria={criteria}
        signals={signals}
        account={account}
        onAccount={setAccount}
        onOpenPerformance={onOpenPerformance}
      />
      <MarketStrip rows={strip.rows} failed={strip.failed} />

      <div className="home-grid">
        <div className="home-main">
          <MoversPane movers={movers} quietCount={pricedCount - movers.length} priced={pricedCount > 0} />
          <NewsPane news={news} loading={loading} onRefresh={refreshNews} priorityTickers={priorityTickers} />
        </div>
        <div className="home-side">
          <EarningsCalendar watchlist={watchlist} heldTickers={heldTickers} />
          <AttentionCard signals={signals} onShowSignal={onShowSignal} />
        </div>
      </div>
    </div>
  );
}
