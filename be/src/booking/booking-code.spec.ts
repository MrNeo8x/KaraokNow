import { BOOKING_CODE_INPUT_PATTERN, BOOKING_CODE_PATTERN, bookingCodeHash, deriveBookingCode, normalizeBookingCode } from './booking-code';

describe('booking code (PD-038)', () => {
  const secret = 'test-secret-at-least-32-characters-long';

  it('derives a stable 6-character code without look-alike characters', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const codes = ids.map((id) => deriveBookingCode(secret, id));
    for (const code of codes) expect(code).toMatch(BOOKING_CODE_PATTERN);
    expect(codes.join('')).not.toMatch(/[01IO]/);
    expect(deriveBookingCode(secret, ids[0])).toBe(codes[0]);
    expect(deriveBookingCode('another-secret-at-least-32-characters', ids[0])).not.toBe(codes[0]);
    expect(new Set(codes).size).toBeGreaterThan(1990);
  });

  it('normalises input and keeps legacy hex codes', () => {
    expect(normalizeBookingCode(' k7m-4xq ')).toBe('K7M4XQ');
    expect(normalizeBookingCode('ABCDEF0123456789ABCDEF0123456789')).toBe('abcdef0123456789abcdef0123456789');
    expect(normalizeBookingCode(42)).toBe(42);
    expect(BOOKING_CODE_INPUT_PATTERN.test('K7M4XQ')).toBe(true);
    expect(BOOKING_CODE_INPUT_PATTERN.test('a'.repeat(32))).toBe(true);
    expect(BOOKING_CODE_INPUT_PATTERN.test('K7M4X0')).toBe(false);
    expect(BOOKING_CODE_INPUT_PATTERN.test('K7M4X')).toBe(false);
  });

  it('hashes new codes with the secret and legacy codes as before', () => {
    expect(bookingCodeHash(secret, 'K7M4XQ')).not.toBe(bookingCodeHash('another-secret-at-least-32-characters', 'K7M4XQ'));
    expect(bookingCodeHash(secret, 'f'.repeat(32))).toBe(require('node:crypto').createHash('sha256').update('f'.repeat(32)).digest('hex'));
  });
});
