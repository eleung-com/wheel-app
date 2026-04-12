import React, { useMemo } from 'react';
import { useAppContext } from '../store';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { TrendingUp, Target, CalendarDays, BookOpen, Activity } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function InsightsPage() {
  const { history, positions } = useAppContext();

  // 1. Calculate Open Theta Income (approximate daily theta from active short options)
  // Since we don't have exact Greeks, we use premium / dte as a very rough straight-line theta
  const openTheta = useMemo(() => {
    return positions.filter(p => (p.type === 'short_put' || p.type === 'short_call') && p.expiry).reduce((acc, p) => {
      const dte = Math.max(1, Math.round((new Date(p.expiry + 'T12:00:00') - new Date()) / 86400000));
      const curVal = p.curPrem !== undefined && p.curPrem !== null ? p.curPrem : p.prem;
      if (curVal !== null && curVal !== undefined) {
        return acc + ((curVal * p.qty * 100) / dte);
      }
      return acc;
    }, 0);
  }, [positions]);

  // 2. Aggregate History P&L
  const pnlData = useMemo(() => {
    const closed = history || [];
    let totalPnl = 0;
    let wins = 0;
    const stratBreakdown = { shares: 0, short_put: 0, short_call: 0 };
    const monthlyMap = {};

    closed.forEach(trade => {
      const net = trade.pnl || 0;
      totalPnl += net;
      if (net > 0) wins++;
      if (stratBreakdown[trade.type] !== undefined) stratBreakdown[trade.type] += net;
      
      // Group by month
      if (trade.closedAt) {
        const d = new Date(trade.closedAt);
        const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap[mKey] = (monthlyMap[mKey] || 0) + net;
      }
    });

    const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : 0;

    // Monthly Chart Data formatting
    const sortedMonths = Object.keys(monthlyMap).sort();
    const chartLabels = sortedMonths.map(m => {
      const [y, mStr] = m.split('-');
      const d = new Date(y, parseInt(mStr) - 1);
      return d.toLocaleString('default', { month: 'short', year: '2-digit' });
    });
    const chartDataValues = sortedMonths.map(m => monthlyMap[m]);

    return { totalPnl, winRate, trades: closed.length, stratBreakdown, chartLabels, chartDataValues };
  }, [history]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => '$' + ctx.raw.toFixed(2) }
      }
    },
    scales: {
      y: { ticks: { callback: v => '$' + v } }
    }
  };

  const cData = {
    labels: pnlData.chartLabels,
    datasets: [{
      label: 'Realized P&L',
      data: pnlData.chartDataValues,
      backgroundColor: pnlData.chartDataValues.map(v => v >= 0 ? '#4caf50' : '#ff5252'),
      borderRadius: 4,
    }],
  };

  return (
    <div style={{ padding: '15px', color: 'var(--fg)', paddingBottom: '80px' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '15px' }}>
        {/* Total P&L Card */}
        <div style={{ background: 'var(--bg2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--mu)', fontSize: '12px', marginBottom: '8px' }}>
            <TrendingUp size={14} color="var(--g)" /> Total Realized
          </div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: pnlData.totalPnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
            {pnlData.totalPnl >= 0 ? '+' : ''}${pnlData.totalPnl.toFixed(2)}
          </div>
        </div>

        {/* Win Rate Card */}
        <div style={{ background: 'var(--bg2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--mu)', fontSize: '12px', marginBottom: '8px' }}>
            <Target size={14} color="var(--b)" /> Win Rate
          </div>
          <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
            {pnlData.winRate}%
          </div>
          <div style={{ fontSize: '10px', color: 'var(--mu)', marginTop: '2px' }}>{pnlData.trades} Total Trades</div>
        </div>
      </div>

      {/* Theta Decay Tracker */}
      <div style={{ background: 'var(--bg2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '15px' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--mu)', fontSize: '12px', marginBottom: '8px' }}>
            <Activity size={14} color="var(--p)" /> Est. Daily Theta Decay
         </div>
         <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--p)' }}>
            +${openTheta.toFixed(2)} <span style={{ fontSize: '12px', color: 'var(--mu)', fontWeight: 'normal' }}>/ day</span>
         </div>
         <div style={{ fontSize: '10px', color: 'var(--mu)', marginTop: '4px' }}>Approximate theta decay captured per day across active short options.</div>
      </div>

      {/* Monthly P&L Chart */}
      <div style={{ background: 'var(--bg2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--mu)', fontSize: '12px', marginBottom: '12px' }}>
          <CalendarDays size={14} /> Monthly Income
        </div>
        <div style={{ height: '180px', width: '100%' }}>
          {pnlData.chartLabels.length > 0 ? (
            <Bar options={chartOptions} data={cData} />
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mu2)', fontSize: '12px' }}>
              No closed trades logged yet.
            </div>
          )}
        </div>
      </div>

      {/* Trade Journal & Strategy List */}
      <div style={{ background: 'var(--bg2)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--mu)', fontSize: '12px' }}>
             <BookOpen size={14} /> Trade Journal
          </div>
          <div style={{ fontSize: '11px', color: 'var(--b)' }}>{pnlData.trades} closed</div>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {history && history.length > 0 ? history.map((trade, idx) => (
             <div key={idx} style={{ padding: '10px', backgroundColor: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                 <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{trade.ticker} <span style={{ fontSize: '10px', fontWeight: 'normal', color: 'var(--mu)', marginLeft:'4px' }}>{trade.type}</span></div>
                 <div style={{ fontSize: '12px', fontWeight: 'bold', color: trade.pnl >= 0 ? 'var(--g)' : 'var(--r)' }}>
                   {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                 </div>
               </div>
               {trade.journalNotes && (
                 <div style={{ fontSize: '11px', color: 'var(--mu)', fontStyle: 'italic', marginTop: '6px' }}>
                   "{trade.journalNotes}"
                 </div>
               )}
               <div style={{ fontSize: '9px', color: 'var(--mu)', marginTop: '6px' }}>
                 Closed: {new Date(trade.closedAt).toLocaleDateString()}
               </div>
             </div>
          )) : (
             <div style={{ padding: '15px', textAlign: 'center', color: 'var(--mu)', fontSize: '12px' }}>
               No journal history. Start tracking closed trades to see them here!
             </div>
          )}
        </div>
      </div>

    </div>
  );
}
