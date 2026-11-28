// Display helpers for PAY-007 / PD-036 cash reconciliation. Amounts are VND integer strings handled with BigInt.
export type LedgerKind = 'DEPOSIT' | 'CASH' | 'SURCHARGE' | 'REVERSAL' | 'REFUND';
export type ReversalType = 'HOLD_DEPOSIT' | 'MANUAL_PAYMENT' | 'SURCHARGE';
export type Settlement = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'CLOSED';
export type LedgerEntry = { kind: LedgerKind; id: string; amountVnd: string; note: string | null; reversesType: ReversalType | null; reversesId: string | null; reversed: boolean; recordedBy: string; recordedAt: string };

export const kindLabel: Record<LedgerKind, string> = { DEPOSIT: 'Cọc', CASH: 'Thu tiền mặt', SURCHARGE: 'Phụ thu', REVERSAL: 'Đảo bút toán', REFUND: 'Hoàn tiền' };
export const reversalTargetLabel: Record<ReversalType, string> = { HOLD_DEPOSIT: 'cọc', MANUAL_PAYMENT: 'khoản thu tiền mặt', SURCHARGE: 'phụ thu' };
export const settlementLabel: Record<Settlement, string> = { UNPAID: 'Chưa thu', PARTIAL: 'Thu một phần', PAID: 'Đã thu đủ', OVERPAID: 'Thu dư', CLOSED: 'Đã đóng' };
export const settlementTone: Record<Settlement, string> = { UNPAID: 'rose', PARTIAL: 'amber', PAID: 'green', OVERPAID: 'purple', CLOSED: 'gray' };

/** Which reversal type corrects an entry; null for entries that cannot be reversed (reversals, refunds, already reversed). */
export function reversalTypeOf(entry: Pick<LedgerEntry, 'kind' | 'reversed'>): ReversalType | null {
  if (entry.reversed) return null;
  return entry.kind === 'DEPOSIT' ? 'HOLD_DEPOSIT' : entry.kind === 'CASH' ? 'MANUAL_PAYMENT' : entry.kind === 'SURCHARGE' ? 'SURCHARGE' : null;
}

/** Sign shown next to an entry: surcharges add to the amount due, deposits/cash add to paid, reversals/refunds reduce. */
export function entrySign(kind: LedgerKind): '+' | '−' { return kind === 'REVERSAL' || kind === 'REFUND' ? '−' : '+'; }

/** Non-breaking space keeps "₫" on the same line as the number. */
export function money(value: string): string { return `${BigInt(value).toLocaleString('vi-VN')}\u00a0₫`; }

/** Amount that reduces a total: "−x ₫", or "0 ₫" when nothing (never "−0 ₫"). */
export function minus(value: string): string { return BigInt(value) === 0n ? money('0') : `−${money(value)}`; }

/** Balance wording: positive = still to collect, negative = collected more than due. */
export function balanceText(balanceVnd: string): string {
  const balance = BigInt(balanceVnd);
  return balance > 0n ? `Còn thiếu ${money(balanceVnd)}` : balance < 0n ? `Thu dư ${money((-balance).toString())}` : 'Đã khớp';
}
