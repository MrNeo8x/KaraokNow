import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { CorrelatedRequest } from '../auth/auth.types';
import { RequestMetricsService } from '../../operations/request-metrics.service';

export interface RequestLogEntry {
  timestamp: string; level: 'info'; event: 'http_request'; correlationId: string;
  method: string; path: string; statusCode: number; durationMs: number;
  userId?: string; tenantId?: string;
}

export function buildRequestLog(request: CorrelatedRequest, statusCode: number, durationMs: number): RequestLogEntry {
  return {
    timestamp: new Date().toISOString(), level: 'info', event: 'http_request',
    correlationId: request.correlationId, method: request.method,
    path: request.originalUrl.split('?')[0], statusCode, durationMs,
    ...(request.actor?.userId ? { userId: request.actor.userId } : {}),
    ...(request.actor?.tenantId ? { tenantId: request.actor.tenantId } : {})
  };
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly metrics: RequestMetricsService) {}

  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      if (!request.originalUrl.startsWith('/v1/metrics')) {
        this.metrics?.observe(request.method, response.statusCode, durationMs / 1_000);
      }
      process.stdout.write(`${JSON.stringify(buildRequestLog(request, response.statusCode, Math.round(durationMs * 100) / 100))}\n`);
    });
    next();
  }
}
