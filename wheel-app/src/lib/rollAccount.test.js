import { describe, it, expect } from 'vitest';
import { rolledShortPosition, leapsCloseDetails } from '../components/modals/ClosePositionModal';

const put = (extra = {}) => ({ id: 1, ticker: 'AMD', type: 'short_put', qty: 1, strike: 150, expiry: '2026-11-20', prem: 2.1, ...extra });
const leg = { type: 'short_put', qty: 1, strike: 145, expiry: '2026-12-18', prem: 2.5, closeDateTs: 0 };

describe('rolled position keeps its account', () => {
  it('Fam put rolled → new put is Fam', () => {
    expect(rolledShortPosition(put({ account: 'Fam' }), leg).account).toBe('Fam');
  });
  it('Esther put rolled → Esther; no account → Esther', () => {
    expect(rolledShortPosition(put({ account: 'Esther' }), leg).account).toBe('Esther');
    expect(rolledShortPosition(put(), leg).account).toBe('Esther');
  });
  it('covered call roll keeps account too', () => {
    const p = rolledShortPosition(put({ type: 'covered_call', account: 'Fam' }), { ...leg, type: 'covered_call' });
    expect(p.account).toBe('Fam');
    expect(p.notes).toContain('call');
  });
  it('LEAPS roll still keeps account', () => {
    const d = leapsCloseDetails({ id: 2, ticker: 'NVDA', type: 'long_call', qty: 1, strike: 185, expiry: '2027-12-17', prem: 70, account: 'Fam' },
      'rolled', { price: 80, closeDateTs: 0, roll: { strike: 200, expiry: '2028-12-15', paid: 75, qty: 1 } });
    expect(d.newPosition.account).toBe('Fam');
  });
});
