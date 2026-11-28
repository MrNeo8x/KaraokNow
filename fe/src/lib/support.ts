// Super Admin read-only support sessions (FE-021, IAM-009, PD-045): pure helpers shared by the Platform and merchant areas.
// The browser-side write block lives in api.ts (setReadOnlyGuard / isMerchantWrite).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant opened from the Platform area through `/merchant?support=<tenantId>`; null when absent or not a UUID. */
export function supportTenantFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('support');
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Link the Platform area uses to open a merchant in a support session. */
export function supportHref(tenantId: string): string { return `/merchant?support=${encodeURIComponent(tenantId)}`; }

/** Whole minutes left before `expiresAt` (0 when expired). */
export function minutesLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 60_000));
}
