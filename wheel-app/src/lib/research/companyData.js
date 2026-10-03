// "Run a stock" data layer: one ticker → everything the scoring engine needs.
//
// Runs in the browser (decided 10-02: the app does the work, the Worker only
// relays + caches, so a run never hits the Worker's per-request limits). Every
// network call goes through an injected `transport`, so the same code runs in
// tests, in the verify script on a Mac, and in the app:
//
//   transport.sec(path)      path under data.sec.gov, or /files/… under www.sec.gov
//   transport.yahoo(path)    path under query1.finance.yahoo.com
//   transport.fmp(path)      path under financialmodelingprep.com (key added by the caller)
//   transport.finnhub(path)  path under finnhub.io (key added by the caller)
//
// Each returns a fetch Response (or null). Any failure = "no data" for that
// piece; the bundle records what's missing in `dataTags` instead of throwing.

import {
  US_GAAP, IFRS, factsFromConcept, reportingUnit, shareFactsFromConcept, shareSeries,
  buildFinancials, quartersFromYears,
} from './secClean.js';

const CONCURRENCY = 5; // SEC allows 10 requests/sec; stay well under

async function getJson(fn, path) {
  try {
    const res = await fn(path);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/** Run async jobs with at most `limit` in flight. Keeps input order. */
async function pool(items, limit, job) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Ticker → CIK ────────────────────────────────────────────────────────────

let tickerMap = null; // { TICKER: { cik, name } }, loaded once per session

export function resetTickerMap() { tickerMap = null; }

export async function lookupCik(transport, ticker) {
  if (!tickerMap) {
    const body = await getJson(transport.sec, '/files/company_tickers.json');
    if (!body) return null;
    tickerMap = {};
    for (const c of Object.values(body)) {
      tickerMap[String(c.ticker).toUpperCase()] = { cik: String(c.cik_str).padStart(10, '0'), name: c.title };
    }
  }
  const t = String(ticker).toUpperCase();
  return tickerMap[t] || tickerMap[t.replace('.', '-')] || null;
}

// ── SEC concepts ────────────────────────────────────────────────────────────

async function fetchTaxonomy(transport, cik, taxonomy, set) {
  const jobs = [];
  for (const kind of ['flows', 'instants']) {
    for (const [item, labels] of Object.entries(set[kind])) {
      labels.forEach((label, prio) => jobs.push({ kind, item, label, prio }));
    }
  }
  const bodies = await pool(jobs, CONCURRENCY, (j) =>
    getJson(transport.sec, `/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${j.label}.json`));

  // One currency for every concept, decided by the revenue tags.
  const unit = reportingUnit(bodies.filter((_, i) => jobs[i].item === 'revenue'));
  const raw = { flows: {}, instants: {} };
  jobs.forEach((j, i) => {
    const { facts } = factsFromConcept(bodies[i], unit);
    const bucket = (raw[j.kind][j.item] ||= []);
    bucket[j.prio] = facts;
  });
  return { raw, unit, found: bodies.some(Boolean) };
}

export async function fetchShares(transport, cik) {
  const dei = await getJson(transport.sec, `/api/xbrl/companyconcept/CIK${cik}/dei/EntityCommonStockSharesOutstanding.json`);
  let series = shareSeries(shareFactsFromConcept(dei));
  let source = 'dei:EntityCommonStockSharesOutstanding';
  if (!series.length) {
    // Multi-class companies sometimes tag cover-page shares only by class, which
    // the API omits. Diluted weighted-average shares is the next best total.
    const wa = await getJson(transport.sec, `/api/xbrl/companyconcept/CIK${cik}/us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding.json`);
    // Guarded: some filers' bodies don't have a list here (CAR, BE) — treat as no data.
    const waFacts = Array.isArray(wa?.units?.shares) ? wa.units.shares : [];
    series = waFacts
      .filter((f) => f && f.start && typeof f.val === 'number' && f.end && f.filed)
      .map((f) => ({ end: f.end, filed: f.filed, val: f.val }))
      .sort((a, b) => a.filed.localeCompare(b.filed) || a.end.localeCompare(b.end));
    source = 'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding';
  }
  return { series, source };
}

// ── Yahoo: price, month-end prices, splits ──────────────────────────────────

export async function fetchPriceHistory(transport, ticker) {
  const body = await getJson(transport.yahoo,
    `/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=6y&events=split`);
  const r = body?.chart?.result?.[0];
  if (!r) return null;
  const closes = r.indicators?.quote?.[0]?.close || [];
  const months = (r.timestamp || []).map((t, i) => ({
    month: new Date(t * 1000).toISOString().slice(0, 7), // YYYY-MM
    close: closes[i],
  })).filter((m) => typeof m.close === 'number' && m.close > 0);
  const splits = Object.values(r.events?.splits || {}).map((s) => ({
    date: new Date(s.date * 1000).toISOString().slice(0, 10),
    ratio: s.numerator && s.denominator ? s.numerator / s.denominator : 1,
  }));
  return {
    price: r.meta?.regularMarketPrice ?? months.at(-1)?.close ?? null,
    currency: r.meta?.currency || 'USD',
    months,
    splits,
  };
}

/** Product of every split ratio dated after `date` (pre-split share counts × this = today's basis). */
export function splitFactorAfter(splits, date) {
  return (splits || []).filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1);
}

/** Month-end close for the month a fiscal year ended in (Yahoo closes are split-adjusted). */
export function priceAtMonth(months, isoDate) {
  const m = (months || []).find((x) => x.month === isoDate.slice(0, 7));
  return m ? m.close : null;
}

async function fetchFx(transport, currency) {
  if (!currency || currency === 'USD') return 1;
  const body = await getJson(transport.yahoo, `/v8/finance/chart/${currency}USD%3DX?interval=1d&range=5d`);
  return body?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
}

// ── Analyst target + foreign market cap ─────────────────────────────────────

export async function fetchAnalystTarget(transport, ticker) {
  if (!transport.fmp) return null;
  const body = await getJson(transport.fmp, `/stable/price-target-consensus?symbol=${encodeURIComponent(ticker)}`);
  const row = Array.isArray(body) ? body[0] : null;
  const value = row?.targetConsensus ?? row?.targetMedian ?? null;
  return typeof value === 'number' && value > 0
    ? { value, source: 'FMP consensus', asOf: new Date().toISOString().slice(0, 10) }
    : null;
}

async function fetchFinnhubMarketCap(transport, ticker) {
  if (!transport.finnhub) return null;
  const body = await getJson(transport.finnhub, `/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}`);
  const mc = body?.marketCapitalization; // millions, in the profile's `currency` (TWD for TSM)
  return typeof mc === 'number' && mc > 0
    ? { marketCap: mc * 1e6, currency: body.currency || 'USD', name: body.name || null }
    : null;
}

// ── The bundle ──────────────────────────────────────────────────────────────

const MONEY_FIELDS = ['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'operatingCashFlow', 'capex',
  'totalAssets', 'totalLiabilities', 'currentAssets', 'currentLiabilities', 'longTermDebt', 'retainedEarnings', 'equity'];

function scaleMoney(row, k) {
  const out = { ...row };
  for (const f of MONEY_FIELDS) if (typeof out[f] === 'number') out[f] *= k;
  return out;
}

/**
 * Everything about one company, ready for scoreStock() (peers, beat rate and
 * stage are added later by the run).
 *
 * @returns {Promise<{ ok: boolean, ticker, name, input, financials, price, dataTags, meta }>}
 */
export async function fetchCompanyBundle(transport, ticker, { withTarget = true, now = Date.now() } = {}) {
  const t = String(ticker).toUpperCase();
  const dataTags = [];
  const meta = { ticker: t, sources: [] };

  const [id, px, target] = await Promise.all([
    lookupCik(transport, t),
    fetchPriceHistory(transport, t),
    withTarget ? fetchAnalystTarget(transport, t) : Promise.resolve(null),
  ]);
  if (!px?.price) dataTags.push({ code: 'no_price', text: 'No price from Yahoo' });
  if (withTarget && !target) dataTags.push({ code: 'target_pending', text: 'No FMP analyst target — waiting on Claude' });
  if (!id) {
    dataTags.push({ code: 'no_sec', text: 'Not an SEC filer — no score (Claude write-up only)' });
    return { ok: false, ticker: t, name: null, input: null, financials: null, price: px, dataTags, meta };
  }
  meta.cik = id.cik;

  // US GAAP first; foreign filers (20-F, IFRS) have none of those labels.
  let tax = await fetchTaxonomy(transport, id.cik, 'us-gaap', US_GAAP);
  let taxonomy = 'us-gaap';
  let fin = buildFinancials(tax.raw);
  if (!fin) {
    tax = await fetchTaxonomy(transport, id.cik, 'ifrs-full', IFRS);
    taxonomy = 'ifrs-full';
    fin = buildFinancials(tax.raw);
  }
  if (!fin) {
    dataTags.push({ code: 'no_sec_financials', text: 'SEC has no usable financials for this company' });
    return { ok: false, ticker: t, name: id.name, input: null, financials: null, price: px, dataTags, meta };
  }
  meta.taxonomy = taxonomy;
  meta.currency = tax.unit || 'USD';
  meta.sources.push(`SEC EDGAR (${taxonomy}), latest period ${fin.latestPeriod}`);

  // Home-currency filers: convert every money figure to USD at today's rate.
  let fx = 1;
  if (meta.currency !== 'USD') {
    fx = await fetchFx(transport, meta.currency);
    if (!fx) {
      dataTags.push({ code: 'no_fx', text: `No ${meta.currency}→USD rate — can't compare to the USD price` });
      return { ok: false, ticker: t, name: id.name, input: null, financials: fin, price: px, dataTags, meta };
    }
    fin = { ...fin, quarters: fin.quarters.map((q) => scaleMoney(q, fx)), annual: fin.annual.map((y) => scaleMoney(y, fx)),
      balance: fin.balance && { ...fin.balance, equity: fin.balance.equity * fx, totalDebt: fin.balance.totalDebt == null ? null : fin.balance.totalDebt * fx } };
    meta.fx = fx;
    dataTags.push({ code: 'fx_converted', text: `Financials converted from ${meta.currency} at today's rate (${fx.toFixed(4)})` });
  }

  // ── Shares outstanding (today's basis) ──
  let sharesNow = null;
  let shareSeriesForYears = [];
  if (taxonomy === 'us-gaap') {
    const sh = await fetchShares(transport, id.cik);
    shareSeriesForYears = sh.series;
    const last = sh.series.at(-1);
    if (last) sharesNow = last.val * splitFactorAfter(px?.splits, last.end);
    meta.sharesSource = sh.source;
  } else {
    // Foreign: share counts are in home-market units (TSM ADR = 5 ordinary shares).
    // Back out ADR-equivalent shares from Finnhub's USD market cap instead.
    const fh = await fetchFinnhubMarketCap(transport, t);
    const capFx = fh ? (fh.currency === meta.currency ? fx : await fetchFx(transport, fh.currency)) : null;
    if (fh && capFx && px?.price) {
      sharesNow = (fh.marketCap * capFx) / px.price;
      dataTags.push({ code: 'shares_from_market_cap', text: 'Share count inferred from Finnhub market cap (ADR basis)' });
    }
  }
  if (!sharesNow) dataTags.push({ code: 'no_shares', text: 'No share count — no P/E or Altman Z' });

  // Fiscal-year share counts: first cover-page figure dated after that year ended.
  const annual = fin.annual.map((y) => {
    let shares = null;
    if (taxonomy === 'us-gaap') {
      const s = shareSeriesForYears.find((x) => x.end >= y.end);
      if (s) shares = s.val * splitFactorAfter(px?.splits, s.end);
    } else {
      shares = sharesNow; // constant-share approximation for foreign filers
    }
    return { ...y, sharesOutstanding: shares };
  });

  // ── Operating P/E per fiscal year (fix #9): year-end market cap ÷ FY operating income ──
  const opPeHistory = annual.slice(-5).map((y) => {
    const p = priceAtMonth(px?.months, y.end);
    if (!p || !y.sharesOutstanding || !y.operatingIncome || y.operatingIncome <= 0) return { year: y.fy, opPe: null };
    return { year: y.fy, opPe: (p * y.sharesOutstanding) / y.operatingIncome };
  });
  if (taxonomy !== 'us-gaap') dataTags.push({ code: 'pe_history_approx', text: 'P/E history assumes today\'s share count' });

  // ── Quarters the engine reads ──
  let quarters = fin.quarters;
  if (fin.yearlyOnly) {
    quarters = quartersFromYears(annual);
    dataTags.push({ code: 'yearly_only', text: 'Yearly data only (foreign filer) — 12-month checks compare full years' });
  }
  // Filings older than ~2 quarters (US) or ~16 months (yearly filers) are flagged, not hidden.
  const ageDays = fin.latestPeriod ? Math.round((now - Date.parse(fin.latestPeriod)) / 86400000) : null;
  if (ageDays !== null && ageDays > (fin.yearlyOnly ? 480 : 200)) {
    dataTags.push({ code: 'stale_financials', text: `Newest SEC financials are from ${fin.latestPeriod} (${Math.round(ageDays / 30)} months old)` });
  }
  if (fin.balance?.noDebtReported) dataTags.push({ code: 'no_debt', text: 'No debt reported in SEC filings — treated as zero' });
  if (fin.balance?.debtAsOf && fin.balance.debtAsOf !== fin.balance.asOf) {
    dataTags.push({ code: 'debt_stale', text: `Debt figure from ${fin.balance.debtAsOf} (newest tagged)` });
  }

  const input = {
    ticker: t,
    price: px?.price ?? null,
    sharesOutstanding: sharesNow,
    quarters,
    balance: fin.balance ? { totalDebt: fin.balance.totalDebt, equity: fin.balance.equity } : null,
    annual,
    opPeHistory,
    analystTarget: target,
  };

  return {
    ok: !!(px?.price && sharesNow),
    ticker: t,
    name: id.name,
    input,
    financials: { ...fin, annual, yearlyOnly: fin.yearlyOnly },
    price: px,
    dataTags,
    meta,
  };
}
