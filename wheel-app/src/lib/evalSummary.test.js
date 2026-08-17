import { describe, it, expect } from 'vitest';
import { evalSnippet } from './evalSummary';

// Shaped after a real page (NVDA, 08-03-2026): heading / table / bullets /
// heading / paragraph, as flattened by the worker's /notion/eval route.
const REAL = {
  title: '08-03-2026',
  blocks: [
    { type: 'heading', text: '📊 NVDA · $198.98 · Technology' },
    { type: 'heading', text: '🗳️ Verdict' },
    { type: 'table', hasHeader: true, rows: [['', '', ''], ['👁️ Watchlist', '✅ YES', 'Unmatched AI infra growth']] },
    { type: 'heading', text: '⚠️ Risks' },
    { type: 'bullet',  text: 'IVR unresolved two passes running' },
    { type: 'heading', text: '🧠 Bottom Line' },
    { type: 'text',    text: 'NVDA: YES. Best-in-class growth; confirm IVR before sizing.' },
  ],
};

describe('evalSnippet', () => {
  it('pulls the paragraph under the Bottom Line heading', () => {
    expect(evalSnippet(REAL)).toBe('NVDA: YES. Best-in-class growth; confirm IVR before sizing.');
  });

  it('matches the heading regardless of emoji, case or markdown level', () => {
    for (const text of ['🧠 Bottom Line', 'BOTTOM LINE', '#### bottom line', 'Bottom  Line']) {
      const ev = { blocks: [{ type: 'heading', text }, { type: 'text', text: 'verdict here' }] };
      expect(evalSnippet(ev), text).toBe('verdict here');
    }
  });

  it('joins several blocks under Bottom Line and stops at the next heading', () => {
    const ev = { blocks: [
      { type: 'heading', text: 'Bottom Line' },
      { type: 'text',    text: 'One.' },
      { type: 'bullet',  text: 'Two.' },
      { type: 'heading', text: 'Appendix' },
      { type: 'text',    text: 'must not appear' },
    ] };
    expect(evalSnippet(ev)).toBe('One. Two.');
  });

  it('skips tables sitting under Bottom Line rather than stringifying them', () => {
    const ev = { blocks: [
      { type: 'heading', text: 'Bottom Line' },
      { type: 'table',   rows: [['a', 'b']] },
      { type: 'text',    text: 'the call' },
    ] };
    expect(evalSnippet(ev)).toBe('the call');
  });

  it('falls back to the first prose block when no Bottom Line is written', () => {
    const ev = { blocks: [
      { type: 'heading', text: '🗳️ Verdict' },
      { type: 'table',   rows: [['x']] },
      { type: 'text',    text: 'first paragraph' },
      { type: 'text',    text: 'second' },
    ] };
    expect(evalSnippet(ev)).toBe('first paragraph');
  });

  it('falls back past a Bottom Line heading that has no prose under it', () => {
    const ev = { blocks: [
      { type: 'text',    text: 'earlier prose' },
      { type: 'heading', text: 'Bottom Line' },
      { type: 'table',   rows: [['only', 'a', 'table']] },
    ] };
    expect(evalSnippet(ev)).toBe('earlier prose');
  });

  it('returns empty string for missing, null, empty or malformed evals', () => {
    expect(evalSnippet(null)).toBe('');
    expect(evalSnippet(undefined)).toBe('');
    expect(evalSnippet({})).toBe('');
    expect(evalSnippet({ blocks: [] })).toBe('');
    expect(evalSnippet({ blocks: 'nope' })).toBe('');
    expect(evalSnippet({ blocks: [{ type: 'table', rows: [] }] })).toBe('');
    expect(evalSnippet({ blocks: [{ type: 'text' }] })).toBe('');
    expect(evalSnippet({ blocks: [{ type: 'heading', text: 'Bottom Line' }] })).toBe('');
  });

  it('ignores whitespace-only prose', () => {
    const ev = { blocks: [
      { type: 'heading', text: 'Bottom Line' },
      { type: 'text',    text: '   ' },
      { type: 'text',    text: 'real text' },
    ] };
    expect(evalSnippet(ev)).toBe('real text');
  });
});
