import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { AttachHoldDetailsDto, CreateHoldDto, ListHoldsDto } from './hold.dto';
import { PricingService } from '../pricing/pricing.service';
import { snapshotDepositPolicy } from './deposit-snapshot';
import { lockRoomOccupancy } from '../availability/occupancy-lock';

const fields = `h.id,h.branch_id AS "branchId",h.room_id AS "roomId",h.channel,h.start_at AS "startAt",h.duration_minutes AS "durationMinutes",h.buffer_minutes AS "bufferMinutes",upper(o.occupied_range) AS "reservedEndAt",h.expires_at AS "expiresAt",h.status,h.customer_phone AS "customerPhone",h.customer_email AS "customerEmail",h.price_snapshot AS "priceSnapshot",h.phone_verified_at AS "phoneVerifiedAt",h.phone_verified_by AS "phoneVerifiedBy",h.deposit_policy_snapshot AS "depositPolicySnapshot"`;

@Injectable()
export class HoldService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly pricing: PricingService) {}
  async expiryBacklog(actor: Actor): Promise<{ overdueCount: string; oldestOverdueSeconds: number | null }> {
    const result = await this.db.query<{ overdueCount: string; oldestOverdueSeconds: number | null }>(
      `SELECT count(*)::text AS "overdueCount",extract(epoch FROM (statement_timestamp()-min(expires_at)))::double precision AS "oldestOverdueSeconds"
       FROM booking_holds WHERE tenant_id=$1 AND status='HELD' AND expires_at<=statement_timestamp()`, [actor.tenantId]);
    return result.rows[0];
  }
  async recordPhoneVerification(actor: Actor, id: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const hold = (await client.query(`SELECT branch_id AS "branchId",customer_phone AS "customerPhone",phone_verified_at AS "phoneVerifiedAt",status,expires_at>clock_timestamp() AS valid
        FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, id])).rows[0];
      if (!hold) throw new NotFoundException('Hold not found');
      this.assertBranch(actor, hold.branchId);
      if (hold.status !== 'HELD' || !hold.valid) throw new ConflictException('Hold has expired');
      if (!hold.customerPhone) throw new ConflictException('Customer phone must be recorded first');
      if (!hold.phoneVerifiedAt) {
        const updated = await client.query(`UPDATE booking_holds SET phone_verified_at=clock_timestamp(),phone_verified_by=$3,updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND id=$2 AND status='HELD' AND expires_at>clock_timestamp()`, [actor.tenantId, id, actor.userId]);
        if (!updated.rowCount) throw new ConflictException('Hold has expired');
        await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
          VALUES($1,$2,$3,'HOLD_PHONE_VERIFIED','BOOKING_HOLD',$4,$5)`,
        [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify({ method: 'STAFF_PHONE_CALL' })]);
      }
      const result = await this.find(client, actor.tenantId!, id);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async attachDetails(actor: Actor, id: string, dto: AttachHoldDetailsDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const hold = (await client.query(`SELECT branch_id AS "branchId",room_id AS "roomId",channel,start_at AS "startAt",duration_minutes AS "durationMinutes",
        customer_phone AS "customerPhone",customer_email AS "customerEmail",price_snapshot AS "priceSnapshot",status,expires_at>clock_timestamp() AS valid
        FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, id])).rows[0];
      if (!hold) throw new NotFoundException('Hold not found');
      this.assertBranch(actor, hold.branchId);
      if (hold.status !== 'HELD' || !hold.valid) throw new ConflictException('Hold has expired');
      if (hold.priceSnapshot) {
        if (hold.customerPhone !== dto.phone || (hold.customerEmail ?? null) !== (dto.email ?? null) || hold.priceSnapshot.totalAmountVnd !== dto.expectedTotalAmountVnd) throw new ConflictException('Hold details are already recorded');
        const existing = await this.find(client, actor.tenantId!, id);
        await client.query('COMMIT'); return existing;
      }
      const quote = await this.pricing.quote(actor, hold.roomId, { startAt: hold.startAt.toISOString(), durationMinutes: hold.durationMinutes }, client);
      if (quote.priceSnapshot.totalAmountVnd !== dto.expectedTotalAmountVnd) throw new ConflictException('Price has changed; request a new quote');
      const deposit = await snapshotDepositPolicy(client, actor.tenantId!, hold.channel, quote.priceSnapshot.totalAmountVnd);
      const updated = await client.query(`UPDATE booking_holds SET customer_phone=$3,customer_email=$4,price_snapshot=$5,deposit_policy_snapshot=$6,updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND id=$2 AND status='HELD' AND expires_at>clock_timestamp()`,
      [actor.tenantId, id, dto.phone, dto.email ?? null, JSON.stringify(quote.priceSnapshot), JSON.stringify(deposit)]);
      if (!updated.rowCount) throw new ConflictException('Hold has expired');
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'HOLD_DETAILS_ATTACHED','BOOKING_HOLD',$4,$5)`,
        [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify({ priceRuleId: quote.priceSnapshot.calculation.priceRuleId, priceRuleVersion: quote.priceSnapshot.calculation.priceRuleVersion, customerDetailsRecorded: true, depositMode: deposit.mode, depositPolicyVersion: deposit.policyVersion, requiredDepositVnd: deposit.requiredAmountVnd })]);
      const result = await this.find(client, actor.tenantId!, id);
      await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as {code?: string}).code === '40001') throw new ConflictException('Hold changed concurrently; retry the request');
      throw error;
    } finally { client.release(); }
  }
  async list(actor: Actor, branchId: string, query: ListHoldsDto) {
    const from = new Date(query.from), to = new Date(query.to);
    const zone = /[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/;
    if (!zone.test(query.from) || !zone.test(query.to) || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      throw new UnprocessableEntityException('from and to must be timestamps with explicit timezones, and to must be after from');
    }
    const branch = (await this.db.query('SELECT id FROM branches WHERE tenant_id=$1 AND id=$2', [actor.tenantId, branchId])).rows[0];
    if (!branch) throw new NotFoundException('Branch not found');
    this.assertBranch(actor, branchId);
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const result = await this.db.query(`SELECT h.id,h.branch_id AS "branchId",h.room_id AS "roomId",h.channel,h.start_at AS "startAt",
      h.duration_minutes AS "durationMinutes",h.buffer_minutes AS "bufferMinutes",upper(o.occupied_range) AS "reservedEndAt",h.expires_at AS "expiresAt",
      CASE WHEN h.status='HELD' AND h.expires_at<=statement_timestamp() THEN 'EXPIRED' ELSE h.status END AS status
      FROM booking_holds h JOIN room_occupancy o ON o.id=h.occupancy_id
      WHERE h.tenant_id=$1 AND h.branch_id=$2 AND h.start_at<$4::timestamptz
        AND h.start_at+(h.duration_minutes*interval '1 minute')>$3::timestamptz
      ORDER BY h.start_at,h.id LIMIT $5 OFFSET $6`, [actor.tenantId, branchId, from.toISOString(), to.toISOString(), limit + 1, offset]);
    return { items: result.rows.slice(0, limit), limit, offset, hasMore: result.rows.length > limit };
  }
  async get(actor: Actor, id: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const hold = (await client.query(`SELECT branch_id AS "branchId" FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, id])).rows[0];
      if (!hold) throw new NotFoundException('Hold not found');
      this.assertBranch(actor, hold.branchId);
      await this.expireById(client, id);
      const result = await this.find(client, actor.tenantId!, id);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async create(actor: Actor, key: string, dto: CreateHoldDto) {
    if (!key || !/^[\x21-\x7e]{1,100}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 1–100 visible ASCII characters');
    const start = new Date(dto.startAt);
    if (!Number.isFinite(start.getTime()) || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(dto.startAt)) throw new UnprocessableEntityException('startAt must include an explicit timezone');
    const hash = createHash('sha256').update(JSON.stringify([dto.roomId, start.toISOString(), dto.durationMinutes, dto.channel])).digest('hex');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`hold:${actor.tenantId}:${actor.userId}:${key}`]);
      const existing = (await client.query(`SELECT h.id,h.request_hash,h.branch_id AS "branchId" FROM booking_holds h WHERE h.tenant_id=$1 AND h.created_by=$2 AND h.idempotency_key=$3 FOR UPDATE`, [actor.tenantId, actor.userId, key])).rows[0];
      if (existing) {
        this.assertBranch(actor, existing.branchId);
        if (existing.request_hash !== hash) throw new ConflictException('Idempotency key was used for a different request');
        await this.expireById(client, existing.id);
        const replay = await this.find(client, actor.tenantId!, existing.id);
        await client.query('COMMIT'); return replay;
      }
      const room = (await client.query(`SELECT r.branch_id AS "branchId" FROM rooms r JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id WHERE r.id=$1 AND r.tenant_id=$2 AND r.status='ACTIVE' AND b.status='ACTIVE' FOR SHARE OF r,b`, [dto.roomId, actor.tenantId])).rows[0];
      if (!room) throw new NotFoundException('Active room not found');
      this.assertBranch(actor, room.branchId);
      const policy = (await client.query(`SELECT duration_step_minutes,min_duration_minutes,max_duration_minutes FROM tenant_booking_policies WHERE tenant_id=$1`, [actor.tenantId])).rows[0] ?? { duration_step_minutes: 30, min_duration_minutes: 60, max_duration_minutes: 480 };
      if (dto.durationMinutes < policy.min_duration_minutes || dto.durationMinutes > policy.max_duration_minutes || (dto.durationMinutes-policy.min_duration_minutes)%policy.duration_step_minutes !== 0) throw new UnprocessableEntityException('Requested duration does not match the merchant booking-duration policy');
      const buffer = (await client.query(`SELECT buffer_enabled,buffer_minutes FROM tenant_availability_policies WHERE tenant_id=$1`, [actor.tenantId])).rows[0] ?? { buffer_enabled: true, buffer_minutes: 15 };
      const ttl = (await client.query(`SELECT ttl_minutes FROM tenant_hold_ttl_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, dto.channel])).rows[0]?.ttl_minutes ?? 15;
      const bufferMinutes = buffer.buffer_enabled ? buffer.buffer_minutes : 0;
      const id = randomUUID(), occupancyId = randomUUID();
      await lockRoomOccupancy(client, dto.roomId);
      try {
        await client.query(`INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
          VALUES($1,$2,$3,$4,'BOOKING',$5,tstzrange($6::timestamptz,$6::timestamptz+(($7::integer+$8::integer)*interval '1 minute'),'[)'),'HELD')`,
        [occupancyId, actor.tenantId, room.branchId, dto.roomId, id, start.toISOString(), dto.durationMinutes, bufferMinutes]);
      } catch (error) { if ((error as {code?: string}).code === '23P01') throw new ConflictException('Room already has an active occupancy in this interval'); throw error; }
      await client.query(`INSERT INTO booking_holds(id,tenant_id,branch_id,room_id,occupancy_id,created_by,idempotency_key,request_hash,channel,start_at,duration_minutes,buffer_minutes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()+($13::integer*interval '1 minute'))`,
      [id, actor.tenantId, room.branchId, dto.roomId, occupancyId, actor.userId, key, hash, dto.channel, start.toISOString(), dto.durationMinutes, bufferMinutes, ttl]);
      const result = await this.find(client, actor.tenantId!, id);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'HOLD_CREATED','BOOKING_HOLD',$4,$5)`, [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify(result)]);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async expireBatch(limit = 100): Promise<number> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const rows = (await client.query(`SELECT id FROM booking_holds WHERE status='HELD' AND expires_at<=clock_timestamp() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1`, [limit])).rows;
      for (const row of rows) await this.expireById(client, row.id);
      await client.query('COMMIT'); return rows.length;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async expireById(client: PoolClient, id: string) {
    const expired = (await client.query(`UPDATE booking_holds SET status='EXPIRED',updated_at=clock_timestamp() WHERE id=$1 AND status='HELD' AND expires_at<=clock_timestamp() RETURNING id,tenant_id,occupancy_id`, [id])).rows[0];
    if (!expired) return;
    await client.query(`UPDATE room_occupancy SET status='RELEASED',updated_at=clock_timestamp() WHERE id=$1 AND status='HELD'`, [expired.occupancy_id]);
    await client.query(`INSERT INTO audit_logs(id,tenant_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'HOLD_EXPIRED','BOOKING_HOLD',$3,$4)`, [randomUUID(), expired.tenant_id, id, JSON.stringify({ status: 'EXPIRED' })]);
  }
  private async find(client: PoolClient, tenantId: string, id: string) {
    return (await client.query(`SELECT ${fields} FROM booking_holds h JOIN room_occupancy o ON o.id=h.occupancy_id WHERE h.tenant_id=$1 AND h.id=$2`, [tenantId,id])).rows[0];
  }
  private assertBranch(actor: Actor, branchId: string) {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }
}
