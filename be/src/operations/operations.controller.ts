import { Controller, Get, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { PG_POOL } from '../platform/database/database.module';
import { RequestMetricsService } from './request-metrics.service';

@ApiTags('operations')
@Controller()
export class OperationsController {
  constructor(
    @Inject(PG_POOL) private readonly db: Pool,
    private readonly metrics: RequestMetricsService
  ) {}

  @Get('health/live')
  @ApiOperation({ summary: 'Check whether the process is alive' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @ApiOperation({ summary: 'Check whether the service can use PostgreSQL' })
  @ApiResponse({ status: 200, description: 'Service and database are ready' })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  async ready(): Promise<{ status: 'ok'; dependencies: { database: 'ok' } }> {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', dependencies: { database: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error', dependencies: { database: 'unavailable' }
      });
    }
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Expose process-local HTTP metrics in Prometheus text format' })
  @ApiProduces('text/plain')
  @ApiResponse({ status: 200, description: 'Prometheus text exposition' })
  metricsEndpoint(@Res() response: Response): void {
    response.type('text/plain; version=0.0.4; charset=utf-8').send(this.metrics.renderPrometheus());
  }
}
