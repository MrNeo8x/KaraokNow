import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { ConfirmHoldDto } from './confirmation.dto';
import { ListHoldsDto } from './hold.dto';
import type { DepositPolicySnapshot } from './deposit-snapshot';
import { HoldDepositService } from './hold-deposit.service';
import { DepositExemptionService, type ExemptionReason } from './deposit-exemption';
import { BOOKING_SELECT, toBooking } from './booking-read';

@Injectable()
export class ConfirmationService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly deposits: HoldDepositService, private readonly exemptions: DepositExemptionService) {}
  async list(actor: Actor, branchId: string, query: ListHoldsDto) {
    const from = new Date(query.from), to = new Date(query.to);
    const zone = /[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/;
    if (!zone.test(query.from) || !zone.test(query.to) || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      throw new UnprocessableEntityException('from and to must be timestamps with explicit timezones, and to must be after from');
    }
    if (!(await this.db.query('SELECT id FROM branches WHERE tenant_id=$1 AND id=$2', [actor.tenantId, branchId])).rowCount) throw new NotFoundException('Branch not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`${BOOKING_SELECT} WHERE b.tenant_id=$1 AND b.branch_id=$2
      AND b.start_at<$4::timestamptz AND b.start_at+(b.duration_minutes*interval '1 minute')>$3::timestamptz
      ORDER BY b.start_at,b.id LIMIT $5 OFFSET $6`, [actor.tenantId, branchId, from.toISOString(), to.toISOString(), limit + 1, offset])).rows;
    return { items: rows.slice(0, limit).map(toBooking), limit, offset, hasMore: rows.length > limit };
  }
  async get(actor: Actor, id: string) {
    const row = (await this.db.query(`${BOOKING_SELECT} WHERE b.tenant_id=$1 AND b.id=$2`, [actor.tenantId, id])).rows[0];
    if (!row) throw new NotFoundException('Booking not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(row.branchId)) throw new ForbiddenException('Branch access denied');
    return toBooking(row);
  }
  async confirm(actor: Actor, holdId: string, dto: ConfirmHoldDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const hold = (await client.query(`SELECT id,branch_id,room_id,occupancy_id,channel,start_at,duration_minutes,buffer_minutes,
        customer_phone,customer_email,phone_verified_at,phone_verified_by,price_snapshot,public_accepted_terms,deposit_policy_snapshot,status,expires_at>clock_timestamp() AS valid
        FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, holdId])).rows[0];
      if (!hold) throw new NotFoundException('Hold not found');
      if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(hold.branch_id)) throw new ForbiddenException('Branch access denied');
      if (hold.status === 'CONFIRMED') {
        const existing = await this.findByHold(client, actor.tenantId!, holdId);
        if (!existing || existing.cancellationTerms !== dto.cancellationTerms) throw new ConflictException('Hold already confirmed with different terms');
        await client.query('COMMIT'); return existing;
      }
      if (hold.status !== 'HELD' || !hold.valid) throw new ConflictException('Hold has expired');
      if (!hold.customer_phone || !hold.price_snapshot || !hold.phone_verified_at || !hold.phone_verified_by) throw new ConflictException('Customer details, price snapshot and phone verification are required');
      if (hold.public_accepted_terms && hold.public_accepted_terms !== dto.cancellationTerms) throw new ConflictException('Confirmation terms must match the terms accepted by the customer');

      const snapshot = hold.deposit_policy_snapshot as DepositPolicySnapshot | null;
      let policy: Record<string, unknown>;
      if (snapshot && snapshot.mode !== 'NONE') {
        // Deposit-required path (UAT-PD-002): the hold row lock serializes this check with concurrent deposit recording.
        const recorded = await this.deposits.recordedTotal(client, actor.tenantId!, holdId);
        let exemption: ExemptionReason[] = [];
        if (BigInt(recorded) < BigInt(snapshot.requiredAmountVnd)) {
          // BKG-008 / PD-050: a matching case (or a staff waiver) lets the hold confirm without the full deposit.
          exemption = await this.exemptions.evaluate(client, actor.tenantId!, holdId);
          if (!exemption.length) throw new ConflictException('Required deposit has not been fully recorded');
        }
        policy = { depositMode: snapshot.mode, depositPolicyVersion: snapshot.policyVersion, requiredDepositVnd: snapshot.requiredAmountVnd,
          depositRecordedVnd: recorded, noDepositAllowed: false, noDepositPolicyVersion: null, ...(exemption.length ? { depositExemptionReasons: exemption } : {}) };
      } else {
        let depositVersion: string | null = snapshot?.policyVersion ?? null;
        if (!snapshot) {
          // Holds priced before deposit snapshots existed fall back to the live channel policy.
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`deposit:${actor.tenantId}:${hold.channel}`]);
          const deposit = (await client.query(`SELECT mode,version::text FROM tenant_deposit_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, hold.channel])).rows[0];
          if (deposit && deposit.mode !== 'NONE') throw new ConflictException('Hold has no deposit snapshot; re-record customer details on a new hold');
          depositVersion = deposit?.version ?? null;
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`no-deposit:${actor.tenantId}:${hold.channel}`]);
        const permission = (await client.query(`SELECT allowed,version::text FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel=$2`, [actor.tenantId, hold.channel])).rows[0];
        let exemption: ExemptionReason[] = [];
        if (!permission?.allowed) {
          exemption = await this.exemptions.evaluate(client, actor.tenantId!, holdId);
          if (!exemption.length) throw new ConflictException('No-deposit confirmation is not enabled for this channel');
        }
        policy = { depositMode: 'NONE', depositPolicyVersion: depositVersion, noDepositAllowed: Boolean(permission?.allowed),
          noDepositPolicyVersion: permission?.version ?? null, ...(exemption.length ? { depositExemptionReasons: exemption } : {}) };
      }
      const updated = await client.query(`UPDATE booking_holds SET status='CONFIRMED',updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND id=$2 AND status='HELD' AND expires_at>clock_timestamp()`, [actor.tenantId, holdId]);
      if (!updated.rowCount) throw new ConflictException('Hold has expired');
      const occupancy = await client.query(`UPDATE room_occupancy SET status='CONFIRMED',updated_at=clock_timestamp()
        WHERE id=$1 AND tenant_id=$2 AND source_type='BOOKING' AND source_id=$3 AND status='HELD'`, [hold.occupancy_id, actor.tenantId, holdId]);
      if (!occupancy.rowCount) throw new ConflictException('Hold occupancy is not active');
      const id = randomUUID();
      await client.query(`INSERT INTO bookings(id,tenant_id,branch_id,room_id,hold_id,occupancy_id,channel,start_at,duration_minutes,buffer_minutes,
        customer_phone,customer_email,phone_verified_at,phone_verified_by,price_snapshot,cancellation_terms,confirmation_policy_snapshot,confirmed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, actor.tenantId, hold.branch_id, hold.room_id, holdId, hold.occupancy_id, hold.channel, hold.start_at, hold.duration_minutes, hold.buffer_minutes,
        hold.customer_phone, hold.customer_email, hold.phone_verified_at, hold.phone_verified_by, JSON.stringify(hold.price_snapshot), dto.cancellationTerms, JSON.stringify(policy), actor.userId]);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'BOOKING_CONFIRMED','BOOKING',$4,$5)`,
        [randomUUID(), actor.tenantId, actor.userId, id, JSON.stringify({ holdId, channel: hold.channel, depositMode: policy.depositMode, depositExemptionReasons: policy.depositExemptionReasons ?? [] })]);
      const result = await this.findByHold(client, actor.tenantId!, holdId);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async findByHold(client: PoolClient, tenant: string, holdId: string) {
    return (await client.query(`${BOOKING_SELECT} WHERE b.tenant_id=$1 AND b.hold_id=$2`, [tenant, holdId])).rows.map(toBooking)[0];
  }
}
