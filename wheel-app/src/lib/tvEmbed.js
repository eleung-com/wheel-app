// ── TradingView embed override ────────────────────────────────────────────────
// TradingView hands out a block of HTML for every widget you configure on their
// site. Rather than hard-coding one chart setup, Settings → Chart takes a pasted
// block and the Watchlist chart uses it from then on.
//
// The pasted HTML is never injected into the page. It's parsed for two things —
// the script URL and the JSON settings inside the script tag — and the URL has
// to be TradingView's own host, so a bad paste can't get code running here.

import { useSyncExternalStore } from 'react';

export const TV_EMBED_KEY = 'wd_tv_embed';

const ALLOWED_HOSTS = ['s3.tradingview.com', 'www.tradingview.com', 'tradingview.com'];

export const DEFAULT_TV_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

// The setup the app shipped with. `symbol` and `watchlist` are left out on
// purpose — those are filled in from the selected pill and the watchlist.
export const DEFAULT_TV_CONFIG = {
  allow_symbol_change: true, calendar: false, details: false,
  hide_side_toolbar: true, hide_top_toolbar: false,
  hide_legend: false, hide_volume: false, hotlist: false,
  interval: '240', locale: 'en', save_image: true, style: '1',
  theme: 'dark', timezone: 'America/New_York',
  withdateranges: false, compareSymbols: [],
  studies: ['STD;Stochastic', 'STD;RSI'], autosize: true,
};

/**
 * Parse a pasted TradingView embed block.
 * @returns {{ok: true, src: string, config: object} | {ok: false, error: string}}
 */
export function parseTvEmbed(html) {
  const raw = String(html || '').trim();
  if (!raw) return { ok: false, error: 'Paste the embed code from TradingView first.' };

  let doc;
  try {
    // DOMParser builds an inert document — scripts in it never execute.
    doc = new DOMParser().parseFromString(raw, 'text/html');
  } catch (e) {
    return { ok: false, error: "That doesn't parse as HTML." };
  }

  const script = [...doc.querySelectorAll('script')].find(s => s.getAttribute('src'));
  if (!script) {
    return { ok: false, error: 'No <script src="…"> tag found. Copy the whole widget block, including the script tag.' };
  }

  // getAttribute, not .src — the latter resolves against this page's base URL.
  const srcAttr = script.getAttribute('src');
  let url;
  try {
    url = new URL(srcAttr, 'https://s3.tradingview.com');
  } catch (e) {
    return { ok: false, error: `Couldn't read the script URL: ${srcAttr}` };
  }
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    return { ok: false, error: `Only tradingview.com embeds are accepted — this one loads from ${url.hostname}.` };
  }

  const body = script.textContent.trim();
  if (!body) {
    return { ok: false, error: 'The script tag has no settings inside it. Copy the whole block, not just the opening tag.' };
  }

  let config;
  try {
    config = JSON.parse(body);
  } catch (e) {
    return { ok: false, error: `The settings inside the script tag aren't valid JSON — ${e.message}` };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'Expected a JSON object of widget settings inside the script tag.' };
  }

  return { ok: true, src: url.href, config };
}

/** True for the widget that has a symbol search and a watchlist side panel. */
export function isAdvancedChart(src) {
  return src.includes('embed-widget-advanced-chart');
}

// ── Storage ───────────────────────────────────────────────────────────────────
// This is a per-device display preference, so it lives in localStorage rather
// than the sheet — pasting a new chart on the laptop won't change the phone.
// useSyncExternalStore is what lets Settings and the Watchlist page stay in step
// while both are mounted; the app hides pages with CSS instead of unmounting.

const listeners = new Set();

function emit() { for (const l of listeners) l(); }

function subscribe(cb) {
  listeners.add(cb);
  window.addEventListener('storage', cb); // other tabs
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb); };
}

function readRaw() {
  try { return localStorage.getItem(TV_EMBED_KEY) || ''; } catch (e) { return ''; }
}

export function saveTvEmbed(raw) {
  try { localStorage.setItem(TV_EMBED_KEY, raw); } catch (e) {}
  emit();
}

export function clearTvEmbed() {
  try { localStorage.removeItem(TV_EMBED_KEY); } catch (e) {}
  emit();
}

/** The stored embed HTML, re-rendering any component that reads it when it changes. */
export function useTvEmbed() {
  return useSyncExternalStore(subscribe, readRaw, () => '');
}
