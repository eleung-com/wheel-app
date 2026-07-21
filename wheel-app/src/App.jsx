import React, { useState, useEffect, useCallback, useRef } from 'react';

import { useAppContext } from './context/AppContext';
import { useToast }       from './hooks/useToast';
import { useMarketStatus } from './hooks/useMarketStatus';
import { useSheets }      from './hooks/useSheets';
import { useNotion }      from './hooks/useNotion';
import { useScreener }    from './hooks/useScreener';
import { isConfigured, LS_SESSION_KEY, parseCriteria, parsePositions, parseClosedTrades } from './lib/utils';

import AuthGate    from './components/AuthGate/AuthGate';
import BootScreen  from './components/BootScreen/BootScreen';
import Header      from './components/Header/Header';
import TabNav      from './components/TabNav/TabNav';
import FAB         from './components/FAB/FAB';
import Toast       from './components/Toast/Toast';

import SignalsPage   from './components/pages/SignalsPage/SignalsPage';
import PositionsPage from './components/pages/PositionsPage/PositionsPage';
import WatchlistPage from './components/pages/WatchlistPage/WatchlistPage';
import HistoryPage   from './components/pages/HistoryPage/HistoryPage';
import CriteriaPage  from './components/pages/CriteriaPage/CriteriaPage';
import ToolsPage     from './components/pages/ToolsPage/ToolsPage';

import ModalOverlay           from './components/modals/ModalOverlay';
import PositionModal          from './components/modals/PositionModal';
import ClosePositionModal     from './components/modals/ClosePositionModal';
import ShareGroupDetailModal  from './components/modals/ShareGroupDetailModal';
import SignalDetailModal      from './components/modals/SignalDetailModal';
import HelpModal              from './components/modals/HelpModal';
import WatchNotesModal        from './components/modals/WatchNotesModal';

function getInitialAuthState() {
  if (!isConfigured()) return 'setup';
  if (localStorage.getItem(LS_SESSION_KEY) === '1') return 'booting';
  return 'login';
}

export default function App() {
  const { state, dispatch } = useAppContext();

  // Auth / boot flow
  const [authState, setAuthState] = useState(getInitialAuthState);
  const [isBooting, setIsBooting] = useState(() => getInitialAuthState() === 'booting');

  // Navigation
  const [activePage, setActivePage] = useState('pg-history');

  // Modal state
  const [openModal,         setOpenModal]         = useState(null);
  const [editPositionId,    setEditPositionId]    = useState(null);
  const [closePositionId,   setClosePositionId]   = useState(null);
  const [detailShareTicker, setDetailShareTicker] = useState(null);
  // Pre-fill ticker when adding lot from share group modal
  const [addLotTicker,      setAddLotTicker]      = useState(null);
  const [addPosType,        setAddPosType]        = useState(null);
  // Watchlist notes edit
  const [editNotesTicker,   setEditNotesTicker]   = useState(null);
  // Signal detail
  const [detailSignalId,    setDetailSignalId]    = useState(null);

  const { toast, showToast }          = useToast();
  const { isOpen: marketOpen, marketText } = useMarketStatus();
  const { syncStatus, sheetRead, sheetWriteViaGet, syncFromSheet } = useSheets(showToast);
  const { notionSyncWatchlist, notionUpdateWatch }                 = useNotion(showToast);
  const { isScreening, runScreener, refreshOptionPrices }          = useScreener(showToast);
  const runScreenerRef = useRef(runScreener);
  useEffect(() => { runScreenerRef.current = runScreener; });

  // ── Boot sequence ────────────────────────────────────────────────────────
  const boot = useCallback(async () => {
    // Watchlist lives in Notion; positions, trades and criteria stay in Sheets.
    // Run both together so a slow Notion call doesn't delay the rest of boot.
    const [data] = await Promise.all([
      sheetRead(),
      notionSyncWatchlist({ quiet: true }),
    ]);
    if (data) {
      if (Array.isArray(data.positions)) {
        dispatch({ type: 'SET_POSITIONS', payload: parsePositions(data.positions) });
      }
      if (Array.isArray(data.closedTrades)) {
        dispatch({ type: 'SET_CLOSED_TRADES', payload: parseClosedTrades(data.closedTrades) });
      }
      if (data.criteria && typeof data.criteria === 'object' && Object.keys(data.criteria).length > 0) {
        dispatch({ type: 'SET_CRITERIA', payload: parseCriteria(data.criteria) });
      }
    }
    setIsBooting(false);
    runScreenerRef.current();
  }, [sheetRead, notionSyncWatchlist, dispatch]); // runScreener accessed via ref — not a dep

  // hasBooted ref prevents re-running if boot/authState reference changes during screener lifecycle
  const hasBooted = useRef(false);
  useEffect(() => {
    if (authState === 'booting' && !hasBooted.current) {
      hasBooted.current = true;
      boot();
    }
  }, [authState, boot]);

  // ── Auto-refresh (market hours only, 1-min silent background refresh) ──────
  useEffect(() => {
    if (isBooting || authState !== 'booting') return;

    function isMarketHours() {
      const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const d    = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
      return d >= 1 && d <= 5 && mins >= 570 && mins < 960;
    }

    // Only set up the interval when markets are open; it runs silently in the background.
    // When markets are closed the boot-time screener run already captured the last close — no repeat needed.
    if (!isMarketHours()) return;

    const screenerInterval = setInterval(() => {
      runScreener(true); // silent=true: no toast, no flash
    }, 60 * 1000);

    const optionsInterval = setInterval(() => {
      refreshOptionPrices(true);
    }, 60 * 60 * 1000);

    return () => {
      clearInterval(screenerInterval);
      clearInterval(optionsInterval);
    };
  }, [isBooting, authState, runScreener, refreshOptionPrices]);

  // ── Auth handlers ────────────────────────────────────────────────────────
  function handleAuthSuccess() {
    setAuthState('booting');
    setIsBooting(true);
  }

  // ── FAB ──────────────────────────────────────────────────────────────────
  function handleFabClick() {
    if (activePage === 'pg-positions') {
      setEditPositionId(null);
      setAddLotTicker(null);
      setOpenModal('pos');
    }
  }

  // ── Watchlist handlers ───────────────────────────────────────────────────
  // Membership is curated in Notion (anything tagged in TV Lists), so there is
  // no add/remove here. The app owns Notes and App Category and writes those back.

  function handleUpdateWatchNotes(ticker, notes) {
    dispatch({ type: 'UPDATE_WATCH_NOTES', payload: { ticker, notes } });
    notionUpdateWatch(ticker, { notes });
  }

  function handleUpdateWatchCategory(ticker, category) {
    dispatch({ type: 'UPDATE_WATCH_CATEGORY', payload: { ticker, category } });
    notionUpdateWatch(ticker, { category });
  }

  function handleUpdateWatchlistCategories(categories) {
    const nextCriteria = { ...state.criteria, watchlistCategories: categories.join(',') };
    dispatch({ type: 'SET_CRITERIA', payload: nextCriteria });
    sheetWriteViaGet({ ...state, criteria: nextCriteria });
  }

  // ── Market indicator handlers ────────────────────────────────────────────
  function handleAddIndicator(ticker) {
    const current = state.criteria.indicatorTickers
      ? String(state.criteria.indicatorTickers).split(',').map(t => t.trim()).filter(Boolean)
      : [];
    if (current.includes(ticker)) return;
    const next = [...current, ticker].join(',');
    const nextCriteria = { ...state.criteria, indicatorTickers: next };
    dispatch({ type: 'SET_CRITERIA', payload: nextCriteria });
    sheetWriteViaGet({ ...state, criteria: nextCriteria });
    runScreener(true);
  }

  function handleRemoveIndicator(ticker) {
    const current = state.criteria.indicatorTickers
      ? String(state.criteria.indicatorTickers).split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const next = current.filter(t => t !== ticker).join(',');
    const nextCriteria = { ...state.criteria, indicatorTickers: next };
    dispatch({ type: 'SET_CRITERIA', payload: nextCriteria });
    sheetWriteViaGet({ ...state, criteria: nextCriteria });
  }

  // ── Position handlers ────────────────────────────────────────────────────
  function handleSavePos(pos) {
    let nextPositions;
    if (editPositionId) {
      dispatch({ type: 'UPDATE_POSITION', payload: pos });
      nextPositions = state.positions.map(p => p.id === pos.id ? pos : p);
    } else {
      dispatch({ type: 'ADD_POSITION', payload: pos });
      nextPositions = [...state.positions, pos];
    }
    setOpenModal(null);
    setEditPositionId(null);
    const nextState = { ...state, positions: nextPositions };
    sheetWriteViaGet(nextState);
    runScreener();
  }

  function handleDeletePos(id) {
    dispatch({ type: 'DELETE_POSITION', payload: id });
    setOpenModal(null);
    setEditPositionId(null);
    const nextState = { ...state, positions: state.positions.filter(p => p.id !== id) };
    sheetWriteViaGet(nextState);
    runScreener();
  }

  function handleEditPos(id) {
    setEditPositionId(id);
    setAddLotTicker(null);
    setOpenModal('pos');
  }

  // Opens close modal for an option row tap
  function handleSelectOptPos(id) {
    setClosePositionId(id);
    setOpenModal('closePos');
  }

  // Confirms a close action — logs it, deletes position, adds new one if rolled
  function handleClosePosition(posId, details) {
    const pos = state.positions.find(p => p.id === posId);
    if (!pos) return;

    // New row appended to positions for the close action — original row is kept intact
    const closeEntry = {
      id:           Date.now(),
      ticker:       pos.ticker,
      type:         details.closeType,   // 'btc' | 'expired' | 'assigned' | 'rolled'
      posType:      pos.type,            // original strategy type (short_put / short_call)
      qty:          pos.qty,
      strike:       pos.strike,
      expiry:       pos.expiry,
      prem:         pos.prem,            // original premium collected
      cost:         0,
      notes:        pos.notes,
      account:      pos.account || 'Esther',
      enteredAt:    details.closeDate,   // row timestamp = close date
      closePrice:   details.closePrice,
      pnl:          details.pnl,
      linkedId:     posId,               // links back to the opening row
      ...(details.sharesAcquired !== undefined ? { sharesAcquired: details.sharesAcquired, costBasis: details.costBasis } : {}),
      ...(details.newPosition    !== undefined ? { rolledToId: details.newPosition.id }                                    : {}),
    };

    // Also keep closedTrades in sync for future Insights tab
    const logEntry = {
      id: closeEntry.id, ticker: pos.ticker, posType: pos.type,
      closeType: details.closeType, qty: pos.qty, strike: pos.strike,
      expiry: pos.expiry, openDate: pos.enteredAt, closeDate: details.closeDate,
      premCollected: pos.prem, closePrice: details.closePrice, pnl: details.pnl,
      notes: pos.notes, account: pos.account || 'Esther',
      ...(details.sharesAcquired !== undefined ? { sharesAcquired: details.sharesAcquired, costBasis: details.costBasis } : {}),
      ...(details.newPosition    !== undefined ? { rolledToId: details.newPosition.id }                                    : {}),
    };

    // Stamp the original opening row with the close entry's id — two-way link
    const closedOriginal = { ...pos, linkedId: closeEntry.id };

    dispatch({ type: 'UPDATE_POSITION',  payload: closedOriginal });
    dispatch({ type: 'ADD_POSITION',     payload: closeEntry });
    dispatch({ type: 'ADD_CLOSED_TRADE', payload: logEntry });

    // nextPositions: replace original with stamped version, append close entry
    let nextPositions = state.positions.map(p => p.id === posId ? closedOriginal : p);
    nextPositions = [...nextPositions, closeEntry];
    const nextClosedTrades = [...state.closedTrades, logEntry];

    if (details.closeType === 'rolled' && details.newPosition) {
      dispatch({ type: 'ADD_POSITION', payload: details.newPosition });
      nextPositions = [...nextPositions, details.newPosition];
    }

    setOpenModal(null);
    setClosePositionId(null);
    sheetWriteViaGet({ ...state, positions: nextPositions, closedTrades: nextClosedTrades });
  }

  // ── Criteria handler ─────────────────────────────────────────────────────
  function handleSaveCriteria(newCrit) {
    dispatch({ type: 'SET_CRITERIA', payload: newCrit });
    const nextState = { ...state, criteria: newCrit };
    sheetWriteViaGet(nextState);
  }

  // ── Share group modal ────────────────────────────────────────────────────
  function handleShowShareGroup(ticker) {
    setDetailShareTicker(ticker);
    setOpenModal('shareGroup');
  }

  function handleAddLot(ticker) {
    setOpenModal(null);
    setEditPositionId(null);
    setAddLotTicker(ticker);
    setTimeout(() => setOpenModal('pos'), 50);
  }

  // ── Render: auth screens ─────────────────────────────────────────────────
  if (authState === 'setup' || authState === 'login') {
    return (
      <AuthGate
        mode={authState}
        onSuccess={handleAuthSuccess}
        onResetToSetup={() => setAuthState('setup')}
      />
    );
  }

  if (isBooting) return <BootScreen />;

  // ── Main app ─────────────────────────────────────────────────────────────
  return (
    <>
      <Header
        marketOpen={marketOpen}
        marketText={marketText}
        syncStatus={syncStatus}
        isScreening={isScreening}
        onRefresh={runScreener}
        onPull={syncFromSheet}
        onHelp={() => setOpenModal('help')}
      />

      <TabNav
        activePage={activePage}
        onSwitch={setActivePage}
        positions={state.positions}
        watchlist={state.watchlist}
        signals={state.signals}
      />

      <div className={`page${activePage === 'pg-signals' ? ' active' : ''}`} id="pg-signals">
        <SignalsPage
          signals={state.signals}
          lastRefresh={state.lastRefresh}
          onShowDetail={id => { setDetailSignalId(id); setOpenModal('signal-detail'); }}
        />
      </div>

      <div className={`page${activePage === 'pg-positions' ? ' active' : ''}`} id="pg-positions">
        <PositionsPage
          positions={state.positions}
          watchlist={state.watchlist}
          criteria={state.criteria}
          onSelectOptPos={handleSelectOptPos}
          onEditPos={handleEditPos}
          onShowShareGroup={handleShowShareGroup}
        />
      </div>

      <div className={`page${activePage === 'pg-watchlist' ? ' active' : ''}`} id="pg-watchlist">
        <WatchlistPage
          watchlist={state.watchlist}
          categories={state.criteria.watchlistCategories
            ? state.criteria.watchlistCategories.split(',').map(s => s.trim()).filter(Boolean)
            : []}
          onSaveNotes={handleUpdateWatchNotes}
          onSaveCategory={handleUpdateWatchCategory}
          onSaveCategories={handleUpdateWatchlistCategories}
        />
      </div>

      <div className={`page${activePage === 'pg-history' ? ' active' : ''}`} id="pg-history">
        <HistoryPage positions={state.positions} />
      </div>

      <div className={`page${activePage === 'pg-tools' ? ' active' : ''}`} id="pg-tools">
        <ToolsPage onAddPosition={posType => {
          setEditPositionId(null);
          setAddLotTicker(null);
          setAddPosType(posType || null);
          setOpenModal('pos');
        }} />
      </div>

      <div className={`page${activePage === 'pg-criteria' ? ' active' : ''}`} id="pg-criteria">
        <CriteriaPage
          criteria={state.criteria}
          onSave={handleSaveCriteria}
          onRefresh={runScreener}
          onPull={syncFromSheet}
        />
      </div>

      <FAB activePage={activePage} onClick={handleFabClick} />
      <Toast message={toast.message} type={toast.type} visible={toast.visible} />

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      <ModalOverlay open={openModal === 'pos'} onClose={() => setOpenModal(null)}>
        <PositionModal
          key={editPositionId ?? `new-${addLotTicker ?? ''}-${addPosType ?? ''}`}
          editId={editPositionId}
          initialType={addPosType}
          positions={state.positions}
          onSave={handleSavePos}
          onDelete={handleDeletePos}
          onClose={() => { setOpenModal(null); setEditPositionId(null); setAddPosType(null); }}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'closePos'} onClose={() => { setOpenModal(null); setClosePositionId(null); }}>
        <ClosePositionModal
          key={closePositionId}
          posId={closePositionId}
          positions={state.positions}
          onConfirm={handleClosePosition}
          onEdit={id => { setOpenModal(null); setTimeout(() => handleEditPos(id), 50); }}
          onClose={() => { setOpenModal(null); setClosePositionId(null); }}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'shareGroup'} onClose={() => setOpenModal(null)}>
        <ShareGroupDetailModal
          ticker={detailShareTicker}
          positions={state.positions}
          watchlist={state.watchlist}
          onEditPos={id => { setOpenModal(null); setTimeout(() => handleEditPos(id), 50); }}
          onAddLot={handleAddLot}
          onClose={() => setOpenModal(null)}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'signal-detail'} onClose={() => { setOpenModal(null); setDetailSignalId(null); }}>
        <SignalDetailModal
          signalId={detailSignalId}
          signals={state.signals}
          positions={state.positions}
          onClose={() => { setOpenModal(null); setDetailSignalId(null); }}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'help'} onClose={() => setOpenModal(null)}>
        <HelpModal onClose={() => setOpenModal(null)} />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'watchNotes'} onClose={() => setOpenModal(null)}>
        <WatchNotesModal
          ticker={editNotesTicker}
          watchlist={state.watchlist}
          onSave={(ticker, notes) => { handleUpdateWatchNotes(ticker, notes); setOpenModal(null); }}
          onClose={() => setOpenModal(null)}
        />
      </ModalOverlay>
    </>
  );
}
