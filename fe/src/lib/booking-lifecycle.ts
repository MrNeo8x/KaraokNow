export type BookingStatus = 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type OutcomeType = 'CUSTOMER_CANCELLED' | 'MERCHANT_CANCELLED' | 'NO_SHOW';

export const bookingStatusLabel: Record<BookingStatus, string> = { CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đang sử dụng', COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', NO_SHOW: 'Khách không đến' };
export const outcomeLabel: Record<OutcomeType, string> = { CUSTOMER_CANCELLED: 'Khách hủy', MERCHANT_CANCELLED: 'Cơ sở hủy', NO_SHOW: 'Khách không đến' };

/** Transitions the backend accepts from each status (PD-025…PD-028). Role checks stay on the backend. */
export function allowedActions(status: string): { checkIn: boolean; checkOut: boolean; outcome: boolean } {
  return { checkIn: status === 'CONFIRMED', checkOut: status === 'CHECKED_IN', outcome: status === 'CONFIRMED' };
}

/** Positive whole VND as a decimal string (no sign, no leading zero). */
export function parseVnd(value: string, { allowZero = false } = {}): bigint | null {
  const cleaned = value.trim().replace(/[.,\s]/g, '');
  if (!(allowZero ? /^(0|[1-9]\d{0,18})$/ : /^[1-9]\d{0,18}$/).test(cleaned)) return null;
  return BigInt(cleaned);
}

/** Validates a CASH deposit entry against the remaining required deposit returned by the backend. */
export function depositAmountError(value: string, remainingVnd: string): string | null {
  const amount = parseVnd(value);
  if (amount === null) return 'Số tiền cọc phải là số nguyên dương (VND).';
  if (amount > BigInt(remainingVnd)) return `Số tiền vượt số cọc còn thiếu (${BigInt(remainingVnd).toLocaleString('vi-VN')} ₫).`;
  return null;
}

/** NONE needs the channel no-deposit permission; FIXED/PERCENT need the recorded deposit to cover the snapshot — unless a
 * deposit-exemption case applies (PD-050), which also lets the backend confirm without the channel permission. */
export function confirmationMode(snapshot: { mode: string } | null | undefined, depositSatisfied: boolean | undefined, exempt = false): 'NO_SNAPSHOT' | 'NO_DEPOSIT' | 'DEPOSIT_MISSING' | 'DEPOSIT_COVERED' | 'EXEMPT' {
  if (!snapshot) return 'NO_SNAPSHOT';
  if (snapshot.mode !== 'NONE' && depositSatisfied) return 'DEPOSIT_COVERED';
  if (exempt) return 'EXEMPT';
  return snapshot.mode === 'NONE' ? 'NO_DEPOSIT' : 'DEPOSIT_MISSING';
}
