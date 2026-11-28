import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * OPS-007: client IP used for public per-IP rate limits.
 *
 * Production runs browser → FE (Vercel) → Next.js rewrite → BE (Vercel). `req.ip` without a correct proxy setup is the
 * platform's internal address, which would put every customer in one rate-limit bucket. Resolution order:
 *  1. `X-KN-Client-IP`, only when `X-KN-Proxy-Secret` equals `CLIENT_IP_PROXY_SECRET` (FE forwards the browser IP it saw).
 *  2. The header named by `CLIENT_IP_HEADER` (first entry), for platforms that overwrite it at their edge
 *     (e.g. `x-real-ip` / `x-vercel-forwarded-for` on Vercel) so callers cannot spoof it.
 *  3. Express `req.ip` (honours `TRUST_PROXY_HOPS`), then the socket address.
 * Every candidate must be a valid IPv4/IPv6 literal; invalid values fall through to the next source.
 */
export const CLIENT_IP_HEADERS = ['x-real-ip', 'x-vercel-forwarded-for', 'x-forwarded-for', 'cf-connecting-ip'] as const;
export const FORWARDED_IP_HEADER = 'x-kn-client-ip';
export const FORWARDED_SECRET_HEADER = 'x-kn-proxy-secret';
export const MIN_PROXY_SECRET_LENGTH = 16;

export type ClientIpSource = 'trusted-proxy' | 'platform-header' | 'request';
export interface ClientIpResolution { ip: string; source: ClientIpSource }

type Env = Record<string, string | undefined>;
type RequestLike = Pick<Request, 'headers' | 'ip'> & { socket?: { remoteAddress?: string } };

function header(request: RequestLike, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function firstIp(value: string | undefined): string | undefined {
  const candidate = value?.split(',')[0]?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return candidate && isIP(candidate) ? candidate : undefined;
}

function secretMatches(provided: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_PROXY_SECRET_LENGTH || !provided) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(secret));
}

export function resolveClientIp(request: RequestLike, env: Env = process.env): ClientIpResolution {
  if (secretMatches(header(request, FORWARDED_SECRET_HEADER), env.CLIENT_IP_PROXY_SECRET)) {
    const forwarded = firstIp(header(request, FORWARDED_IP_HEADER));
    if (forwarded) return { ip: forwarded, source: 'trusted-proxy' };
  }
  const configured = env.CLIENT_IP_HEADER?.toLowerCase();
  if (configured) {
    const fromPlatform = firstIp(header(request, configured));
    if (fromPlatform) return { ip: fromPlatform, source: 'platform-header' };
  }
  return { ip: firstIp(request.ip) ?? firstIp(request.socket?.remoteAddress) ?? request.ip ?? request.socket?.remoteAddress ?? 'unknown', source: 'request' };
}

/** Returns validation errors for the OPS-007 settings (used by env.validation.ts). */
export function validateClientIpSettings(env: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const headerName = env.CLIENT_IP_HEADER;
  if (headerName !== undefined && headerName !== '' && !(CLIENT_IP_HEADERS as readonly string[]).includes(String(headerName).toLowerCase())) {
    errors.push(`CLIENT_IP_HEADER must be one of ${CLIENT_IP_HEADERS.join(', ')}`);
  }
  const secret = env.CLIENT_IP_PROXY_SECRET;
  if (secret !== undefined && secret !== '' && String(secret).length < MIN_PROXY_SECRET_LENGTH) {
    errors.push(`CLIENT_IP_PROXY_SECRET must contain at least ${MIN_PROXY_SECRET_LENGTH} characters`);
  }
  return errors;
}
