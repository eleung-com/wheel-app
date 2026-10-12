// ET-aware market-hours + NYSE holiday guard for the unattended scan. The cron
// trigger itself (wrangler.toml) fires on a UTC schedule wide enough to cover
// both EST and EDT — this is what narrows that down to "actually open right
// now", so a scan that fires early/late around a DST boundary, on a weekend,
// or on a holiday, is a clean no-op rather than a bogus alert.

// Observed NYSE full-day holidays. Update yearly — the exchange publishes the
// next year's schedule every fall (https://www.nyse.com/markets/hours-calendars).
const NYSE_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** {y, mo, day, dow, mins} for "now" as seen on an America/New_York wall clock. */
function etParts(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return {
    dateStr: `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`,
    dow:     et.getDay(), // 0=Sun .. 6=Sat
    mins:    et.getHours() * 60 + et.getMinutes(),
  };
}

/** Today's ET calendar date as YYYY-MM-DD — the de-dupe key's date component. */
export function etDateString(now = new Date()) {
  return etParts(now).dateStr;
}

/** Minutes since midnight on the ET wall clock. */
export function etMinutes(now = new Date()) {
  return etParts(now).mins;
}

/** True only during regular US equity hours (9:30–16:00 ET), Mon–Fri, non-holiday. */
export function isMarketOpen(now = new Date()) {
  const { dateStr, dow, mins } = etParts(now);
  if (dow < 1 || dow > 5) return false;
  if (NYSE_HOLIDAYS.has(dateStr)) return false;
  return mins >= 570 && mins < 960; // 9:30–16:00 ET
}

/** True when YYYY-MM-DD is a NYSE trading day (Mon–Fri, not a full holiday). */
export function isTradingDay(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return dow >= 1 && dow <= 5 && !NYSE_HOLIDAYS.has(dateStr);
}

/** The date `n` trading days after `dateStr` (Part 3: FMV refresh 2 trading days after earnings). */
export function addTradingDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTradingDay(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}
