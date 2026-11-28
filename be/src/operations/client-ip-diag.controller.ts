import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { CronSecretGuard } from '../jobs/cron-secret.guard';
import { FORWARDED_IP_HEADER, resolveClientIp } from '../platform/http/client-ip';

const OBSERVED_HEADERS = ['x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for', 'forwarded', 'cf-connecting-ip', 'x-forwarded-host', 'via'];

/**
 * OPS-007 diagnostic: shows how this request's client IP is seen and resolved, to choose CLIENT_IP_HEADER /
 * CLIENT_IP_PROXY_SECRET / TRUST_PROXY_HOPS on a real deployment. Same protection as the cron jobs: `Authorization:
 * Bearer $CRON_SECRET`, otherwise 404; excluded from OpenAPI. Reports only the caller's own request data, never secrets.
 */
@ApiExcludeController()
@UseGuards(CronSecretGuard)
@Controller('internal/diag')
export class ClientIpDiagController {
  @Get('client-ip')
  clientIp(@Req() request: Request) {
    const headers: Record<string, string | null> = {};
    for (const name of OBSERVED_HEADERS) {
      const value = request.headers[name];
      headers[name] = Array.isArray(value) ? value.join(', ') : value ?? null;
    }
    return {
      resolved: resolveClientIp(request),
      reqIp: request.ip ?? null,
      socketAddress: request.socket?.remoteAddress ?? null,
      config: {
        trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
        clientIpHeader: process.env.CLIENT_IP_HEADER || null,
        proxySecretConfigured: Boolean(process.env.CLIENT_IP_PROXY_SECRET)
      },
      forwardedByProxy: Boolean(request.headers[FORWARDED_IP_HEADER]),
      headers
    };
  }
}
