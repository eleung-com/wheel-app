import { describe, it, expect } from 'vitest';
import { watchRowFor, fairValueView, summaryOf, strengthsAndWatchouts, writeupTabs, leadSplit, pillarLines } from './resultView';

const wl = [{ ticker: 'GOOG', fmvLow: 262.59, fmvMid: 308.93, fmvHigh: 321.57, fmvDate: '2026-10-19' }];
const r = {
  quality: { score: 83, piotroski: { score: 5, passed: 5, run: 9 }, checks: [
    { id: 'revenue_growth', label: 'Revenue growth', color: 'green', display: '+20.1%' },
    { id: 'op_income_growth', label: 'Operating income growth', color: 'green', display: '+21.6%' },
    { id: 'margin_trend', label: 'Operating margin trend', color: 'yellow', display: '+0.4 pts' },
    { id: 'debt_to_equity', label: 'Debt-to-equity', color: 'green', display: '0.16' },
    { id: 'beat_rate', label: 'Beat rate', color: 'green', display: '7 of 8' },
  ] },
  value: { score: 42, parts: [
    { id: 'pe_own', label: 'Operating P/E vs own 5-yr median', points: 0, display: '26.7 vs 21.0' },
    { id: 'pe_peers', label: 'Operating P/E vs peer median', points: 62, display: '26.7 vs 28.5' },
    { id: 'peg', label: 'PEG (operating)', points: 64, display: '1.04' },
  ] },
  upside: { score: 69, pct: 34.6, target: { value: 430.96 } },
  metrics: { operatingPe: 26.7 },
};

describe('Part 7 research result view', () => {
  it('GOOGL finds the GOOG watchlist row', () => {
    expect(watchRowFor('GOOGL', wl).ticker).toBe('GOOG');
    expect(watchRowFor('MSFT', wl)).toBeNull();
  });
  it('fair value: +3.6% over, marker positions inside 0–100', () => {
    const fv = fairValueView('GOOGL', 320.21, wl);
    expect(fv.pct).toBe(3.7);
    expect(fv.from).toBe('GOOG');
    expect(fv.pricePos).toBeGreaterThan(fv.midPos);
    expect(fv.pricePos).toBeLessThanOrEqual(100);
    expect(fairValueView('GOOGL', 320, [])).toBeNull();
  });
  it('summary: headline from quality + value bands, numbers bolded', () => {
    const s = summaryOf(r, { pct: 3.7 });
    expect(s.headline).toBe('A strong business at a so-so price.');
    const text = s.parts.map((p) => p.text).join('');
    expect(text).toContain('3.7% over fair value');
    expect(text).toContain('27% above its own 5-year norm');
    expect(text).toContain('+34.6%');
    expect(s.parts.filter((p) => p.strong).length).toBe(3);
  });
  it('summary is the same every time (no randomness)', () => {
    expect(summaryOf(r)).toEqual(summaryOf(r));
  });
  it('strengths vs watch-outs', () => {
    const { good, watch } = strengthsAndWatchouts({
      lines: [{ tone: 'g', text: 'Revenue up' }, { tone: 'r', text: 'P/E pricier' }, { tone: 'n', text: 'skip me' }],
      row: { moatStrength: 'Strong', moatType: 'Scale', oneTimeItems: true },
      tags: [{ code: 'altman_danger', text: 'Altman low' }], r, earningsDays: 3,
    });
    expect(good.map((x) => x.text)).toEqual(['Revenue up', 'Moat: Scale · Strong (Claude)']);
    expect(watch.map((x) => x.text)).toEqual(['P/E pricier', 'Piotroski 5 of 9: mixed fundamentals trend', expect.stringContaining('One-time items'), 'Altman low', 'Earnings in 3 days']);
    expect(watch.find((x) => x.text === 'Altman low').tone).toBe('r');
  });
  it('write-up splits into tabs on headings', () => {
    const tabs = writeupTabs([
      { type: 'heading', text: 'What they do' }, { type: 'paragraph', text: 'A. B.' },
      { type: 'heading', text: 'Moat' }, { type: 'paragraph', text: 'Scale.' },
      { type: 'heading', text: 'Empty' },
    ]);
    expect(tabs.map((t) => t.title)).toEqual(['What they do', 'Moat']);
  });
  it('lead sentence split', () => {
    expect(leadSplit('Scale is the moat. Google handles most searches.')).toEqual({ lead: 'Scale is the moat.', rest: 'Google handles most searches.' });
    expect(leadSplit('no period here').lead).toBe('');
  });
  it('pillar one-liners', () => {
    const p = pillarLines(r);
    expect(p.quality).toBe('Sales +20.1% · profit +21.6% · debt/equity 0.16 · beat 7 of 8');
    expect(p.upside).toContain('+34.6%');
  });
});
