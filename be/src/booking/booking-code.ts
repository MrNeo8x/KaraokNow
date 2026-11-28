import { createHash, createHmac } from 'node:crypto';

/**
 * PD-038: public booking code = 6 characters from digits and upper-case letters, without the look-alikes 0/O and 1/I
 * (32 symbols, ~1.07 billion codes). The code is derived from the hold id with a server secret, so idempotent replays
 * return the same code without storing it; only a keyed hash is persisted. Lookup always needs the phone number too, and
 * is rate limited per phone (10 / 15 min by default), which keeps guessing a code for a known phone impractical.
 * Codes issued before PD-038 (32 lower-case hex characters, unkeyed SHA-256) remain valid for lookup.
 */
export const BOOKING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const BOOKING_CODE_LENGTH = 6;
export const BOOKING_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export const LEGACY_BOOKING_CODE_PATTERN = /^[a-f0-9]{32}$/;
/** Accepted on lookup: new 6-character code (any case, spaces/hyphens ignored) or a legacy 32-hex code. */
export const BOOKING_CODE_INPUT_PATTERN = /^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}|[a-f0-9]{32})$/;

export function deriveBookingCode(secret: string, holdId: string): string {
  const digest = createHmac('sha256', secret).update(`booking-code-v2:${holdId}`).digest();
  let code = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i += 1) code += BOOKING_CODE_ALPHABET[digest[i] & 31];
  return code;
}

/** Normalises user input: trims, drops spaces and hyphens, upper-cases a short code. Legacy hex codes are kept as-is. */
export function normalizeBookingCode(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const compact = input.trim().replace(/[\s-]/g, '');
  return LEGACY_BOOKING_CODE_PATTERN.test(compact.toLowerCase()) ? compact.toLowerCase() : compact.toUpperCase();
}

export function bookingCodeHash(secret: string, code: string): string {
  return LEGACY_BOOKING_CODE_PATTERN.test(code)
    ? createHash('sha256').update(code).digest('hex')
    : createHmac('sha256', secret).update(`booking-code-hash:${code}`).digest('hex');
}
