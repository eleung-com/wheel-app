import React, { useState } from 'react';

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
// Part 6E: desktop shows the first few dates, then "Show more". On a phone
// the dates scroll sideways instead (CSS), so all of them render.
const FIRST = 4;
const SOON_DAYS = 7; // this week → amber

// Parse only the YYYY-MM-DD prefix by hand — building a Date from a bare
// date string would shift it across the timezone boundary and can land it in
// the previous day.
function isoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}

export default function EarningsCalendar({ watchlist, heldTickers }) {
  const [more, setMore] = useState(false);
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
    <section className="hcard h-earn">
      <div className="hcard-h">
        <h3>Earnings</h3>
        <small>{total > 0 ? `${total} in the next ${WINDOW_DAYS} days` : ''}</small>
      </div>

      {days.length === 0 ? (
        <div className="hcard-empty">No earnings in the next {WINDOW_DAYS} days.</div>
      ) : (
        <div className={`ecal-list${more ? ' all' : ''}`}>
          {days.map(({ date, tickers }, i) => {
            // Held tickers lead the day; the rest fall in alphabetically.
            const ordered = tickers.slice().sort((a, b) =>
              (heldTickers.has(b) - heldTickers.has(a)) || a.localeCompare(b));
            const soon = (date - today) / 86400000 <= SOON_DAYS;
            return (
              <div className={`ecal-row${i >= FIRST ? ' ecal-x' : ''}`} key={date.getTime()}>
                <div className="ecal-date">
                  <b>{date.getMonth() !== today.getMonth() ? `${date.toLocaleString(undefined, { month: 'short' })} ` : ''}{date.getDate()}</b>{' '}
                  <span>{date.toLocaleString(undefined, { weekday: 'short' })}</span>
                </div>
                <div className="ecal-pills">
                  {ordered.map(t => {
                    const held = heldTickers.has(t);
                    return (
                      <span key={t} className={`ecal-pill${held ? ' hold' : soon ? ' soon' : ''}`}>
                        {t}{held && <span className="ecal-hold-l"> · held</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {days.length > FIRST && (
        <button type="button" className="hmore ecal-more" onClick={() => setMore(m => !m)}>
          {more ? 'Show less ▴' : `Show ${days.length - FIRST} more ${days.length - FIRST === 1 ? 'date' : 'dates'} ▾`}
        </button>
      )}
    </section>
  );
}
