import { dte } from './utils';

export function buildSignals(watchlist, positions, criteria, qmap, strikeMap = {}) {
  const cr   = criteria;
  const sigs = [];

  // ── CSP signals ───────────────────────────────────────────────────────────
  for (const w of watchlist) {
    const q = qmap[w.ticker];
    if (!q) continue;

    const ivrOk   = q.ivrEst   !== null && q.ivrEst   >= cr.ivr;
    const rsiOk   = q.rsiEst   !== null && q.rsiEst   <= cr.rsi;
    const stochOk = q.stochEst !== null && q.stochEst <= cr.stoch;
    const maOk    = q.aboveMa  !== false;
    const hasOpt  = positions.find(p => p.ticker === w.ticker && (p.type === 'short_put' || p.type === 'short_call') && !p.linkedId);

    const chks = [
      { l: `IVR ${q.ivrEst   != null ? q.ivrEst + '%'         : '?'}`, ok: ivrOk,   tgt: `≥${cr.ivr}%`  },
      { l: `RSI ${q.rsiEst   != null ? q.rsiEst.toFixed(0)    : '?'}`, ok: rsiOk,   tgt: `<${cr.rsi}`   },
      { l: `Stoch ${q.stochEst != null ? q.stochEst.toFixed(0) : '?'}`, ok: stochOk, tgt: `<${cr.stoch}` },
      { l: `${cr.ma}MA`, ok: maOk, tgt: 'Above' },
    ];
    const allOk = ivrOk && rsiOk && stochOk && maOk;
    const passN = chks.filter(c => c.ok).length;

    if (!hasOpt) {
      if (allOk) {
        const live    = strikeMap[`${w.ticker}:put`];
        const strike  = live?.strike ?? null;
        const dteT    = live?.dte    ?? null;
        const premEst = live?.premium != null ? live.premium.toFixed(2) : null;
        const deltaStr = live?.delta != null
          ? `Δ${Math.abs(live.delta).toFixed(2)}`
          : `${cr.deltaMin}–${cr.deltaMax}Δ range`;
        const suggParts = [];
        if (dteT != null && strike != null) suggParts.push(`Sell ${dteT}d $${strike} put`);
        else suggParts.push(`Sell put · ${cr.deltaMin}–${cr.deltaMax}Δ · ${cr.dteMin}–${cr.dteMax}d`);
        if (live) suggParts.push(deltaStr);
        if (premEst) suggParts.push(`~$${premEst}/contract`);
        sigs.push({
          id: `csp-${w.ticker}`, type: 'csp', ticker: w.ticker,
          price: q.price, chg: q.chg1d, strike, dteTarget: dteT, premEst,
          ivr: q.ivrEst, rsi: q.rsiEst, stoch: q.stochEst, chks,
          suggestion: suggParts.join(' · '),
          ts: Date.now(),
        });
      } else if (passN >= 2) {
        sigs.push({
          id: `csp-p-${w.ticker}`, type: 'csp', ticker: w.ticker,
          price: q.price, chg: q.chg1d, chks, partial: true, passN,
          suggestion: `${passN}/4 criteria met · Waiting: ${chks.filter(c => !c.ok).map(c => c.l + ' (need ' + c.tgt + ')').join(', ')}`,
          ts: Date.now(),
        });
      }
    }
  }

  // ── Covered Call signals ──────────────────────────────────────────────────
  const CC_MIN_SHARES = 100;
  for (const pos of positions.filter(p => p.type === 'shares' && !p.linkedId && p.qty >= CC_MIN_SHARES)) {
    const q = qmap[pos.ticker];
    if (!q) continue;
    const ivrOk   = q.ivrEst   !== null && q.ivrEst   >= cr.ccIvr;
    const stochOk = q.stochEst !== null && q.stochEst >= cr.ccStoch;
    const hasCall = positions.find(p => p.ticker === pos.ticker && p.type === 'short_call' && !p.linkedId);
    const contracts = Math.floor(pos.qty / 100);
    if (ivrOk && stochOk && !hasCall && contracts >= 1) {
      const live     = strikeMap[`${pos.ticker}:call`];
      const strike   = live?.strike ?? null;
      const dteT     = live?.dte    ?? null;
      const premEst  = live?.premium != null ? live.premium.toFixed(2) : null;
      const deltaStr = live?.delta != null
        ? `Δ${Math.abs(live.delta).toFixed(2)}`
        : `${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ range`;
      const suggParts = [];
      if (dteT != null && strike != null) suggParts.push(`Sell ${contracts} x ${dteT}d $${strike} call`);
      else suggParts.push(`Sell ${contracts} call · ${cr.ccDeltaMin}–${cr.ccDeltaMax}Δ · ${cr.ccDteMin}–${cr.ccDteMax}d`);
      if (live) suggParts.push(deltaStr);
      if (premEst) suggParts.push(`~$${premEst}/contract`);
      if (premEst && contracts > 1) suggParts.push(`~$${(parseFloat(premEst) * contracts * 100).toFixed(0)} total`);
      sigs.push({
        id: `cc-${pos.id}`, type: 'cc', ticker: pos.ticker,
        price: q.price, chg: q.chg1d, strike, dteTarget: dteT, premEst,
        contracts, sharesOwned: pos.qty, ivr: q.ivrEst,
        chks: [
          { l: `${pos.qty} shares (${contracts} contract${contracts > 1 ? 's' : ''})`, ok: true },
          { l: `IVR ${q.ivrEst !== null ? q.ivrEst + '%' : '?'}`, ok: ivrOk },
          { l: `Stoch ${q.stochEst !== null ? q.stochEst.toFixed(0) : '?'}`, ok: stochOk },
        ],
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
