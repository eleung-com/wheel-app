export const LS_URL_KEY      = 'wd_sheet_url';
export const LS_SECRET_KEY   = 'wd_secret';
export const LS_AUTH_KEY     = 'wd_authed';
export const LS_SESSION_KEY  = 'wd_session';
export const LS_TRADIER_KEY  = 'wd_tradier_key';

export function getSheetUrl()    { return localStorage.getItem(LS_URL_KEY)    || ''; }
export function getSecret()      { return localStorage.getItem(LS_SECRET_KEY) || ''; }
export function getTradierKey()  { return localStorage.getItem(LS_TRADIER_KEY) || ''; }
export function isConfigured()   { return !!getSheetUrl() && !!getSecret(); }

export function dte(expiry) {
  if (!expiry) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((new Date(expiry + 'T12:00:00') - now) / 86400000);
}

export function suggestStrike(price, delta, type) {
  const pct = delta === 30 ? 0.07 : delta === 20 ? 0.10 : delta === 15 ? 0.13 : (delta / 100) * 0.25;
  if (type === 'put')  return Math.floor((price * (1 - pct)) / 0.5) * 0.5;
  return Math.ceil((price * (1 + pct)) / 0.5) * 0.5;
}

export const DEFAULT_CRITERIA = {
  ivr: 50, stoch: 20, rsi: 35, ma: 200, earn: 30,
  deltaMin: 20, deltaMax: 35, dteMin: 21, dteMax: 45,
  shares: 100, ccIvr: 30, ccDeltaMin: 15, ccDeltaMax: 25, ccDteMin: 21, ccDteMax: 35,
  closePct: 50, closeDtePct: 50,
};

export function parseCriteria(c) {
  return {
    ivr:        Number(c.ivr)        || 50,
    stoch:      Number(c.stoch)      || 20,
    rsi:        Number(c.rsi)        || 35,
    ma:         Number(c.ma)         || 200,
    earn:       Number(c.earn)       || 30,
    deltaMin:   Number(c.deltaMin)   || (Number(c.delta) || 20),
    deltaMax:   Number(c.deltaMax)   || (Number(c.delta) || 35),
    dteMin:     Number(c.dteMin)     || 21,
    dteMax:     Number(c.dteMax)     || 45,
    shares:     Number(c.shares)     || 100,
    ccIvr:      Number(c.ccIvr)      || 30,
    ccDeltaMin: Number(c.ccDeltaMin) || (Number(c.ccDelta) || 15),
    ccDeltaMax: Number(c.ccDeltaMax) || (Number(c.ccDelta) || 25),
    ccDteMin:   Number(c.ccDteMin)   || 21,
    ccDteMax:   Number(c.ccDteMax)   || 35,
    closePct:   Number(c.closePct)   || 50,
    closeDtePct:Number(c.closeDtePct)|| 50,
  };
}

// Coerce any date representation coming from Google Sheets into YYYY-MM-DD.
// Handles: already-correct 'YYYY-MM-DD', 'M/D/YYYY', 'MM/DD/YYYY', 'MM/DD/YY',
// and Google Sheets integer date serials (days since 1899-12-30, e.g. 45828).
export function normalizeDate(val) {
  if (!val) return '';
  const s = String(val).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO datetime from GAS Date serialization e.g. "2025-06-20T07:00:00.000Z"
  // Slice to just the date part — use UTC to avoid day-boundary timezone shifts
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const y  = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${mo}-${dy}`;
    }
    return s.slice(0, 10); // fallback: just slice
  }

  // Google Sheets integer date serial (days since 1899-12-30, e.g. 45828)
  const n = Number(s);
  if (!isNaN(n) && Number.isInteger(n) && n > 40000 && n < 80000) {
    const d  = new Date(Math.round((n - 25569) * 86400000));
    const y  = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }

  // M/D/YY or M/D/YYYY (e.g. "6/20/2025" or "6/20/25")
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  return '';
}

// Format a YYYY-MM-DD string for display as MM/DD/YY
export function formatDateDisplay(dateStr) {
  if (!dateStr) return '—';
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

// Deduplicate an array by a key function, keeping the last occurrence of each key.
// "Last" wins so that if GAS appended a corrected copy, the newest row is kept.
function dedupeBy(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => map.set(keyFn(item), item));
  return [...map.values()];
}

export function parseClosedTrades(raw) {
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map(t => ({
    id:           Number(t.id)          || 0,
    ticker:       String(t.ticker       || ''),
    posType:      String(t.posType      || ''),
    closeType:    String(t.closeType    || ''),
    qty:          Number(t.qty)         || 0,
    strike:       t.strike  !== '' && t.strike  != null ? Number(t.strike)  : undefined,
    expiry:       normalizeDate(t.expiry),
    openDate:     Number(t.openDate)    || 0,
    closeDate:    Number(t.closeDate)   || 0,
    premCollected:t.premCollected != null && t.premCollected !== '' ? Number(t.premCollected) : undefined,
    closePrice:   t.closePrice  != null && t.closePrice  !== '' ? Number(t.closePrice)  : undefined,
    pnl:          t.pnl        != null && t.pnl        !== '' ? Number(t.pnl)        : undefined,
    notes:        t.notes || '',
    sharesAcquired: t.sharesAcquired != null && t.sharesAcquired !== '' ? Number(t.sharesAcquired) : undefined,
    costBasis:    t.costBasis  != null && t.costBasis  !== '' ? Number(t.costBasis)  : undefined,
    rolledToId:   t.rolledToId != null && t.rolledToId !== '' ? Number(t.rolledToId) : undefined,
  }));
  return dedupeBy(mapped, t => t.id);
}

const CLOSE_TYPES = new Set(['btc', 'expired', 'assigned', 'rolled']);

export function parsePositions(raw) {
  const mapped = raw.filter(p => p.ticker).map(p => {
    const base = {
      id:          Number(p.id)     || Date.now(),
      ticker:      String(p.ticker),
      type:        String(p.type   || 'shares'),
      qty:         Number(p.qty)   || 0,
      cost:        Number(p.cost)  || 0,
      marketPrice: (p.marketPrice !== '' && p.marketPrice !== null && p.marketPrice !== undefined) ? Number(p.marketPrice) : undefined,
      strike:      (p.strike !== '' && p.strike !== null)  ? Number(p.strike) : undefined,
      expiry:      normalizeDate(p.expiry),
      prem:        (p.prem   !== '' && p.prem   !== null)  ? Number(p.prem)   : undefined,
      curPrem:     (p.curPrem !== '' && p.curPrem !== null && p.curPrem !== undefined) ? Number(p.curPrem) : undefined,
      notes:       p.notes   || '',
      enteredAt:   Number(p.enteredAt) || Date.now(),
    };
    // linkedId is preserved for ALL types:
    //  - on opening rows (short_put/short_call/shares): means this position has been closed
    //  - on close rows (btc/expired/assigned/rolled): points back to the opening row
    if (p.linkedId != null && p.linkedId !== '') base.linkedId = Number(p.linkedId);

    // Additional fields only present on close rows
    if (CLOSE_TYPES.has(base.type)) {
      if (p.posType)                                            base.posType        = String(p.posType);
      if (p.closePrice     != null && p.closePrice     !== '') base.closePrice     = Number(p.closePrice);
      if (p.pnl            != null && p.pnl            !== '') base.pnl            = Number(p.pnl);
      if (p.rolledToId     != null && p.rolledToId     !== '') base.rolledToId     = Number(p.rolledToId);
      if (p.sharesAcquired != null && p.sharesAcquired !== '') base.sharesAcquired = Number(p.sharesAcquired);
      if (p.costBasis      != null && p.costBasis      !== '') base.costBasis      = Number(p.costBasis);
    }
    return base;
  });
  return dedupeBy(mapped, p => p.id);
}
