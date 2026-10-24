// Part 7 (Research result redesign, approved 10-24): pure helpers behind the
// new result screen. Everything here is fixed rules over the score result —
// no AI — so the same run always reads the same way.

import { fmvOf, vsMidPct, fmvStale } from '../fairValue';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Share classes that are the same company on the watchlist (El researched
// GOOGL; the watchlist row is GOOG).
const SAME_CO = { GOOGL: 'GOOG', GOOG: 'GOOGL', 'BRK.B': 'BRK.A', 'BRK.A': 'BRK.B', FOXA: 'FOX', FOX: 'FOXA', NWSA: 'NWS', NWS: 'NWSA' };

/** The watchlist row for a ticker, falling back to its other share class. */
export function watchRowFor(ticker, watchlist = []) {
  const t = String(ticker || '').toUpperCase();
  return watchlist.find((w) => w.ticker === t) || watchlist.find((w) => w.ticker === SAME_CO[t]) || null;
}

/** Price vs fair value for the hero box, or null when there's no FMV. */
export function fairValueView(ticker, price, watchlist) {
  const row = watchRowFor(ticker, watchlist);
  const fmv = row ? fmvOf(row) : null;
  if (!fmv || !isNum(price)) return null;
  const pct = vsMidPct(price, fmv);
  const lo = fmv.low ?? fmv.mid * 0.85;
  const hi = Math.max(fmv.high ?? fmv.mid * 1.3, price, fmv.mid) ;
  const min = Math.min(lo, price);
  const pos = (v) => Math.round(((v - min) / (hi - min || 1)) * 1000) / 10;
  return { ...fmv, pct, from: row.ticker, pricePos: pos(price), midPos: pos(fmv.mid) };
}

const band = (s, hi, lo) => (s == null ? null : s >= hi ? 'high' : s >= lo ? 'mid' : 'low');

/**
 * The one-paragraph summary at the top. Returns { headline, parts[] } where
 * each part is { text, strong? } so the screen can bold the key numbers.
 */
export function summaryOf(r, fv = null) {
  if (!r) return null;
  const q = band(r.quality?.score, 75, 50);
  const v = band(r.value?.score, 67, 34);
  const headline = (
    q === 'high' && v === 'high' ? 'A strong business at a good price.'
      : q === 'high' && v === 'mid' ? 'A strong business at a so-so price.'
        : q === 'high' && v === 'low' ? 'A strong business, but expensive.'
          : q === 'high' ? 'A strong business; value can’t be judged yet.'
            : q === 'mid' && v === 'high' ? 'A decent business at a good price.'
              : q === 'mid' ? 'A decent business; the price isn’t a bargain.'
                : q === 'low' ? 'Weak business numbers.'
                  : 'Not enough data for a full read.'
  );
  const parts = [];
  if (fv && isNum(fv.pct)) {
    parts.push({ text: 'The price is ' }, { text: `${Math.abs(fv.pct)}% ${fv.pct <= 0 ? 'under' : 'over'} fair value`, strong: true }, { text: '. ' });
  }
  if (isNum(r.quality?.score)) {
    const goods = (r.quality.checks || []).filter((c) => c.color === 'green').map((c) => c.label.toLowerCase());
    parts.push({ text: `Quality is ${q === 'high' ? 'high' : q === 'mid' ? 'middling' : 'low'} (${r.quality.score})` });
    parts.push({ text: goods.length ? `: strong on ${goods.slice(0, 3).join(', ')}. ` : '. ' });
  }
  const own = (r.value?.parts || []).find((p) => p.id === 'pe_own');
  if (own && own.points != null && isNum(r.metrics?.operatingPe)) {
    const ref = Number(String(own.display).split(' vs ')[1]);
    if (isNum(ref) && ref > 0) {
      const d = Math.round(((r.metrics.operatingPe - ref) / ref) * 100);
      parts.push({ text: 'Its P/E is ' }, { text: `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} its own 5-year norm`, strong: true }, { text: `, and Value is ${r.value.score}. ` });
    }
  } else if (isNum(r.value?.score)) {
    parts.push({ text: `Value is ${r.value.score}. ` });
  }
  if (isNum(r.upside?.pct)) {
    parts.push({ text: 'Analysts’ average target is ' }, { text: `${r.upside.pct >= 0 ? '+' : ''}${r.upside.pct}%`, strong: true }, { text: ' from today’s price.' });
  }
  return { headline, parts };
}

/** One plain line per pillar card. */
export function pillarLines(r) {
  const chk = (id) => (r.quality?.checks || []).find((c) => c.id === id);
  const q = [
    chk('revenue_growth')?.color !== 'na' && chk('revenue_growth') ? `Sales ${chk('revenue_growth').display}` : null,
    chk('op_income_growth')?.color !== 'na' && chk('op_income_growth') ? `profit ${chk('op_income_growth').display}` : null,
    chk('debt_to_equity')?.color !== 'na' && chk('debt_to_equity') ? `debt/equity ${chk('debt_to_equity').display}` : null,
    chk('beat_rate')?.color !== 'na' && chk('beat_rate') ? `beat ${chk('beat_rate').display}` : null,
  ].filter(Boolean).join(' · ');
  const v = (r.value?.parts || []).filter((p) => p.points != null).map((p) => `${p.label.replace('Operating ', '')}: ${p.display}`).join(' · ');
  const u = r.upside?.target && isNum(r.upside.pct)
    ? `Analyst average target $${r.upside.target.value.toFixed(2)}, ${r.upside.pct >= 0 ? '+' : ''}${r.upside.pct}%`
    : 'No analyst target yet';
  return { quality: q || 'Not enough data', value: v || 'Not enough data', upside: u };
}

/**
 * Strengths vs watch-outs. `lines` = explain.plainLines(run) ({tone,text}),
 * `row` = Claude's Stock Runs row (moat, one-time items), `tags` = score flags.
 */
export function strengthsAndWatchouts({ lines = [], row = null, tags = [], r = null, earningsDays = null }) {
  const good = [], watch = [];
  for (const l of lines) {
    if (l.tone === 'g') good.push({ tone: 'g', text: l.text });
    else if (l.tone === 'r' || l.tone === 'a') watch.push({ tone: l.tone, text: l.text });
  }
  if (r?.quality?.piotroski?.score != null) {
    const p = r.quality.piotroski;
    if (p.score >= 7) good.push({ tone: 'g', text: `Piotroski ${p.passed} of ${p.run}: improving fundamentals` });
    else if (p.score <= 5) watch.push({ tone: p.score <= 3 ? 'r' : 'a', text: `Piotroski ${p.passed} of ${p.run}: mixed fundamentals trend` });
  }
  if (row?.moatStrength === 'Strong') good.push({ tone: 'g', text: `Moat: ${row.moatType || '—'} · Strong (Claude)` });
  else if (row?.moatStrength === 'None') watch.push({ tone: 'a', text: 'No clear moat (Claude)' });
  if (row?.oneTimeItems) watch.push({ tone: 'a', text: 'One-time items over 10% of a quarter’s operating income — see Claude’s read' });
  for (const t of tags) watch.push({ tone: /altman|negative|no_operating/.test(t.code) ? 'r' : 'a', text: t.text });
  if (isNum(earningsDays) && earningsDays >= 0 && earningsDays <= 14) {
    watch.push({ tone: 'a', text: earningsDays === 0 ? 'Earnings today' : `Earnings in ${earningsDays} day${earningsDays === 1 ? '' : 's'}` });
  }
  return { good, watch };
}

/** Claude's write-up blocks → tabs: [{ title, blocks }], split on headings. */
export function writeupTabs(blocks = []) {
  const tabs = [];
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'heading') { cur = { title: b.text, blocks: [] }; tabs.push(cur); continue; }
    if (!cur) { cur = { title: 'Overview', blocks: [] }; tabs.push(cur); }
    cur.blocks.push(b);
  }
  return tabs.filter((t) => t.blocks.length);
}

/** First sentence → bold takeaway; the rest stays as normal text. */
export function leadSplit(text = '') {
  const m = /^(.+?[.!?])(\s+|$)([\s\S]*)$/.exec(String(text).trim());
  if (!m || m[1].length > 220) return { lead: '', rest: String(text) };
  return { lead: m[1], rest: m[3] };
}

/** v2.8 score input: the watchlist row's fair value for this ticker, or null. */
export function fairValueInput(ticker, watchlist, now = new Date()) {
  const row = watchRowFor(ticker, watchlist);
  const fmv = row ? fmvOf(row) : null;
  if (!fmv) return null;
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return { mid: fmv.mid, low: fmv.low, high: fmv.high, date: fmv.date, source: `Monday eval${row.ticker !== String(ticker).toUpperCase() ? ` (${row.ticker})` : ''}`, stale: fmvStale(fmv, today) };
}
