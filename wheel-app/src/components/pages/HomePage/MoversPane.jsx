import React, { useState } from 'react';
import { MOVER_PCT } from '../../../lib/homeFeed';

/**
 * Part 6A: watchlist stocks ±5% or more today, biggest first. The one-line
 * "why" comes from the Mover Summary routine (Part 6C) once it's live; until
 * a note for today exists the card just shows the move.
 */
function Mover({ m }) {
  const [open, setOpen] = useState(false);
  const up = (m.chg ?? 0) > 0;
  return (
    <button type="button" className={`mover ${up ? 'up' : 'dn'}${open ? ' open' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
      <div className="mover-row">
        <span className="mover-tk">{m.ticker}</span>
        {m.price != null && <span className="mover-px">${m.price.toFixed(2)}</span>}
        {m.held && <span className="mover-hold">Held</span>}
        {m.chg != null && <span className={`mover-pct ${up ? 'g' : 'r'}`}>{up ? '▲' : '▼'} {Math.abs(m.chg).toFixed(1)}%</span>}
      </div>
      <div className={`mover-why${m.note ? '' : ' none'}`}>
        {m.note || 'Reason not in yet. It appears here once Claude has looked up the news.'}
      </div>
      {open && m.link && (
        <a className="mover-link" href={m.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
          Read the top story →
        </a>
      )}
    </button>
  );
}

export default function MoversPane({ movers, quietCount, priced }) {
  return (
    <section className="hcard h-movers">
      <div className="hcard-h">
        <h3>Today’s movers</h3>
        <small>±{MOVER_PCT}% or more today · watchlist</small>
      </div>
      {!priced ? (
        <div className="hcard-empty">Waiting for prices…</div>
      ) : movers.length === 0 ? (
        <div className="hcard-empty">Nothing on your watchlist moved {MOVER_PCT}% or more today.</div>
      ) : movers.map(m => <Mover key={m.ticker} m={m} />)}
      {priced && movers.length > 0 && quietCount > 0 && (
        <div className="movers-quiet">{quietCount} other watchlist stock{quietCount === 1 ? '' : 's'} moved less than {MOVER_PCT}%</div>
      )}
    </section>
  );
}
