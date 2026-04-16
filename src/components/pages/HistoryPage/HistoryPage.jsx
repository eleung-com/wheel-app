import React, { useState, useRef } from 'react';
import { formatDateDisplay } from '../../../lib/utils';

const CLOSE_TYPES  = new Set(['btc', 'expired', 'assigned', 'rolled']);
const CLOSE_LABEL  = { btc: 'BTC', expired: 'Expired', assigned: 'Assigned', rolled: 'Rolled' };
const CLOSE_COLOR  = { btc: 'var(--bl)', expired: 'var(--g)', assigned: 'var(--a)', rolled: 'var(--pu)' };
const STRAT_LABEL  = { short_put: 'CSP', short_call: 'CC' };
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n) {
  return Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtK(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}k`;
  return `$${Math.round(abs)}`;
}

function fmtDollar(n) {
  return '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcStats(entries) {
  const scoreable = entries.filter(e => e.type !== 'assigned');
  const wins      = scoreable.filter(e => e.pnl != null && e.pnl > 0);
  const totalPnl  = entries.reduce((s, e) => s + (e.pnl ?? 0), 0);
  const totalPrem = entries.reduce((s, e) => s + (e.prem ?? 0) * (e.qty ?? 1) * 100, 0);
  const winRate   = scoreable.length ? Math.round((wins.length / scoreable.length) * 100) : null;
  return { totalPnl, totalPrem, winRate, count: entries.length, wins: wins.length, losses: scoreable.length - wins.length, scoreable: scoreable.length };
}

// ── Full-width premium bar chart ──────────────────────────────────────────────
function PremiumChart({ entries, posMap, yearFilter }) {
  let bars = [];

  if (yearFilter !== 'all') {
    const yr = Number(yearFilter);
    bars = MONTHS_SHORT.map((label, i) => {
      const total = entries
        .filter(e => {
          const ts = posMap[e.linkedId]?.enteredAt || e.enteredAt;
          if (!ts) return false;
          const d = new Date(ts);
          return d.getFullYear() === yr && d.getMonth() === i;
        })
        .reduce((s, e) => s + (e.prem ?? 0) * (e.qty ?? 1) * 100, 0);
      return { label, total, key: `${yr}-${String(i + 1).padStart(2, '0')}` };
    });
  } else {
    const map = {};
    entries.forEach(e => {
      const ts = posMap[e.linkedId]?.enteredAt || e.enteredAt;
      if (!ts) return;
      const d   = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lbl = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      if (!map[key]) map[key] = { label: lbl, total: 0, key };
      map[key].total += (e.prem ?? 0) * (e.qty ?? 1) * 100;
    });
    bars = Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }

  const maxVal     = Math.max(...bars.map(b => b.total), 1);
  const totalPrem  = bars.reduce((s, b) => s + b.total, 0);
  const activeMos  = bars.filter(b => b.total > 0);
  const monthlyAvg = activeMos.length ? totalPrem / activeMos.length : 0;
  const activePct  = bars.length ? Math.round((activeMos.length / bars.length) * 100) : 0;

  const VW = 600, VH = 150;
  const PL = 44, PR = 8, PT = 12, PB = 24;
  const CW = VW - PL - PR;
  const CH = VH - PT - PB;
  const n    = bars.length || 1;
  const colW = CW / n;
  const barW = Math.max(8, Math.min(40, colW * 0.55));

  const toBarX = i     => PL + colW * i + colW / 2 - barW / 2;
  const toBarH = total => total > 0 ? Math.max(3, (total / maxVal) * CH) : 0;
  const toBarY = total => PT + CH - toBarH(total);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    val: f * maxVal, y: PT + CH - f * CH,
  }));

  const metrics = [
    { label: 'Total Premium',  value: fmtDollar(totalPrem),        color: 'var(--tx)', small: true },
    { label: 'Monthly Avg',    value: fmtDollar(monthlyAvg),       color: 'var(--g)',  small: true },
    { label: 'Active Months',  value: `${activePct}%`,             color: 'var(--g)',  small: false },
    { label: 'Trades Closed',  value: String(entries.length),      color: 'var(--bl)', small: false },
  ];

  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '13px 16px 4px', fontSize: 10, color: 'var(--mu)', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>
        Premium by month
      </div>

      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="pmbar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#1fd8a0" />
            <stop offset="100%" stopColor="#1fd8a0" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {yTicks.map(({ val, y }, i) => (
          <g key={i}>
            <line x1={PL} y1={y} x2={PL + CW} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.7" />
            <text x={PL - 5} y={y + 3} textAnchor="end"
              fontSize="8" fill="rgba(255,255,255,0.28)" fontFamily="monospace">
              {fmtK(val)}
            </text>
          </g>
        ))}

        {bars.map((b, i) => {
          const bh = toBarH(b.total);
          const by = toBarY(b.total);
          const bx = toBarX(i);
          const cx = PL + colW * i + colW / 2;
          return (
            <g key={b.key}>
              {b.total > 0 && (
                <rect x={bx} y={by} width={barW} height={bh}
                  fill="url(#pmbar)" rx="2" ry="2" />
              )}
              <text x={cx} y={VH - PB + 14} textAnchor="middle"
                fontSize="8.5" fill="rgba(255,255,255,0.32)" fontFamily="monospace">
                {b.label}
              </text>
            </g>
          );
        })}

        <line x1={PL} y1={PT}      x2={PL}      y2={PT + CH} stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
        <line x1={PL} y1={PT + CH} x2={PL + CW} y2={PT + CH} stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: '1px solid var(--b1)' }}>
        {metrics.map(({ label, value, color, small }, i) => (
          <div key={label} style={{
            padding: '11px 10px',
            textAlign: 'center',
            borderLeft: i > 0 ? '1px solid var(--b1)' : 'none',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: small ? 13 : 16, color, lineHeight: 1.2 }}>{value}</div>
            <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Win-rate donut ────────────────────────────────────────────────────────────
function WinRateDonut({ stats }) {
  const { winRate, wins, losses, scoreable } = stats;

  const VW = 160, VH = 120;
  const cx = VW / 2, cy = 56;
  const r  = 46, strokeW = 15;
  const circumference = 2 * Math.PI * r;
  const winArc  = circumference * ((winRate ?? 0) / 100);
  const lossArc = circumference - winArc;

  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '13px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--mono)' }}>
        Win rate
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', maxWidth: 140, height: 'auto', display: 'block' }}>
          {/* Track */}
          <circle cx={cx} cy={cy} r={r}
            fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeW} />

          {/* Loss arc */}
          {winRate !== null && lossArc > 0 && (
            <g transform={`rotate(-90, ${cx}, ${cy})`}>
              <circle cx={cx} cy={cy} r={r}
                fill="none" stroke="var(--r)" strokeWidth={strokeW - 2}
                strokeDasharray={`${lossArc} ${circumference - lossArc}`}
                strokeDashoffset={-winArc}
                strokeLinecap="round"
              />
            </g>
          )}

          {/* Win arc */}
          {winRate !== null && winArc > 0 && (
            <g transform={`rotate(-90, ${cx}, ${cy})`}>
              <circle cx={cx} cy={cy} r={r}
                fill="none" stroke="var(--g)" strokeWidth={strokeW}
                strokeDasharray={`${winArc} ${circumference - winArc}`}
                strokeLinecap="round"
              />
            </g>
          )}

          {/* Center */}
          <text x={cx} y={cy - 5} textAnchor="middle"
            fontSize="20" fontWeight="700" fill="var(--tx)" fontFamily="monospace">
            {winRate !== null ? `${winRate}%` : '—'}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle"
            fontSize="9" fill="var(--mu)" fontFamily="monospace">
            {scoreable} trades
          </text>
        </svg>

        {/* W / L legend */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, color: 'var(--g)' }}>{wins}</div>
            <div style={{ fontSize: 9, color: 'var(--mu)' }}>Wins</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, color: 'var(--r)' }}>{losses}</div>
            <div style={{ fontSize: 9, color: 'var(--mu)' }}>Losses</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Capture efficiency scatter ────────────────────────────────────────────────
function CaptureEfficiencyChart({ entries, posMap }) {
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  const points = [];
  entries.forEach(e => {
    if (e.type === 'assigned') return;
    if (e.pnl == null || !e.prem) return;
    const openTs = posMap[e.linkedId]?.enteredAt;
    if (!openTs) return;
    const closeTs  = e.enteredAt;
    const expiryTs = e.expiry ? new Date(e.expiry + 'T16:00:00').getTime() : null;
    if (!expiryTs) return;
    const totalTime = expiryTs - openTs;
    if (totalTime <= 0) return;
    const timePct        = Math.max(0, Math.min(110, Math.round(((closeTs - openTs) / totalTime) * 100)));
    const maxPrem        = e.prem * (e.qty ?? 1) * 100;
    const premCapturePct = maxPrem > 0 ? Math.round((e.pnl / maxPrem) * 100) : null;
    if (premCapturePct === null) return;
    points.push({ timePct, premCapturePct, ticker: e.ticker, type: e.type, pnl: e.pnl, prem: e.prem, qty: e.qty ?? 1 });
  });

  if (!points.length) return null;

  const W = 300, H = 143;
  const PL = 34, PB = 22, PT = 10, PR = 14;
  const CW = W - PL - PR;
  const CH = H - PT - PB;
  const Y_MIN = -25, Y_MAX = 125;

  const toX = pct => PL + (Math.max(0, Math.min(100, pct)) / 100) * CW;
  const toY = pct => PT + CH - ((Math.max(Y_MIN, Math.min(Y_MAX, pct)) - Y_MIN) / (Y_MAX - Y_MIN)) * CH;

  function handleEnter(e, point) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, point });
  }

  return (
    <div ref={containerRef} style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '13px 13px 10px', position: 'relative', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'var(--mono)' }}>
        Capture efficiency
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setTooltip(null)}>
        <defs>
          <clipPath id="ce-clip">
            <rect x={PL} y={PT} width={CW} height={CH} />
          </clipPath>
        </defs>

        {[0, 25, 50, 75, 100].map(v => (
          <line key={`gy${v}`} x1={PL} y1={toY(v)} x2={PL + CW} y2={toY(v)} stroke="var(--b1)" strokeWidth="0.5" />
        ))}
        {[0, 25, 50, 75, 100].map(v => (
          <line key={`gx${v}`} x1={toX(v)} y1={PT} x2={toX(v)} y2={PT + CH} stroke="var(--b1)" strokeWidth="0.5" />
        ))}
        <line x1={PL} y1={toY(0)} x2={PL + CW} y2={toY(0)} stroke="var(--mu)" strokeWidth="0.8" opacity="0.5" />
        <line x1={toX(0)} y1={toY(0)} x2={toX(100)} y2={toY(100)}
          stroke="var(--mu)" strokeWidth="1.2" strokeDasharray="5,4" opacity="0.6" />
        <line x1={PL} y1={PT}      x2={PL}      y2={PT + CH} stroke="var(--b1)" strokeWidth="1" />
        <line x1={PL} y1={PT + CH} x2={PL + CW} y2={PT + CH} stroke="var(--b1)" strokeWidth="1" />

        <g clipPath="url(#ce-clip)">
          {points.map((p, i) => (
            <circle key={i}
              cx={toX(p.timePct)} cy={toY(p.premCapturePct)}
              r={2.5}
              fill={p.premCapturePct >= 0 ? 'var(--g)' : 'var(--r)'}
              fillOpacity={0.8}
              stroke={p.premCapturePct >= 0 ? 'var(--g)' : 'var(--r)'}
              strokeWidth={0.5}
              style={{ cursor: 'pointer' }}
              onMouseEnter={ev => handleEnter(ev, p)}
            />
          ))}
        </g>

        {[0, 50, 100].map(v => (
          <text key={v} x={PL - 5} y={toY(v) + 3} textAnchor="end"
            fontSize="7" fill="var(--mu)" fontFamily="var(--mono)">{v}%</text>
        ))}
        {[0, 50, 100].map(v => (
          <text key={v} x={toX(v)} y={PT + CH + 10} textAnchor="middle"
            fontSize="7" fill="var(--mu)" fontFamily="var(--mono)">{v}%</text>
        ))}
        <text x={PL + CW / 2} y={H - 1} textAnchor="middle" fontSize="7" fill="var(--mu)" fontFamily="var(--mono)">
          Time in trade
        </text>
        <text transform={`translate(7, ${PT + CH / 2}) rotate(-90)`} textAnchor="middle"
          fontSize="7" fill="var(--mu)" fontFamily="var(--mono)">
          Premium captured
        </text>
      </svg>

      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x + 10,
          top: tooltip.y - 10,
          background: 'var(--s2)',
          border: '1px solid var(--b1)',
          borderRadius: 6,
          padding: '6px 9px',
          pointerEvents: 'none',
          zIndex: 10,
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, marginBottom: 3 }}>
            {tooltip.point.ticker}
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 400, color: 'var(--mu)', textTransform: 'uppercase' }}>
              {CLOSE_LABEL[tooltip.point.type] || tooltip.point.type}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
            Time: <span style={{ color: 'var(--tx)' }}>{tooltip.point.timePct}%</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
            Captured: <span style={{ color: tooltip.point.premCapturePct >= 0 ? 'var(--g)' : 'var(--r)' }}>
              {tooltip.point.premCapturePct}%
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
            P&amp;L: <span style={{ color: tooltip.point.pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
              {tooltip.point.pnl >= 0 ? '+' : '-'}${fmt(tooltip.point.pnl)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trade detail modal ────────────────────────────────────────────────────────
function TradeDetailModal({ entry, posMap, onClose }) {
  const maxPrem    = (entry.prem ?? 0) * (entry.qty ?? 1) * 100;
  const pnl        = entry.pnl ?? 0;
  const capturePct = maxPrem > 0 ? Math.round((pnl / maxPrem) * 100) : null;
  const premFill   = maxPrem > 0 ? Math.max(0, Math.min(100, (pnl / maxPrem) * 100)) : 0;

  // Dates
  const openEntry  = posMap[entry.linkedId];
  const openTs     = openEntry?.enteredAt || null;
  const closeTs    = entry.enteredAt || null;
  const expiryTs   = entry.expiry ? new Date(entry.expiry + 'T16:00:00').getTime() : null;

  const openDate  = openTs  ? formatDateDisplay(new Date(openTs).toISOString().slice(0,10))  : '—';
  const closeDate = closeTs ? formatDateDisplay(new Date(closeTs).toISOString().slice(0,10)) : '—';

  // % of days in trade
  let daysFill = null;
  let daysLabel = '—';
  if (openTs && expiryTs && closeTs) {
    const totalDays = Math.max(1, Math.round((expiryTs - openTs) / 86400000));
    const elapsed   = Math.round((closeTs  - openTs) / 86400000);
    daysFill  = Math.max(0, Math.min(100, Math.round((elapsed / totalDays) * 100)));
    daysLabel = `${elapsed}d of ${totalDays}d`;
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '0 16px' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--s2)', border: '1px solid var(--b1)', borderRadius: 14, width: '100%', maxWidth: 420, padding: '20px 20px 24px', boxSizing: 'border-box' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 20 }}>{entry.ticker}</span>
          {entry.posType && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: entry.posType === 'short_put' ? 'var(--gd)' : 'var(--ad)', color: entry.posType === 'short_put' ? 'var(--g)' : 'var(--a)' }}>
              {STRAT_LABEL[entry.posType] || entry.posType}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: 'var(--s1)', border: '1px solid var(--b1)', color: CLOSE_COLOR[entry.type] || 'var(--mu2)' }}>
            {CLOSE_LABEL[entry.type] || entry.type}
          </span>
        </div>

        {/* Date grid: opened · expiry · closed */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7, marginBottom: 14 }}>
          {[
            { label: 'Opened', value: openDate },
            { label: 'Expiry', value: formatDateDisplay(entry.expiry) },
            { label: 'Closed', value: closeDate },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--s1)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--mu)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Days-in-trade bar */}
        {daysFill !== null && (
          <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--mu)', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Time in trade</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--bl)' }}>{daysFill}% · {daysLabel}</span>
            </div>
            <div style={{ height: 7, background: 'var(--b1)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${daysFill}%`, background: 'linear-gradient(90deg, var(--bl), rgba(79,140,255,0.5))', borderRadius: 4, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' }} />
            </div>
          </div>
        )}

        {/* Premium breakdown bar */}
        <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--mu)', marginBottom: 3 }}>Collected</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: 'var(--tx)' }}>{fmtDollar(maxPrem)}</div>
              {entry.qty > 1 && (
                <div style={{ fontSize: 9, color: 'var(--mu)', marginTop: 2 }}>${Number(entry.prem).toFixed(2)} × {entry.qty} contracts</div>
              )}
            </div>

            {capturePct !== null && (
              <div style={{ textAlign: 'center', padding: '0 10px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 20, color: pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>{capturePct}%</div>
                <div style={{ fontSize: 9, color: 'var(--mu)' }}>captured</div>
              </div>
            )}

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: 'var(--mu)', marginBottom: 3 }}>Kept</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
                {pnl >= 0 ? '' : '−'}{fmtDollar(Math.abs(pnl))}
              </div>
              {entry.closePrice != null && entry.type === 'btc' && (
                <div style={{ fontSize: 9, color: 'var(--mu)', marginTop: 2 }}>closed @ ${Number(entry.closePrice).toFixed(2)}</div>
              )}
            </div>
          </div>

          <div style={{ height: 8, background: 'var(--b1)', borderRadius: 5, overflow: 'hidden', marginBottom: 5 }}>
            <div style={{ height: '100%', width: `${premFill}%`, background: pnl >= 0 ? 'linear-gradient(90deg, #1fd8a0, rgba(31,216,160,0.55))' : 'var(--r)', borderRadius: 5, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 8, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>$0</span>
            <span style={{ fontSize: 8, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>{fmtDollar(maxPrem)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--mu)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: color || 'var(--tx)' }}>
        {value}
      </span>
    </div>
  );
}

export default function HistoryPage({ positions }) {
  const [yearFilter,    setYearFilter]    = useState('all');
  const [stratFilter,   setStratFilter]   = useState('all');
  const [selectedTrade, setSelectedTrade] = useState(null);

  const posMap = {};
  positions.forEach(p => { posMap[p.id] = p; });

  const allEntries = positions
    .filter(p => CLOSE_TYPES.has(p.type))
    .sort((a, b) => (b.enteredAt || 0) - (a.enteredAt || 0));

  if (!allEntries.length) {
    return (
      <div className="empty">
        <div className="empty-icon">📈</div>
        <div className="empty-title">No closed trades yet</div>
        <div className="empty-sub">Your trade history will appear here after you close a position.</div>
      </div>
    );
  }

  const years = [...new Set(allEntries.map(e => {
    const ts = posMap[e.linkedId]?.enteredAt || e.enteredAt;
    return ts ? new Date(ts).getFullYear() : null;
  }).filter(Boolean))].sort((a, b) => b - a);

  const yearFiltered = yearFilter === 'all'
    ? allEntries
    : allEntries.filter(e => {
        const ts = posMap[e.linkedId]?.enteredAt || e.enteredAt;
        return ts && new Date(ts).getFullYear() === Number(yearFilter);
      });

  const filtered = stratFilter === 'all'
    ? yearFiltered
    : yearFiltered.filter(e => e.posType === stratFilter);

  const all = calcStats(yearFiltered);
  const csp = calcStats(yearFiltered.filter(e => e.posType === 'short_put'));
  const cc  = calcStats(yearFiltered.filter(e => e.posType === 'short_call'));

  return (
    <div>
      {/* ── Year filter ───────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <span style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>Year</span>
        {['all', ...years].map(y => (
          <button key={y} onClick={() => setYearFilter(String(y))} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
            border: `1px solid ${yearFilter === String(y) ? 'var(--bl)' : 'var(--b1)'}`,
            background: yearFilter === String(y) ? 'rgba(79,140,255,0.12)' : 'var(--s2)',
            color: yearFilter === String(y) ? 'var(--bl)' : 'var(--mu2)',
            fontFamily: 'var(--mono)',
          }}>
            {y === 'all' ? 'All' : y}
          </button>
        ))}
      </div>

      {/* ── Full-width premium chart ──────────────────────────── */}
      <PremiumChart entries={yearFiltered} posMap={posMap} yearFilter={yearFilter} />

      {/* ── Win rate + Capture efficiency ─────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <WinRateDonut stats={all} />
        </div>
        <div style={{ flex: 2, minWidth: 0 }}>
          <CaptureEfficiencyChart entries={yearFiltered} posMap={posMap} />
        </div>
      </div>

      {/* ── Strategy breakdown ────────────────────────────────── */}
      <div className="slabel">By strategy</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Cash-Secured Put', abbr: 'CSP', stats: csp },
          { label: 'Covered Call',     abbr: 'CC',  stats: cc  },
        ].map(({ label, abbr, stats }) => (
          <div key={abbr} style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', padding: '12px 13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>{abbr}</span>
              <span style={{ fontSize: 10, color: 'var(--mu)' }}>{label}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <StatRow label="Trades"   value={stats.count} />
              <StatRow
                label="Win rate"
                value={stats.winRate !== null ? `${stats.winRate}%` : '—'}
                color={stats.winRate >= 50 ? 'var(--g)' : 'var(--a)'}
              />
              <StatRow
                label="P&L"
                value={`${stats.totalPnl >= 0 ? '+' : '-'}$${fmt(stats.totalPnl)}`}
                color={stats.totalPnl >= 0 ? 'var(--g)' : 'var(--r)'}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Trade log ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="slabel" style={{ margin: 0 }}>Trade log</div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[
            { val: 'all',        label: 'All' },
            { val: 'short_put',  label: 'CSP' },
            { val: 'short_call', label: 'CC'  },
          ].map(f => (
            <button key={f.val} onClick={() => setStratFilter(f.val)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 10, cursor: 'pointer',
              border: `1px solid ${stratFilter === f.val ? 'var(--g)' : 'var(--b1)'}`,
              background: stratFilter === f.val ? 'var(--gd)' : 'var(--s2)',
              color: stratFilter === f.val ? 'var(--g)' : 'var(--mu2)',
              fontFamily: 'var(--sans)',
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 'var(--rr)', overflow: 'hidden', marginBottom: 24 }}>
        <div className="pos-table-wrap">
          <table className="pos-table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Strat</th>
                <th>Close</th>
                <th>Strike</th>
                <th>Expiry</th>
                <th>Prem</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--mu)', padding: 20, fontSize: 12 }}>
                    No trades
                  </td>
                </tr>
              )}
              {filtered.map(e => (
                <tr key={e.id} onClick={() => setSelectedTrade(e)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13 }}>{e.ticker}</div>
                    <div style={{ fontSize: 9, color: 'var(--mu)', marginTop: 1 }}>
                      {e.enteredAt
                        ? formatDateDisplay(new Date(e.enteredAt).toISOString().slice(0, 10))
                        : '—'}
                    </div>
                  </td>
                  <td>
                    {e.posType ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20,
                        background: e.posType === 'short_put' ? 'var(--gd)' : 'var(--ad)',
                        color: e.posType === 'short_put' ? 'var(--g)' : 'var(--a)',
                      }}>
                        {STRAT_LABEL[e.posType] || e.posType}
                      </span>
                    ) : <span style={{ color: 'var(--mu)' }}>—</span>}
                  </td>
                  <td style={{ color: CLOSE_COLOR[e.type] || 'var(--mu2)', fontSize: 11 }}>
                    {CLOSE_LABEL[e.type] || e.type}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--bl)' }}>
                    {e.strike ? `$${e.strike}` : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {formatDateDisplay(e.expiry)}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--g)', fontSize: 12 }}>
                    {e.prem != null ? `$${Number(e.prem).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: e.pnl != null ? (e.pnl >= 0 ? 'var(--g)' : 'var(--r)') : 'var(--mu)' }}>
                    {e.pnl != null
                      ? `${e.pnl >= 0 ? '+' : '-'}$${fmt(e.pnl)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTrade && (
        <TradeDetailModal
          entry={selectedTrade}
          posMap={posMap}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
}
