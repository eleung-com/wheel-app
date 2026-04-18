import React, { useState, useEffect, useCallback } from 'react';

import { useAppContext } from './context/AppContext';
import { useToast }       from './hooks/useToast';
import { useMarketStatus } from './hooks/useMarketStatus';
import { useSheets }      from './hooks/useSheets';
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
import PnLPage       from './components/pages/PnLPage/PnLPage';

import ModalOverlay           from './components/modals/ModalOverlay';
import AddWatchModal          from './components/modals/AddWatchModal';
import PositionModal          from './components/modals/PositionModal';
import ClosePositionModal     from './components/modals/ClosePositionModal';
import SignalDetailModal      from './components/modals/SignalDetailModal';
import ShareGroupDetailModal  from './components/modals/ShareGroupDetailModal';
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
  const [activePage, setActivePage] = useState('pg-signals');

  // Modal state
  const [openModal,         setOpenModal]         = useState(null);
  const [editPositionId,    setEditPositionId]    = useState(null);
  const [closePositionId,   setClosePositionId]   = useState(null);
  const [detailSignalId,    setDetailSignalId]    = useState(null);
  const [detailShareTicker, setDetailShareTicker] = useState(null);
  // Pre-fill ticker when adding lot from share group modal
  const [addLotTicker,      setAddLotTicker]      = useState(null);
  // Watchlist notes edit
  const [editNotesTicker,   setEditNotesTicker]   = useState(null);

  const { toast, showToast }          = useToast();
  const { isOpen: marketOpen, marketText } = useMarketStatus();
  const { syncStatus, sheetRead, sheetWriteViaGet, syncFromSheet } = useSheets(showToast);
  const { isScreening, runScreener, refreshOptionPrices }          = useScreener(showToast);

  // ── Boot sequence ────────────────────────────────────────────────────────
  const boot = useCallback(async () => {
    const data = await sheetRead();
    if (data) {
      if (Array.isArray(data.watchlist)) {
        const seen = new Set();
        dispatch({
          type: 'SET_WATCHLIST',
          payload: data.watchlist
            .map(w => ({
              ticker:   String(w.ticker || ''),
              addedAt:  w.addedAt || Date.now(),
              notes:    w.notes || '',
              liveData: w.price ? { price: Number(w.price) } : null,
            }))
            .filter(w => w.ticker && !seen.has(w.ticker) && seen.add(w.ticker)),
        });
      }
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
  }, [sheetRead, dispatch]);

  useEffect(() => {
    if (authState === 'booting') {
      boot();
    }
  }, [authState, boot]);

  // ── Auto-refresh intervals (set up after boot completes) ─────────────────
  useEffect(() => {
    if (isBooting || authState !== 'booting') return;

    function isMarketHours() {
      const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const d    = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
      return d >= 1 && d <= 5 && mins >= 570 && mins < 960;
    }

    const screenerInterval = setInterval(() => {
      if (isMarketHours()) runScreener();
    }, 20 * 60 * 1000);

    const optionsInterval = setInterval(() => {
      if (isMarketHours()) refreshOptionPrices(false);
    }, 60 * 60 * 1000);

    const sheetSyncInterval = setInterval(() => {
      syncFromSheet();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(screenerInterval);
      clearInterval(optionsInterval);
      clearInterval(sheetSyncInterval);
    };
  }, [isBooting, authState, runScreener, refreshOptionPrices, syncFromSheet]);

  // ── Auth handlers ────────────────────────────────────────────────────────
  function handleAuthSuccess() {
    setAuthState('booting');
    setIsBooting(true);
  }

  // ── FAB ──────────────────────────────────────────────────────────────────
  function handleFabClick() {
    if (activePage === 'pg-watchlist') {
      setOpenModal('watch');
    } else if (activePage === 'pg-positions') {
      setEditPositionId(null);
      setAddLotTicker(null);
      setOpenModal('pos');
    }
  }

  // ── Watchlist handlers ───────────────────────────────────────────────────
  async function handleAddWatch(ticker, notes = '') {
    const entry = { ticker, addedAt: Date.now(), notes, liveData: null };
    dispatch({ type: 'ADD_WATCH', payload: entry });
    setOpenModal(null);
    const nextState = { ...state, watchlist: [...state.watchlist, entry] };
    await sheetWriteViaGet(nextState);
    // After 2 s, fetch only the new ticker's GOOGLEFINANCE price from the sheet
    // — does NOT call syncFromSheet() which would wipe all other tickers' indicator data
    setTimeout(async () => {
      const data = await sheetRead();
      if (!data?.watchlist) return;
      const row = data.watchlist.find(w => String(w.ticker).toUpperCase() === ticker);
      if (row?.price) {
        dispatch({
          type: 'UPDATE_WATCHLIST_LIVE_DATA',
          payload: { ticker, liveData: { price: Number(row.price) } },
        });
      }
    }, 2000);
    runScreener();
  }

  function handleUpdateWatchNotes(ticker, notes) {
    dispatch({ type: 'UPDATE_WATCH_NOTES', payload: { ticker, notes } });
    const nextState = {
      ...state,
      watchlist: state.watchlist.map(w => w.ticker === ticker ? { ...w, notes } : w),
    };
    sheetWriteViaGet(nextState);
  }

  function handleRemoveWatch(ticker) {
    dispatch({ type: 'REMOVE_WATCH', payload: ticker });
    const nextState = {
      ...state,
      watchlist: state.watchlist.filter(w => w.ticker !== ticker),
    };
    sheetWriteViaGet(nextState);
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
        signals={state.signals}
        positions={state.positions}
        watchlist={state.watchlist}
      />

      <div className={`page${activePage === 'pg-signals' ? ' active' : ''}`} id="pg-signals">
        <SignalsPage
          signals={state.signals}
          lastRefresh={state.lastRefresh}
          onShowDetail={id => { setDetailSignalId(id); setOpenModal('detail'); }}
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
          criteria={state.criteria}
          onRemove={handleRemoveWatch}
          onEditNotes={(ticker) => { setEditNotesTicker(ticker); setOpenModal('watchNotes'); }}
        />
      </div>

      <div className={`page${activePage === 'pg-history' ? ' active' : ''}`} id="pg-history">
        <HistoryPage positions={state.positions} />
      </div>

      <div className={`page${activePage === 'pg-pnl' ? ' active' : ''}`} id="pg-pnl">
        <PnLPage />
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
      <ModalOverlay open={openModal === 'watch'} onClose={() => setOpenModal(null)}>
        <AddWatchModal
          watchlist={state.watchlist}
          onAdd={handleAddWatch}
          onClose={() => setOpenModal(null)}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'pos'} onClose={() => setOpenModal(null)}>
        <PositionModal
          key={editPositionId ?? `new-${addLotTicker ?? ''}`}
          editId={editPositionId}
          positions={state.positions}
          onSave={handleSavePos}
          onDelete={handleDeletePos}
          onClose={() => { setOpenModal(null); setEditPositionId(null); }}
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

      <ModalOverlay open={openModal === 'detail'} onClose={() => setOpenModal(null)}>
        <SignalDetailModal
          signalId={detailSignalId}
          signals={state.signals}
          positions={state.positions}
          onClose={() => setOpenModal(null)}
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
