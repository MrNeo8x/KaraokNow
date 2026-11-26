/**
 * Canonical form used to key public rate limits, idempotency and booking lookup (UAT-PD-004).
 * Input is already validated as `^\+?\d{8,15}$`. Vietnamese local and country-code variants
 * collapse to `+84…`; other `+` numbers are kept; anything else is returned unchanged because
 * its country cannot be inferred safely.
 */
export function normalizePhone(phone: string): string {
  if (phone.startsWith('+840')) return `+84${phone.slice(4)}`;
  if (phone.startsWith('+')) return phone;
  if (phone.startsWith('0')) return `+84${phone.slice(1)}`;
  if (phone.startsWith('84') && phone.length >= 11 && phone.length <= 12) return `+${phone}`;
  return phone;
}
