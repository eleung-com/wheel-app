// Unattended signal scan — the server-side mirror of useScreener.js. Runs on
// the Cron Trigger (see worker.js's scheduled() and wrangler.toml), pulls the
// same watchlist/positions/criteria the app uses, re-runs the shared signal
// engine, and DMs new hits to Telegram with KV de-duping so a persisting
// condition doesn't re-alert all day.

import { readWatchlist } from './notion.js';
import { PRIORITY, dte, buildSignals, cspEntryOk, ccEntryOk, OPEN_OPTION_TYPES } from '../src/lib/signalEngine.js';
import { parsePositions, parseCriteria, CLOSE_TYPES, isPriceableOption } from '../src/lib/utils.js';
import { fetchQ, fetchOptionPrice, fetchBestStrike } from '../src/lib/marketData.js';
import { sendTelegram, formatCountAlert } from './telegram.js';
import { isMarketOpen, etDateString } from './marketHours.js';
import { refreshEarnings } from './earnings.js';
import { listRuns, applyPendingDecisions } from './stockRuns.js';
import { scoreMap } from '../src/lib/research/runRecord.js';
import { SECTION } from '../src/lib/signalSections.js';
import { prefetchLeaps } from '../src/lib/leaps.js';

const CBOE_ORIGIN    = 'https://cdn.cboe.com/api/global/delayed_quotes';
const YAHOO_ORIGIN   = 'https://query1.finance.yahoo.com';

// A signal that fires and gets dismissed still shouldn't re-alert same-day —
// a few days of headroom past the daily de-dupe window is plenty; KV just
// needs the key gone well before it could collide with a future date.
const DEDUPE_TTL_SECONDS     = 3 * 24 * 60 * 60;
const SELF_ALERT_TTL_SECONDS = 24 * 60 * 60;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sheet: positions + criteria (Notion owns the watchlist; the Sheet owns
// held lots and the screener's saved thresholds) ────────────────────────────
async function fetchSheetData(env) {
  if (!env.SHEET_URL) throw new Error('SHEET_URL secret is not set on the worker');
  const url = `${env.SHEET_URL}?secret=${encodeURIComponent(env.APP_SECRET || '')}&action=read`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`sheet read HTTP ${r.status}`);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`sheet read: non-JSON response: ${text.slice(0, 120)}`); }
  if (data.error) throw new Error(data.error);
  return {
    positions: Array.isArray(data.positions) ? parsePositions(data.positions) : [],
    criteria:  parseCriteria(data.criteria && typeof data.criteria === 'object' ? data.criteria : {}),
  };
}

// ── Transport ────────────────────────────────────────────────────────────────
// The Worker half of the marketData contract. Unlike the browser it isn't
// subject to CORS, so it calls both sources directly. Both want a browser
// User-Agent — Yahoo rejects bare server requests.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
function workerTransport(env) {
  return {
    async cboe(path, timeoutMs) {
      return fetch(CBOE_ORIGIN + path, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
    async yahoo(path, timeoutMs) {
      return fetch(YAHOO_ORIGIN + path, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/json,text/plain,*/*',
          'Referer': 'https://finance.yahoo.com/',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    },
  };
}

/**
 * Price every open contract and stamp `_liveCurPrem` on it, exactly as the
 * browser's screener does before calling buildSignals.
 *
 * @returns { priced, unpricedIds } — `unpricedIds` are the positions whose close
 * signal must be suppressed, because the only premium available for them is the
 * Sheet's possibly-stale one.
 */
async function withLivePremiums(env, positions) {
  const tx = workerTransport(env);
  const open = positions.filter(isPriceableOption);
  if (!open.length) return { priced: positions, unpricedIds: new Set() };

  const live = new Map();
  const unpricedIds = new Set();
  for (const pos of open) {
    const premium = await fetchOptionPrice(tx, pos);
    if (premium === null) unpricedIds.add(pos.id);
    else live.set(pos.id, premium);
    await sleep(450); // same pacing as the browser's option loop
  }

  const priced = positions.map(p =>
    live.has(p.id) ? { ...p, _liveCurPrem: live.get(p.id) } : p);
  return { priced, unpricedIds };
}

async function selfAlertOnce(env, message, now) {
  const key = `self-alert|${etDateString(now)}`;
  if (env.ALERTS_KV && await env.ALERTS_KV.get(key)) return;
  try {
    await sendTelegram(env, `⚠️ Wheel scan\n${message}`);
  } catch (e) {
    console.error('[scan] self-alert delivery failed:', e?.message || e);
    return; // don't mark as sent if we couldn't even deliver the self-alert
  }
  if (env.ALERTS_KV) await env.ALERTS_KV.put(key, '1', { expirationTtl: SELF_ALERT_TTL_SECONDS });
}

// ── 21-DTE management nudge ──────────────────────────────────────────────────
// Wheel convention says decide (roll / close / take assignment) around 21 DTE,
// where gamma risk starts climbing fast. This pass is deliberately *not* part of
// buildSignals: nothing has to have moved in the market for it to fire, it's
// purely the calendar, and it stays out of the dashboard's signal cards.

/** Still-open option row: has a contract, hasn't been closed out or rolled. */
function isOpenOption(p) {
  return p.strike != null
    && !!p.expiry
    && p.type !== 'shares'
    && !p.linkedId            // set on the opening row once it's been closed
    && !CLOSE_TYPES.has(p.type); // the close row itself
}

/**
 * Open options inside the management window (Part 2C: no longer their own
 * message — they count toward "to manage" in the single count message).
 * Keyed on position id (not ticker) so two contracts on one underlying each
 * count. @returns [{ key, bucket: 'manage' }]
 */
export function dteDue(positions, criteria, now) {
  const threshold = criteria.manageDte;
  if (!threshold || threshold < 1) return [];
  const out = [];
  for (const pos of positions.filter(isOpenOption)) {
    const days = dte(pos.expiry);
    // NOTE the `<= 1`. The shared dte() counts expiry day itself as 1 — an
    // option expiring today reads "1 DTE" everywhere in the dashboard — so
    // "silent on expiry day, and after it" is days <= 1, not days < 1.
    if (days == null || days <= 1 || days > threshold) continue;
    out.push({ key: `manage-dte|${pos.id}|${etDateString(now)}`, bucket: 'manage' });
  }
  return out;
}

// Signal type → count-message bucket — the same map the app's three sections use.
const BUCKET = SECTION;

/**
 * Part 2C: ONE Telegram message with the counts, sent only when something is
 * new since the last one today (an item whose KV key isn't set yet). A
 * failed send marks nothing, so the next scan retries.
 * @returns { sent, counts }
 */
export async function sendCounts(env, items, now) {
  const counts = { manage: 0, trades: 0, waiting: 0 };
  for (const it of items) counts[it.bucket]++;
  const fresh = [];
  for (const it of items) {
    if (!env.ALERTS_KV || !(await env.ALERTS_KV.get(it.key))) fresh.push(it);
  }
  if (!fresh.length) return { sent: false, counts };
  try {
    await sendTelegram(env, formatCountAlert(counts));
  } catch (e) {
    console.error('[scan] count message failed, will retry next run:', e?.message || e);
    return { sent: false, counts };
  }
  if (env.ALERTS_KV) {
    for (const it of fresh) await env.ALERTS_KV.put(it.key, '1', { expirationTtl: DEDUPE_TTL_SECONDS });
  }
  return { sent: true, counts };
}

// `now` is an injectable clock — worker.js's scheduled() calls this with no
// second argument (real time); tests pass a fixed Date for determinism.
export async function runScan(env, now = new Date()) {
  if (!isMarketOpen(now)) return;

  const tx = workerTransport(env);

  try {
    const watchlist = await readWatchlist(env);
    const { positions, criteria } = await fetchSheetData(env);

    // Calendar-only, so it's worked out before (and independently of) the
    // market-data pass — a Yahoo/CBOE outage must not swallow it (Part 2C:
    // counted in the one message, sent even when every price fetch fails).
    let due = [];
    try {
      due = dteDue(positions, criteria, now);
    } catch (e) {
      console.error('[scan] dte pass failed:', e?.message || e);
    }

    const priorityTickers = watchlist.filter(w => w.diveIn === PRIORITY).map(w => w.ticker);
    const heldTickers = positions
      .filter(p => (p.type === 'shares' || OPEN_OPTION_TYPES.has(p.type)) && !p.linkedId)
      .map(p => p.ticker);
    const tickers = [...new Set([...priorityTickers, ...heldTickers])];

    // Earnings dates from Finnhub, once per ET day (Part 2A). Runs before the
    // signal pass so today's cards and alerts see corrected dates. Its own
    // failure never stops the scan.
    try {
      await refreshEarnings(env, watchlist, heldTickers, now);
    } catch (e) {
      console.error('[scan] earnings refresh failed:', e?.message || e);
    }

    // Part 2B: Research decisions made before TradingView synced the row →
    // copy them into Dive-In, once a day. Updates this scan's rows too.
    try {
      const dayKey = `decisions|day|${etDateString(now)}`;
      if (!env.ALERTS_KV || !(await env.ALERTS_KV.get(dayKey))) {
        const applied = await applyPendingDecisions(env);
        for (const a of applied) {
          const w = watchlist.find(x => x.ticker === a.ticker);
          if (w) w.diveIn = { Priority: PRIORITY, Watch: '👀 Watch', Reject: '— Skip' }[a.decision] || w.diveIn;
        }
        if (applied.length) console.log('[scan] dive-in applied:', JSON.stringify(applied));
        if (env.ALERTS_KV) await env.ALERTS_KV.put(dayKey, '1', { expirationTtl: 3 * 86400 });
      }
    } catch (e) {
      console.error('[scan] pending decisions failed:', e?.message || e);
    }

    // Part 2B: latest Investment Score per ticker gates CSP cards. null on a
    // Notion failure → cards still go out, tagged "Score unavailable".
    let scores = null;
    try { scores = scoreMap(await listRuns(env, { limit: 50 })); }
    catch (e) { console.error('[scan] score read failed:', e?.message || e); }

    if (!tickers.length) { await sendCounts(env, due, now); return; } // nothing flagged or held

    const qmap = {};
    let gotAny = false;
    for (const t of tickers) {
      try { qmap[t] = await fetchQ(tx, t, criteria.ma); }
      catch (e) { console.error(`[scan] ${t} fetch failed, skipping:`, e?.message || e); qmap[t] = null; }
      if (qmap[t]) gotAny = true;
      await sleep(350); // Yahoo pacing — matches useScreener.js
    }

    if (!gotAny) {
      await selfAlertOnce(env, 'Every ticker fetch failed this run — Yahoo price history may be unreachable or blocking the Worker.', now);
      // Calendar items don't need prices — still count them.
      await sendCounts(env, due, now);
      return;
    }

    // Live strike lookups, gated on the same cspEntryOk/ccEntryOk predicates
    // buildSignals decides with — so a Telegram alert can never be built for a
    // ticker whose strike this loop skipped. It used to filter on the retired
    // 5-day-drop rule, which is why alerts mostly carried the generic
    // delta/DTE line instead of a concrete contract.
    const strikeMap = {};
    for (const w of watchlist) {
      if (w.diveIn !== PRIORITY) continue;
      if (strikeMap[`${w.ticker}:put`]) continue;
      if (!cspEntryOk(qmap[w.ticker], criteria)) continue;
      const hasOpt = positions.some(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
      if (hasOpt) continue;
      const best = await fetchBestStrike(tx, w.ticker, 'put', criteria.deltaMin, criteria.deltaMax, criteria.dteMin, criteria.dteMax);
      if (best) strikeMap[`${w.ticker}:put`] = best;
      await sleep(450);
    }
    for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= 100)) {
      if (strikeMap[`${pos.ticker}:call`]) continue;
      if (!ccEntryOk(qmap[pos.ticker], criteria)) continue;
      const hasCall = positions.some(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
      if (hasCall) continue;
      const best = await fetchBestStrike(tx, pos.ticker, 'call', criteria.ccDeltaMin, criteria.ccDeltaMax, criteria.ccDteMin, criteria.ccDteMax);
      if (best) strikeMap[`${pos.ticker}:call`] = best;
      await sleep(450);
    }

    // Price open contracts before the signal pass — the close rule is meaningless
    // without a current premium, and the Sheet's copy is only as fresh as the
    // last time it was typed in.
    let pricedPositions = positions;
    let unpricedIds = new Set();
    try {
      ({ priced: pricedPositions, unpricedIds } = await withLivePremiums(env, positions));
    } catch (e) {
      // Pricing is an enhancement to the close rule, not a prerequisite for the
      // roll/max-loss alerts, which key off the stock price alone. Treat a total
      // failure as "nothing could be priced" so those still go out.
      console.error('[scan] live premium pass failed:', e?.message || e);
      unpricedIds = new Set(positions.filter(isPriceableOption).map(p => p.id));
    }

    // Part 2D: weekly LEAPS setups, cached a day in KV. No option chains here
    // (Telegram only counts; the app picks the contract when opened).
    let wmap = {};
    try {
      ({ wmap } = await prefetchLeaps(tx, {
        watchlist, positions: pricedPositions, criteria, scores, chains: false, now,
        cache: env.ALERTS_KV || undefined, sleep,
      }));
    } catch (e) {
      console.error('[scan] leaps prefetch failed:', e?.message || e);
    }

    const sigs = buildSignals(watchlist, pricedPositions, criteria, qmap, strikeMap, scores, { wmap })
      // A close alert says "buy it back at this price". Sending one computed off
      // a stale Sheet value is worse than staying quiet — the roll and max-loss
      // alerts for the same position are unaffected, since those read the stock.
      .filter(sig => !(sig.type === 'close' && unpricedIds.has(Number(sig.id.slice('close-'.length)))));

    const items = [
      ...due,
      ...sigs.filter(sig => BUCKET[sig.type]).map(sig => ({
        key: `${sig.ticker}|${sig.type}|${etDateString(now)}`, bucket: BUCKET[sig.type],
      })),
    ];
    const { counts } = await sendCounts(env, items, now);
    // Returned for tests and logs; the cron caller ignores it.
    return { sigs, counts };
  } catch (e) {
    console.error('[scan] run failed:', e?.message || e);
    await selfAlertOnce(env, `Scan crashed: ${e?.message || e}`, now);
  }
}
