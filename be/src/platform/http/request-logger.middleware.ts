import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { CorrelatedRequest } from '../auth/auth.types';
import { RequestMetricsService } from '../../operations/request-metrics.service';
import { context, defaultTextMapGetter, SpanKind, SpanStatusCode, trace, type SpanContext } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

export interface RequestLogEntry {
  timestamp: string; level: 'info'; event: 'http_request'; correlationId: string;
  method: string; path: string; statusCode: number; durationMs: number;
  traceId?: string; spanId?: string;
  userId?: string; tenantId?: string;
}

export function buildRequestLog(request: CorrelatedRequest, statusCode: number, durationMs: number,
                                spanContext?: SpanContext): RequestLogEntry {
  return {
    timestamp: new Date().toISOString(), level: 'info', event: 'http_request',
    correlationId: request.correlationId, method: request.method,
    path: request.originalUrl.split('?')[0], statusCode, durationMs,
    ...(spanContext?.traceId ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}),
    ...(request.actor?.userId ? { userId: request.actor.userId } : {}),
    ...(request.actor?.tenantId ? { tenantId: request.actor.tenantId } : {})
  };
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(private readonly metrics: RequestMetricsService) {}

  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const parentContext = new W3CTraceContextPropagator().extract(context.active(), request.headers, defaultTextMapGetter);
    const route = request.originalUrl.split('?')[0];
    trace.getTracer('karaokenow-http').startActiveSpan(`${request.method} ${route}`, {
      kind: SpanKind.SERVER
    }, parentContext, (span) => {
      const activeSpanContext = span.spanContext();
      const startedAt = process.hrtime.bigint();
      if (activeSpanContext.traceId) response.setHeader('X-Trace-ID', activeSpanContext.traceId);
      response.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        span.setAttribute('http.request.method', request.method);
        span.setAttribute('url.path', route);
        span.setAttribute('http.response.status_code', response.statusCode);
        if (response.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        if (!request.originalUrl.startsWith('/v1/metrics')) {
          this.metrics.observe(request.method, response.statusCode, durationMs / 1_000);
        }
        process.stdout.write(`${JSON.stringify(buildRequestLog(request, response.statusCode,
          Math.round(durationMs * 100) / 100, activeSpanContext))}\n`);
      });
      next();
    });
  }
}
