import React from 'react';

export default function ModalOverlay({ open, onClose, children }) {
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }
  return (
    <div className={`overlay${open ? ' open' : ''}`} onClick={handleBackdrop}>
      <div className="modal">
        {children}
      </div>
    </div>
  );
}
