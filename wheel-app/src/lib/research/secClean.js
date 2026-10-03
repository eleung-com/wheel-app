// SEC XBRL "company concept" facts → clean quarterly + yearly series.
//
// Pure functions: no fetch. companyData.js downloads the facts and hands them
// here. Every rule below exists because a real filing broke the naive version:
//
//   • Labels change. UBER, NVDA, TER and GOOG all moved revenue to a different
//     tag over the years, so the first label that "exists" can stop in 2019.
//     → every candidate label is read and merged; the latest filing wins.
//   • Cash flow is year-to-date. A 10-Q reports 6- and 9-month totals, not the
//     quarter. → quarter = this YTD − previous YTD of the same fiscal year.
//   • Q4 has no 10-Q. → Q4 = full year (10-K) − first nine months.
//   • Restatements. The same period appears in several filings.
//     → the most recently filed value wins.
//   • Share classes. GOOG reports class A, B and C separately on the cover page.
//     → shares in one filing are summed across classes.
//   • Foreign filers (TSM, ASML) file 20-F under IFRS, yearly only, in their
//     home currency. → separate IFRS label set; yearly path; currency carried.

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// Forms whose numbers we trust. Amendments included — they're how restatements arrive.
const FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A', '10-KT', '10-KT/A']);

// Duration buckets, in days between start and end.
const isQuarter = (d) => d >= 80 && d <= 100;
const isYear    = (d) => d >= 350 && d <= 380;
const isYtd     = (d) => d >= 80 && d <= 380; // any cumulative span inside a fiscal year

// ── Label sets ───────────────────────────────────────────────────────────────
// Order = priority when two labels report the same period in the same filing.

export const US_GAAP = {
  flows: {
    // 'Revenues' first: when a filing tags both, it is the total and the
    // contract-revenue tag is a subset (VST's hedging revenue sits outside it).
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueGoodsNet'],
    grossProfit: ['GrossProfit'],
    operatingIncome: ['OperatingIncomeLoss'],
    netIncome: ['NetIncomeLoss', 'ProfitLoss'],
    operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  },
  instants: {
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    totalAssets: ['Assets'],
    totalLiabilities: ['Liabilities'],
    liabilitiesAndEquity: ['LiabilitiesAndStockholdersEquity'],
    currentAssets: ['AssetsCurrent'],
    currentLiabilities: ['LiabilitiesCurrent'],
    retainedEarnings: ['RetainedEarningsAccumulatedDeficit'],
    // Debt pieces — combined by debtAt().
    ltdTotal: ['LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities'],
    ltdNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
    ltdCurrent: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'DebtCurrent'],
    shortTermBorrowings: ['ShortTermBorrowings', 'CommercialPaper'],
    cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  },
};

export const IFRS = {
  flows: {
    revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
    grossProfit: ['GrossProfit'],
    operatingIncome: ['ProfitLossFromOperatingActivities'],
    netIncome: ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent'],
    operatingCashFlow: ['CashFlowsFromUsedInOperatingActivities', 'CashFlowsFromUsedInOperations'],
    capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'PurchaseOfPropertyPlantAndEquipment'],
  },
  instants: {
    equity: ['Equity', 'EquityAttributableToOwnersOfParent'],
    totalAssets: ['Assets'],
    totalLiabilities: ['Liabilities'],
    liabilitiesAndEquity: ['EquityAndLiabilities'],
    currentAssets: ['CurrentAssets'],
    currentLiabilities: ['CurrentLiabilities'],
    retainedEarnings: ['RetainedEarnings'],
    ltdTotal: ['Borrowings'],
    ltdNoncurrent: ['NoncurrentPortionOfNoncurrentBorrowings', 'NoncurrentBorrowings', 'LongtermBorrowings'],
    ltdCurrent: ['CurrentPortionOfNoncurrentBorrowings', 'CurrentBorrowings'],
    shortTermBorrowings: ['ShorttermBorrowings'],
    cash: ['CashAndCashEquivalents'],
  },
};

const DEBT_PIECES = ['ltdTotal', 'ltdNoncurrent', 'ltdCurrent', 'shortTermBorrowings'];

/** Every concept a taxonomy needs, flattened: [{ item, label }]. */
export function conceptList(set) {
  const out = [];
  for (const group of [set.flows, set.instants]) {
    for (const [item, labels] of Object.entries(group)) for (const label of labels) out.push({ item, label });
  }
  return out;
}

// ── Reading a companyconcept body ────────────────────────────────────────────

const usable = (f) => f && FORMS.has(f.form) && typeof f.val === 'number' && f.end;
const asList = (x) => (Array.isArray(x) ? x : []);
const unitsOf = (body) => (body && typeof body.units === 'object' && !Array.isArray(body.units) ? body.units : {});

/**
 * The company's reporting currency, judged from its revenue concepts: the money
 * unit with the most recent period, then the most facts. Foreign filers can tag
 * a few "convenience" USD figures next to their home currency (TSM does), so
 * "USD if present" would mix currencies across years.
 */
export function reportingUnit(bodies) {
  const stats = new Map(); // unit → { latest, count }
  for (const body of bodies) {
    for (const [unit, facts] of Object.entries(unitsOf(body))) {
      if (/shares/i.test(unit)) continue;
      const ok = asList(facts).filter(usable);
      if (!ok.length) continue;
      const cur = stats.get(unit) || { latest: '', count: 0 };
      for (const f of ok) if (f.end > cur.latest) cur.latest = f.end;
      cur.count += ok.length;
      stats.set(unit, cur);
    }
  }
  let best = null;
  for (const [unit, st] of stats) {
    if (!best || st.latest > best.st.latest || (st.latest === best.st.latest && st.count > best.st.count)) best = { unit, st };
  }
  return best ? best.unit : null;
}

/**
 * Pull the fact list out of a companyconcept JSON body in one money unit
 * (the reporting currency). Without a unit: USD if present, else the first
 * non-share unit.
 * @returns {{ unit: string|null, facts: object[] }}
 */
export function factsFromConcept(body, unit = null) {
  // Defensive: an unexpected SEC body (error page, odd shape) must read as "no data", never throw.
  const units = unitsOf(body);
  const u = unit || (units.USD ? 'USD' : Object.keys(units).find((k) => !/shares/i.test(k)) || null);
  const facts = asList(u ? units[u] : null).filter(usable);
  return { unit: facts.length ? u : null, facts };
}

/** Same, for share counts (dei:EntityCommonStockSharesOutstanding). */
export function shareFactsFromConcept(body) {
  return asList(unitsOf(body).shares).filter((f) => f && typeof f.val === 'number' && f.end);
}

// Latest filing wins; on a tie the earlier label in priority order wins.
function better(a, b) {
  if (!b) return true;
  if (a.filed !== b.filed) return a.filed > b.filed;
  return a._prio < b._prio;
}

/** Merge several labels' facts for one item, keyed by period. */
function mergeByPeriod(factLists) {
  const best = new Map();
  factLists.forEach((facts, prio) => {
    for (const f of facts || []) {
      const key = `${f.start || ''}|${f.end}`;
      const cand = { ...f, _prio: prio };
      if (better(cand, best.get(key))) best.set(key, cand);
    }
  });
  return [...best.values()];
}

// ── Flows (income + cash-flow statement items) ───────────────────────────────

/**
 * Single-quarter and full-year values for one flow item.
 * @param {object[][]} factLists  one fact array per candidate label, in priority order
 * @returns {{ quarters: Map<end, val>, years: Map<end, {start, val}> }}
 */
export function flowSeries(factLists) {
  const facts = mergeByPeriod(factLists).filter((f) => f.start);
  const quarters = new Map();
  const years = new Map();

  // Direct quarter facts first — they're the cleanest number available.
  for (const f of facts) {
    const d = daysBetween(f.start, f.end);
    if (isQuarter(d)) quarters.set(f.end, f.val);
    if (isYear(d)) years.set(f.end, { start: f.start, val: f.val });
  }

  // Year-to-date chains: every cumulative span that starts on the same day is
  // one fiscal year. Consecutive differences are quarters (incl. Q4 = FY − 9M).
  const byStart = new Map();
  for (const f of facts) {
    const d = daysBetween(f.start, f.end);
    if (!isYtd(d)) continue;
    if (!byStart.has(f.start)) byStart.set(f.start, []);
    byStart.get(f.start).push(f);
  }
  for (const chain of byStart.values()) {
    chain.sort((a, b) => a.end.localeCompare(b.end));
    let prev = null;
    for (const f of chain) {
      const fromPrev = prev ? daysBetween(prev.end, f.end) : daysBetween(f.start, f.end);
      if (isQuarter(fromPrev) && !quarters.has(f.end)) {
        quarters.set(f.end, prev ? f.val - prev.val : f.val);
      }
      prev = f;
    }
  }
  return { quarters, years };
}

// ── Instants (balance-sheet items) ───────────────────────────────────────────

/** Point-in-time values for one balance-sheet item: Map<end, val>. */
export function instantSeries(factLists) {
  const out = new Map();
  for (const f of mergeByPeriod(factLists)) if (!f.start) out.set(f.end, f.val);
  return out;
}

/**
 * Total debt on a date, from whichever pieces the company reports:
 *   long-term debt incl. current portion  (or noncurrent + current)  + short-term borrowings.
 * Returns 0 when the company reports no debt concept at all (DUOL), null when
 * it reports debt but not on this date.
 */
export function debtAt(instants, end) {
  const has = (k) => instants[k] && instants[k].size > 0;
  if (!DEBT_PIECES.some(has)) return { value: 0, noDebtReported: true };
  const at = (k) => (instants[k]?.has(end) ? instants[k].get(end) : null);
  const stb = at('shortTermBorrowings') ?? 0;
  if (at('ltdTotal') !== null) return { value: at('ltdTotal') + stb, noDebtReported: false };
  if (at('ltdNoncurrent') !== null) return { value: at('ltdNoncurrent') + (at('ltdCurrent') ?? 0) + stb, noDebtReported: false };
  if (at('ltdCurrent') !== null || at('shortTermBorrowings') !== null) {
    return { value: (at('ltdCurrent') ?? 0) + stb, noDebtReported: false };
  }
  return { value: null, noDebtReported: false };
}

/**
 * Debt split for the chart (P1-5, decided 10-03: long-term vs short-term + cash).
 * Long-term = noncurrent portion (or total minus current portion);
 * short-term = current portion of long-term debt + short-term borrowings.
 * Null when the company tags nothing usable on that date.
 */
export function debtSplitAt(instants, end) {
  const has = (k) => instants[k] && instants[k].size > 0;
  const at = (k) => (instants[k]?.has(end) ? instants[k].get(end) : null);
  const cash = at('cash');
  if (!DEBT_PIECES.some(has)) return { longTerm: 0, shortTerm: 0, cash };
  const cur = at('ltdCurrent');
  const stb = at('shortTermBorrowings');
  let longTerm = at('ltdNoncurrent');
  if (longTerm === null && at('ltdTotal') !== null) longTerm = at('ltdTotal') - (cur ?? 0);
  const shortTerm = cur === null && stb === null ? (longTerm === null ? null : 0) : (cur ?? 0) + (stb ?? 0);
  return { longTerm, shortTerm, cash };
}

/** Most recent date ≤ `end` that has a value in `series`. */
function latestOnOrBefore(series, end) {
  let best = null;
  for (const d of series?.keys() || []) if (d <= end && (!best || d > best)) best = d;
  return best;
}

// ── Shares ──────────────────────────────────────────────────────────────────

/**
 * Shares outstanding per filing, summed across share classes (GOOG A+B+C).
 * @returns {{ end: string, filed: string, val: number }[]} newest filing last
 */
export function shareSeries(facts) {
  const byAccn = new Map();
  for (const f of facts || []) {
    const key = f.accn || `${f.filed}|${f.end}`;
    const cur = byAccn.get(key) || { end: f.end, filed: f.filed, val: 0, seen: new Set() };
    // A filing can repeat the same class twice (same frame); count each value once per class row.
    const sig = `${f.end}|${f.val}|${f.frame || ''}`;
    if (!cur.seen.has(sig)) { cur.val += f.val; cur.seen.add(sig); }
    if (f.end > cur.end) cur.end = f.end;
    byAccn.set(key, cur);
  }
  return [...byAccn.values()]
    .map(({ end, filed, val }) => ({ end, filed, val }))
    .sort((a, b) => a.filed.localeCompare(b.filed) || a.end.localeCompare(b.end));
}

// ── Putting it together ──────────────────────────────────────────────────────

function debtChartFields(instants, end) {
  const s = debtSplitAt(instants, end);
  return { debtLongTerm: s.longTerm, debtShortTerm: s.shortTerm, cash: s.cash };
}

/**
 * @param {object} raw
 * @param {Object<string, object[][]>} raw.flows     item → [facts per label]
 * @param {Object<string, object[][]>} raw.instants  item → [facts per label]
 * @param {object[]} raw.shares                      dei share facts
 * @param {object} [opts]
 * @param {number} [opts.maxQuarters=20]
 * @returns cleaned company financials, or null when there is nothing usable
 */
export function buildFinancials(raw, { maxQuarters = 20 } = {}) {
  const flows = Object.fromEntries(Object.entries(raw.flows || {}).map(([k, lists]) => [k, flowSeries(lists)]));
  const instants = Object.fromEntries(Object.entries(raw.instants || {}).map(([k, lists]) => [k, instantSeries(lists)]));

  const rev = flows.revenue, oi = flows.operatingIncome;
  if (!rev || (!rev.quarters.size && !rev.years.size)) return null;

  // ── Quarters: every quarter end that has revenue; other items may be missing.
  const qEnds = [...rev.quarters.keys()].sort().slice(-maxQuarters);
  const qVal = (item, end) => flows[item]?.quarters.get(end) ?? null;
  const quarters = qEnds.map((end) => ({
    end,
    revenue: qVal('revenue', end),
    operatingIncome: qVal('operatingIncome', end),
    netIncome: qVal('netIncome', end),
    operatingCashFlow: qVal('operatingCashFlow', end),
    capex: qVal('capex', end),
    ...debtChartFields(instants, end),
  }));

  // ── Years: fiscal years with revenue.
  const yEnds = [...rev.years.keys()].sort().slice(-6);
  const yVal = (item, end) => flows[item]?.years.get(end)?.val ?? null;
  const iVal = (item, end) => instants[item]?.get(end) ?? null;
  const annual = yEnds.map((end) => {
    const totalAssets = iVal('totalAssets', end);
    const equity = iVal('equity', end);
    let totalLiabilities = iVal('totalLiabilities', end);
    // Many filers skip a "total liabilities" line; derive it from the balance identity.
    if (totalLiabilities === null && totalAssets !== null && equity !== null) totalLiabilities = totalAssets - equity;
    const debt = debtAt(instants, end);
    return {
      fy: Number(end.slice(0, 4)),
      end,
      revenue: yVal('revenue', end),
      grossProfit: yVal('grossProfit', end),
      operatingIncome: yVal('operatingIncome', end),
      netIncome: yVal('netIncome', end),
      operatingCashFlow: yVal('operatingCashFlow', end),
      capex: yVal('capex', end),
      totalAssets,
      totalLiabilities,
      currentAssets: iVal('currentAssets', end),
      currentLiabilities: iVal('currentLiabilities', end),
      longTermDebt: debt.value,
      retainedEarnings: iVal('retainedEarnings', end),
      equity,
      ...debtChartFields(instants, end),
      sharesOutstanding: null, // filled by companyData from the cover-page share series
    };
  });

  // ── Latest balance sheet: the newest date that has equity.
  const eqEnd = latestOnOrBefore(instants.equity, '9999-12-31');
  let balance = null;
  if (eqEnd) {
    let debt = debtAt(instants, eqEnd);
    // Some companies only tag total debt in the 10-K notes; fall back to the newest debt figure.
    if (debt.value === null) {
      const pieceDates = DEBT_PIECES.map((k) => latestOnOrBefore(instants[k], eqEnd)).filter(Boolean).sort();
      const d = pieceDates.at(-1);
      if (d) debt = { ...debtAt(instants, d), staleFrom: d };
    }
    balance = {
      asOf: eqEnd,
      equity: instants.equity.get(eqEnd),
      totalDebt: debt.value,
      debtAsOf: debt.staleFrom || eqEnd,
      noDebtReported: !!debt.noDebtReported,
    };
  }

  return {
    quarters,
    annual,
    balance,
    yearlyOnly: quarters.length < 4 && annual.length > 0,
    latestPeriod: [qEnds.at(-1), yEnds.at(-1)].filter(Boolean).sort().at(-1) || null,
  };
}

/**
 * Yearly-only filers (20-F): spread each fiscal year into four equal quarters so
 * the scoring engine's 12-month comparisons become year-vs-year comparisons.
 * Every value is a quarter of the real yearly figure; the flag travels with it
 * so the UI shows yearly bars and a "yearly data only" tag instead.
 */
export function quartersFromYears(annual, maxYears = 5) {
  const out = [];
  for (const y of annual.slice(-maxYears)) {
    for (let k = 0; k < 4; k++) {
      const q = (v) => (typeof v === 'number' ? v / 4 : null);
      out.push({
        end: `${y.end}#${k + 1}`, // synthetic; never shown as a date
        revenue: q(y.revenue),
        operatingIncome: q(y.operatingIncome),
        netIncome: q(y.netIncome),
        operatingCashFlow: q(y.operatingCashFlow),
        capex: q(y.capex),
        synthetic: true,
      });
    }
  }
  return out;
}
