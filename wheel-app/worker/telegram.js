// Telegram delivery for the unattended scan — one DM per new signal, plain text
// (no parse_mode) so tickers, dollar signs, and deltas never need HTML/Markdown
// escaping.

import { formatDateDisplay } from '../src/lib/utils.js';

const APP_URL = 'https://eleung-com.github.io/wheel-app/';

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
