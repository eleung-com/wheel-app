// Peers for the Value score (fix #7) and the debt comparison (fix #3).
//
// Preliminary runs use Finnhub's automatic peer list (instant, rough: UBER's
// includes car-rental companies). The Claude routine later supplies 3–6 real
// competitors and the run is re-scored as Final. Both go through the same
// "light" fetch here: only what the comparison needs, ~13 small SEC requests
// per peer instead of the ~25 a full company run makes.
//
// Rules (PRD fix #7, decided 10-02):
//   • A peer needs US SEC filings (foreign peers are listed as skipped).
//   • A peer with an operating loss stays in the debt average but is left out
//     of the P/E median (scoring.js does the P/E filtering).
//   • Other share classes of the company itself are never its peers (GOOG ≠ peer of GOOGL).

import { lookupCik, fetchPriceHistory, splitFactorAfter, fetchShares } from './companyData.js';
import {
  US_GAAP, factsFromConcept, flowSeries, instantSeries, debtAt,
} from './secClean.js';

export const MAX_PEERS = 6;
const MAX_CANDIDATES = 10; // stop looking after this many, usable or not
const CONCURRENCY = 2;     // peers in flight at once (each makes ~13 SEC requests)
const STALE_DAYS = 200;

async function getJson(fn, path) {
  try {
    const res = await fn(path);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

/** Finnhub's peer list for `ticker`, uppercased, self removed. */
export async function fetchAutoPeerTickers(transport, ticker) {
  if (!transport.finnhub) return [];
  const body = await getJson(transport.finnhub, `/api/v1/stock/peers?symbol=${encodeURIComponent(ticker)}`);
  const self = String(ticker).toUpperCase();
  return Array.isArray(body)
    ? [...new Set(body.map((t) => String(t).toUpperCase()))].filter((t) => t && t !== self)
    : [];
}

// The concepts a peer needs: operating income + the balance-sheet debt pieces.
const LITE_INSTANTS = ['equity', 'ltdTotal', 'ltdNoncurrent', 'ltdCurrent', 'shortTermBorrowings'];

/**
 * Operating P/E and debt-to-equity for one peer.
 * @returns {{ ticker, name, ok, opPe, debtToEquity, marketCap, operatingIncomeTtm, reason, cik }}
 */
export async function fetchPeerMetrics(transport, ticker, opts = {}) {
  // One odd peer must never sink the whole run: any unexpected error = skipped peer.
  try {
    return await peerMetrics(transport, ticker, opts);
  } catch (e) {
    return { ticker: String(ticker).toUpperCase(), ok: false, opPe: null, debtToEquity: null, marketCap: null,
      operatingIncomeTtm: null, cik: null, name: null, reason: `Data error (${String(e?.message || e).slice(0, 60)})` };
  }
}

async function peerMetrics(transport, ticker, { now = Date.now() } = {}) {
  const t = String(ticker).toUpperCase();
  const base = { ticker: t, name: null, ok: false, opPe: null, debtToEquity: null, marketCap: null, operatingIncomeTtm: null, reason: null, cik: null };
  const id = await lookupCik(transport, t);
  if (!id) return { ...base, reason: 'No US SEC filings' };
  base.cik = id.cik;
  base.name = id.name;

  const jobs = [
    ...US_GAAP.flows.operatingIncome.map((label) => ({ kind: 'flows', item: 'operatingIncome', label })),
    ...LITE_INSTANTS.flatMap((item) => US_GAAP.instants[item].map((label) => ({ kind: 'instants', item, label }))),
  ];
  const [px, sharesInfo, ...bodies] = await Promise.all([
    fetchPriceHistory(transport, t),
    // Cover-page shares, with the diluted-average fallback for multi-class
    // companies (META, PINS, SNAP, RDDT tag cover shares only per class).
    fetchShares(transport, id.cik),
    ...jobs.map((j) => getJson(transport.sec, `/api/xbrl/companyconcept/CIK${id.cik}/us-gaap/${j.label}.json`)),
  ]);

  const grouped = { flows: {}, instants: {} };
  jobs.forEach((j, i) => {
    (grouped[j.kind][j.item] ||= []).push(factsFromConcept(bodies[i], 'USD').facts);
  });

  // Operating income, last 12 months: the newest 4 quarters, which must be recent and contiguous.
  const oiQuarters = [...flowSeries(grouped.flows.operatingIncome || []).quarters.entries()].sort(([a], [b]) => a.localeCompare(b));
  const last4 = oiQuarters.slice(-4);
  if (last4.length < 4) return { ...base, reason: 'No quarterly US-GAAP operating income' };
  const spanDays = (Date.parse(last4[3][0]) - Date.parse(last4[0][0])) / 86400000;
  const ageDays = (now - Date.parse(last4[3][0])) / 86400000;
  if (spanDays > 300 || ageDays > STALE_DAYS) return { ...base, reason: 'Operating income data out of date' };
  const oiTtm = last4.reduce((s, [, v]) => s + v, 0);

  // Debt-to-equity on the newest balance-sheet date.
  const instants = Object.fromEntries(Object.entries(grouped.instants).map(([k, lists]) => [k, instantSeries(lists)]));
  const eqDates = [...(instants.equity?.keys() || [])].sort();
  const eqEnd = eqDates.at(-1);
  let debtToEquity = null;
  if (eqEnd) {
    const equity = instants.equity.get(eqEnd);
    let debt = debtAt(instants, eqEnd).value;
    if (debt === null) { // debt tagged only at year end — take the newest figure
      const dates = ['ltdTotal', 'ltdNoncurrent', 'ltdCurrent', 'shortTermBorrowings']
        .flatMap((k) => [...(instants[k]?.keys() || [])]).filter((d) => d <= eqEnd).sort();
      if (dates.length) debt = debtAt(instants, dates.at(-1)).value;
    }
    if (equity > 0 && debt !== null) debtToEquity = debt / equity;
  }

  // Market cap: price × shares (split-adjusted to today's basis).
  const shares = sharesInfo.series.at(-1);
  const sharesNow = shares ? shares.val * splitFactorAfter(px?.splits, shares.end) : null;
  const marketCap = px?.price && sharesNow ? px.price * sharesNow : null;
  if (!marketCap) return { ...base, debtToEquity, operatingIncomeTtm: oiTtm, reason: 'No price or share count' };

  return {
    ...base,
    ok: true,
    marketCap,
    operatingIncomeTtm: oiTtm,
    opPe: oiTtm > 0 ? marketCap / oiTtm : null,
    debtToEquity,
    reason: oiTtm > 0 ? null : 'Operating loss — left out of the P/E median',
  };
}

/**
 * Turn a list of candidate tickers into the peer set a score uses.
 * Takes candidates in order until MAX_PEERS usable ones are found.
 *
 * @returns {{ source, used: object[], skipped: {ticker, reason}[] }}
 *   `used` rows are what scoring.js reads: { ticker, opPe, debtToEquity, ... }.
 */
export async function buildPeerSet(transport, candidates, { source, subjectCik = null, max = MAX_PEERS, now } = {}) {
  const used = [];
  const skipped = [];
  const seenCiks = new Set(subjectCik ? [subjectCik] : []);
  const queue = [...new Set((candidates || []).map((t) => String(t).toUpperCase().trim()).filter(Boolean))].slice(0, MAX_CANDIDATES);

  // Small batches so we stop early once enough peers are usable.
  for (let i = 0; i < queue.length && used.length < max; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(batch.map((t) => fetchPeerMetrics(transport, t, { now })));
    for (const row of rows) {
      if (used.length >= max) { skipped.push({ ticker: row.ticker, reason: 'Enough peers already' }); continue; }
      if (row.cik && seenCiks.has(row.cik)) {
        skipped.push({ ticker: row.ticker, reason: subjectCik === row.cik ? 'Same company (other share class)' : 'Duplicate company' });
        continue;
      }
      if (!row.ok) { skipped.push({ ticker: row.ticker, reason: row.reason }); continue; }
      if (row.opPe === null && row.debtToEquity === null) {
        skipped.push({ ticker: row.ticker, reason: 'No usable numbers (operating loss and no debt-to-equity)' });
        continue;
      }
      if (row.cik) seenCiks.add(row.cik);
      used.push(row);
    }
  }
  for (const t of queue.slice(used.length + skipped.length)) skipped.push({ ticker: t, reason: 'Not checked (enough peers)' });
  return { source, used, skipped };
}
