import React from 'react';
import { Actions } from './ResearchResult';
import { runStamp } from '../../../lib/research/runRecord';
import { writeupTabs } from '../../../lib/research/resultView';

// Part 9C: a past run whose full data isn't on this device (it ran on another
// one, or was cleared). Shows what Notion saved — no fetching, no re-run.
// Charts and peer details need fresh data: "Re-run with fresh data".
const TONE = { 'Worth investing': 'var(--g)', Maybe: 'var(--a)', 'Not worth it': 'var(--r)' };
const toneOf = (s) => (s == null ? 'var(--mu)' : s >= 75 ? 'var(--g)' : s >= 55 ? 'var(--a)' : 'var(--r)');

export default function SavedSummary({ row, writeup, loading, save, onDecide, onRerun, onFinish, onBack, running }) {
  const tabs = writeupTabs(writeup || []);
  const vt = TONE[row.verdict] || 'var(--mu)';
  return (
    <div className="rs2">
      <button type="button" className="rs-back" onClick={onBack}>‹ Research</button>
      <section className="rs2-card">
        <div className="rs2-hero-grid">
          <div>
            <div className="rs2-id"><span className="rs-tk">{row.ticker}</span>{row.price != null && <span className="rs2-px">${Number(row.price).toFixed(2)}</span>}</div>
            <div className="rs-meta">
              <span className={`stbdg ${row.scoreType === 'Final' ? 'final' : 'prelim'}`}>{row.scoreType === 'Final' ? 'Final' : 'Preliminary'}</span>
              <span className="stbdg rs2-saved">Saved run · not re-run</span>
              <span>{runStamp(row.runAt)}</span>{row.version && <span>· rules {row.version}</span>}
            </div>
          </div>
          <div className="rs2-vbox">
            <div className="rs2-dial" style={{ '--p': row.investmentScore ?? 0, '--c': vt }}><div><b>{row.investmentScore ?? '—'}</b><small>of 100</small></div></div>
            <div className="rs2-vtext"><div className="rs-vlabel">Verdict</div><div className="rs-verdict" style={{ color: vt }}>{row.verdict || '—'}</div></div>
          </div>
          <div className="rs2-sum-scores">
            {[['Quality', row.quality], ['Value', row.value], ['Upside', row.upside]].map(([l, v]) => (
              <div key={l}><span>{l}</span><b style={{ color: toneOf(v) }}>{v ?? 'n/a'}</b></div>
            ))}
          </div>
        </div>
        <div className="rs2-note">
          This device doesn’t have this run’s full data (it probably ran on another device), so charts, checks and peers aren’t shown.
          {' '}<button type="button" className="rs-link" onClick={onRerun} disabled={running}>Re-run with fresh data</button> to see them.
          {onFinish && <> Claude’s research is in — <button type="button" className="rs-link" onClick={onFinish} disabled={running}>update to the Final score</button>.</>}
        </div>
        <div className="rs2-acts">
          <Actions ticker={row.ticker} save={save} current={row} verdict={row.verdict || 'No score'} onDecide={onDecide} onRerun={onRerun} running={running} />
        </div>
      </section>
      <section className="rs2-card">
        <div className="rs2-h">Claude’s read</div>
        {loading && <div className="rs-muted">Loading the write-up…</div>}
        {!loading && tabs.length === 0 && <div className="rs-muted">No Claude write-up on this run.</div>}
        {tabs.map((t) => (
          <div key={t.title} className="rs2-sum-sec">
            <div className="rs2-lead">{t.title}</div>
            {t.blocks.map((b, i) => (b.type === 'bullet' ? <div key={i} className="rs2-li">{b.text}</div> : <p key={i}>{b.text}</p>))}
          </div>
        ))}
      </section>
    </div>
  );
}
