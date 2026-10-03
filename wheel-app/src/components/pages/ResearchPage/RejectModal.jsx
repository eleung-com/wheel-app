import React, { useState } from 'react';
import ModalOverlay from '../../modals/ModalOverlay';
import { REJECT_TAGS } from '../../../lib/research/runRecord';

// Reject a run: reason required + tag chips (PRD §6A step 14). Saved to the
// Notion row; the "Rejects" view in Notion is the reject log.

function Body({ ticker, current, onSave, onClear, onClose }) {
  const [reason, setReason] = useState(current?.rejectReason || '');
  const [tags, setTags] = useState(current?.rejectTags || []);
  const [busy, setBusy] = useState(false);
  const isRejected = current?.decision === 'Reject';

  const toggle = (t) => setTags((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim() || busy) return;
    setBusy(true);
    const ok = await onSave({ decision: 'Reject', reason: reason.trim(), tags });
    setBusy(false);
    if (ok) onClose();
  }

  async function clear() {
    setBusy(true);
    const ok = await onClear();
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit}>
      <div className="mtitle">Reject {ticker}</div>
      <div className="mlbl">Why? (required)</div>
      <textarea
        className="rs-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Debt rising 3 years in a row"
        maxLength={1000}
        autoFocus
        rows={3}
      />
      <div className="mlbl" style={{ marginTop: 10 }}>Tags (optional)</div>
      <div className="rs-tagrow">
        {REJECT_TAGS.map((t) => (
          <button type="button" key={t} className={`rs-tag${tags.includes(t) ? ' on' : ''}`}
            aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>{t}</button>
        ))}
      </div>
      <button type="submit" className="btn-p rs-reject-save" disabled={!reason.trim() || busy} style={{ marginTop: 14 }}>
        {busy ? <span className="spinner" /> : isRejected ? 'Update reject' : 'Reject'}
      </button>
      {isRejected && (
        <button type="button" className="btn-s" onClick={clear} disabled={busy}>Clear decision</button>
      )}
      <button type="button" className="btn-s" onClick={onClose} disabled={busy}>Cancel</button>
    </form>
  );
}

export default function RejectModal({ open, ...rest }) {
  return (
    <ModalOverlay open={open} onClose={rest.onClose}>
      <Body {...rest} />
    </ModalOverlay>
  );
}
