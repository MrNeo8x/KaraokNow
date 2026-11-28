import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';

/** Keys holding a person's contact data (customers and staff). Branch `phone` is the business's public number and stays. */
const MASKED_KEYS = new Set(['customerPhone', 'customerEmail', 'email']);

export function maskPhone(value: string): string {
  if (value.length <= 7) return '•'.repeat(value.length);
  const local = value.startsWith('+84') ? `0${value.slice(3)}` : value;
  return `${local.slice(0, 4)}${'•'.repeat(Math.max(3, local.length - 7))}${local.slice(-3)}`;
}
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '•••';
  return `${value[0]}•••${value.slice(at)}`;
}

export function maskContactData(value: unknown, key?: string): unknown {
  if (typeof value === 'string' && key && MASKED_KEYS.has(key)) return key.toLowerCase().includes('email') ? maskEmail(value) : maskPhone(value);
  if (Array.isArray(value)) return value.map(item => maskContactData(item));
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskContactData(v, k)]));
  }
  return value;
}

/**
 * PD-045: in a Super Admin support session, every merchant response has customer/staff phone and email partially masked
 * (e.g. 0912•••678, n•••@gmail.com). Applies only when TenantGuard marked the actor as `support`.
 */
@Injectable()
export class SupportMaskInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>();
    return next.handle().pipe(map(body => (request.actor?.support ? maskContactData(body) : body)));
  }
}
