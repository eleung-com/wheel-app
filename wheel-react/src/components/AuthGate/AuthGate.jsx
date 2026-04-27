import React, { useState, useRef, useEffect } from 'react';
import { LS_URL_KEY, LS_SECRET_KEY, LS_SESSION_KEY, LS_TRADIER_KEY, getSecret } from '../../lib/utils';

export default function AuthGate({ mode, onSuccess, onResetToSetup }) {
  const isSetup = mode === 'setup';

  // Setup form state
  const [url,         setUrl]         = useState('');
  const [secret,      setSecret]      = useState('');
  const [tradierKey,  setTradierKey]  = useState('');
  const [setupErr,    setSetupErr]    = useState('');

  // Login form state
  const [loginVal,  setLoginVal]  = useState('');
  const [loginErr,  setLoginErr]  = useState('');
  const [loginBorder, setLoginBorder] = useState('');

  const urlRef   = useRef(null);
  const loginRef = useRef(null);

  useEffect(() => {
    if (isSetup)  urlRef.current?.focus();
    else          loginRef.current?.focus();
  }, [isSetup]);

  async function doSetup() {
    const trimmedUrl    = url.trim();
    const trimmedSecret = secret.trim();
    setSetupErr('');
    if (!trimmedUrl || !trimmedUrl.startsWith('https://script.google.com')) {
      setSetupErr('Enter a valid Apps Script URL (starts with https://script.google.com)');
      return;
    }
    if (!trimmedSecret) {
      setSetupErr('Secret key cannot be empty');
      return;
    }
    setSetupErr('Testing connection…');
    try {
      const testUrl = `${trimmedUrl}?secret=${encodeURIComponent(trimmedSecret)}&action=read`;
      const r    = await fetch(testUrl, { signal: AbortSignal.timeout(12000) });
      const data = await r.json();
      if (data.error && data.error === 'unauthorized') {
        setSetupErr('✗ Wrong secret key — check your Apps Script and try again');
        return;
      }
    } catch (e) {
      setSetupErr('✗ Could not reach your Apps Script — check the URL and try again');
      return;
    }
    localStorage.setItem(LS_URL_KEY,     trimmedUrl);
    localStorage.setItem(LS_SECRET_KEY,  trimmedSecret);
    if (tradierKey.trim()) localStorage.setItem(LS_TRADIER_KEY, tradierKey.trim());
    localStorage.setItem(LS_SESSION_KEY, '1');
    onSuccess();
  }

  function doLogin() {
    setLoginErr('');
    if (!loginVal) { setLoginErr('Enter your secret key'); return; }
    if (loginVal !== getSecret()) {
      setLoginErr('Incorrect secret key');
      setLoginVal('');
      setLoginBorder('var(--r)');
      setTimeout(() => setLoginBorder(''), 1200);
      loginRef.current?.focus();
      return;
    }
    localStorage.setItem(LS_SESSION_KEY, '1');
    onSuccess();
  }

  function resetCredentials() {
    if (!confirm('This will clear your saved URL and secret key from this device. You will need to re-enter them. Continue?')) return;
    localStorage.removeItem(LS_URL_KEY);
    localStorage.removeItem(LS_SECRET_KEY);
    localStorage.removeItem(LS_SESSION_KEY);
    onResetToSetup();
  }

  return (
    <div className="pw-gate">
      <div className="pw-logo">wheel<em>.</em>desk</div>
      <div className="pw-sub">
        {isSetup ? 'First-time setup — enter your Google Sheet credentials' : 'personal trading dashboard'}
      </div>

      {isSetup ? (
        <div className="pw-card">
          <div>
            <div className="pw-field-lbl">Apps Script URL</div>
            <input
              ref={urlRef}
              className="pw-input"
              type="url"
              placeholder="https://script.google.com/macros/s/…/exec"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
          </div>
          <div>
            <div className="pw-field-lbl">Secret key</div>
            <input
              className="pw-input"
              type="password"
              placeholder="your-secret-here"
              autoComplete="off"
              value={secret}
              onChange={e => setSecret(e.target.value)}
            />
          </div>
          <div>
            <div className="pw-field-lbl">Tradier API key <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — add later in Settings)</span></div>
            <input
              className="pw-input large"
              type="password"
              placeholder="your-tradier-token"
              autoComplete="off"
              value={tradierKey}
              onChange={e => setTradierKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSetup()}
            />
          </div>
          <div className="pw-err">{setupErr}</div>
          <button className="pw-btn" onClick={doSetup}>Connect &amp; Save</button>
          <div className="pw-hint">
            All credentials are stored in this browser only — never in the source code or the sheet.
            You will enter these once per device. The Tradier key can be added later in Settings.
          </div>
        </div>
      ) : (
        <div className="pw-card">
          <div>
            <div className="pw-field-lbl">Secret key</div>
            <input
              ref={loginRef}
              className="pw-input large"
              type="password"
              placeholder="••••••"
              maxLength={60}
              autoComplete="current-password"
              value={loginVal}
              style={loginBorder ? { borderColor: loginBorder } : {}}
              onChange={e => setLoginVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
            />
          </div>
          <div className="pw-err">{loginErr}</div>
          <button className="pw-btn" onClick={doLogin}>Unlock</button>
          <button className="pw-reset" onClick={resetCredentials}>
            Reset credentials (set up new sheet)
          </button>
        </div>
      )}
    </div>
  );
}
