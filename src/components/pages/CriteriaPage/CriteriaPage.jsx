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

export default function CriteriaPage({ criteria, onSave, onRefresh, onPull }) {
  const [local,       setLocal]       = useState(criteria);
  const [tradierKey,  setTradierKey]  = useState(() => getTradierKey());
  const [sheetUrl,    setSheetUrl]    = useState(() => getSheetUrl());
  const [sheetSecret, setSheetSecret] = useState(() => getSecret());
  const [keySaved,    setKeySaved]    = useState(false);
  const [sheetSaved,  setSheetSaved]  = useState(false);

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

  return (
    <div>
      <div className="slabel">CSP Entry — Technical Indicators</div>
      <div className="ssec">
        <div className="shdr">All 4 required to fire a CSP signal</div>
        <CriteriaRow label="Min IV Rank (IVR)"    sub="IVR must be ≥ this value"                inputId="c-ivr"   value={local.ivr}   min={0}  max={100} onChange={v => update('ivr', v)} />
        <CriteriaRow label="Max Stochastic %K"    sub="Oversold when Stoch %K < this"           inputId="c-stoch" value={local.stoch} min={0}  max={100} onChange={v => update('stoch', v)} />
        <CriteriaRow label="Max RSI (14)"         sub="Oversold when RSI < this"                inputId="c-rsi"   value={local.rsi}   min={0}  max={100} onChange={v => update('rsi', v)} />
        <CriteriaRow label="Price above MA"       sub="Moving average period (days)"            inputId="c-ma"    value={local.ma}    min={20} max={250} onChange={v => update('ma', v)} />
        <CriteriaRow label="Avoid earnings within" sub="Days — skip if earnings inside DTE window" inputId="c-earn" value={local.earn}  onChange={v => update('earn', v)} />
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

      <div className="slabel">Covered Call — Entry</div>
      <div className="ssec">
        <CriteriaRow label="Min shares owned"  sub="Must have at least this many"          inputId="c-shares"   value={local.shares}  onChange={v => update('shares', v)} />
        <CriteriaRow label="Min IVR for CC"    sub="Lower bar OK for covered calls"        inputId="c-cc-ivr"   value={local.ccIvr}   onChange={v => update('ccIvr', v)} />
        <CriteriaRow
          label="CC target delta range" sub="Strike is chosen at the midpoint delta"
          pair={{ min: local.ccDeltaMin, max: local.ccDeltaMax }}
          onChange={v => updatePair('ccDeltaMin', 'ccDeltaMax', v)}
        />
        <CriteriaRow
          label="CC DTE range"
          pair={{ min: local.ccDteMin, max: local.ccDteMax }}
          onChange={v => updatePair('ccDteMin', 'ccDteMax', v)}
        />
      </div>

      <div className="slabel">Exit Rules</div>
      <div className="ssec">
        <CriteriaRow label="Early close — % premium captured"  sub="Fire BTC signal when this much is locked in"         inputId="c-close-pct" value={local.closePct}    onChange={v => update('closePct', v)} />
        <CriteriaRow label="Early close — max % DTE elapsed"  sub="Only suggest close if less than this % of time gone" inputId="c-close-dte" value={local.closeDtePct} onChange={v => update('closeDtePct', v)} />
      </div>

      <button className="btn-p" onClick={onRefresh} style={{ marginBottom: 8 }}>↻ Run Screener Now</button>
      <button className="btn-s" onClick={onPull}    style={{ marginBottom: 8 }}>⇩ Pull Latest from Google Sheets</button>

      <div className="slabel" style={{ marginTop: 8 }}>Google Sheets</div>
      <div className="ssec">
        {[
          {
            label: 'Web App URL',
            sub: 'The /exec URL from your Google Apps Script deployment.',
            type: 'url',
            placeholder: 'https://script.google.com/macros/s/…/exec',
            value: sheetUrl,
            onChange: setSheetUrl,
            onSave: saveSheetCredentials,
            saved: sheetSaved,
          },
          {
            label: 'Secret',
            sub: 'Must match the secret property in your Apps Script.',
            type: 'password',
            placeholder: 'your-secret',
            value: sheetSecret,
            onChange: setSheetSecret,
            onSave: saveSheetCredentials,
            saved: sheetSaved,
          },
        ].map(({ label, sub, type, placeholder, value, onChange, onSave, saved }) => (
          <div key={label} className="srow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <div className="slbl2">{label}</div>
            <div className="ssub">{sub}</div>
            <div style={{ display: 'flex', gap: 8, width: '80vw', maxWidth: '100%' }}>
              <input
                className="sinput"
                type={type}
                placeholder={placeholder}
                value={value}
                style={{ flex: 1, width: 'auto', maxWidth: 'none', textAlign: 'left', fontSize: 13, padding: '9px 12px' }}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSave()}
              />
              <button className="btn-s" style={{ margin: 0, whiteSpace: 'nowrap', padding: '0 12px', fontSize: 11 }} onClick={onSave}>
                {saved ? '✓' : 'Save'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="slabel" style={{ marginTop: 8 }}>API Keys</div>
      <div className="ssec">
        <div className="srow" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <div className="slbl2">Tradier API key</div>
          <div className="ssub">Used for live prices, indicators, and option chains. Stored in this browser only — never in the code or sheet.</div>
          <div style={{ display: 'flex', gap: 8, width: '80vw', maxWidth: '100%' }}>
            <input
              className="sinput"
              type="password"
              placeholder="your-tradier-token"
              value={tradierKey}
              style={{ flex: 1, width: 'auto', maxWidth: 'none', textAlign: 'left', fontSize: 13, padding: '9px 12px' }}
              onChange={e => setTradierKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveTradierKey()}
            />
            <button className="btn-s" style={{ margin: 0, whiteSpace: 'nowrap', padding: '0 12px', fontSize: 11 }} onClick={saveTradierKey}>
              {keySaved ? '✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
