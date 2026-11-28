import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { PG_POOL } from '../platform/database/database.module';

/** Vercel Hobby runs the cron jobs once a day, so the default thresholds allow one missed slot plus margin. */
export const DEFAULT_JOB_LAG_MINUTES = 26 * 60;

class HoldExpiryCheckDto {
  @ApiProperty({ description: 'HELD holds past their TTL that no job or request has expired yet' }) overdue!: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Minutes since the oldest overdue hold expired' }) oldestOverdueMinutes!: number | null;
  @ApiProperty() thresholdMinutes!: number;
  @ApiProperty() ok!: boolean;
}
class OutboxCheckDto {
  @ApiProperty({ description: 'PENDING events already due' }) due!: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Minutes the oldest due event has been waiting' }) oldestDueMinutes!: number | null;
  @ApiProperty({ description: 'Events that exhausted retries (DEAD)' }) dead!: number;
  @ApiProperty() thresholdMinutes!: number;
  @ApiProperty() ok!: boolean;
}
class JobChecksDto {
  @ApiProperty({ type: HoldExpiryCheckDto }) holdExpiry!: HoldExpiryCheckDto;
  @ApiProperty({ type: OutboxCheckDto }) outbox!: OutboxCheckDto;
}
export class JobHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty({ type: JobChecksDto }) checks!: JobChecksDto;
  @ApiProperty({ format: 'date-time' }) checkedAt!: string;
}

function threshold(name: string): number {
  const value = Number(process.env[name] ?? DEFAULT_JOB_LAG_MINUTES);
  return Number.isInteger(value) && value >= 1 && value <= 10080 ? value : DEFAULT_JOB_LAG_MINUTES;
}

/**
 * OPS-003 / PD-041: backlog of the background jobs (hold expiry, outbox) for an external uptime monitor.
 * Public on purpose (free monitors cannot send auth headers); returns only counts and ages — no tenant, customer or
 * event data. 200 when within thresholds, 503 when degraded, so the monitor alerts by status code alone.
 */
@ApiTags('operations')
@Controller('health')
export class JobHealthController {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Background job backlog for uptime monitoring (counts only)' })
  @ApiResponse({ status: 200, type: JobHealthDto, description: 'All checks within thresholds' })
  @ApiResponse({ status: 503, type: JobHealthDto, description: 'At least one check is over its threshold' })
  async jobs(@Res({ passthrough: true }) res: Response): Promise<JobHealthDto> {
    const holdLimit = threshold('JOB_HOLD_EXPIRY_MAX_LAG_MINUTES');
    const outboxLimit = threshold('JOB_OUTBOX_MAX_LAG_MINUTES');
    const row = (await this.db.query(`SELECT
        (SELECT count(*)::int FROM booking_holds WHERE status='HELD' AND expires_at<=clock_timestamp()) AS "overdue",
        (SELECT floor(extract(epoch FROM clock_timestamp()-min(expires_at))/60)::int FROM booking_holds WHERE status='HELD' AND expires_at<=clock_timestamp()) AS "oldestOverdueMinutes",
        (SELECT count(*)::int FROM outbox_events WHERE status='PENDING' AND available_at<=clock_timestamp()) AS "due",
        (SELECT floor(extract(epoch FROM clock_timestamp()-min(available_at))/60)::int FROM outbox_events WHERE status='PENDING' AND available_at<=clock_timestamp()) AS "oldestDueMinutes",
        (SELECT count(*)::int FROM outbox_events WHERE status='DEAD') AS "dead"`)).rows[0];
    const holdOk = (row.oldestOverdueMinutes ?? 0) <= holdLimit;
    const outboxOk = (row.oldestDueMinutes ?? 0) <= outboxLimit && row.dead === 0;
    const status = holdOk && outboxOk ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503);
    res.setHeader('Cache-Control', 'no-store');
    return {
      status,
      checks: {
        holdExpiry: { overdue: row.overdue, oldestOverdueMinutes: row.oldestOverdueMinutes, thresholdMinutes: holdLimit, ok: holdOk },
        outbox: { due: row.due, oldestDueMinutes: row.oldestDueMinutes, dead: row.dead, thresholdMinutes: outboxLimit, ok: outboxOk }
      },
      checkedAt: new Date().toISOString()
    };
  }
}
