import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { BOOKING_SELECT, toBooking } from './booking-read';
import { RecordBookingOutcomeDto } from './confirmation.dto';

interface LockedBooking { id: string; branch_id: string; hold_id: string; occupancy_id: string; status: string; buffer_minutes: number }

/**
 * Staff booking transitions after confirmation:
 * CONFIRMED -> CHECKED_IN (PD-026: no time window) -> COMPLETED (PD-025: early check-out shortens occupancy to actual end + buffer);
 * CONFIRMED -> CANCELLED | NO_SHOW with one staff-reviewed outcome (PD-006/PD-015/PD-027), releasing the room.
 * Every transition locks the booking row, so concurrent check-in/cancel/check-out serialize.
 */
@Injectable()
export class BookingLifecycleService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async checkIn(actor: Actor, id: string) {
    return this.transaction(actor, id, async (client, booking) => {
      if (booking.status === 'CHECKED_IN') return;
      if (booking.status !== 'CONFIRMED') throw new ConflictException(`Booking in status ${booking.status} cannot be checked in`);
      await client.query(`UPDATE bookings SET status='CHECKED_IN',checked_in_at=clock_timestamp(),checked_in_by=$3 WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, actor.userId]);
      await client.query(`UPDATE room_occupancy SET status='IN_USE',updated_at=clock_timestamp() WHERE id=$1 AND tenant_id=$2 AND status='CONFIRMED'`,
        [booking.occupancy_id, actor.tenantId]);
      await this.audit(client, actor, 'BOOKING_CHECKED_IN', id, { status: 'CHECKED_IN' });
    });
  }

  async checkOut(actor: Actor, id: string) {
    return this.transaction(actor, id, async (client, booking) => {
      if (booking.status === 'COMPLETED') return;
      if (booking.status !== 'CHECKED_IN') throw new ConflictException(`Booking in status ${booking.status} cannot be checked out`);
      await client.query(`UPDATE bookings SET status='COMPLETED',checked_out_at=clock_timestamp(),checked_out_by=$3 WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, actor.userId]);
      // Early check-out releases the remainder: occupancy ends at actual end + cleanup buffer (PD-024/PD-025).
      // Late check-out keeps the scheduled occupancy; overtime handling is still an open product question.
      const shortened = await client.query(`UPDATE room_occupancy
        SET occupied_range=tstzrange(lower(occupied_range),clock_timestamp()+($3::integer*interval '1 minute'),'[)'),updated_at=clock_timestamp()
        WHERE id=$1 AND tenant_id=$2 AND clock_timestamp()>lower(occupied_range)
          AND clock_timestamp()+($3::integer*interval '1 minute')<upper(occupied_range) RETURNING upper(occupied_range) AS "reservedEndAt"`,
      [booking.occupancy_id, actor.tenantId, booking.buffer_minutes]);
      await this.audit(client, actor, 'BOOKING_CHECKED_OUT', id, { status: 'COMPLETED', occupancyShortened: shortened.rowCount === 1 });
    });
  }

  async recordOutcome(actor: Actor, id: string, dto: RecordBookingOutcomeDto) {
    const refund = dto.refundAmountVnd ?? '0';
    if (BigInt(refund) > 9223372036854775807n) throw new UnprocessableEntityException('Refund exceeds database limit');
    const hash = createHash('sha256').update(JSON.stringify([id, dto.type, dto.note, refund])).digest('hex');
    return this.transaction(actor, id, async (client, booking) => {
      const prior = (await client.query(`SELECT request_hash FROM booking_outcomes WHERE tenant_id=$1 AND booking_id=$2`, [actor.tenantId, id])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('A different outcome is already recorded for this booking');
        return;
      }
      if (booking.status !== 'CONFIRMED') throw new ConflictException(`Booking in status ${booking.status} cannot be cancelled or marked no-show`);
      const collected = BigInt((await client.query(`SELECT
          (SELECT COALESCE(SUM(amount_vnd),0) FROM manual_payments WHERE tenant_id=$1 AND booking_id=$2)
        + (SELECT COALESCE(SUM(amount_vnd),0) FROM hold_deposits WHERE tenant_id=$1 AND hold_id=$3) AS total`,
      [actor.tenantId, id, booking.hold_id])).rows[0].total);
      if (BigInt(refund) > collected) throw new ConflictException(`Refund exceeds the amount recorded for this booking (${collected} VND)`);
      const status = dto.type === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED';
      await client.query(`INSERT INTO booking_outcomes(id,tenant_id,branch_id,booking_id,outcome_type,note,refund_amount_vnd,request_hash,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), actor.tenantId, booking.branch_id, id, dto.type, dto.note, refund, hash, actor.userId]);
      await client.query(`UPDATE bookings SET status=$3 WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, status]);
      await client.query(`UPDATE room_occupancy SET status='RELEASED',updated_at=clock_timestamp() WHERE id=$1 AND tenant_id=$2 AND status='CONFIRMED'`,
        [booking.occupancy_id, actor.tenantId]);
      // The free-text note may contain customer details, so the audit keeps only structured fields.
      await this.audit(client, actor, status === 'NO_SHOW' ? 'BOOKING_NO_SHOW' : 'BOOKING_CANCELLED', id,
        { status, outcomeType: dto.type, refundAmountVnd: refund, collectedVnd: collected.toString() });
    });
  }

  private async transaction(actor: Actor, id: string, change: (client: PoolClient, booking: LockedBooking) => Promise<void>) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const booking = (await client.query<LockedBooking>(`SELECT id,branch_id,hold_id,occupancy_id,status,buffer_minutes FROM bookings
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, id])).rows[0];
      if (!booking) throw new NotFoundException('Booking not found');
      if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(booking.branch_id)) throw new ForbiddenException('Branch access denied');
      await change(client, booking);
      const result = toBooking((await client.query(`${BOOKING_SELECT} WHERE b.tenant_id=$1 AND b.id=$2`, [actor.tenantId, id])).rows[0]);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async audit(client: PoolClient, actor: Actor, action: string, id: string, after: Record<string, unknown>) {
    await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,'BOOKING',$5,$6)`,
      [randomUUID(), actor.tenantId, actor.userId, action, id, JSON.stringify(after)]);
  }
}
