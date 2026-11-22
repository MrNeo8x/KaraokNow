import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { NOTIFICATION_ADAPTER, NotificationAdapter, NotificationRequest } from '../notification/notification.port';
import { PG_POOL } from '../platform/database/database.module';

interface OutboxRow {
  id: string; event_type: string; payload: unknown; attempts: number;
}

@Injectable()
export class OutboxWorker {
  private stopping = false;
  constructor(@Inject(PG_POOL) private readonly db: Pool,
              @Inject(NOTIFICATION_ADAPTER) private readonly notifications: NotificationAdapter) {}

  async runOnce(staleAfterSeconds = 300, batchSize = 20): Promise<number> {
    await this.db.query(
      `UPDATE outbox_events SET status='PENDING',locked_at=NULL,last_error='stale_lock_recovered'
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
         UPDATE outbox_events e SET status='PROCESSING',locked_at=now(),attempts=e.attempts+1
         FROM claimed WHERE e.id=claimed.id RETURNING e.id,e.event_type,e.payload,e.attempts`, [batchSize])).rows;
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    for (const event of events) {
      try {
        await this.dispatch(event);
        await this.db.query(
          `UPDATE outbox_events SET status='PUBLISHED',published_at=now(),locked_at=NULL,last_error=NULL WHERE id=$1`, [event.id]);
      } catch (error) {
        const dead = event.attempts >= 5;
        const delaySeconds = Math.min(300, 2 ** event.attempts);
        await this.db.query(
          `UPDATE outbox_events SET status=$2::varchar,locked_at=NULL,last_error=$3,
             available_at=CASE WHEN $2::varchar='PENDING' THEN now()+($4::text || ' seconds')::interval ELSE available_at END
           WHERE id=$1`,
          [event.id, dead ? 'DEAD' : 'PENDING', this.safeError(error), delaySeconds]);
      }
    }
    return events.length;
  }

  async runLoop(intervalMs = 1000): Promise<void> {
    this.stopping = false;
    while (!this.stopping) {
      await this.runOnce();
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  stop(): void { this.stopping = true; }

  private async dispatch(event: OutboxRow): Promise<void> {
    if (event.event_type !== 'NOTIFICATION_REQUESTED') throw new Error('Unsupported outbox event type');
    const payload = event.payload as Partial<NotificationRequest>;
    if (!payload.channel || !payload.destinationRef || !payload.template || !payload.variables) {
      throw new Error('Invalid notification payload');
    }
    await this.notifications.deliver(payload as NotificationRequest);
  }
  private safeError(error: unknown): string {
    return error instanceof Error ? error.name.slice(0, 200) : 'DeliveryError';
  }
}
