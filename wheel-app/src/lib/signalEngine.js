// Runtime-agnostic signal engine — no fetch, no browser/DOM globals. This is the
// single source of truth for the wheel signal logic: both the browser
// (useScreener.js, via indicators.js) and the Cloudflare Worker's unattended
// scan (worker/scan.js) import from here so the two never drift apart.

// The Dive-In select value in Notion that promotes a watchlist row into the
// signal engine. Rows reading anything else are never scanned for entries.
export const PRIORITY = '🔥 Priority';

export function dte(expiry) {
  if (!expiry) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((new Date(expiry + 'T12:00:00') - now) / 86400000);
}

// ── ATR-14 using Wilder's RMA — matches TradingView ta.atr() exactly ─────────
// True Range is the widest of: today's range, or today's high/low measured
// against yesterday's close (which captures overnight gaps that a plain
// high−low misses). RMA smoothing uses a 1/length multiplier rather than the
// EMA's 2/(length+1), and seeds on a plain SMA of the first `length` TRs —
// exactly what Pine Script's ta.rma() does.
export function calcATR(highs, lows, closes, length = 14) {
  const n = closes.length;
  if (n < length + 1) return null;

  const tr = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    ));
  }

  let atr = tr.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < tr.length; i++) {
    atr = (atr * (length - 1) + tr[i]) / length;
  }
  return atr > 0 ? atr : null;
}

/**
 * Pure derived-indicator math shared by browser and Worker: both already have
 * `{closes, highs, lows, dates}` daily history plus a live price/chg1d from
 * their own fetch path (Tradier direct for the Worker, tradierRequest for the
 * browser) — this just turns those arrays into the fields buildSignals reads.
 */
export function deriveIndicators({ closes, highs, lows, dates = [] }, price, chg1d, maPeriod = 200) {
  // MA check
  let aboveMa = null;
  const mp = maPeriod || 200;
  if (closes.length >= mp) {
    const ma = closes.slice(-mp).reduce((a, b) => a + b, 0) / mp;
    aboveMa = price > ma;
  } else if (closes.length >= 20) {
    const ma = closes.reduce((a, b) => a + b, 0) / closes.length;
    aboveMa = price > ma;
  }

  // ── Weekly extremes — the basis for both entry signals ───────────────────
  // "Past week" means the last 5 trading sessions, not 7 calendar days, so a
  // holiday-shortened week still compares five real bars. The window includes
  // today, so an intraday high set this morning counts as the week high.
  const WEEK_BARS = 5;
  let dropPct = null, rallyPct = null, weekHigh = null, weekLow = null;
  if (closes.length >= WEEK_BARS) {
    weekHigh = Math.max(...highs.slice(-WEEK_BARS));
    weekLow  = Math.min(...lows.slice(-WEEK_BARS));
    if (weekHigh > 0) dropPct  = (weekHigh - price) / weekHigh * 100;
    if (weekLow  > 0) rallyPct = (price - weekLow)  / weekLow  * 100;
  }

  // How far the drop is in units of the stock's own average daily range.
  // Displayed rather than gated on — it ranks which names deserve a manual
  // RSI/Stochastic check first.
  const atr     = calcATR(highs, lows, closes);
  const atrDrop = (atr && weekHigh !== null) ? (weekHigh - price) / atr : null;

  // HV30 → IVR estimate. NOTE: this is a realized-volatility estimate, not a
  // real IV Rank (no options-market data goes into it) — always label it
  // "HV30 est" wherever it's shown, per the Worker's Telegram messages too.
  let ivrEst = null, hv30 = null;
  if (closes.length >= 22) {
    const rc   = closes.slice(-22);
    const rets = rc.slice(1).map((c, i) => Math.log(c / rc[i]));
    const mn   = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vr   = rets.reduce((a, b) => a + (b - mn) ** 2, 0) / rets.length;
    hv30       = Math.sqrt(vr * 252) * 100;

    const yr  = closes.slice(-252);
    const yh  = highs.slice(-252);
    const yl  = lows.slice(-252);
    const h52 = yh.length ? Math.max(...yh) : Math.max(...yr);
    const l52 = yl.length ? Math.min(...yl) : Math.min(...yr);
    const pctFrH = (h52 - price) / ((h52 - l52) || 1) * 100;
    ivrEst = Math.min(99, Math.round(hv30 * 1.25 + pctFrH * 0.15));
  }

  return {
    price, chg1d, aboveMa, ivrEst, hv30,
    dropPct, rallyPct, weekHigh, weekLow, atr, atrDrop,
    closes2m: closes.slice(-45),
    dates2m:  dates.slice(-45),
  };
}

/** "down 2.3x its average daily range" — omitted when ATR can't be computed. */
function atrNote(q) {
  return q.atrDrop != null ? `${q.atrDrop.toFixed(1)}x ATR` : null;
}

export function buildSignals(watchlist, positions, criteria, qmap, strikeMap = {}) {
  const cr   = criteria;
  const sigs = [];

  // Covered calls key off a share lot, which may sit on a ticker that never
  // made the watchlist — hence a lookup rather than reading the row directly.
  const byTicker = new Map(watchlist.map(w => [w.ticker, w]));

  /** Notion context every signal carries, so cards can show the latest eval. */
  const notionOf = (ticker) => {
    const w = byTicker.get(ticker);
    return {
      pageId:       w?.pageId       || null,
      notes:        w?.notes        || '',
      wheel:        w?.wheel        || '',
      fundamentals: w?.fundamentals || '',
      lastEval:     w?.lastEval     || '',
    };
  };

  // ── CSP signals ───────────────────────────────────────────────────────────
  // Two conditions only: the row is flagged Priority in Notion, and the price
  // has fallen at least cr.dropPct from its 5-day high. Deliberately does not
  // gate on RSI or Stochastic — those are checked by eye on the Watchlist
  // chart, and the ATR figure below says which name to look at first.
  for (const w of watchlist) {
    if (w.diveIn !== PRIORITY) continue;

    const q = qmap[w.ticker];
    if (!q || q.dropPct == null) continue;

    const dropOk = q.dropPct >= cr.dropPct;
    const hasOpt = positions.find(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);
    if (!dropOk || hasOpt) continue;

    const live    = strikeMap[`${w.ticker}:put`];
    const strike  = live?.strike ?? null;
    const dteT    = live?.dte    ?? null;
    const deltaStr = live?.delta != null
      ? `Δ${Math.abs(live.delta).toFixed(2)}`
      : `${cr.deltaMin}–${cr.deltaMax}Δ range`;

    const chks = [
      { l: 'Dive-In Priority', ok: true, tgt: PRIORITY },
      { l: `${q.dropPct.toFixed(1)}% off week high`, ok: true, tgt: `≥${cr.dropPct}%` },
    ];
    const note = atrNote(q);
    if (note) chks.push({ l: note, ok: true, tgt: 'context' });

    const suggParts = [];
    if (dteT != null && strike != null) suggParts.push(`Sell ${dteT}d $${strike} put`);
    else suggParts.push(`Sell put · ${cr.deltaMin}–${cr.deltaMax}Δ · ${cr.dteMin}–${cr.dteMax}d`);
    if (live) suggParts.push(deltaStr);
    // The MA no longer gates the signal, but a deep drop below it is the
    // difference between a pullback and a falling knife — worth saying out loud.
    if (q.aboveMa === false) suggParts.push(`⚠ Below the ${cr.ma}MA`);
    suggParts.push('Confirm RSI & Stoch on the chart first');

    sigs.push({
      id: `csp-${w.ticker}`, type: 'csp', ticker: w.ticker,
      price: q.price, chg: q.chg1d, strike, dteTarget: dteT,
      ivr: q.ivrEst ?? null, aboveMa: q.aboveMa, maPeriod: cr.ma,
      ...notionOf(w.ticker),
      dropPct: q.dropPct, weekHigh: q.weekHigh, atrDrop: q.atrDrop, chks,
      suggestion: suggParts.join(' · '),
      ts: Date.now(),
    });
  }

  // ── Covered Call signals ──────────────────────────────────────────────────
  const CC_MIN_SHARES = 100;
  for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= CC_MIN_SHARES)) {
    const q = qmap[pos.ticker];
    if (!q || q.rallyPct == null) continue;
    // Mirror of the put rule: a rally off the 5-day low is when call premium
    // is richest, the same way a drop off the 5-day high is when put premium is.
    const rallyOk = q.rallyPct >= cr.ccRallyPct;
    const hasCall = positions.find(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
    const contracts = Math.floor(pos.qty / 100);
    if (rallyOk && !hasCall && contracts >= 1) {
      const live     = strikeMap[`${pos.ticker}:call`];
      const strike   = live?.strike ?? null;
      const dteT     = live?.dte    ?? null;
      const deltaStr = live?.delta != null
        ? `Δ${Math.abs(live.delta).toFixed(2)}`
        : `${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ range`;
      const suggParts = [];
      if (dteT != null && strike != null) suggParts.push(`Sell ${contracts} x ${dteT}d $${strike} call`);
      else suggParts.push(`Sell ${contracts} call · ${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ · ${cr.ccDteMin}–${cr.ccDteMax}d`);
      if (live) suggParts.push(deltaStr);
      suggParts.push('Confirm RSI & Stoch on the chart first');
      const ccChks = [
        { l: `${pos.qty} shares (${contracts} contract${contracts > 1 ? 's' : ''})`, ok: true },
        { l: `+${q.rallyPct.toFixed(1)}% off week low`, ok: true, tgt: `≥${cr.ccRallyPct}%` },
      ];
      sigs.push({
        id: `cc-${pos.id}`, type: 'cc', ticker: pos.ticker,
        price: q.price, chg: q.chg1d, strike, dteTarget: dteT,
        contracts, sharesOwned: pos.qty,
        ...notionOf(pos.ticker),
        rallyPct: q.rallyPct, weekLow: q.weekLow, ivr: q.ivrEst ?? null,
        chks: ccChks,
        suggestion: suggParts.join(' · '),
        ts: Date.now(),
      });
    }
  }

  // ── Roll / Close signals ──────────────────────────────────────────────────
  for (const pos of positions.filter(p => (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId)) {
    const q    = qmap[pos.ticker];
    const days = dte(pos.expiry);
    if (days === null) continue;

    let origDte = null;
    if (pos.expiry && pos.enteredAt && pos.enteredAt > 0) {
      const calc = Math.round((new Date(pos.expiry + 'T12:00:00') - new Date(pos.enteredAt)) / 86400000);
      if (!isNaN(calc) && calc > 0) origDte = calc;
    }
    if (!origDte) origDte = pos.origDte || null;

    const pctT = (origDte && origDte > 0)
      ? Math.max(0, Math.round((1 - days / origDte) * 100))
      : null;

    const effectiveCurPrem = (pos._liveCurPrem !== undefined && pos._liveCurPrem !== null)
      ? pos._liveCurPrem
      : pos.curPrem;

    const pctCap = (effectiveCurPrem !== undefined && effectiveCurPrem !== null && pos.prem)
      ? Math.round((1 - effectiveCurPrem / pos.prem) * 100)
      : null;

    const putBr     = q && pos.type === 'short_put'  && q.price < pos.strike;
    const callBr    = q && pos.type === 'short_call' && q.price > pos.strike;
    const earlyClose = pctCap !== null && pctCap >= cr.closePct && pctT !== null && pctT < cr.closeDtePct;

    if (putBr || callBr) {
      sigs.push({
        id: `roll-${pos.id}`, type: 'roll', ticker: pos.ticker,
        price: q?.price, chg: q?.chg1d, strike: pos.strike, days,
        pctT: pctT ?? '—', pctCap,
        chks: [{ l: 'Strike breached', ok: false }],
        suggestion: putBr
          ? `Price $${q.price.toFixed(2)} < strike $${pos.strike} · Roll down & out to next expiry`
          : `Price $${q.price.toFixed(2)} > strike $${pos.strike} · Roll up & out or accept assignment`,
        ts: Date.now(),
      });
    } else if (earlyClose) {
      sigs.push({
        id: `close-${pos.id}`, type: 'close', ticker: pos.ticker,
        price: q?.price, chg: q?.chg1d, strike: pos.strike, days, pctT, pctCap,
        chks: [
          { l: `${pctCap}% captured`, ok: true },
          { l: `${pctT}% elapsed`,    ok: true },
        ],
        suggestion: `${pctCap}% of premium captured · ${pctT}% of time elapsed · Buy to close & redeploy capital`,
        ts: Date.now(),
      });
    }
  }

  return sigs;
}
