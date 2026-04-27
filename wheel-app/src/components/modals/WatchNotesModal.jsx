import React, { useState } from 'react';

export default function WatchNotesModal({ ticker, watchlist, onSave, onClose }) {
  const existing = watchlist?.find(w => w.ticker === ticker)?.notes || '';
  const [notes, setNotes] = useState(existing);

  if (!ticker) return null;

  return (
    <>
      <div className="mtitle">{ticker} — Notes</div>
      <textarea
        className="minput norm"
        placeholder="e.g. Good IV history, avoid earnings in Sept"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        style={{ margin: 0, resize: 'vertical', minHeight: 80, fontFamily: 'var(--sans)', fontSize: 13 }}
      />
      <button className="btn-p" onClick={() => onSave(ticker, notes.trim())}>Save Notes</button>
      <button className="btn-s" onClick={onClose}>Cancel</button>
    </>
  );
}
