#!/usr/bin/env node
// P1.0 source check — "does each free data source actually work for my watchlist?"
//
// Run from wheel-app/:   node scripts/check-sources.mjs
//
// Asks for keys with hidden typing; nothing is saved. Press Enter to skip a
// source you don't want to test. Prints a pass/fail table and writes it to
// scripts/source-check-results.md (no keys in it). Read-only: it never
// changes anything in Notion, the Worker, or your accounts.
//
// Cost: ~10 SEC calls, 1 Yahoo, 1 CBOE, 1 FMP and 3 Finnhub calls per ticker.
// FMP free = 250 calls/day, so this uses ~18 of them. Takes ~3 minutes.

import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TICKERS = (process.argv[2]?.split(',') ?? [
  // Notion "Watchlist" TV list as of 10-02 (Red list index/ETF names excluded)
  'GEV', 'TER', 'ETN', 'NVDA', 'DUOL', 'TSM', 'COHR', 'META', 'AAPL',
  'AVGO', 'UBER', 'AMD', 'MU', 'ASML', 'GOOG', 'LRCX', 'ADBE', 'VST',
]).map((t) => t.trim().toUpperCase()).filter(Boolean);

// SEC item → ordered list of labels companies use for it (first hit wins).
const SEC_ITEMS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  operatingIncome: ['OperatingIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  netIncome: ['NetIncomeLoss'],
};

// ── tiny helpers ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One shared prompt; `muted` hides typed characters for keys.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const realWrite = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) realWrite?.(s); };
const lines$ = rl[Symbol.asyncIterator]();

async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines$.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  return (value ?? '').trim();
}

async function getJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e.message || e) };
  }
}

// ── SEC ─────────────────────────────────────────────────────────────────────
let cikMap = null;
async function secCheck(ticker, email) {
  const headers = { 'User-Agent': `wheel-desk research ${email}`, Accept: 'application/json' };
  if (!cikMap) {
    const r = await getJson('https://www.sec.gov/files/company_tickers.json', headers);
    if (!r.ok) return { pass: false, note: r.status === 403 ? 'SEC blocked the request (check the email, or network)' : `ticker list HTTP ${r.status}` };
    cikMap = Object.fromEntries(Object.values(r.body).map((c) => [c.ticker.toUpperCase(), String(c.cik_str).padStart(10, '0')]));
  }
  const cik = cikMap[ticker] || cikMap[ticker.replace('.', '-')];
  if (!cik) return { pass: false, note: 'not an SEC filer' };

  const found = {}, missing = [];
  let quarters = 0, latest = null, foreign = false;
  for (const [item, labels] of Object.entries(SEC_ITEMS)) {
    let hit = null;
    for (const label of labels) {
      await sleep(120); // SEC limit is 10/sec
      const r = await getJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${label}.json`, headers);
      if (r.status === 403) return { pass: false, note: 'SEC blocked (check the email)' };
      if (r.ok && r.body?.units?.USD?.length) { hit = { label, facts: r.body.units.USD }; break; }
    }
    if (!hit) { missing.push(item); continue; }
    found[item] = hit.label;
    if (item === 'revenue') {
      const q = hit.facts.filter((f) => f.form === '10-Q' && f.fp?.startsWith('Q'));
      quarters = new Set(q.map((f) => f.end)).size;
      latest = hit.facts.map((f) => f.end).sort().at(-1);
      foreign = !q.length && hit.facts.some((f) => f.form === '20-F' || f.form === '40-F');
    }
  }
  const nFound = Object.keys(found).length;
  const pass = nFound === Object.keys(SEC_ITEMS).length && quarters > 0;
  let note = `${nFound}/${Object.keys(SEC_ITEMS).length} items`;
  if (missing.length) note += ` · missing: ${missing.join(', ')}`;
  if (foreign) note += ' · foreign filer (annual only)';
  else if (!found.revenue) note += ' · no us-gaap revenue (foreign/IFRS?)';
  return { pass, quarters, latest, note, labels: found };
}

// ── Yahoo (price + 5-yr history) ───────────────────────────────────────────
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Referer: 'https://finance.yahoo.com/',
};
async function yahooCheck(ticker) {
  const r = await getJson(`https://wheel-tradier-proxy.esthercandy.workers.dev/yf/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=6y`) // via the Worker: Yahoo blocks home IPs;
  const res = r.body?.chart?.result?.[0];
  const price = res?.meta?.regularMarketPrice;
  const months = res?.timestamp?.length ?? 0;
  await sleep(400);
  return { pass: !!price && months >= 60, note: `${price ? `$${price}` : `no price (HTTP ${r.status})`} · ${months} months of history` };
}

// ── CBOE delayed option chain (Tradier replacement candidate) ───────────────
async function cboeCheck(ticker) {
  const t0 = Date.now();
  const r = await getJson(`https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json`, { 'User-Agent': YAHOO_HEADERS['User-Agent'] });
  const ms = Date.now() - t0;
  const opts = r.body?.data?.options;
  if (!Array.isArray(opts) || !opts.length) return { pass: false, note: `no chain (HTTP ${r.status})` };
  const withDelta = opts.filter((o) => o.delta != null && o.delta !== 0).length;
  const sizeMb = (JSON.stringify(r.body).length / 1e6).toFixed(1);
  // OCC symbol = ROOT + YYMMDD + C/P + strike×1000 (8 digits); slice out the date
  const exp = new Set(opts.map((o) => String(o.option || "").slice(-15, -9)));
  return { pass: withDelta > 0, note: `${opts.length} contracts · ${withDelta} with delta · ${exp.size} expiries · ${sizeMb} MB · ${ms} ms` };
}

// ── FMP ─────────────────────────────────────────────────────────────────────
async function fmpCheck(ticker, key) {
  const r = await getJson(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${ticker}&apikey=${key}`);
  const row = Array.isArray(r.body) ? r.body[0] : null;
  const target = row?.targetConsensus ?? row?.targetMedian ?? null;
  if (target) return { pass: true, note: `target $${Number(target).toFixed(2)}` };
  const msg = typeof r.body === 'string' ? r.body : r.body?.['Error Message'] || JSON.stringify(r.body).slice(0, 80);
  return { pass: false, note: `HTTP ${r.status} ${String(msg).slice(0, 70)}` };
}

// ── Finnhub ─────────────────────────────────────────────────────────────────
async function finnhubCheck(ticker, key) {
  const base = 'https://finnhub.io/api/v1';
  const peers = await getJson(`${base}/stock/peers?symbol=${ticker}&token=${key}`);
  const recs = await getJson(`${base}/stock/recommendation?symbol=${ticker}&token=${key}`);
  const eps = await getJson(`${base}/stock/earnings?symbol=${ticker}&token=${key}`);
  await sleep(1100); // stay well under 60/min
  const peerList = Array.isArray(peers.body) ? peers.body.filter((p) => p !== ticker) : [];
  const rec = Array.isArray(recs.body) ? recs.body[0] : null;
  const epsRows = Array.isArray(eps.body) ? eps.body.filter((e) => e.actual != null && e.estimate != null) : [];
  const parts = [
    peerList.length ? `peers: ${peerList.slice(0, 5).join(' ')}` : `no peers (HTTP ${peers.status})`,
    rec ? `ratings ${rec.strongBuy + rec.buy}B/${rec.hold}H/${rec.sell + rec.strongSell}S` : 'no ratings',
    `${epsRows.length} qtrs EPS vs estimate${epsRows[0] ? ` (latest ${epsRows[0].period})` : ''}`,
  ];
  return { pass: peerList.length > 0, note: parts.join(' · ') };
}

// ── main ────────────────────────────────────────────────────────────────────
console.log('\nSource check — keys are hidden as you type and are not saved. Enter = skip that source.\n');
const email = await ask('SEC contact email (your throwaway): ');
const fmp = await ask('FMP key: ', { hidden: true });
const finnhub = await ask('Finnhub key: ', { hidden: true });
rl.close();

const mark = (r) => (r == null ? '—' : r.pass ? '✅' : '❌');
const rows = [];
for (const t of TICKERS) {
  process.stdout.write(`Checking ${t}… `);
  const sec = email ? await secCheck(t, email) : null;
  const tr = await yahooCheck(t);
  const cb = await cboeCheck(t);
  const fm = fmp ? await fmpCheck(t, fmp) : null;
  const fh = finnhub ? await finnhubCheck(t, finnhub) : null;
  rows.push({ t, sec, tr, cb, fm, fh });
  console.log([sec, tr, cb, fm, fh].map(mark).join(' '));
}

const pct = (k) => {
  const tested = rows.filter((r) => r[k]);
  return tested.length ? `${tested.filter((r) => r[k].pass).length}/${tested.length}` : 'skipped';
};
const esc = (s) => String(s ?? '').replace(/\|/g, '/');
const lines = [
  `# Source check — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `| Source | Pass |`, `|---|---|`,
  `| SEC (financials) | ${pct('sec')} |`, `| Yahoo (price + history) | ${pct('tr')} |`, `| CBOE (option chain + delta) | ${pct('cb')} |`,
  `| FMP (analyst target) | ${pct('fm')} |`, `| Finnhub (peers) | ${pct('fh')} |`,
  '',
  '| Ticker | SEC | Yahoo | CBOE chain | FMP | Finnhub |', '|---|---|---|---|---|---|',
  ...rows.map(({ t, sec, tr, cb, fm, fh }) =>
    `| ${t} | ${mark(sec)} ${esc(sec && `${sec.note}${sec.quarters ? ` · ${sec.quarters} qtrs to ${sec.latest}` : ''}`)} | ${mark(tr)} ${esc(tr?.note)} | ${mark(cb)} ${esc(cb?.note)} | ${mark(fm)} ${esc(fm?.note)} | ${mark(fh)} ${esc(fh?.note)} |`),
  '',
  '## SEC labels used per ticker',
  ...rows.filter((r) => r.sec?.labels).map((r) => `- ${r.t}: ${Object.entries(r.sec.labels).map(([k, v]) => `${k}=${v}`).join(', ')}`),
];
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'source-check-results.md');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`\nSummary: SEC ${pct('sec')} · Yahoo ${pct('tr')} · CBOE ${pct('cb')} · FMP ${pct('fm')} · Finnhub ${pct('fh')}`);
console.log(`Full table saved to ${out}\n`);
