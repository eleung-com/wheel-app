import { useState, useEffect } from 'react'
import './index.css'
import InsightsPage from './components/InsightsPage'
import PositionsPage from './components/PositionsPage'
import WatchlistPage from './components/WatchlistPage'

function App() {
  const [activeTab, setActiveTab] = useState('signals')

  return (
    <>
      <div className="hdr">
        <div>
          <div className="logo">wheel<em>.</em>desk</div>
          <div className="hdr-sub">
            <div className="mkt">
              <div className="dot" id="mkt-dot"></div><span id="mkt-txt">Checking…</span>
            </div>
            <div className="sync-status idle">⬡ synced</div>
          </div>
        </div>
        <div className="hdr-r">
          <div className="ibtn b">⇩</div>
          <div className="ibtn g">↻</div>
        </div>
      </div>

      <div className="nav">
        <div className={`tab ${activeTab === 'signals' ? 'active' : ''}`} onClick={() => setActiveTab('signals')}>Signals <span className="bdg g">0</span></div>
        <div className={`tab ${activeTab === 'positions' ? 'active' : ''}`} onClick={() => setActiveTab('positions')}>Positions <span className="bdg b">0</span></div>
        <div className={`tab ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setActiveTab('watchlist')}>Watchlist <span className="bdg p">0</span></div>
        <div className={`tab ${activeTab === 'insights' ? 'active' : ''}`} onClick={() => setActiveTab('insights')}>Insights</div>
        <div className={`tab ${activeTab === 'criteria' ? 'active' : ''}`} onClick={() => setActiveTab('criteria')}>Criteria</div>
      </div>

      <div className="page active">
        {activeTab === 'signals' && <div className="empty"><div className="empty-title">Loading Signals...</div></div>}
        {activeTab === 'positions' && <PositionsPage />}
        {activeTab === 'watchlist' && <WatchlistPage />}
        {activeTab === 'criteria' && <div className="empty"><div className="empty-title">Loading Criteria...</div></div>}
        {activeTab === 'insights' && <InsightsPage />}
      </div>

      <div className="bnav">
        <div className={`bni ${activeTab === 'signals' ? 'active' : ''}`} onClick={() => setActiveTab('signals')}>
          <div className="bni-icon">📊</div>Signals
        </div>
        <div className={`bni ${activeTab === 'positions' ? 'active' : ''}`} onClick={() => setActiveTab('positions')}>
          <div className="bni-icon">📂</div>Positions
        </div>
        <div className={`bni ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setActiveTab('watchlist')}>
          <div className="bni-icon">🔭</div>Watch
        </div>
        <div className={`bni ${activeTab === 'insights' ? 'active' : ''}`} onClick={() => setActiveTab('insights')}>
          <div className="bni-icon">📈</div>Insights
        </div>
      </div>
    </>
  )
}

export default App
