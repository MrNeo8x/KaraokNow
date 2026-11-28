import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * FE-012 / PD-039: keep the staff session across reloads without exposing the refresh token to JavaScript storage.
 * Login and refresh set an HttpOnly, SameSite=Strict cookie scoped to /v1/auth. The browser reaches the BE through the FE
 * rewrite (same origin), so the cookie belongs to the FE host. Cookie-based refresh/logout also requires the header
 * `X-KN-Session: 1`, which a cross-site form cannot send (defence in depth on top of SameSite=Strict).
 * `AUTH_COOKIE_SECURE=false` drops the Secure flag for plain-HTTP local stacks (Safari ignores Secure cookies on http://localhost).
 */
export const REFRESH_COOKIE = 'kn_refresh';
export const REFRESH_COOKIE_PATH = '/v1/auth';
export const SESSION_HEADER = 'x-kn-session';

type Env = Record<string, string | undefined>;

function secure(env: Env): boolean { return env.AUTH_COOKIE_SECURE !== 'false'; }

export function setRefreshCookie(res: Response, token: string, maxAgeSeconds: number, env: Env = process.env): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, secure: secure(env), sameSite: 'strict', path: REFRESH_COOKIE_PATH, maxAge: maxAgeSeconds * 1000
  });
}

export function clearRefreshCookie(res: Response, env: Env = process.env): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: secure(env), sameSite: 'strict', path: REFRESH_COOKIE_PATH });
}

export function readRefreshCookie(req: Pick<Request, 'headers'>): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== REFRESH_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value) || undefined; } catch { return undefined; }
  }
  return undefined;
}

/** Body token wins (API clients); otherwise the cookie, only together with `X-KN-Session: 1`. */
export function refreshTokenFrom(req: Pick<Request, 'headers'>, bodyToken: string | undefined, required: boolean): string | undefined {
  if (bodyToken) return bodyToken;
  const cookie = req.headers[SESSION_HEADER] === '1' ? readRefreshCookie(req) : undefined;
  if (!cookie && required) throw new UnauthorizedException('Refresh token is missing');
  return cookie;
}
