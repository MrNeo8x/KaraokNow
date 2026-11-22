export type PriceAmountUnit = 'PER_HOUR' | 'PER_BOOKING';

/** Calculate a VND amount using integer arithmetic; hourly fractions round half up to 1 VND. */
export function calculatePriceRuleAmount(configuredAmountVnd: string, amountUnit: PriceAmountUnit,
                                         durationMinutes: number): string {
  if (!/^\d+$/.test(configuredAmountVnd)) throw new Error('Configured VND amount must be a non-negative integer');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new Error('Duration must be an integer from 1 to 1440 minutes');
  }
  const amount = BigInt(configuredAmountVnd);
  if (amountUnit === 'PER_BOOKING') return amount.toString();
  const weighted = amount * BigInt(durationMinutes);
  return ((weighted + 30n) / 60n).toString();
}
