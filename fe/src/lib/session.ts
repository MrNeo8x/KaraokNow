// Staff session (IAM-007, PD-039). The refresh token lives only in the HttpOnly `kn_refresh` cookie set by the BE
// (path /v1/auth, same origin through the FE rewrite); the browser keeps just the short-lived access token in memory.
export type Session = { accessToken: string; expiresIn: number; mustChangePassword: boolean };

/** Validates login/refresh responses. Any `refreshToken` in the body is ignored on purpose (never stored). */
export function parseSession(value: unknown): Session {
  if (!value || typeof value !== 'object') throw new Error('Phản hồi phiên không hợp lệ. Vui lòng đăng nhập lại.');
  const data = value as Record<string, unknown>;
  if (typeof data.accessToken !== 'string' || !data.accessToken || typeof data.expiresIn !== 'number' || !Number.isSafeInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > 86400 || typeof data.mustChangePassword !== 'boolean') throw new Error('Phản hồi phiên không hợp lệ. Vui lòng đăng nhập lại.');
  return { accessToken: data.accessToken, expiresIn: data.expiresIn, mustChangePassword: data.mustChangePassword };
}

export function refreshDelay(expiresIn: number): number { return Math.max(1000, (expiresIn - 60) * 1000); }

export type RefreshResult = { kind: 'session'; session: Session } | { kind: 'signed-out' } | { kind: 'retry'; reason: string };

/** 401 means no usable cookie (BE cleared it) → sign in again; 409/503/network are transient → retry, keep the cookie. */
export function classifyRefresh(status: number | null): 'signed-out' | 'retry' | 'ok' {
  if (status === null) return 'retry';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'signed-out';
  return 'retry';
}

const COOKIE_HEADERS = { 'content-type': 'application/json', 'X-KN-Session': '1' };

export async function cookieRefresh(fetcher: typeof fetch = fetch): Promise<RefreshResult> {
  let response: Response;
  try { response = await fetcher('/v1/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: COOKIE_HEADERS, body: '{}' }); }
  catch { return { kind: 'retry', reason: 'Mất kết nối khi làm mới phiên.' }; }
  const kind = classifyRefresh(response.status);
  if (kind === 'signed-out') return { kind };
  if (kind === 'retry') return { kind, reason: `Máy chủ tạm thời không làm mới được phiên (${response.status}).` };
  try { return { kind: 'session', session: parseSession(await response.json()) }; }
  catch { return { kind: 'retry', reason: 'Phản hồi phiên không hợp lệ.' }; }
}

/** Revokes the cookie's token family and clears the cookie; a network failure is reported, never retried silently. */
export async function cookieLogout(fetcher: typeof fetch = fetch): Promise<boolean> {
  try { const response = await fetcher('/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: COOKIE_HEADERS, body: '{}' }); return response.ok; }
  catch { return false; }
}

// Last merchant opened in this browser (not a secret; always re-checked against GET /v1/me/tenants).
export type MyTenant = { tenantId: string; tenantName: string; tenantStatus: 'ACTIVE' | 'INACTIVE'; roles: string[] };
export const LAST_TENANT_KEY = 'karaokenow:last-tenant:v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readLastTenant(storage: Store | null): string | null { try { return storage?.getItem(LAST_TENANT_KEY) ?? null; } catch { return null; } }
export function rememberTenant(storage: Store | null, tenantId: string): void { try { storage?.setItem(LAST_TENANT_KEY, tenantId); } catch { /* storage unavailable */ } }
export function forgetTenant(storage: Store | null): void { try { storage?.removeItem(LAST_TENANT_KEY); } catch { /* ignore */ } }

/** Auto-open a merchant when it is unambiguous: the only membership, or the remembered one still in the list. */
export function autoTenant(tenants: MyTenant[], remembered: string | null): string | null {
  if (tenants.length === 1) return tenants[0].tenantId;
  return remembered && tenants.some(tenant => tenant.tenantId === remembered) ? remembered : null;
}
