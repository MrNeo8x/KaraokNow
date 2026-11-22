import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { NOTIFICATION_ADAPTER, NotificationAdapter, NotificationRequest } from '../notification/notification.port';
import { PG_POOL } from '../platform/database/database.module';
import { randomUUID } from 'node:crypto';
import { runOutboxLoop } from './outbox-loop';

interface OutboxRow {
  id: string; event_type: string; payload: unknown; attempts: number; claim_token: string;
}

@Injectable()
export class OutboxWorker {
  private abort = new AbortController();
  constructor(@Inject(PG_POOL) private readonly db: Pool,
              @Inject(NOTIFICATION_ADAPTER) private readonly notifications: NotificationAdapter) {}

  async runOnce(staleAfterSeconds = 300, batchSize = 20): Promise<number> {
    await this.db.query(
      `UPDATE outbox_events SET status='PENDING',locked_at=NULL,claim_token=NULL,last_error='stale_lock_recovered',available_at=now()
       WHERE status='PROCESSING' AND locked_at < now()-($1 || ' seconds')::interval`, [staleAfterSeconds]);
    const client = await this.db.connect();
    let events: OutboxRow[];
    try {
      await client.query('BEGIN');
      events = (await client.query<OutboxRow>(
        `WITH claimed AS (
           SELECT id FROM outbox_events WHERE status='PENDING' AND available_at<=now()
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE outbox_events e SET status='PROCESSING',locked_at=now(),claim_token=$2,attempts=e.attempts+1
         FROM claimed WHERE e.id=claimed.id RETURNING e.id,e.event_type,e.payload,e.attempts,e.claim_token`, [batchSize, randomUUID()])).rows;
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    for (const event of events) {
      try {
        await this.dispatch(event);
        await this.db.query(
          `UPDATE outbox_events SET status='PUBLISHED',published_at=now(),locked_at=NULL,claim_token=NULL,last_error=NULL
           WHERE id=$1 AND status='PROCESSING' AND claim_token=$2`, [event.id, event.claim_token]);
      } catch (error) {
        const dead = event.attempts >= 5;
        const delaySeconds = Math.min(300, 2 ** event.attempts);
        await this.db.query(
          `UPDATE outbox_events SET status=$2::varchar,locked_at=NULL,claim_token=NULL,last_error=$3,
             available_at=CASE WHEN $2::varchar='PENDING' THEN now()+($4::text || ' seconds')::interval ELSE available_at END
           WHERE id=$1 AND status='PROCESSING' AND claim_token=$5`,
          [event.id, dead ? 'DEAD' : 'PENDING', this.safeError(error), delaySeconds, event.claim_token]);
      }
    }
    return events.length;
  }

  async runLoop(intervalMs = 1000): Promise<void> {
    this.abort = new AbortController();
    await runOutboxLoop(() => this.runOnce(), this.abort.signal,
      event => process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`), intervalMs);
  }
  stop(): void { this.abort.abort(); }

  private async dispatch(event: OutboxRow): Promise<void> {
    if (event.event_type !== 'NOTIFICATION_REQUESTED') throw new Error('Unsupported outbox event type');
    const payload = event.payload as Partial<NotificationRequest>;
    if (!payload.channel || !payload.destinationRef || !payload.template || !payload.variables) {
      throw new Error('Invalid notification payload');
    }
    await this.notifications.deliver(payload as NotificationRequest);
  }
  private safeError(error: unknown): string {
    if (!(error instanceof Error)) return 'DeliveryError';
    return ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(error.name) ? error.name : 'DeliveryError';
  }
}
