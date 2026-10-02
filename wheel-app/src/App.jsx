import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import { useAppContext } from './context/AppContext';
import { useToast }       from './hooks/useToast';
import { useMarketStatus } from './hooks/useMarketStatus';
import { useSheets }      from './hooks/useSheets';
import { useNotion }      from './hooks/useNotion';
import { useScreener }    from './hooks/useScreener';
import useEvals           from './hooks/useEvals';
import { isConfigured, LS_SESSION_KEY, parseCriteria, parsePositions, parseClosedTrades } from './lib/utils';
import { sortByDiveIn } from './lib/watchlistOrder';

import AuthGate    from './components/AuthGate/AuthGate';
import BootScreen  from './components/BootScreen/BootScreen';
import Header      from './components/Header/Header';
import TabNav      from './components/TabNav/TabNav';
import BottomNav   from './components/BottomNav/BottomNav';
import FAB         from './components/FAB/FAB';
import Toast       from './components/Toast/Toast';

import HomePage      from './components/pages/HomePage/HomePage';
import SignalsPage   from './components/pages/SignalsPage/SignalsPage';
import PositionsPage from './components/pages/PositionsPage/PositionsPage';
import WatchlistPage from './components/pages/WatchlistPage/WatchlistPage';
import SettingsPage  from './components/pages/SettingsPage/SettingsPage';

import ModalOverlay           from './components/modals/ModalOverlay';
import PositionModal          from './components/modals/PositionModal';
import ClosePositionModal     from './components/modals/ClosePositionModal';
import ShareGroupDetailModal  from './components/modals/ShareGroupDetailModal';
import SignalDetailModal      from './components/modals/SignalDetailModal';
import HelpModal              from './components/modals/HelpModal';

// How stale the screened data must be before foregrounding the app refetches.
// Long enough that flicking away and back is free; short enough that a real
// return to the app shows current prices.
const FOREGROUND_STALE_MS = 10 * 60 * 1000;

function getInitialAuthState() {
  if (!isConfigured()) return 'setup';
  if (localStorage.getItem(LS_SESSION_KEY) === '1') return 'booting';
  return 'login';
}

export default function App() {
  const { state, dispatch } = useAppContext();

  // Read by the foreground-refresh listener, which is registered once and must
  // not be torn down and re-added on every state change.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  // Auth / boot flow
  const [authState, setAuthState] = useState(getInitialAuthState);
  const [isBooting, setIsBooting] = useState(() => getInitialAuthState() === 'booting');

  // Navigation
  const [activePage, setActivePage] = useState('pg-home');

  // Modal state
  const [openModal,         setOpenModal]         = useState(null);
  const [editPositionId,    setEditPositionId]    = useState(null);
  const [closePositionId,   setClosePositionId]   = useState(null);
  const [detailShareTicker, setDetailShareTicker] = useState(null);
  // Pre-fill ticker when adding lot from share group modal
  const [addLotTicker,      setAddLotTicker]      = useState(null);
  const [addPosType,        setAddPosType]        = useState(null);
  // Signal detail
  const [detailSignalId,    setDetailSignalId]    = useState(null);

  // Also read by the foreground-refresh listener: a silent refetch must not
  // swap state out from under an open form.
  const openModalRef = useRef(openModal);
  useEffect(() => { openModalRef.current = openModal; });

  const { toast, showToast }          = useToast();
  const { isOpen: marketOpen, marketText } = useMarketStatus();
  const { syncStatus, sheetRead, sheetWriteViaGet, syncFromSheet } = useSheets(showToast);
  const { notionSyncWatchlist, notionUpdateWatch }                 = useNotion(showToast);
  const { isScreening, runScreener }                               = useScreener(showToast);
  const runScreenerRef = useRef(runScreener);
  useEffect(() => { runScreenerRef.current = runScreener; });

  // Latest Notion evaluation for every ticker currently offering an entry.
  // Roll and close signals are excluded — those are about an open position, so
  // the written thesis isn't what you're deciding on.
  const evalTargets = useMemo(
    () => state.signals
      .filter(s => (s.type === 'csp' || s.type === 'cc') && s.pageId)
      .map(s => ({ ticker: s.ticker, pageId: s.pageId, lastEval: s.lastEval })),
    [state.signals],
  );
  const { evals, loading: evalsLoading } = useEvals(evalTargets);

  // Watchlist evals. Same Notion page bodies, same localStorage cache (keyed by
  // pageId, so the two hooks warm each other), but every watched ticker rather
  // than only the ones signalling.
  //
  // Fetched in Dive-In order so Priority resolves first — a cold load is ~8
  // Notion calls per ticker at 3 requests/second, and the tickers you triaged as
  // Priority shouldn't be stuck behind the ones you marked Skip.
  //
  // Gated on the tab having been opened, so a session that never visits the
  // watchlist never pays for it. Latched rather than live: leaving the tab must
  // not empty `evals` and re-fetch on every return.
  const [watchlistSeen, setWatchlistSeen] = useState(false);
  useEffect(() => {
    if (activePage === 'pg-watchlist') setWatchlistSeen(true);
  }, [activePage]);

  const watchEvalTargets = useMemo(
    () => (watchlistSeen
      ? sortByDiveIn(state.watchlist)
        .filter(w => w.pageId)
        .map(w => ({ ticker: w.ticker, pageId: w.pageId, lastEval: w.lastEval }))
      : []),
    [watchlistSeen, state.watchlist],
  );
  const { evals: watchEvals, loading: watchEvalsLoading } = useEvals(watchEvalTargets);

  // ── Boot sequence ────────────────────────────────────────────────────────
  const boot = useCallback(async () => {
    // Watchlist lives in Notion; positions, trades and criteria stay in Sheets.
    // Run both together so a slow Notion call doesn't delay the rest of boot.
    const [data, rows] = await Promise.all([
      sheetRead(),
      notionSyncWatchlist({ quiet: true }),
    ]);

    let positions = null, criteria = null;
    if (data) {
      if (Array.isArray(data.positions)) {
        positions = parsePositions(data.positions);
        dispatch({ type: 'SET_POSITIONS', payload: positions });
      }
      if (Array.isArray(data.closedTrades)) {
        dispatch({ type: 'SET_CLOSED_TRADES', payload: parseClosedTrades(data.closedTrades) });
      }
      if (data.criteria && typeof data.criteria === 'object' && Object.keys(data.criteria).length > 0) {
        criteria = parseCriteria(data.criteria);
        dispatch({ type: 'SET_CRITERIA', payload: criteria });
      }
    }
    setIsBooting(false);

    // Hand the screener what boot just loaded. It otherwise reads app state
    // through a ref that only refreshes after a render, and the dispatches above
    // haven't been committed yet — so it would see an empty watchlist, bail at
    // its own guard, and leave the Signals tab blank until the next manual
    // refresh — there is no polling loop to bail it out.
    runScreenerRef.current(false, {
      ...(rows      ? { watchlist: rows } : {}),
      ...(positions ? { positions }       : {}),
      ...(criteria  ? { criteria }        : {}),
    });
  }, [sheetRead, notionSyncWatchlist, dispatch]); // runScreener accessed via ref — not a dep

  // hasBooted ref prevents re-running if boot/authState reference changes during screener lifecycle
  const hasBooted = useRef(false);
  useEffect(() => {
    if (authState === 'booting' && !hasBooted.current) {
      hasBooted.current = true;
      boot();
    }
  }, [authState, boot]);

  // ── Refresh on foreground ────────────────────────────────────────────────
  // There is no polling loop. An idle app makes no network calls at all — the
  // Cloudflare Worker is what watches the market while this is closed, and it
  // messages Telegram. This screen is a read-out, so it refreshes when someone
  // actually looks at it.
  //
  // It replaces a 60-second setInterval that re-screened the entire watchlist
  // for as long as the tab stayed open. With the in-run guard preventing
  // overlap, that amounted to running back-to-back full screens all session —
  // roughly two market-data calls per ticker per cycle. That is the exact pattern
  // that got this app rate-limited before, and it bought nothing: nobody was
  // reading the screen between refreshes.
  //
  // Three guards, each earning its place:
  //   • >10 min stale — mobile fires visibilitychange constantly (app switcher,
  //     notification shade). Without this, every glance is a full screen.
  //   • market open   — outside hours the data cannot have changed since the
  //     close, so foregrounding on a Sunday must stay silent.
  //   • no modal open — a background refresh mid-edit swaps state underneath an
  //     open form, which is the same class of bug the watchlist pull already
  //     guards against.
  // The manual ↻ button bypasses all three, by design.
  useEffect(() => {
    if (isBooting || authState !== 'booting') return;

    function isMarketHours() {
      const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const d    = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
      return d >= 1 && d <= 5 && mins >= 570 && mins < 960;
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (!isMarketHours()) return;
      if (openModalRef.current) return;
      const last = stateRef.current.lastRefresh;
      if (last && Date.now() - last < FOREGROUND_STALE_MS) return;
      runScreener(true); // silent — no toast, no flash
    }

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isBooting, authState, runScreener]);

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
  // no add/remove here. Notes is the one property the app writes back.

  function handleUpdateWatchNotes(ticker, notes) {
    dispatch({ type: 'UPDATE_WATCH_NOTES', payload: { ticker, notes } });
    notionUpdateWatch(ticker, { notes });
  }

  // A pull replaces every row's `notes`, so it would swap the text out from
  // under an open detail modal and lose the draft. The watchlist tells us when
  // one is up; background pulls no-op until it closes.
  const watchModalOpen = useRef(false);
  const handleWatchModalOpenChange = useCallback(open => { watchModalOpen.current = open; }, []);

  const syncNotionWatchlist = useCallback(() => {
    if (watchModalOpen.current) return;
    notionSyncWatchlist({ quiet: true });
  }, [notionSyncWatchlist]);

  // Header refresh pulls Notion as well as prices. Notes edited in Notion would
  // otherwise not reach the app until a full reload — boot is the only other
  // place the watchlist is read.
  const handleHeaderRefresh = useCallback((...args) => {
    syncNotionWatchlist();
    return runScreener(...args);
  }, [syncNotionWatchlist, runScreener]);

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
      posType:      pos.type,            // original strategy type (short_put / short_call / put_spread)
      qty:          pos.qty,
      strike:       pos.strike,
      longStrike:   pos.longStrike,      // spread long leg (undefined for single-leg)
      expiry:       pos.expiry,
      prem:         pos.prem,            // original premium collected (net credit for spreads)
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
      closeType: details.closeType, qty: pos.qty, strike: pos.strike, longStrike: pos.longStrike,
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
        onRefresh={handleHeaderRefresh}
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

      <div className={`page${activePage === 'pg-home' ? ' active' : ''}`} id="pg-home">
        <HomePage
          positions={state.positions}
          closedTrades={state.closedTrades}
          criteria={state.criteria}
          signals={state.signals}
          watchlist={state.watchlist}
          showToast={showToast}
          onShowSignal={id => { setDetailSignalId(id); setOpenModal('signal-detail'); }}
        />
      </div>

      <div className={`page${activePage === 'pg-signals' ? ' active' : ''}`} id="pg-signals">
        <SignalsPage
          signals={state.signals}
          lastRefresh={state.lastRefresh}
          evals={evals}
          evalsLoading={evalsLoading}
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
          isActive={activePage === 'pg-watchlist'}
          evals={watchEvals}
          evalsLoading={watchEvalsLoading}
          onSaveNotes={handleUpdateWatchNotes}
          onSyncNotion={syncNotionWatchlist}
          onModalOpenChange={handleWatchModalOpenChange}
        />
      </div>

      <div className={`page${activePage === 'pg-settings' ? ' active' : ''}`} id="pg-settings">
        <SettingsPage
          criteria={state.criteria}
          onSave={handleSaveCriteria}
          onRefresh={runScreener}
          onPull={syncFromSheet}
          onAddPosition={posType => {
            setEditPositionId(null);
            setAddLotTicker(null);
            setAddPosType(posType || null);
            setOpenModal('pos');
          }}
        />
      </div>

      <BottomNav
        activePage={activePage}
        onSwitch={setActivePage}
        positions={state.positions}
        watchlist={state.watchlist}
        signals={state.signals}
      />

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
          evaluation={evals[(state.signals.find(s => s.id === detailSignalId) || {}).ticker] || null}
          loading={evalsLoading}
          onClose={() => { setOpenModal(null); setDetailSignalId(null); }}
        />
      </ModalOverlay>

      <ModalOverlay open={openModal === 'help'} onClose={() => setOpenModal(null)}>
        <HelpModal onClose={() => setOpenModal(null)} />
      </ModalOverlay>

    </>
  );
}
