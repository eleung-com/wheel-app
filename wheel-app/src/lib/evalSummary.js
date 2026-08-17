/**
 * One line of preview text for a watchlist card, pulled from a Notion eval.
 *
 * The evals are written to a fixed shape — Verdict, Key Metrics, Risks, Bottom
 * Line — and the Bottom Line is the paragraph that actually states the call, so
 * that's what a card shows. Everything else needs the table layout to make sense
 * and belongs in the detail modal.
 */

const BOTTOM_LINE = /bottom\s*line/i;

/** Headings arrive with their emoji and markdown level already stripped by the worker. */
function isHeading(b) { return b && b.type === 'heading'; }

/**
 * @param evaluation { title, blocks } from the worker's /notion/eval route, or null.
 * @returns the Bottom Line text, else the first prose paragraph, else ''.
 */
export function evalSnippet(evaluation) {
  const blocks = evaluation && Array.isArray(evaluation.blocks) ? evaluation.blocks : [];
  if (!blocks.length) return '';

  // Prefer the text under the Bottom Line heading. Collect every paragraph and
  // bullet up to the next heading — some evals put the call in a bullet list.
  const at = blocks.findIndex(b => isHeading(b) && BOTTOM_LINE.test(b.text || ''));
  if (at !== -1) {
    const parts = [];
    for (let i = at + 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (isHeading(b)) break;
      if (b.type === 'text' || b.type === 'bullet') {
        const t = (b.text || '').trim();
        if (t) parts.push(t);
      }
    }
    if (parts.length) return parts.join(' ');
  }

  // No Bottom Line written — fall back to the first prose block on the page so
  // the card still says something rather than going blank.
  const firstText = blocks.find(b => (b.type === 'text' || b.type === 'bullet') && (b.text || '').trim());
  return firstText ? firstText.text.trim() : '';
}
