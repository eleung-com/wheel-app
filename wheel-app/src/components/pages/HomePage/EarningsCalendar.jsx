import React from 'react';

/**
 * Upcoming earnings for the watchlist, at the top of the News tab.
 *
 * Shows every watchlist earnings date from today through 30 days out — past
 * dates are dropped, and anything further out waits until it enters the window.
 * Dates come from the Notion "Earnings Date" property (surfaced by the worker as
 * `earnings`), so this is only as complete as what's filled in there. Tickers
 * you hold a position in are pulled to the front of each day and flagged.
 */

const WINDOW_DAYS = 30;

// Parse only the YYYY-MM-DD prefix by hand — building a Date from a bare
// date string would shift it across the timezone boundary and can land it in
// the previous day.
function isoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}

export default function EarningsCalendar({ watchlist, heldTickers }) {
  const now     = new Date();
  const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + WINDOW_DAYS);

  // Group by exact date (keyed on the day's timestamp) so the window can span a
  // month boundary without two different months colliding on a day-of-month.
  const byDay = new Map();
  for (const w of watchlist) {
    const p = isoDate(w.earnings);
    if (!p) continue;
    const d = new Date(p.y, p.mo, p.d);
    if (d < today || d > horizon) continue; // drop past dates and anything past the window
    const key = d.getTime();
    if (!byDay.has(key)) byDay.set(key, { date: d, tickers: [] });
    byDay.get(key).tickers.push(w.ticker);
  }

  const days  = [...byDay.values()].sort((a, b) => a.date - b.date);
  const total = days.reduce((s, g) => s + g.tickers.length, 0);

  return (
    <div className="ecal">
      <div className="news-head">
        <div className="slabel">Earnings · Next 30 days</div>
        {total > 0 && (
          <span className="news-time">{total} {total === 1 ? 'report' : 'reports'}</span>
        )}
      </div>

      {days.length === 0 ? (
        <div className="ecal-empty">No earnings in the next 30 days.</div>
      ) : days.map(({ date, tickers }) => {
        // Held tickers lead the day; the rest fall in alphabetically.
        const ordered = tickers.slice().sort((a, b) =>
          (heldTickers.has(b) - heldTickers.has(a)) || a.localeCompare(b));

        return (
          <div className="ecal-row" key={date.getTime()}>
            <div className="ecal-date">
              <div className="ecal-dow">
                {date.toLocaleString(undefined, { weekday: 'short' }).toUpperCase()}{' '}
                {date.toLocaleString(undefined, { month: 'short' }).toUpperCase()}
              </div>
              <div className="ecal-dnum">{date.getDate()}</div>
            </div>
            <div className="ecal-pills">
              {ordered.map(t => {
                const held = heldTickers.has(t);
                return (
                  <span key={t} className={`ecal-pill${held ? ' hold' : ''}`}>
                    {t}{held && <span className="ecal-hold-l"> · hold</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
