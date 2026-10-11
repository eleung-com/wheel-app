// Part 2C: which section of the Signals tab a card belongs to, and the order
// inside it. Shared by the page and the Worker's count message so "2 to
// manage" in Telegram always matches the Manage section in the app.

export const SECTION = {
  maxloss: 'manage', roll: 'manage', close: 'manage', cc: 'manage', score_review: 'manage',
  csp: 'trades', csp_wait: 'waiting',
};

const MANAGE_ORDER = { maxloss: 0, roll: 1, close: 2, score_review: 3, cc: 4 };

/** Worst first: max loss → roll → close → score review → covered call; sooner expiry first. */
export function sortManage(list) {
  return [...list].sort((a, b) => (MANAGE_ORDER[a.type] - MANAGE_ORDER[b.type]) || ((a.days ?? 99) - (b.days ?? 99)));
}

/** New trades: highest Investment Score first; unscored last; ties → bigger drop vs its own range. */
export function rankTrades(list) {
  return [...list].sort((a, b) => {
    const sa = a.score ?? -1, sb = b.score ?? -1;
    if (sb !== sa) return sb - sa;
    return (b.atrDrop ?? 0) - (a.atrDrop ?? 0);
  });
}

/** signals → { manage, trades, waiting }, each already in display order. */
export function splitSections(signals) {
  const by = { manage: [], trades: [], waiting: [] };
  for (const s of signals || []) if (SECTION[s.type]) by[SECTION[s.type]].push(s);
  return { manage: sortManage(by.manage), trades: rankTrades(by.trades), waiting: by.waiting };
}
