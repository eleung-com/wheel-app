import React from 'react';

export default function ModalOverlay({ open, onClose, children }) {
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }
  // Children are only mounted while open: forms reset between opens and
  // autoFocus fires on every open (mounted-but-hidden children do neither).
  return (
    <div className={`overlay${open ? ' open' : ''}`} onClick={handleBackdrop}>
      <div className="modal">
        {open ? children : null}
      </div>
    </div>
  );
}
