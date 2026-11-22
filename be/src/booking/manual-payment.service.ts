import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { PolicyListQueryDto } from './policy-list.dto';
import { RecordManualPaymentDto } from './manual-payment.dto';

const fields = `id,booking_id AS "bookingId",branch_id AS "branchId",method,amount_vnd::text AS "amountVnd",note,recorded_by AS "recordedBy",recorded_at AS "recordedAt"`;
@Injectable()
export class ManualPaymentService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}
  private async booking(db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, actor: Actor, id: string) {
    const row = (await db.query(`SELECT id,branch_id AS "branchId" FROM bookings WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0];
    if (!row) throw new NotFoundException('Booking not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(row.branchId)) throw new ForbiddenException('Branch access denied');
    return row;
  }
  async list(actor: Actor, bookingId: string, query: PolicyListQueryDto) {
    await this.booking(this.db, actor, bookingId);
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT ${fields} FROM manual_payments WHERE tenant_id=$1 AND booking_id=$2 ORDER BY recorded_at,id LIMIT $3 OFFSET $4`, [actor.tenantId,bookingId,limit+1,offset])).rows;
    return { items: rows.slice(0,limit), limit, offset, hasMore: rows.length > limit };
  }
  async record(actor: Actor, bookingId: string, key: string, dto: RecordManualPaymentDto) {
    if (!key || !/^[\x21-\x7e]{1,100}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 1–100 visible ASCII characters');
    if (BigInt(dto.amountVnd) > 9223372036854775807n) throw new UnprocessableEntityException('Amount exceeds database limit');
    const hash = createHash('sha256').update(JSON.stringify([bookingId,dto.method,dto.amountVnd,dto.note ?? null])).digest('hex');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`manual-payment:${actor.tenantId}:${actor.userId}:${key}`]);
      const booking = await this.booking(client, actor, bookingId);
      const prior = (await client.query(`SELECT ${fields},request_hash FROM manual_payments WHERE tenant_id=$1 AND recorded_by=$2 AND idempotency_key=$3`, [actor.tenantId,actor.userId,key])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('Idempotency key was used for a different payment');
        delete prior.request_hash; await client.query('COMMIT'); return prior;
      }
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO manual_payments(id,tenant_id,branch_id,booking_id,method,amount_vnd,note,recorded_by,idempotency_key,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${fields}`,
      [id,actor.tenantId,booking.branchId,bookingId,dto.method,dto.amountVnd,dto.note ?? null,actor.userId,key,hash])).rows[0];
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
        VALUES($1,$2,$3,'MANUAL_PAYMENT_RECORDED','MANUAL_PAYMENT',$4,$5)`, [randomUUID(),actor.tenantId,actor.userId,id,JSON.stringify({ bookingId,method:dto.method,amountVnd:dto.amountVnd })]);
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
