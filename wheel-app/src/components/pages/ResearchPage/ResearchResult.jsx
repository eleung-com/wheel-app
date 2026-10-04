import React, { useState } from 'react';
import MiniBarChart from './MiniBarChart';
import RejectModal from './RejectModal';
import { plainLines, chartSeries, money } from '../../../lib/research/explain';
import { rejectedBefore, runStamp, claudeState, CLAUDE_TIMEOUT_MIN, scoreAllowsPriority } from '../../../lib/research/runRecord';

// Result screen for one "Run a stock" (layout from the approved mockup,
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
    body = (
      <>
        {finalizing && <div className="rs-cl-wait" role="status"><span className="spinner a" /> Re-scoring with Claude’s peers…</div>}
        <div className="rs-cl-facts">
          <div><span>Moat</span><b>{row.moatType || '—'}{row.moatStrength ? ` · ${row.moatStrength}` : ''}</b></div>
          <div><span>Peers</span><b>{row.peersClaude || '—'}</b></div>
          <div><span>Beat rate</span><b>{beat}</b></div>
          <div><span>One-time items</span><b>{row.oneTimeItems ? 'Yes — see below' : 'None flagged'}</b></div>
        </div>
        {row.peerReasons && <div className="rs-cl-reasons">{row.peerReasons}</div>}
        <div className="rs-cl-body">
          {(claude.writeup || []).map((b, i) => (
            b.type === 'heading' ? <div key={i} className="rs-cl-h">{b.text}</div>
              : b.type === 'bullet' ? <div key={i} className="rs-cl-li">• {b.text}</div>
                : <p key={i}>{b.text}</p>
          ))}
          {!claude.writeup?.length && <div className="rs-muted">Loading the write-up…</div>}
        </div>
        <div className="rs-cl-foot">
          Written {runStamp(row.claudeWritten)}
          {row.claudeSession && <> · <a href={row.claudeSession} target="_blank" rel="noreferrer">session</a></>}
          {' · '}<button type="button" className="rs-link" onClick={redo} disabled={busy}>{busy ? 'Starting…' : 'Redo Claude research'}</button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="slabel">Claude’s read</div>
      <div className="rs-claude">{body}</div>
    </>
  );
}

export default function ResearchResult({ run, onBack, onRerun, running, save, onRetrySave, onDecide, claude, finalizing, onRedoClaude }) {
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
  const chip = (label, score, weight) => {
    const tone = score == null ? 'n' : score >= 75 ? 'g' : score >= 55 ? 'a' : 'r';
    return (
      <div className="rs-chip">
        <div className="rs-chip-l">{label}</div>
        <div className="rs-chip-v" style={{ color: TONE_VAR[tone] }}>{score ?? 'n/a'}</div>
        <div className="rs-chip-w">{weight != null ? `× ${Math.round(weight * 100)}%` : 'left out'}</div>
        <div className="rs-meter"><i style={{ width: `${score ?? 0}%`, background: TONE_VAR[tone] }} /></div>
      </div>
    );
  };

  return (
    <div>
      <button type="button" className="rs-back" onClick={onBack}>‹ Research</button>

      {/* Header: verdict first — this is what gets read on a phone */}
      <div className="rs-head" style={{ '--vt': TONE_VAR[vt] }}>
        <div className="rs-top">
          <div>
            <div className="rs-tk">{run.ticker}</div>
            <div className="rs-name">{name}</div>
          </div>
          <div className="rs-price">{price != null ? `$${price.toFixed(2)}` : '—'}</div>
        </div>
        <div className="rs-vrow">
          <div>
            <div className="rs-vlabel">Investment verdict</div>
            <div className="rs-verdict" style={{ color: TONE_VAR[vt] }}>{r.verdict}</div>
          </div>
          <div className="rs-big" style={{ color: TONE_VAR[vt] }}>{r.investmentScore ?? '—'}<small>of 100</small></div>
        </div>
        {r.investmentScore != null && (
          <>
            <div className="rs-scale" aria-hidden="true"><i style={{ left: `${r.investmentScore}%` }} /></div>
            <div className="rs-scale-l"><span>Not worth it</span><span>55</span><span>75</span><span>100</span></div>
          </>
        )}
        <div className="rs-meta">
          <span className={`stbdg ${r.scoreType === 'Final' ? 'final' : 'prelim'}`}>
            {r.scoreType === 'Final' ? 'Final' : 'Preliminary · auto peers'}
          </span>
          <span>Run {new Date(run.ranAt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' })}</span>
          <span>· rules {r.version}</span>
          {latestQ && <span>· SEC data to {latestQ}</span>}
        </div>
        <div className="rs-sub">{r.verdictReason}</div>
        <SaveStatus save={save} onRetry={onRetrySave} />
      </div>
      <RejectedBanner row={prevReject} />

      <div className="rs-chips">
        {chip('Quality', r.quality.score, r.weightsUsed.quality)}
        {chip('Value', r.value.score, r.weightsUsed.value)}
        {chip('Upside', r.upside.score, r.weightsUsed.upside)}
      </div>

      <div className="slabel">In plain English</div>
      <div className="rs-lines">
        {lines.map((l, i) => (
          <div key={i} className="rs-line"><span className={`rs-ld ${l.tone}`} aria-hidden="true" />{l.text}</div>
        ))}
      </div>

      {tagsShown.length > 0 && (
        <>
          <div className="slabel">Flags</div>
          <div className="rs-pills">
            {tagsShown.map((t, i) => <span key={`${t.code}-${i}`} className="cpill warn">{t.text}</span>)}
          </div>
        </>
      )}

      <div className="slabel">Checks · tap a row for the rule</div>
      <div className="rs-checks">
        <div className="rs-grp"><span>Quality · {r.quality.score ?? 'n/a'}</span><span>pts</span></div>
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

        <div className="rs-grp"><span>Value · {r.value.score ?? 'n/a'}</span><span>pts</span></div>
        {r.value.parts.map((p) => (
          <CheckRow key={p.id} tone={p.points == null ? 'n' : p.points === 100 ? 'g' : p.points === 50 ? 'a' : 'r'}
            name={p.label} value={p.display} pts={p.points ?? '—'}>
            <b>Rule:</b> {p.rule}{p.note ? <><br /><b>Note:</b> {p.note}</> : null}
          </CheckRow>
        ))}

        <div className="rs-grp"><span>Upside · {r.upside.score ?? 'n/a'}</span><span>pts</span></div>
        <CheckRow tone={r.upside.score == null ? 'n' : r.upside.score >= 50 ? 'g' : r.upside.score > 0 ? 'a' : 'r'}
          name="Analyst average target"
          value={r.upside.target ? `$${r.upside.target.value.toFixed(2)} · ${r.upside.pct >= 0 ? '+' : ''}${r.upside.pct}%` : 'waiting on Claude'}
          pts={r.upside.score ?? '—'}>
          <b>Rule:</b> 0% or below = 0 · 30%+ = 100, straight line between.
          {r.upside.target?.source ? <><br /><b>Source:</b> {r.upside.target.source}{r.upside.target.asOf ? `, ${r.upside.target.asOf}` : ''}</> : null}
        </CheckRow>
      </div>

      <div className="slabel">Peers used ({run.peers?.source === 'claude' ? 'Claude' : 'Finnhub auto-peers'})</div>
      <div className="rs-peers">
        {(run.peers?.used || []).length === 0 && <div className="rs-muted">None usable — waiting on Claude’s peers.</div>}
        {(run.peers?.used || []).map((p) => (
          <div key={p.ticker} className="rs-peer">
            <b>{p.ticker}</b>
            <span>P/E {p.opPe != null ? p.opPe.toFixed(1) : '—'}</span>
            <span>D/E {p.debtToEquity != null ? p.debtToEquity.toFixed(2) : '—'}</span>
          </div>
        ))}
        {(run.peers?.skipped || []).length > 0 && (
          <details className="rs-skipped">
            <summary>{run.peers.skipped.length} skipped</summary>
            {run.peers.skipped.map((s) => <div key={s.ticker}><b>{s.ticker}</b> — {s.reason}</div>)}
          </details>
        )}
      </div>

      <ClaudeSection claude={claude} save={save} finalizing={finalizing} onRedo={onRedoClaude} />

      {series && (
        <>
          <div className="slabel">Charts · last {series.labels.length} {periodWord}</div>
          <details className="rs-chartbox" open>
            <summary>Revenue</summary>
            <MiniBarChart ariaLabel="Revenue by period" labels={series.labels}
              bars={[{ name: 'Revenue', color: '#5B62B8', data: series.revenue }]} />
          </details>
          <details className="rs-chartbox">
            <summary>Free cash flow + capex</summary>
            <MiniBarChart ariaLabel="Free cash flow by period with capital spending line" labels={series.labels}
              bars={[{ name: 'FCF', color: '#6F7F35', data: series.fcf, allowNegative: true }]}
              line={{ name: 'Capex', color: '#5B62B8', data: series.capex }} />
          </details>
          <details className="rs-chartbox">
            <summary>Debt + cash</summary>
            <MiniBarChart ariaLabel="Long-term and short-term debt with cash line" labels={series.labels}
              bars={[
                { name: 'Long-term', color: '#5B62B8', data: series.debtLongTerm },
                { name: 'Short-term', color: '#B0791A', data: series.debtShortTerm },
              ]}
              line={{ name: 'Cash', color: '#262524', data: series.cash, dashed: true }} />
          </details>
        </>
      )}

      <History save={save} />
      {actions}
      <div className="rs-note">Market cap {money(r.metrics.marketCap)} · operating P/E {r.metrics.operatingPe?.toFixed(1) ?? '—'} · reported P/E {r.metrics.reportedPe?.toFixed(1) ?? '—'}</div>
    </div>
  );
}
