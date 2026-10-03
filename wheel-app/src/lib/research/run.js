// "Run a stock": the two scoring passes a run goes through.
//
//   runPreliminary  company data + Finnhub auto-peers → score tagged Preliminary.
//                   Shown immediately; the Claude routine is fired after this (P1.6).
//   rescoreFinal    same company data + Claude's peers, analyst target and beat
//                   rate → score tagged Final.
//
// Both are pure orchestration over companyData.js / peers.js / scoring.js, with
// the network behind the injected transport. Nothing here writes anywhere;
// saving to Notion is P1.5.

import { fetchCompanyBundle } from './companyData.js';
import { fetchAutoPeerTickers, buildPeerSet } from './peers.js';
import { scoreStock } from './scoring.js';

/**
 * @returns {Promise<{ ticker, stage, ranAt, bundle, peers, result }>}
 *   result is null when the company can't be scored (non-SEC filer, no price…);
 *   bundle.dataTags says why.
 */
export async function runPreliminary(transport, ticker, { now = Date.now(), onStep = () => {} } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  const ranAt = new Date(now).toISOString();
  onStep('company');
  const bundle = await fetchCompanyBundle(transport, t, { now });
  if (!bundle.input) return { ticker: t, stage: 'preliminary', ranAt, bundle, peers: null, result: null };

  onStep('peers');
  const candidates = await fetchAutoPeerTickers(transport, t);
  const peers = await buildPeerSet(transport, candidates, { source: 'auto', subjectCik: bundle.meta.cik, now });
  onStep('scoring');
  const result = scoreStock({
    ...bundle.input,
    stage: 'preliminary',
    peers: { source: 'auto', list: peers.used },
    beatRate: null,
  });
  result.tags.unshift(...bundle.dataTags);
  return { ticker: t, stage: 'preliminary', ranAt, bundle, peers, result };
}

/**
 * Re-score a run with what the Claude routine found.
 *
 * @param {object} run  a runPreliminary() result
 * @param {object} claude
 * @param {string[]} claude.peerTickers           3–6 direct competitors
 * @param {object|null} [claude.analystTarget]    { value, source, asOf } — used only if FMP had none
 * @param {object|null} [claude.beatRate]         { beats, total, stale }
 */
export async function rescoreFinal(transport, run, { peerTickers = [], analystTarget = null, beatRate = null } = {}, { now = Date.now() } = {}) {
  if (!run?.bundle?.input) return { ...run, stage: 'final' };
  const peers = await buildPeerSet(transport, peerTickers, { source: 'claude', subjectCik: run.bundle.meta.cik, now });
  // SEC/FMP wins for anything they have; Claude only fills gaps (PRD §8 edge cases).
  const target = run.bundle.input.analystTarget || analystTarget || null;
  const result = scoreStock({
    ...run.bundle.input,
    analystTarget: target,
    stage: 'final',
    peers: { source: 'claude', list: peers.used },
    beatRate,
  });
  result.tags.unshift(...run.bundle.dataTags.filter((x) => !(x.code === 'target_pending' && target)));
  return { ...run, stage: 'final', rescoredAt: new Date(now).toISOString(), peers, result };
}
