import React from 'react';

/**
 * This month's earnings for the watchlist, at the top of the News tab.
 *
 * Dates come from the Notion "Earnings Date" property (surfaced by the worker as
 * `earnings`), so this is only as complete as what's filled in there. Tickers
 * you hold a position in are pulled to the front of each day and flagged.
 */

// Parse only the YYYY-MM-DD prefix by hand — building a Date from a bare
// date string would shift it across the timezone boundary and can land it in
// the previous day.
function isoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}

export default function EarningsCalendar({ watchlist, heldTickers }) {
  const now  = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const curD = now.getDate();

  const byDay = new Map();
  for (const w of watchlist) {
    const d = isoDate(w.earnings);
    if (!d || d.y !== curY || d.mo !== curM) continue;
    if (!byDay.has(d.d)) byDay.set(d.d, []);
    byDay.get(d.d).push(w.ticker);
  }

  const days      = [...byDay.keys()].sort((a, b) => a - b);
  const total     = days.reduce((s, k) => s + byDay.get(k).length, 0);
  const monthName = now.toLocaleString(undefined, { month: 'long' });

  return (
    <div className="ecal">
      <div className="news-head">
        <div className="slabel">Earnings · {monthName}</div>
        {total > 0 && (
          <span className="news-time">{total} {total === 1 ? 'report' : 'reports'}</span>
        )}
      </div>

      {days.length === 0 ? (
        <div className="ecal-empty">No earnings dates in Notion this month.</div>
      ) : days.map(day => {
        const date = new Date(curY, curM, day);
        const past = day < curD;
        // Held tickers lead the day; the rest fall in alphabetically.
        const tickers = byDay.get(day).slice().sort((a, b) =>
          (heldTickers.has(b) - heldTickers.has(a)) || a.localeCompare(b));

        return (
          <div className={`ecal-row${past ? ' past' : ''}`} key={day}>
            <div className="ecal-date">
              <div className="ecal-dow">
                {date.toLocaleString(undefined, { weekday: 'short' }).toUpperCase()}
              </div>
              <div className="ecal-dnum">{day}</div>
            </div>
            <div className="ecal-pills">
              {tickers.map(t => {
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
