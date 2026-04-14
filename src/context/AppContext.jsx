import React, { createContext, useContext, useReducer } from 'react';
import { DEFAULT_CRITERIA } from '../lib/utils';

const initialState = {
  watchlist:    [],
  positions:    [],
  closedTrades: [],
  signals:      [],
  criteria:     { ...DEFAULT_CRITERIA },
  lastRefresh:  null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_WATCHLIST':
      return { ...state, watchlist: action.payload };

    case 'SET_POSITIONS':
      return { ...state, positions: action.payload };

    case 'SET_SIGNALS':
      return { ...state, signals: action.payload, lastRefresh: Date.now() };

    case 'SET_CRITERIA':
      return { ...state, criteria: action.payload };

    case 'UPDATE_WATCHLIST_LIVE_DATA':
      // payload: { ticker, liveData }
      return {
        ...state,
        watchlist: state.watchlist.map(w =>
          w.ticker === action.payload.ticker
            ? { ...w, liveData: action.payload.liveData }
            : w
        ),
      };

    case 'UPDATE_POSITION_LIVE_PREM':
      // payload: { id, liveCurPrem }
      return {
        ...state,
        positions: state.positions.map(p =>
          p.id === action.payload.id
            ? { ...p, _liveCurPrem: action.payload.liveCurPrem, _liveCurPremTs: Date.now() }
            : p
        ),
      };

    case 'UPDATE_POSITION_MARKET_PRICE':
      // payload: { ticker, price } — sets _livePrice on all share lots for this ticker
      return {
        ...state,
        positions: state.positions.map(p =>
          p.ticker === action.payload.ticker && p.type === 'shares'
            ? { ...p, _livePrice: action.payload.price }
            : p
        ),
      };

    case 'ADD_POSITION':
      return { ...state, positions: [...state.positions, action.payload] };

    case 'UPDATE_POSITION': {
      const idx = state.positions.findIndex(p => p.id === action.payload.id);
      if (idx === -1) return state;
      const next = [...state.positions];
      next[idx] = action.payload;
      return { ...state, positions: next };
    }

    case 'DELETE_POSITION':
      return { ...state, positions: state.positions.filter(p => p.id !== action.payload) };

    case 'SET_CLOSED_TRADES':
      return { ...state, closedTrades: action.payload };

    case 'ADD_CLOSED_TRADE':
      return { ...state, closedTrades: [...state.closedTrades, action.payload] };

    case 'ADD_WATCH':
      return { ...state, watchlist: [...state.watchlist, action.payload] };

    case 'REMOVE_WATCH':
      return { ...state, watchlist: state.watchlist.filter(w => w.ticker !== action.payload) };

    default:
      return state;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
