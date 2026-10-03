#!/usr/bin/env node
// Acceptance check for P1.1 + P1.3: run a real Preliminary "Run a stock" (company
// data + Finnhub auto-peers + scoring) against live SEC / Yahoo / FMP / Finnhub data.
//
// Run from wheel-app/:   node scripts/verify-research-data.mjs [TICKER,...]
// Asks for the SEC contact email and the FMP + Finnhub keys (hidden, not saved).
// Read-only. Writes scripts/research-check-results.json (no keys) so the
// numbers can be compared with stockanalysis.com (target: within ±2%).

import readline from 'node:readline';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreliminary } from '../src/lib/research/run.js';
import { ttm } from '../src/lib/research/fundamentals.js';

const TICKERS = (process.argv[2] || 'VST,UBER,GOOGL,GEV,NVDA,DUOL,TSM,ASML').split(',').map((t) => t.trim().toUpperCase());

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const realWrite = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => { if (!muted || s.includes('\n')) realWrite?.(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(q, hidden = false) {
  process.stdout.write(q);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  return (value ?? '').trim();
}

const email = await ask('SEC contact email (your throwaway): ');
const fmpKey = await ask('FMP key (Enter to skip): ', true);
const fhKey = await ask('Finnhub key (Enter to skip): ', true);
rl.close();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastSec = 0;
const transport = {
  // SEC directly (it accepts home IPs with a contact header); ~8 requests/sec max.
  async sec(p) {
    const wait = Math.max(0, lastSec + 125 - Date.now());
    lastSec = Date.now() + wait;
    if (wait) await sleep(wait);
    const host = p.startsWith('/files/') ? 'https://www.sec.gov' : 'https://data.sec.gov';
    return fetch(host + p, { headers: { 'User-Agent': `wheel-desk research ${email}`, Accept: 'application/json' } });
  },
  // Yahoo via the Worker — Yahoo blocks home IPs.
  yahoo: (p) => fetch('https://wheel-tradier-proxy.esthercandy.workers.dev/yf' + p),
  fmp: fmpKey ? (p) => fetch(`https://financialmodelingprep.com${p}${p.includes('?') ? '&' : '?'}apikey=${fmpKey}`) : null,
  finnhub: fhKey ? (p) => fetch(`https://finnhub.io${p}${p.includes('?') ? '&' : '?'}token=${fhKey}`) : null,
};

const B = (v) => (typeof v === 'number' ? `${(v / 1e9).toFixed(2)}B` : '—');
const N = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—');
const results = [];

for (const t of TICKERS) {
  const started = Date.now();
  const run = await runPreliminary(transport, t);
  const b = run.bundle;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!b.input) {
    console.log(`\n❌ ${t} — ${b.dataTags.map((x) => x.text).join(' · ')}`);
    results.push({ ticker: t, ok: false, tags: b.dataTags });
    continue;
  }
  const q = b.input.quarters;
  const r = run.result;
  const row = {
    ticker: t,
    name: b.name,
    taxonomy: b.meta.taxonomy,
    currency: b.meta.currency,
    latestPeriod: b.financials.latestPeriod,
    quarters: q.length,
    yearlyOnly: b.financials.yearlyOnly,
    price: b.input.price,
    sharesB: b.input.sharesOutstanding / 1e9,
    marketCapB: r.metrics.marketCap / 1e9,
    ttm: {
      revenueB: ttm(q, 'revenue') / 1e9,
      operatingIncomeB: ttm(q, 'operatingIncome') / 1e9,
      netIncomeB: ttm(q, 'netIncome') / 1e9,
      operatingCashFlowB: ttm(q, 'operatingCashFlow') / 1e9,
      capexB: ttm(q, 'capex') / 1e9,
    },
    debtB: b.input.balance?.totalDebt / 1e9,
    equityB: b.input.balance?.equity / 1e9,
    operatingPe: r.metrics.operatingPe,
    reportedPe: r.metrics.reportedPe,
    opPeHistory: b.input.opPeHistory,
    target: b.input.analystTarget?.value ?? null,
    score: { investment: r.investmentScore, verdict: r.verdict, quality: r.quality.score, value: r.value.score, upside: r.upside.score },
    checks: r.quality.checks.map((c) => `${c.label}: ${c.display} (${c.color})`),
    piotroski: r.quality.piotroski?.score,
    altmanZ: r.quality.altmanZ,
    tags: r.tags.map((x) => x.text),
    peers: run.peers.used.map((p) => ({ ticker: p.ticker, opPe: p.opPe, debtToEquity: p.debtToEquity })),
    peersSkipped: run.peers.skipped,
    valueParts: r.value.parts.map((x) => `${x.label}: ${x.display} → ${x.points ?? 'n/a'}`),
    seconds: Number(secs),
  };
  results.push(row);
  console.log(`\n✅ ${t} · ${b.name} · ${row.taxonomy}${row.currency !== 'USD' ? ` (${row.currency}→USD)` : ''} · latest ${row.latestPeriod} · ${row.quarters} qtrs · ${secs}s`);
  console.log(`   Price $${N(row.price, 2)} · shares ${N(row.sharesB, 3)}B · mkt cap ${N(row.marketCapB, 1)}B`);
  console.log(`   TTM revenue ${B(ttm(q, 'revenue'))} · op income ${B(ttm(q, 'operatingIncome'))} · net income ${B(ttm(q, 'netIncome'))}`);
  console.log(`   TTM op cash flow ${B(ttm(q, 'operatingCashFlow'))} · capex ${B(ttm(q, 'capex'))} · debt ${B(b.input.balance?.totalDebt)} · equity ${B(b.input.balance?.equity)}`);
  console.log(`   Operating P/E ${N(row.operatingPe)} · reported P/E ${N(row.reportedPe)} · history ${row.opPeHistory.map((h) => `${h.year}:${N(h.opPe)}`).join(' ')}`);
  console.log(`   Auto-peers: ${row.peers.map((p) => `${p.ticker} (P/E ${N(p.opPe)}, D/E ${N(p.debtToEquity, 2)})`).join(' · ') || 'none usable'}`);
  if (row.peersSkipped.length) console.log(`   Skipped: ${row.peersSkipped.map((x) => `${x.ticker} – ${x.reason}`).join(' · ')}`);
  console.log(`   Value: ${row.valueParts.join(' · ')}`);
  console.log(`   Score (Preliminary, auto-peers) ${row.score.investment} → ${row.score.verdict} · Q ${row.score.quality} · V ${row.score.value} · U ${row.score.upside}`);
  if (row.tags.length) console.log(`   Tags: ${row.tags.join(' · ')}`);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'research-check-results.json');
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.log(`\nSaved ${out}`);
