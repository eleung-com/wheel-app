// Telegram delivery for the unattended scan. Plain text (no parse_mode) so
// tickers, dollar signs, and deltas never need HTML/Markdown escaping.
//
// Part 2C (decided 10-04): the scan sends ONE count message, no details —
// formatCountAlert(). It forces a look at the app, where the cards are.
// formatAlert / formatDteAlert are kept for reference and tests only.

import { formatDateDisplay } from '../src/lib/utils.js';

const APP_URL = 'https://wheel-app-67w.pages.dev/';

/**
 * Part 2C: the only signal message the scan sends.
 *   📡 Wheel: 2 to manage · 3 new trades · 1 waiting
 *   Open app → https://wheel-app-67w.pages.dev/
 */
export function formatCountAlert({ manage = 0, trades = 0, waiting = 0 } = {}) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  return [
    `\u{1F4E1} Wheel: ${manage} to manage \u00b7 ${n(trades, 'new trade', 'new trades')} \u00b7 ${waiting} waiting`,
    `Open app \u2192 ${APP_URL}`,
  ].join('\n');
}

export async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID secret is not set on the worker');
  }
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`telegram sendMessage ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * One message per signal from buildSignals() — ticker, signal type, why it
 * fired, current price, strike/DTE context where relevant, and the app link.
 * `ivr` is always an HV30 (realized-vol) estimate, never a real IV Rank — the
 * label below says so wherever it's shown, per the approved spec.
 */
export function formatAlert(sig) {
  const price = sig.price != null ? `$${Number(sig.price).toFixed(2)}` : '—';
  const chg   = sig.chg != null ? `${sig.chg >= 0 ? '+' : ''}${sig.chg.toFixed(1)}%` : '';

  let title, why;
  switch (sig.type) {
    case 'csp':
      title = `🎯 CSP — ${sig.ticker}`;
      why = `${sig.dropPct.toFixed(1)}% off 5-day high ($${sig.weekHigh.toFixed(2)})`;
      break;
    case 'cc':
      title = `📈 CC — ${sig.ticker}`;
      why = `+${sig.rallyPct.toFixed(1)}% off 5-day low ($${sig.weekLow.toFixed(2)})`;
      break;
    case 'roll':
      title = `🔁 ROLL — ${sig.ticker}`;
      why = 'Strike breached';
      break;
    case 'close':
      title = `✅ CLOSE — ${sig.ticker}`;
      why = `${sig.pctCap}% of premium captured · ${sig.pctT}% of time elapsed`;
      break;
    // Not actionable in the roll sense — both legs are in the money and the loss
    // is already capped. Worth knowing the day it happens all the same.
    case 'maxloss':
      title = `🛑 MAX LOSS — ${sig.ticker}`;
      why = `Below the long strike $${sig.longStrike} · spread $${sig.width} wide · ${sig.days}d left`;
      break;
    default:
      title = `${String(sig.type).toUpperCase()} — ${sig.ticker}`;
      why = '';
  }

  const lines = [title];
  if (why) lines.push(why);
  lines.push(`Price: ${price}${chg ? ` (${chg})` : ''}`);

  if (sig.strike != null) {
    const dteT = sig.dteTarget != null ? sig.dteTarget : sig.days;
    lines.push(`Strike: $${sig.strike}${dteT != null ? ` · ${dteT}d` : ''}`);
  }
  if (sig.ivr != null) lines.push(`HV30 est: ${sig.ivr}`); // realized-vol estimate, not real IV Rank
  // CSPs blocked by earnings never reach here (csp_wait is filtered in scan.js).
  // What's left: a CSP with earnings shortly after expiry, or a covered call
  // (still advisory) with earnings inside the contract / unknown.
  const ew = sig.earnWarn;
  if (ew && !ew.na) {
    if (ew.warn)                   lines.push(`\u26a0 Earnings in ${ew.days}d - shortly after this contract expires`);
    else if (ew.block && ew.known) lines.push(`\u26a0 Earnings in ${ew.days}d - before this contract expires`);
    else if (!ew.known)            lines.push('\u26a0 No earnings date on file');
  }
  if (sig.suggestion) lines.push(sig.suggestion);
  lines.push(APP_URL);

  return lines.join('\n');
}

/** "Short put", "Short call", "Put credit spread", … for the DTE nudge's subtitle. */
function positionLabel(pos) {
  if (pos.longStrike != null) return 'Put credit spread';
  if (pos.type === 'short_put')  return 'Short put';
  if (pos.type === 'short_call') return 'Short call';
  return String(pos.type || 'Option').replace(/_/g, ' ');
}

/**
 * The daily "this position has hit your management window" nudge — one per open
 * option per ET day, fired by runScan's DTE pass. Unlike formatAlert's signals
 * this isn't a market-condition call: nothing has to have moved, it's purely the
 * calendar. `threshold` is criteria.manageDte so the message always states the
 * rule the user actually set rather than a hardcoded 21.
 */
export function formatDteAlert(pos, days, threshold) {
  const lines = [`⏳ ${threshold}-DTE — ${pos.ticker}`];

  const bits = [positionLabel(pos)];
  if (pos.strike != null) {
    bits.push(pos.longStrike != null ? `$${pos.strike}/$${pos.longStrike}` : `$${pos.strike} strike`);
  }
  bits.push(`${days} DTE`);
  lines.push(bits.join(' · '));

  lines.push(`Expiry: ${formatDateDisplay(pos.expiry)}`);
  // Account is included because the same ticker/strike can be open in both
  // accounts — without it two legitimate nudges read as one duplicate.
  if (pos.account) lines.push(`Account: ${pos.account}`);
  lines.push('Manage: roll out, or close if premium mostly captured');
  lines.push(APP_URL);

  return lines.join('\n');
}
