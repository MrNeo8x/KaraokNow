export type DepositMode = 'NONE' | 'FIXED' | 'PERCENT';
export function depositPayload(mode: DepositMode, amount: string, percent: string) {
  if (mode === 'FIXED' && (!/^[1-9]\d{0,18}$/.test(amount) || BigInt(amount) > 9223372036854775807n)) throw new Error('Số tiền cọc phải là số nguyên VND hợp lệ, lớn hơn 0.');
  if (mode === 'PERCENT' && (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/.test(percent) || Number(percent) <= 0 || Number(percent) > 100)) throw new Error('Tỷ lệ cọc phải lớn hơn 0 và không quá 100%, tối đa 4 chữ số thập phân.');
  return { mode, fixedAmountVnd: mode === 'FIXED' ? amount : null, percent: mode === 'PERCENT' ? percent : null };
}
