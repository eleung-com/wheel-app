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
      <div className="slabel">Exit Rules</div>
      <div className="ssec">
        <CriteriaRow label="Early close — % premium captured"  sub="Fire BTC signal when this much is locked in"         inputId="c-close-pct" value={local.closePct}    onChange={v => update('closePct', v)} />
        <CriteriaRow label="Early close — max % DTE elapsed"  sub="Only suggest close if less than this % of time gone" inputId="c-close-dte" value={local.closeDtePct} onChange={v => update('closeDtePct', v)} />
      </div>

      <div className="slabel">Account Capital</div>
      <div className="ssec">
        <div className="shdr">Set total capital per account to track allocation</div>
        <CriteriaRow label="Esther — total capital ($)" sub="Used to calculate available buying power" inputId="c-cap-esther" value={local.capitalEsther} min={0} onChange={v => update('capitalEsther', v)} />
        <CriteriaRow label="Fam — total capital ($)"   sub="Used to calculate available buying power" inputId="c-cap-fam"    value={local.capitalFam}    min={0} onChange={v => update('capitalFam', v)} />
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
