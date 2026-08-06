import { describe, it, expect } from 'vitest';
import { isMarketOpen, etDateString } from './marketHours';

// All times below are constructed as UTC instants, then interpreted through
// isMarketOpen's America/New_York conversion — this keeps the test independent
// of the machine's local timezone.
function utc(y, mo, d, h, mi = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

describe('isMarketOpen', () => {
  it('is open mid-session on an ordinary weekday (EDT, UTC-4)', () => {
    // 2026-07-22 is a Wednesday; 14:00 UTC = 10:00 ET during EDT.
    expect(isMarketOpen(utc(2026, 7, 22, 14, 0))).toBe(true);
  });

  it('is closed before the 9:30 ET open and at/after the 16:00 ET close', () => {
    expect(isMarketOpen(utc(2026, 7, 22, 13, 0))).toBe(false);  // 9:00 ET
    expect(isMarketOpen(utc(2026, 7, 22, 20, 0))).toBe(false);  // 16:00 ET exactly
  });

  it('is closed on weekends', () => {
    // 2026-07-25 is a Saturday
    expect(isMarketOpen(utc(2026, 7, 25, 15, 0))).toBe(false);
    // 2026-07-26 is a Sunday
    expect(isMarketOpen(utc(2026, 7, 26, 15, 0))).toBe(false);
  });

  it('is closed on a NYSE holiday even during normal trading hours', () => {
    // 2026-01-01 (New Year's Day) is a Thursday — would otherwise be open.
    expect(isMarketOpen(utc(2026, 1, 1, 15, 0))).toBe(false);
  });

  it('accounts for the EST/EDT boundary correctly (EST, UTC-5)', () => {
    // 2026-01-20 is a Tuesday in EST; 14:00 UTC = 9:00 ET (before open).
    expect(isMarketOpen(utc(2026, 1, 20, 14, 0))).toBe(false);
    // 15:00 UTC = 10:00 ET (open).
    expect(isMarketOpen(utc(2026, 1, 20, 15, 0))).toBe(true);
  });
});

describe('etDateString', () => {
  it('returns the ET calendar date even when UTC has already rolled to the next day', () => {
    // 2026-07-23 02:00 UTC = 2026-07-22 22:00 ET (still the 22nd in New York).
    expect(etDateString(utc(2026, 7, 23, 2, 0))).toBe('2026-07-22');
  });
});
