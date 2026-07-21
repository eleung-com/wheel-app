import React, { useState, useEffect } from 'react';
import { LS_TRADIER_KEY, LS_URL_KEY, LS_SECRET_KEY, getTradierKey, getSheetUrl, getSecret } from '../../../lib/utils';

function CriteriaRow({ label, sub, inputId, value, onChange, min, max, pair }) {
  return (
    <div className="srow">
      <div>
        <div className="slbl2">{label}</div>
        {sub && <div className="ssub">{sub}</div>}
      </div>
      {pair ? (
        <div className="spair">
          <input className="sinput" type="number" value={pair.min} onChange={e => onChange({ ...pair, min: +e.target.value })} />
          <span className="ssep">–</span>
          <input className="sinput" type="number" value={pair.max} onChange={e => onChange({ ...pair, max: +e.target.value })} />
        </div>
      ) : (
        <input
          className="sinput"
          id={inputId}
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => onChange(+e.target.value)}
        />
      )}
    </div>
  );
}

const SECTIONS = [
  { id: 'csp',     label: 'CSP Entry',       sub: 'Indicators, delta & DTE ranges' },
  { id: 'cc',      label: 'Covered Calls',   sub: 'Entry rules for calls on shares' },
  { id: 'exit',    label: 'Exit Rules',      sub: 'Early close thresholds' },
  { id: 'capital', label: 'Account Capital', sub: 'Buying power per account' },
  { id: 'sheets',  label: 'Google Sheets',   sub: 'Backend connection' },
  { id: 'api',     label: 'API Keys',        sub: 'Tradier market data' },
];

const MOBILE_QUERY = '(max-width: 720px)';

export default function CriteriaPage({ criteria, onSave, onRefresh, onPull }) {
  const [local,       setLocal]       = useState(criteria);
  const [tradierKey,  setTradierKey]  = useState(() => getTradierKey());
  const [sheetUrl,    setSheetUrl]    = useState(() => getSheetUrl());
  const [sheetSecret, setSheetSecret] = useState(() => getSecret());
  const [keySaved,    setKeySaved]    = useState(false);
  const [sheetSaved,  setSheetSaved]  = useState(false);

  // Section navigation: sidebar on desktop, drill-down list on mobile
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [section,  setSection]  = useState(null); // null = mobile landing list
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const fn = e => setIsMobile(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  // Sync if criteria changes externally (e.g. from sheet pull)
  useEffect(() => { setLocal(criteria); }, [criteria]);

  function update(key, val) {
    const next = { ...local, [key]: val };
    setLocal(next);
    onSave(next);
  }

  function updatePair(minKey, maxKey, val) {
    const next = { ...local, [minKey]: val.min, [maxKey]: val.max };
    setLocal(next);
    onSave(next);
  }

  function saveTradierKey() {
    const trimmed = tradierKey.trim();
    if (trimmed) {
      localStorage.setItem(LS_TRADIER_KEY, trimmed);
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2000);
    }
  }

  function saveSheetCredentials() {
    const url    = sheetUrl.trim();
    const secret = sheetSecret.trim();
    if (!url || !secret) return;
    localStorage.setItem(LS_URL_KEY,    url);
    localStorage.setItem(LS_SECRET_KEY, secret);
    setSheetSaved(true);
    setTimeout(() => setSheetSaved(false), 2000);
  }

  function credentialRow({ label, sub, type, placeholder, value, onChange, onSaveFn, saved }) {
    return (
      <div key={label} className="srow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <div className="slbl2">{label}</div>
        <div className="ssub">{sub}</div>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <input
            className="sinput"
            type={type}
            placeholder={placeholder}
            value={value}
            style={{ flex: 1, width: 'auto', maxWidth: 'none', textAlign: 'left', fontSize: 13, padding: '9px 12px' }}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSaveFn()}
          />
          <button className="btn-s" style={{ margin: 0, width: 'auto', flexShrink: 0, whiteSpace: 'nowrap', padding: '0 14px', fontSize: 11 }} onClick={onSaveFn}>
            {saved ? '✓' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  function sectionContent(id) {
    switch (id) {
      case 'csp': return (
        <>
          <div className="slabel">CSP Entry — Technical Indicators</div>
          <div className="ssec">
            <CriteriaRow label="Max Stochastic %K"     sub="Oversold when Stoch %K < this"             inputId="c-stoch" value={local.stoch} min={0}  max={100} onChange={v => update('stoch', v)} />
            <CriteriaRow label="Max RSI (14)"          sub="Oversold when RSI < this"                  inputId="c-rsi"   value={local.rsi}   min={0}  max={100} onChange={v => update('rsi', v)} />
            <CriteriaRow label="Price above MA"        sub="Moving average period (days)"              inputId="c-ma"    value={local.ma}    min={20} max={250} onChange={v => update('ma', v)} />
            <CriteriaRow label="Avoid earnings within" sub="Days — skip if earnings inside DTE window" inputId="c-earn"  value={local.earn}  onChange={v => update('earn', v)} />
          </div>
          <div className="slabel">CSP — Strike &amp; DTE</div>
          <div className="ssec">
            <CriteriaRow
              label="Target Delta range" sub="Strike is chosen at the midpoint delta"
              pair={{ min: local.deltaMin, max: local.deltaMax }}
              onChange={v => updatePair('deltaMin', 'deltaMax', v)}
            />
            <CriteriaRow
              label="DTE range" sub="Min to max days to expiration"
              pair={{ min: local.dteMin, max: local.dteMax }}
              onChange={v => updatePair('dteMin', 'dteMax', v)}
            />
          </div>
        </>
      );
      case 'cc': return (
        <>
          <div className="slabel">Covered Call — Entry</div>
          <div className="ssec">
            <CriteriaRow label="Min shares owned"    sub="Must have at least this many"                   inputId="c-shares"   value={local.shares}  onChange={v => update('shares', v)} />
            <CriteriaRow label="Min Stoch %K for CC" sub="High stoch signals overbought — good for calls" inputId="c-cc-stoch" value={local.ccStoch} onChange={v => update('ccStoch', v)} />
            <CriteriaRow
              label="CC target delta range" sub="Strike is chosen at the midpoint delta"
              pair={{ min: local.ccDeltaMin, max: local.ccDeltaMax }}
              onChange={v => updatePair('ccDeltaMin', 'ccDeltaMax', v)}
            />
            <CriteriaRow
              label="CC DTE range" sub="Min to max days to expiration"
              pair={{ min: local.ccDteMin, max: local.ccDteMax }}
              onChange={v => updatePair('ccDteMin', 'ccDteMax', v)}
            />
          </div>
        </>
      );
      case 'exit': return (
        <>
          <div className="slabel">Exit Rules</div>
          <div className="ssec">
            <CriteriaRow label="Early close — % premium captured" sub="Fire BTC signal when this much is locked in"         inputId="c-close-pct" value={local.closePct}    onChange={v => update('closePct', v)} />
            <CriteriaRow label="Early close — max % DTE elapsed"  sub="Only suggest close if less than this % of time gone" inputId="c-close-dte" value={local.closeDtePct} onChange={v => update('closeDtePct', v)} />
          </div>
        </>
      );
      case 'capital': return (
        <>
          <div className="slabel">Account Capital</div>
          <div className="ssec">
            <div className="shdr">Set total capital per account to track allocation</div>
            <CriteriaRow label="Esther — total capital ($)" sub="Used to calculate available buying power" inputId="c-cap-esther" value={local.capitalEsther} min={0} onChange={v => update('capitalEsther', v)} />
            <CriteriaRow label="Fam — total capital ($)"   sub="Used to calculate available buying power" inputId="c-cap-fam"    value={local.capitalFam}    min={0} onChange={v => update('capitalFam', v)} />
          </div>
        </>
      );
      case 'sheets': return (
        <>
          <div className="slabel">Google Sheets</div>
          <div className="ssec">
            {credentialRow({
              label: 'Web App URL',
              sub: 'The /exec URL from your Google Apps Script deployment.',
              type: 'url',
              placeholder: 'https://script.google.com/macros/s/…/exec',
              value: sheetUrl,
              onChange: setSheetUrl,
              onSaveFn: saveSheetCredentials,
              saved: sheetSaved,
            })}
            {credentialRow({
              label: 'Secret',
              sub: 'Must match the secret property in your Apps Script.',
              type: 'password',
              placeholder: 'your-secret',
              value: sheetSecret,
              onChange: setSheetSecret,
              onSaveFn: saveSheetCredentials,
              saved: sheetSaved,
            })}
          </div>
        </>
      );
      case 'api': return (
        <>
          <div className="slabel">API Keys</div>
          <div className="ssec">
            {credentialRow({
              label: 'Tradier API key',
              sub: 'Used for live prices, indicators, and option chains. Stored in this browser only — never in the code or sheet.',
              type: 'password',
              placeholder: 'your-tradier-token',
              value: tradierKey,
              onChange: setTradierKey,
              onSaveFn: saveTradierKey,
              saved: keySaved,
            })}
          </div>
        </>
      );
      default: return null;
    }
  }

  const actionButtons = (
    <>
      <button className="btn-p" onClick={onRefresh} style={{ marginTop: 12, marginBottom: 0 }}>↻ Run Screener Now</button>
      <button className="btn-s" onClick={onPull}>⇩ Pull Latest from Google Sheets</button>
    </>
  );

  // ── Mobile: drill-down list ──────────────────────────────────────────────
  if (isMobile) {
    if (!section) {
      return (
        <div>
          <div className="slabel">Settings</div>
          <div className="ssec">
            {SECTIONS.map(s => (
              <div key={s.id} className="set-cat" onClick={() => setSection(s.id)}>
                <div>
                  <div className="set-cat-l">{s.label}</div>
                  <div className="set-cat-sub">{s.sub}</div>
                </div>
                <span className="set-chev">›</span>
              </div>
            ))}
          </div>
          {actionButtons}
        </div>
      );
    }
    return (
      <div>
        <div className="set-back" onClick={() => setSection(null)}>‹ All settings</div>
        {sectionContent(section)}
      </div>
    );
  }

  // ── Desktop: sidebar + content pane ──────────────────────────────────────
  const active = section || 'csp';
  return (
    <div className="set-layout">
      <div className="set-nav">
        {SECTIONS.map(s => (
          <div
            key={s.id}
            className={`set-nav-item${active === s.id ? ' active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </div>
        ))}
        {actionButtons}
      </div>
      <div className="set-content">
        {sectionContent(active)}
      </div>
    </div>
  );
}
