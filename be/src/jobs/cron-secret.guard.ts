import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const MIN_CRON_SECRET_LENGTH = 16;

/** True only when CRON_SECRET is configured and the header is exactly `Bearer <CRON_SECRET>`. */
export function isAuthorizedCronRequest(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !authorization) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

/**
 * OPS-006: Vercel Cron calls job endpoints with `Authorization: Bearer $CRON_SECRET`.
 * Responds 404 (not 401/403) so the endpoints are not discoverable without the secret.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isAuthorizedCronRequest(request.headers.authorization, process.env.CRON_SECRET)) throw new NotFoundException();
    return true;
  }
}
