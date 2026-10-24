import React, { useState } from 'react';
import MiniBarChart from './MiniBarChart';
import RejectModal from './RejectModal';
import { plainLines, chartSeries, money } from '../../../lib/research/explain';
import { rejectedBefore, runStamp, claudeState, CLAUDE_TIMEOUT_MIN, scoreAllowsPriority } from '../../../lib/research/runRecord';
import { fairValueView, summaryOf, pillarLines, strengthsAndWatchouts, writeupTabs, leadSplit, watchRowFor } from '../../../lib/research/resultView';
import { dte } from '../../../lib/utils';

// Result screen for one "Run a stock". Part 7 (10-24) redesign: answer first
// (verdict + fair value + actions), one-paragraph summary, 3 score cards,
// strengths vs watch-outs, Claude's read in tabs, one peer table.
// Originally: layout from the approved mockup,
// PRD §6A-BUILD §4). Save status, rejected-before banner, history and
// Watch / Reject come from Notion Stock Runs (P1.5); the Claude write-up
// arrives in P1.6.

const VERDICT_TONE = { 'Worth investing': 'g', Maybe: 'a', 'Not worth it': 'r' };
const TONE_VAR = { g: 'var(--g)', a: 'var(--a)', r: 'var(--r)', n: 'var(--mu)' };
const COLOR_TONE = { green: 'g', yellow: 'a', red: 'r', na: 'n' };

const fmtPts = (c) => (c.color === 'na' ? '—' : Number.isInteger(c.points) ? String(c.points) : c.points.toFixed(1));

function CheckRow({ tone, name, value, pts, children, open }) {
  return (
    <details className="rs-chk" open={open}>
      <summary>
        <span className={`rs-cd ${tone}`} aria-hidden="true" />
        <span className="rs-cn">{name}</span>
        <span className="rs-cv">{value}</span>
        <span className="rs-cp" style={{ color: TONE_VAR[tone] }}>{pts}</span>
      </summary>
      <div className="rs-cbody">{children}</div>
    </details>
  );
}

const toneOfScore = (score) => (score == null ? 'n' : score >= 75 ? 'g' : score >= 55 ? 'a' : 'r');

/** Part 7: one score card (Quality / Value / Upside); tap to open its checks. */
function Pillar({ label, score, weight, line, children }) {
  const tone = toneOfScore(score);
  return (
    <details className="rs2-pil" style={{ '--c': TONE_VAR[tone] }}>
      <summary>
        <div className="rs2-pil-top"><span>{label} · {weight != null ? `${Math.round(weight * 100)}%` : 'left out'}</span><b>{score ?? 'n/a'}</b></div>
        <div className="rs2-bar"><i style={{ width: `${score ?? 0}%` }} /></div>
        <div className="rs2-pil-line">{line}</div>
        <div className="rs2-pil-more">See the checks ▾</div>
      </summary>
      <div className="rs-checks rs2-checks">{children}</div>
    </details>
  );
}

const fmtDate = (iso) => runStamp(iso);

function SaveStatus({ save, onRetry }) {
  if (!save) return null;
  if (save.state === 'saving') return <div className="rs-save">Saving to Notion…</div>;
  if (save.state === 'saved') return <div className="rs-save ok">Saved to Notion</div>;
  return (
    <div className="rs-save err" role="alert">
      Not saved to Notion — {save.error}{' '}
      <button type="button" className="rs-link" onClick={onRetry}>Retry</button>
    </div>
  );
}

function RejectedBanner({ row }) {
  if (!row) return null;
  return (
    <div className="rs-banner" role="note">
      <b>Rejected {fmtDate(row.runAt).split(' ')[0]}:</b> {row.rejectReason || 'no reason given'}
      {row.investmentScore != null ? ` (score then: ${row.investmentScore})` : ''}
      {row.rejectTags?.length ? <div className="rs-banner-tags">{row.rejectTags.join(' · ')}</div> : null}
    </div>
  );
}

function History({ save }) {
  const rows = save?.history || [];
  return (
    <>
      <div className="slabel">History</div>
      <div className="rs-hist">
        {save?.state === 'saving' && <div className="rs-muted rs-hist-empty">Loading…</div>}
        {save?.state === 'error' && <div className="rs-muted rs-hist-empty">Unavailable until this run is saved.</div>}
        {save?.state === 'saved' && rows.map((h) => (
          <div key={h.pageId} className={`rs-hrow static${h.pageId === save.pageId ? ' cur' : ''}`}>
            <b>{fmtDate(h.runAt)}</b>
            <span className="rs-muted">{h.version || ''}</span>
            <span className={`rs-hv ${VERDICT_TONE[h.verdict] || 'n'}`}>{h.investmentScore ?? '—'} · {h.verdict || '—'}</span>
            <span className="rs-hd">{h.decision === 'Priority' ? 'Priority' : h.decision === 'Watch' ? 'Watch' : h.decision === 'Reject' ? 'Skipped' : h.pageId === save.pageId ? 'This run' : ''}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Part 2B: Priority / Watch / Skip write the ONE field — Dive-In on the
// watchlist. Skip is the old Reject (reason required, kept in the reject log).
// Priority only when the score is Worth investing or Maybe.
function Actions({ ticker, save, current, verdict, onDecide, onRerun, running }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const ready = save?.state === 'saved' && !!save.pageId;
  const decision = current?.decision || null;
  const why = ready ? undefined : 'Available once the run is saved to Notion';
  const canPriority = scoreAllowsPriority(verdict);
  const pending = current?.diveIn?.pending;

  async function choose(d) {
    setBusy(d);
    await onDecide({ decision: decision === d ? null : d });
    setBusy(null);
  }

  return (
    <>
      {decision === 'Priority' && (
        <div className="rs-decided g">🔥 Priority{pending ? ` — saved. Add ${ticker} to TradingView; Dive-In updates after the next sync.` : ' — Dive-In set. Its CSP signals can now show.'} Tap again to undo.</div>
      )}
      {decision === 'Watch' && (
        <div className="rs-decided g">👀 Watch{pending ? ` — saved. Add ${ticker} to TradingView; Dive-In updates after the next sync.` : ' — Dive-In set.'} Tap again to undo.</div>
      )}
      {decision === 'Reject' && (
        <div className="rs-decided r">Skipped: {current.rejectReason}{current.rejectTags?.length ? ` · ${current.rejectTags.join(', ')}` : ''}. Tap Skip to edit or clear.</div>
      )}
      {!canPriority && verdict && (
        <div className="rs-decided" style={{ color: 'var(--mu2)' }}>Priority needs a score of Maybe or better (this run: {verdict}).</div>
      )}
      <div className="rs-actions">
        <button type="button" className={`btn-p${decision === 'Priority' ? ' rs-on' : ''}`} disabled={!ready || !!busy || !canPriority} title={why}
          aria-pressed={decision === 'Priority'} onClick={() => choose('Priority')}>
          {busy === 'Priority' ? <span className="spinner" /> : decision === 'Priority' ? '✓ 🔥 Priority' : '🔥 Priority'}
        </button>
        <button type="button" className={`btn-s${decision === 'Watch' ? ' rs-on' : ''}`} disabled={!ready || !!busy} title={why}
          aria-pressed={decision === 'Watch'} onClick={() => choose('Watch')}>
          {busy === 'Watch' ? <span className="spinner" /> : decision === 'Watch' ? '✓ 👀 Watch' : '👀 Watch'}
        </button>
        <button type="button" className={`btn-s rs-reject${decision === 'Reject' ? ' rs-on' : ''}`} disabled={!ready || !!busy} title={why}
          aria-pressed={decision === 'Reject'} onClick={() => setRejectOpen(true)}>
          {decision === 'Reject' ? '✕ Skipped' : 'Skip'}
        </button>
        <button type="button" className="btn-s rs-rerun" onClick={onRerun} disabled={running}>↻ Re-run</button>
      </div>
      <RejectModal
        open={rejectOpen}
        ticker={ticker}
        current={current}
        onSave={onDecide}
        onClear={() => onDecide({ decision: null })}
        onClose={() => setRejectOpen(false)}
      />
    </>
  );
}

const minsAgo = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/** "Claude's read": researching / failed / the write-up (P1.6). */
function ClaudeSection({ claude, save, finalizing, onRedo }) {
  const row = claude?.row;
  const state = claudeState(row);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);
  const redo = async () => { setBusy(true); await onRedo(); setBusy(false); };

  let body;
  if (save?.state !== 'saved') {
    body = <div className="rs-muted">Starts once the run is saved to Notion.</div>;
  } else if (state === 'waiting') {
    body = (
      <div className="rs-cl-wait" role="status">
        <span className="spinner a" /> Claude is researching peers, moat and the story… started {minsAgo(row.claudeStarted)} min ago · usually 3–10 min
        {row.claudeSession && <> · <a href={row.claudeSession} target="_blank" rel="noreferrer">watch it work</a></>}
        <div className="rs-muted">You can leave this screen. The Final score appears the next time you open this stock.</div>
      </div>
    );
  } else if (state === 'failed' || state === 'none') {
    const why = row?.errorDetail || (state === 'failed' ? `no answer after ${CLAUDE_TIMEOUT_MIN} min` : 'not started');
    body = (
      <div className="rs-cl-fail" role="alert">
        Claude step failed — {why}. Score stays Preliminary.{' '}
        <button type="button" className="rs-link" onClick={redo} disabled={busy}>{busy ? 'Starting…' : 'Retry'}</button>
      </div>
    );
  } else {
    const beat = row.beatQuarters ? `${row.beats ?? '?'} of ${row.beatQuarters}${row.beatStale ? ' (stale)' : ''}` : row.beatStale ? 'stale' : '—';
    const tabs = writeupTabs(claude.writeup || []);
    const t = tabs[Math.min(tab, Math.max(tabs.length - 1, 0))];
    const isMoat = t && /moat/i.test(t.title);
    const isBeat = t && /beat/i.test(t.title);
    const STRENGTHS = ['None', 'Some', 'Strong'];
    body = (
      <>
        {finalizing && <div className="rs-cl-wait" role="status"><span className="spinner a" /> Re-scoring with Claude’s peers…</div>}
        <div className="rs2-facts">
          <div><span>Moat</span><b>{row.moatType || '—'}{row.moatStrength ? ` · ${row.moatStrength}` : ''}</b></div>
          <div><span>Beat rate</span><b>{beat}</b></div>
          <div><span>One-time items</span><b>{row.oneTimeItems ? 'Yes — see tab' : 'None flagged'}</b></div>
          <div><span>Peers</span><b>{row.peersClaude ? `${row.peersClaude.split(',').length} picked` : '—'}</b></div>
        </div>
        {tabs.length === 0 && <div className="rs-muted">Loading the write-up…</div>}
        {tabs.length > 0 && (
          <>
            <div className="rs2-tabs" role="tablist">
              {tabs.map((x, i) => (
                <button key={x.title} type="button" role="tab" aria-selected={x === t} className={x === t ? 'on' : ''} onClick={() => setTab(i)}>{x.title}</button>
              ))}
            </div>
            <div className="rs2-tp" role="tabpanel">
              {isMoat && row.moatStrength && (
                <>
                  {row.moatType && <span className="rs2-badge">{row.moatType}</span>}
                  <div className="rs2-meter3" aria-label={`Moat strength: ${row.moatStrength}`}>
                    {STRENGTHS.map((x) => <span key={x} className={x === row.moatStrength ? 'on' : ''}>{x}</span>)}
                  </div>
                </>
              )}
              {isBeat && row.beatQuarters > 0 && (
                <div className="rs2-dots" aria-label={`Beat ${row.beats} of ${row.beatQuarters}`}>
                  {Array.from({ length: row.beatQuarters }, (_, i) => <i key={i} className={i < (row.beats || 0) ? 'g' : 'a'} />)}
                </div>
              )}
              {t.blocks.map((blk, i) => {
                if (blk.type === 'bullet') return <div key={i} className="rs2-li">{blk.text}</div>;
                if (i === 0) {
                  const { lead, rest } = leadSplit(blk.text);
                  return lead ? <div key={i}><div className="rs2-lead">{lead}</div>{rest && <p>{rest}</p>}</div> : <p key={i}>{blk.text}</p>;
                }
                return <p key={i}>{blk.text}</p>;
              })}
            </div>
          </>
        )}
        <div className="rs-cl-foot">
          Written {runStamp(row.claudeWritten)}
          {row.claudeSession && <> · <a href={row.claudeSession} target="_blank" rel="noreferrer">session</a></>}
          {' · '}<button type="button" className="rs-link" onClick={redo} disabled={busy}>{busy ? 'Starting…' : 'Redo Claude research'}</button>
        </div>
      </>
    );
  }
  return (
    <section className="rs2-card">
      <div className="rs2-h">Claude’s read</div>
      <div className="rs-claude rs2-claude">{body}</div>
    </section>
  );
}
export default function ResearchResult({ run, onBack, onRerun, running, save, onRetrySave, onDecide, claude, finalizing, onRedoClaude, watchlist = [] }) {
  const r = run.result;
  const b = run.bundle;
  const name = b?.name || run.ticker;
  const price = b?.input?.price;
  const tagsShown = r ? r.tags : b?.dataTags || [];
  const current = save?.history?.find((h) => h.pageId === save.pageId) || null;
  const prevReject = save?.state === 'saved' ? rejectedBefore(save.history, save.pageId) : null;
  const actions = <Actions ticker={run.ticker} save={save} current={current} verdict={current?.verdict ?? r?.verdict ?? 'No score'} onDecide={onDecide} onRerun={onRerun} running={running} />;

  if (!r) {
    return (
      <div>
        <button type="button" className="rs-back" onClick={onBack}>‹ Research</button>
        <div className="rs-head" style={{ '--vt': 'var(--mu)' }}>
          <div className="rs-tk">{run.ticker}</div>
          <div className="rs-name">{name}</div>
          <div className="rs-verdict" style={{ color: 'var(--mu2)', marginTop: 12 }}>No score</div>
          <div className="rs-sub">This company can’t be scored from SEC data.</div>
          <SaveStatus save={save} onRetry={onRetrySave} />
        </div>
        <RejectedBanner row={prevReject} />
        <div className="slabel">Why</div>
        <div className="rs-pills">{tagsShown.map((t) => <span key={t.code} className="cpill warn">{t.text}</span>)}</div>
        <ClaudeSection claude={claude} save={save} finalizing={false} onRedo={onRedoClaude} />
        <History save={save} />
        {actions}
      </div>
    );
  }

  const vt = VERDICT_TONE[r.verdict] || 'n';
  const lines = plainLines(run);
  const series = chartSeries(b.financials);
  const periodWord = series?.period === 'year' ? 'years' : 'quarters';
  const latestQ = b.financials?.latestPeriod;
  const fv = fairValueView(run.ticker, price, watchlist);
  const summary = summaryOf(r, fv);
  const pl = pillarLines(r);
  const wrow = watchRowFor(run.ticker, watchlist);
  const { good, watch } = strengthsAndWatchouts({ lines, row: claude?.row, tags: tagsShown, r, earningsDays: wrow?.earnings ? dte(String(wrow.earnings).slice(0, 10)) : null });
  const peersUsed = run.peers?.used || [];
  const reasons = {};
  String(claude?.row?.peerReasons || '').split('\n').forEach((ln) => {
    const m = /^\s*([A-Z.\-]{1,10})\s*[—–-]\s*(.+)$/.exec(ln);
    if (m) reasons[m[1]] = m[2];
  });
  const pes = [r.metrics.operatingPe, ...peersUsed.map((p) => p.opPe)].filter((v) => v != null && v > 0);
  const peMin = Math.min(...pes), peMax = Math.max(...pes);
  const pePos = (v) => (v == null || !(peMax > peMin) ? null : ((v - peMin) / (peMax - peMin)) * 100);
  const median = (xs) => { const a = xs.filter((v) => v != null).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const peerPeMed = median(peersUsed.map((p) => (p.opPe > 0 ? p.opPe : null)));
  const peerDeMed = median(peersUsed.map((p) => p.debtToEquity));

  return (
    <div className="rs2">
      <button type="button" className="rs-back" onClick={onBack}>‹ Research</button>

      {/* 1. Answer first: verdict + fair value + your call */}
      <section className="rs2-card rs2-hero">
        <div className="rs2-hero-grid">
          <div>
            <div className="rs2-id"><span className="rs-tk">{run.ticker}</span><span className="rs2-px">{price != null ? `$${price.toFixed(2)}` : '—'}</span></div>
            <div className="rs-name">{name}</div>
            <div className="rs-meta">
              <span className={`stbdg ${r.scoreType === 'Final' ? 'final' : 'prelim'}`}>{r.scoreType === 'Final' ? 'Final' : 'Preliminary · auto peers'}</span>
              <span>Run {new Date(run.ranAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' })}</span>
              <span>· rules {r.version}</span>
              {latestQ && <span>· SEC data to {latestQ}</span>}
            </div>
          </div>
          <div className="rs2-vbox">
            <div className="rs2-dial" style={{ '--p': r.investmentScore ?? 0, '--c': TONE_VAR[vt] }}>
              <div><b>{r.investmentScore ?? '—'}</b><small>of 100</small></div>
            </div>
            <div className="rs2-vtext">
              <div className="rs-vlabel">Verdict</div>
              <div className="rs-verdict" style={{ color: TONE_VAR[vt] }}>{r.verdict}</div>
              <div className="rs2-scale" aria-hidden="true">
                <span className={r.investmentScore < 55 ? 'on' : ''} /><span className={r.investmentScore >= 55 && r.investmentScore < 75 ? 'on' : ''} /><span className={r.investmentScore >= 75 ? 'on' : ''} />
              </div>
              <div className="rs2-scale-l"><span>Not worth it</span><span>55</span><span>75</span><span>Worth it</span></div>
            </div>
          </div>
          <div className="rs2-fv">
            <div className="rs2-fv-top"><span>Price vs fair value</span>
              {fv && <b style={{ color: fv.pct <= 0 ? 'var(--g)' : fv.pct <= 10 ? 'var(--a)' : 'var(--r)' }}>{Math.abs(fv.pct)}% {fv.pct <= 0 ? 'under' : 'over'}</b>}
            </div>
            {fv ? (
              <>
                <div className="rs2-fv-bar" style={{ '--m': `${fv.midPos}%` }}><b style={{ left: `${fv.midPos}%` }} /><i style={{ left: `${fv.pricePos}%` }} /></div>
                <div className="rs2-fv-l"><span>Low <b>{fv.low != null ? `$${fv.low.toFixed(2)}` : '—'}</b></span><span>Fair <b>${fv.mid.toFixed(2)}</b></span><span>High <b>{fv.high != null ? `$${fv.high.toFixed(2)}` : '—'}</b></span></div>
                <div className="rs2-fv-note">Shown only · not in the score{fv.date ? ` · from ${fv.date.slice(5)}` : ''}{fv.from !== run.ticker ? ` · ${fv.from} row` : ''}</div>
              </>
            ) : (
              <div className="rs2-fv-note">No fair value yet — it fills on the Monday eval{wrow ? '' : ' (not on your watchlist)'}.</div>
            )}
          </div>
        </div>
        {summary && (
          <div className="rs2-summary">
            <b>{summary.headline}</b>{' '}
            {summary.parts.map((p, i) => (p.strong ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
          </div>
        )}
        <div className="rs-sub">{r.verdictReason}</div>
        <SaveStatus save={save} onRetry={onRetrySave} />
        <div className="rs2-acts">{actions}</div>
      </section>
      <RejectedBanner row={prevReject} />

      {/* 2. The 3 scores — tap for the checks */}
      <div className="rs2-pillars">
        <Pillar label="Quality" score={r.quality.score} weight={r.weightsUsed.quality} line={pl.quality}>
          {r.quality.checks.map((c) => (
            <CheckRow key={c.id} tone={COLOR_TONE[c.color]} name={c.label} value={c.display} pts={fmtPts(c)}>
              <b>Rule:</b> {c.rule}{c.note ? <><br /><b>Note:</b> {c.note}</> : null}
            </CheckRow>
          ))}
          <CheckRow tone={r.quality.piotroskiPoints == null ? 'n' : r.quality.piotroski.score >= 7 ? 'g' : r.quality.piotroski.score >= 4 ? 'a' : 'r'}
            name="Piotroski F-Score"
            value={r.quality.piotroski.score == null ? 'n/a' : `${r.quality.piotroski.passed} / ${r.quality.piotroski.run}`}
            pts={r.quality.piotroskiPoints == null ? '—' : r.quality.piotroskiPoints.toFixed(1)}>
            {r.quality.piotroski.tests.map((t) => (
              <div key={t.id}>{t.pass === null ? '–' : t.pass ? '✓' : '✗'} {t.label}</div>
            ))}
          </CheckRow>
          <CheckRow tone={r.quality.altmanZ == null ? 'n' : r.quality.altmanZ < 1.8 ? 'r' : 'g'} name="Altman Z-Score"
            value={r.quality.altmanZ == null ? 'n/a' : r.quality.altmanZ.toFixed(1)} pts="tag">
            Below 1.8 adds a warning tag. Never changes points.
          </CheckRow>
        </Pillar>
        <Pillar label="Value" score={r.value.score} weight={r.weightsUsed.value} line={pl.value}>
          {r.value.parts.map((p) => (
            <CheckRow key={p.id} tone={p.points == null ? 'n' : p.points >= 67 ? 'g' : p.points >= 34 ? 'a' : 'r'}
              name={p.label} value={p.display} pts={p.points ?? '—'}>
              <b>Rule:</b> {p.rule}{p.note ? <><br /><b>Note:</b> {p.note}</> : null}
            </CheckRow>
          ))}
        </Pillar>
        <Pillar label="Upside" score={r.upside.score} weight={r.weightsUsed.upside} line={pl.upside}>
          <CheckRow tone={r.upside.score == null ? 'n' : r.upside.score >= 50 ? 'g' : r.upside.score > 0 ? 'a' : 'r'}
            name="Analyst average target"
            value={r.upside.target ? `$${r.upside.target.value.toFixed(2)} · ${r.upside.pct >= 0 ? '+' : ''}${r.upside.pct}%` : 'waiting on Claude'}
            pts={r.upside.score ?? '—'}>
            <b>Rule:</b> 0% or below = 0 · 50%+ = 100, straight line between.
            {r.upside.target?.source ? <><br /><b>Source:</b> {r.upside.target.source}{r.upside.target.asOf ? `, ${r.upside.target.asOf}` : ''}</> : null}
          </CheckRow>
        </Pillar>
      </div>

      {/* 3. Strengths vs watch-outs */}
      <div className="rs2-two">
        <section className="rs2-card">
          <div className="rs2-h">Strengths</div>
          {good.length === 0 && <div className="rs-muted">Nothing stands out yet.</div>}
          {good.map((x, i) => <div key={i} className="rs2-sw"><i className="g">✓</i><span>{x.text}</span></div>)}
        </section>
        <section className="rs2-card">
          <div className="rs2-h">Watch-outs</div>
          {watch.length === 0 && <div className="rs-muted">No red flags.</div>}
          {watch.map((x, i) => <div key={i} className="rs2-sw"><i className={x.tone === 'r' ? 'r' : 'a'}>{x.tone === 'r' ? '!' : '~'}</i><span>{x.text}</span></div>)}
        </section>
      </div>

      {/* 4. Claude's read */}
      <ClaudeSection claude={claude} save={save} finalizing={finalizing} onRedo={onRedoClaude} />

      {/* 5. Peers — one comparison table */}
      <section className="rs2-card">
        <div className="rs2-h">How it compares · {run.peers?.source === 'claude' ? 'peers picked by Claude' : 'Finnhub auto-peers'}</div>
        {peersUsed.length === 0 ? <div className="rs-muted">None usable — waiting on Claude’s peers.</div> : (
          <div className="rs2-tbl">
            <table>
              <thead><tr><th>Ticker</th><th className="num">Op. P/E</th><th className="rs2-pe-h">P/E range</th><th className="num">Debt/Eq</th><th className="rs2-why">Why it’s a peer</th></tr></thead>
              <tbody>
                <tr className="me"><td>{run.ticker}</td><td className="num">{r.metrics.operatingPe?.toFixed(1) ?? '—'}</td><td className="rs2-pe-h">{pePos(r.metrics.operatingPe) != null && <div className="rs2-pebar"><i className="me" style={{ left: `${pePos(r.metrics.operatingPe)}%` }} /></div>}</td><td className="num">{b.input?.balance?.totalDebt != null && b.input?.balance?.equity > 0 ? (b.input.balance.totalDebt / b.input.balance.equity).toFixed(2) : '—'}</td><td className="rs2-why">this stock</td></tr>
                {[...peersUsed].sort((x, y) => (x.opPe ?? 1e9) - (y.opPe ?? 1e9)).map((p) => (
                  <tr key={p.ticker}><td>{p.ticker}</td><td className="num">{p.opPe != null ? p.opPe.toFixed(1) : '—'}</td><td className="rs2-pe-h">{pePos(p.opPe) != null && <div className="rs2-pebar"><i style={{ left: `${pePos(p.opPe)}%` }} /></div>}</td><td className="num">{p.debtToEquity != null ? p.debtToEquity.toFixed(2) : '—'}</td><td className="rs2-why">{reasons[p.ticker] || ''}</td></tr>
                ))}
                <tr className="med"><td>Peer median</td><td className="num">{peerPeMed != null ? peerPeMed.toFixed(1) : '—'}</td><td className="rs2-pe-h" /><td className="num">{peerDeMed != null ? peerDeMed.toFixed(2) : '—'}</td>
                  <td className="rs2-why">{peerPeMed && r.metrics.operatingPe ? `${run.ticker} is ${Math.abs(Math.round((r.metrics.operatingPe / peerPeMed - 1) * 100))}% ${r.metrics.operatingPe <= peerPeMed ? 'cheaper' : 'pricier'} than peers` : ''}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {(run.peers?.skipped || []).length > 0 && (
          <details className="rs-skipped">
            <summary>{run.peers.skipped.length} skipped</summary>
            {run.peers.skipped.map((x) => <div key={x.ticker}><b>{x.ticker}</b> — {x.reason}</div>)}
          </details>
        )}
      </section>

      {/* 6. Charts side by side */}
      {series && (
        <section className="rs2-card">
          <div className="rs2-h">Last {series.labels.length} {periodWord}</div>
          <div className="rs2-charts">
            <div className="rs2-chart"><div className="rs2-ch">Revenue</div>
              <MiniBarChart ariaLabel="Revenue by period" labels={series.labels} bars={[{ name: 'Revenue', color: '#5B62B8', data: series.revenue }]} /></div>
            <div className="rs2-chart"><div className="rs2-ch">Free cash flow + capex</div>
              <MiniBarChart ariaLabel="Free cash flow by period with capital spending line" labels={series.labels}
                bars={[{ name: 'FCF', color: '#6F7F35', data: series.fcf, allowNegative: true }]}
                line={{ name: 'Capex', color: '#5B62B8', data: series.capex }} /></div>
            <div className="rs2-chart"><div className="rs2-ch">Debt + cash</div>
              <MiniBarChart ariaLabel="Long-term and short-term debt with cash line" labels={series.labels}
                bars={[{ name: 'Long-term', color: '#5B62B8', data: series.debtLongTerm }, { name: 'Short-term', color: '#B0791A', data: series.debtShortTerm }]}
                line={{ name: 'Cash', color: '#262524', data: series.cash, dashed: true }} /></div>
          </div>
        </section>
      )}

      <History save={save} />
      <div className="rs-note">Market cap {money(r.metrics.marketCap)} · operating P/E {r.metrics.operatingPe?.toFixed(1) ?? '—'} · reported P/E {r.metrics.reportedPe?.toFixed(1) ?? '—'}</div>
    </div>
  );
}
