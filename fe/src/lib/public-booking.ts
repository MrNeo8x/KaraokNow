export type PublicHoldBody = { roomId: string; startAt: string; durationMinutes: number; phone: string; email?: string; expectedTotalAmountVnd: string; termsVersion: string };
export type PublicHoldAttempt = { key: string; body: PublicHoldBody };
export type PublicHoldReceipt = { holdId: string; branchId: string; roomId: string; startAt: string; durationMinutes: number; reservedEndAt: string; expiresAt: string; status: 'HELD' | 'EXPIRED' | 'CONFIRMED'; totalAmountVnd: string; termsVersion: string; depositRequiredVnd?: string; bookingCode: string; phone: string };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const PUBLIC_HOLD_ATTEMPT_KEY = 'karaokenow:public-hold-attempt:v1';
export const PUBLIC_HOLD_RECEIPT_KEY = 'karaokenow:public-hold-receipt:v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Removes common separators; returns null unless the result matches the backend rule `^\+?\d{8,15}$`. The backend still normalizes 0…/84…/+84…. */
export function cleanPhone(value: string): string | null {
  const cleaned = value.trim().replace(/[\s.\-()]/g, '');
  return /^\+?\d{8,15}$/.test(cleaned) ? cleaned : null;
}

export function cleanBookingCode(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/\s/g, '');
  return /^[a-f0-9]{32}$/.test(cleaned) ? cleaned : null;
}

function sameBody(a: PublicHoldBody, b: PublicHoldBody): boolean {
  const keys: (keyof PublicHoldBody)[] = ['roomId', 'startAt', 'durationMinutes', 'phone', 'email', 'expectedTotalAmountVnd', 'termsVersion'];
  return keys.every(key => (a[key] ?? null) === (b[key] ?? null));
}

/** Reuses the stored idempotency key only for an identical body; any change starts a new attempt. */
export function prepareAttempt(stored: PublicHoldAttempt | null, body: PublicHoldBody, newKey: () => string): PublicHoldAttempt {
  return stored && sameBody(stored.body, body) ? stored : { key: newKey(), body };
}

/** 429, 5xx and network failures may be retried later with the same key and body; other errors end the attempt. */
export function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

export function readAttempt(storage: Store): PublicHoldAttempt | null {
  try {
    const data = JSON.parse(storage.getItem(PUBLIC_HOLD_ATTEMPT_KEY) ?? 'null');
    if (!data) return null;
    const body = data.body;
    if (!uuid.test(data.key) || !uuid.test(body?.roomId) || typeof body.startAt !== 'string' || !Number.isInteger(body.durationMinutes) || !cleanPhone(body.phone ?? '') || (body.email !== undefined && typeof body.email !== 'string') || !/^(0|[1-9]\d{0,19})$/.test(body.expectedTotalAmountVnd) || !/^[1-9]\d*$/.test(body.termsVersion)) return null;
    return data as PublicHoldAttempt;
  } catch { return null; }
}

export function readReceipt(storage: Store): PublicHoldReceipt | null {
  try {
    const data = JSON.parse(storage.getItem(PUBLIC_HOLD_RECEIPT_KEY) ?? 'null');
    if (!data || !uuid.test(data.holdId) || !cleanBookingCode(data.bookingCode ?? '') || !cleanPhone(data.phone ?? '') || typeof data.startAt !== 'string' || typeof data.totalAmountVnd !== 'string') return null;
    return data as PublicHoldReceipt;
  } catch { return null; }
}

export function save(storage: Store, key: string, value: unknown): void { try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: in-memory state still works */ } }
export function clear(storage: Store, key: string): void { try { storage.removeItem(key); } catch { /* ignore */ } }
