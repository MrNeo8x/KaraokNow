import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface EnqueueEvent {
  tenantId?: string; eventType: string; aggregateType: string; aggregateId: string;
  payload: Record<string, unknown>; availableAt?: Date;
}

@Injectable()
export class OutboxService {
  async enqueue(client: PoolClient, event: EnqueueEvent): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,payload,available_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()))`,
      [id, event.tenantId ?? null, event.eventType, event.aggregateType, event.aggregateId,
        JSON.stringify(event.payload), event.availableAt ?? null]);
    return id;
  }
}
