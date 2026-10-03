// Plain-English lines and chart series for the Research tab result screen.
// Fixed templates over the numbers — no AI (PRD §6A "Plain-English lines").
// Pure functions so they can be tested without React.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
const money = (v) => {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B` : `${(a / 1e6).toFixed(0)}M`;
  return `${v < 0 ? '−' : ''}$${s}`;
};
export { money };

/** Short quarter label from a period end date: 2026-06-30 → Q2'26 (calendar quarter of the end month). */
export function quarterLabel(end) {
  const m = Number(end.slice(5, 7));
  return `Q${Math.ceil(m / 3)}'${end.slice(2, 4)}`;
}

/** Colour of a scoring check by id (green / yellow / red / na). */
const colorOf = (result, id) => result?.quality?.checks?.find((c) => c.id === id)?.color || 'na';
const partOf = (result, id) => result?.value?.parts?.find((p) => p.id === id);

/**
 * The "In plain English" list. Each line: { tone: 'g'|'a'|'r'|'n', text }.
 * @param {object} run  a runPreliminary()/rescoreFinal() result
 */
export function plainLines(run) {
  const out = [];
  const r = run?.result;
  const fin = run?.bundle?.financials;
  if (!r || !fin) return out;
  const tone = (c) => (c === 'green' ? 'g' : c === 'yellow' ? 'a' : c === 'red' ? 'r' : 'n');

  // Revenue consistency
  if (fin.yearlyOnly) {
    const ys = fin.annual.filter((y) => isNum(y.revenue));
    let up = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i].revenue > ys[i - 1].revenue) up++;
    if (ys.length > 1) out.push({ tone: tone(colorOf(r, 'revenue_growth')), text: `Revenue up year over year in ${up} of the last ${ys.length - 1} years` });
  } else {
    const q = fin.quarters;
    let up = 0, n = 0;
    for (let i = 4; i < q.length; i++) {
      if (isNum(q[i].revenue) && isNum(q[i - 4].revenue)) { n++; if (q[i].revenue > q[i - 4].revenue) up++; }
    }
    if (n) out.push({ tone: tone(colorOf(r, 'revenue_growth')), text: `Revenue up year over year in ${up} of the last ${n} quarters` });
  }

  const oi = r.quality.checks.find((c) => c.id === 'op_income_growth');
  if (oi && oi.color !== 'na') {
    out.push({ tone: tone(oi.color), text: isNum(oi.value) ? `Operating income ${pct(oi.value)} vs a year ago` : `Operating income: ${oi.display}` });
  }

  const fcf = r.quality.checks.find((c) => c.id === 'fcf');
  if (fcf && fcf.color !== 'na' && !fin.yearlyOnly) {
    const q = fin.quarters.filter((x) => isNum(x.operatingCashFlow) && isNum(x.capex));
    const pos = q.filter((x) => x.operatingCashFlow - x.capex > 0).length;
    out.push({ tone: tone(fcf.color), text: `Free cash flow positive in ${pos} of ${q.length} quarters · ${fcf.display}` });
  } else if (fcf && fcf.color !== 'na') {
    out.push({ tone: tone(fcf.color), text: `Free cash flow: ${fcf.display}` });
  }

  const own = partOf(r, 'pe_own');
  if (own && own.points !== null && isNum(r.metrics.operatingPe)) {
    const [, ref] = own.display.split(' vs ').map(Number);
    const diff = ((r.metrics.operatingPe - ref) / ref) * 100;
    out.push({ tone: own.points === 100 ? 'g' : own.points === 50 ? 'a' : 'r',
      text: `Operating P/E ${r.metrics.operatingPe.toFixed(1)} vs own 5-yr median ${ref.toFixed(1)} (${diff <= 0 ? `${Math.abs(diff).toFixed(0)}% cheaper` : `${diff.toFixed(0)}% pricier`})` });
  }

  const peer = partOf(r, 'pe_peers');
  if (peer && peer.points !== null && isNum(r.metrics.operatingPe)) {
    const names = (run.peers?.used || []).filter((p) => isNum(p.opPe)).map((p) => p.ticker).slice(0, 5).join(', ');
    const [, ref] = peer.display.split(' vs ').map(Number);
    out.push({ tone: peer.points === 100 ? 'g' : peer.points === 50 ? 'a' : 'r',
      text: `Operating P/E ${r.metrics.operatingPe.toFixed(1)} vs peers ${ref.toFixed(1)}${names ? ` (${names})` : ''}` });
  }

  const de = r.quality.checks.find((c) => c.id === 'debt_to_equity');
  if (de && de.color !== 'na' && isNum(de.value)) {
    out.push({ tone: tone(de.color), text: `Debt-to-equity ${de.value.toFixed(2)}${de.note ? ` · ${de.note}` : ''}` });
  }

  if (r.upside?.target && isNum(r.upside.pct)) {
    out.push({ tone: r.upside.score >= 50 ? 'g' : r.upside.score > 0 ? 'a' : 'r',
      text: `Analyst average target $${r.upside.target.value.toFixed(2)} (${pct(r.upside.pct)})` });
  } else {
    out.push({ tone: 'n', text: 'Analyst target: waiting on Claude' });
  }
  return out;
}

/**
 * Series for the three charts. Quarterly (last 20) for US filers; yearly bars
 * for yearly-only filers. Values in dollars; null = no data for that period.
 */
export function chartSeries(fin) {
  if (!fin) return null;
  const rows = fin.yearlyOnly
    ? fin.annual.slice(-5).map((y) => ({ ...y, label: `FY${String(y.fy).slice(2)}` }))
    : fin.quarters.slice(-20).map((q) => ({ ...q, label: quarterLabel(q.end) }));
  const v = (x) => (isNum(x) ? x : null);
  return {
    period: fin.yearlyOnly ? 'year' : 'quarter',
    labels: rows.map((r) => r.label),
    revenue: rows.map((r) => v(r.revenue)),
    fcf: rows.map((r) => (isNum(r.operatingCashFlow) && isNum(r.capex) ? r.operatingCashFlow - r.capex : null)),
    capex: rows.map((r) => v(r.capex)),
    debtLongTerm: rows.map((r) => v(r.debtLongTerm)),
    debtShortTerm: rows.map((r) => v(r.debtShortTerm)),
    cash: rows.map((r) => v(r.cash)),
  };
}
