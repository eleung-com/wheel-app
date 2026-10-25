import React from 'react';

export default function Header({ marketOpen, marketText, syncStatus, isScreening, onRefresh, onPull, onHelp, onSettings, settingsOn }) {
  return (
    <div className="hdr">
      <div>
        <div className="logo">wheel<em>.</em>desk</div>
        <div className="hdr-sub">
          <div className="mkt">
            <div className={`dot${marketOpen ? '' : ' off'}`}></div>
            <span>{marketText}</span>
          </div>
          <div className={`sync-status ${syncStatus.state}`}>
            {syncStatus.message}
          </div>
        </div>
      </div>
      <div className="hdr-r">
        <div className="ibtn b" onClick={onPull} title="Pull latest from Sheets">⇩</div>
        <div className="ibtn g" onClick={onRefresh} id="rfbtn">
          {isScreening ? <span className="spinner"></span> : '↻'}
        </div>
        <div className="ibtn" onClick={onHelp}>?</div>
        {onSettings && (
          <button type="button" className={`ibtn gear${settingsOn ? ' on' : ''}`} onClick={onSettings} title="Settings" aria-label="Settings" aria-pressed={!!settingsOn}>⚙</button>
        )}
      </div>
    </div>
  );
}
