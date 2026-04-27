import React from 'react';

export default function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-logo">wheel<em>.</em>desk</div>
      <span className="spinner a"></span>
      <div className="boot-msg">Loading from Google Sheets…</div>
    </div>
  );
}
