import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HoldService } from '../booking/hold.service';
import { OutboxWorker } from '../outbox/outbox.worker';
import { CronSecretGuard } from './cron-secret.guard';
import { drainBatches } from './cron-batches';

const BUDGET_MS = 45_000;
const HOLD_BATCH = 100;
const OUTBOX_BATCH = 20;

/**
 * OPS-006: serverless replacement for the long-running `holds:expire` / `outbox:work` loops.
 * Invoked by Vercel Cron (be/vercel.json); each call drains due work within a time budget.
 * Internal only: excluded from OpenAPI, guarded by CRON_SECRET.
 */
@ApiExcludeController()
@UseGuards(CronSecretGuard)
@Controller('internal/cron')
export class CronJobsController {
  constructor(private readonly holds: HoldService, private readonly outbox: OutboxWorker) {}

  @Get('hold-expiry')
  async holdExpiry() {
    const result = await drainBatches(() => this.holds.expireBatch(HOLD_BATCH), HOLD_BATCH, BUDGET_MS);
    return { job: 'hold-expiry', ...result };
  }

  @Get('outbox')
  async outboxJob() {
    const result = await drainBatches(() => this.outbox.runOnce(300, OUTBOX_BATCH), OUTBOX_BATCH, BUDGET_MS);
    return { job: 'outbox', ...result };
  }
}
