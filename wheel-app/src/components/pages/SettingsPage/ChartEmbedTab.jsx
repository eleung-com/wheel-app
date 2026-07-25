import React, { useState, useMemo } from 'react';
import { useTvEmbed, saveTvEmbed, clearTvEmbed, parseTvEmbed, isAdvancedChart } from '../../../lib/tvEmbed';

const PLACEHOLDER = `<!-- TradingView Widget BEGIN -->
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
  {
    "interval": "240",
    "theme": "dark",
    "studies": ["STD;RSI"]
  }
  </script>
</div>
<!-- TradingView Widget END -->`;

export default function ChartEmbedTab() {
  const stored = useTvEmbed();
  const [draft, setDraft] = useState(stored);
  const [saved, setSaved] = useState(false);

  const result = useMemo(() => (draft.trim() ? parseTvEmbed(draft) : null), [draft]);
  const dirty  = draft !== stored;

  function handleApply() {
    if (!result?.ok) return;
    saveTvEmbed(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function handleReset() {
    if (!confirm('Go back to the built-in chart setup?')) return;
    clearTvEmbed();
    setDraft('');
  }

  return (
    <>
      <div className="slabel">Watchlist Chart</div>
      <div className="ssec">
        <div className="srow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div>
            <div className="slbl2">TradingView embed code</div>
            <div className="ssub">
              Build a chart on tradingview.com, choose <em>Get embed code</em>, and paste the whole
              block here. The ticker pills keep working — whichever pill you tap is written into the
              widget&rsquo;s <code>symbol</code> before it loads, so your own settings for interval,
              studies, and theme are all that change.
            </div>
          </div>

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            style={{
              width: '100%', minHeight: 190, boxSizing: 'border-box',
              background: 'var(--s2)', border: '1px solid var(--b2)',
              borderRadius: 'var(--rs)', color: 'var(--tx)',
              fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.5,
              padding: '10px 12px', outline: 'none', resize: 'vertical',
            }}
          />

          {/* Parse feedback — shown live so a bad paste is obvious before applying */}
          {result && !result.ok && (
            <div style={{ fontSize: 11, color: 'var(--r)', fontFamily: 'var(--sans)', lineHeight: 1.5 }}>
              {result.error}
            </div>
          )}
          {result?.ok && (
            <div style={{ fontSize: 11, color: 'var(--g)', fontFamily: 'var(--sans)', lineHeight: 1.5 }}>
              Looks good — {Object.keys(result.config).length} setting
              {Object.keys(result.config).length === 1 ? '' : 's'} read from{' '}
              <span style={{ fontFamily: 'var(--mono)' }}>{result.src.split('/').pop()}</span>.
              {!isAdvancedChart(result.src) && (
                <div style={{ color: 'var(--a)', marginTop: 4 }}>
                  Heads up: this isn&rsquo;t the Advanced Chart widget, so it has no watchlist side
                  panel. Pill selection still drives the symbol.
                </div>
              )}
              {result.config.symbol === undefined && !isAdvancedChart(result.src) && (
                <div style={{ color: 'var(--a)', marginTop: 4 }}>
                  This widget has no <code>symbol</code> setting of its own — if it takes a{' '}
                  <code>symbols</code> list instead, tapping a pill won&rsquo;t change it.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-p"
              disabled={!result?.ok || !dirty}
              onClick={handleApply}
              style={{
                width: 'auto', flex: 1, padding: '10px 16px', fontSize: 12, minHeight: 40,
                opacity: (!result?.ok || !dirty) ? 0.45 : 1,
                cursor: (!result?.ok || !dirty) ? 'default' : 'pointer',
              }}
            >
              {saved ? '✓ Applied' : 'Apply to Watchlist'}
            </button>
            <button
              className="btn-s"
              onClick={handleReset}
              disabled={!stored}
              style={{
                width: 'auto', margin: 0, padding: '10px 16px', fontSize: 12, minHeight: 40,
                whiteSpace: 'nowrap', opacity: stored ? 1 : 0.45,
              }}
            >
              Use default
            </button>
          </div>

          <div className="ssub" style={{ marginTop: 0 }}>
            {stored
              ? 'A custom chart is in use. Saved in this browser only — it won’t follow you to another device.'
              : 'Using the built-in setup: 4h candles, Stochastic and RSI, watchlist panel on the right.'}
          </div>
        </div>
      </div>
    </>
  );
}
