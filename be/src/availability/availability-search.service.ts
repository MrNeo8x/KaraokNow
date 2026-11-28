import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { AvailabilitySearchDto } from './availability-search.dto';

interface BranchRow { id: string; status: string }
interface DurationPolicy { duration_step_minutes: number; min_duration_minutes: number; max_duration_minutes: number }
interface BufferPolicy { buffer_enabled: boolean; buffer_minutes: number }
export interface AvailableRoom { id: string; code: string; name: string; capacity: number }

@Injectable()
export class AvailabilitySearchService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async search(actor: Actor, branchId: string, input: AvailabilitySearchDto) {
    const start = new Date(input.startAt);
    if (!Number.isFinite(start.getTime()) || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(input.startAt)) {
      throw new UnprocessableEntityException('startAt must be an ISO-8601 timestamp with an explicit timezone');
    }
    const branch = (await this.db.query<BranchRow>(
      `SELECT id,status FROM branches WHERE id=$1 AND tenant_id=$2`, [branchId, actor.tenantId])).rows[0];
    if (!branch || branch.status !== 'ACTIVE') throw new NotFoundException('Active branch not found');
    this.assertBranchAccess(actor, branch.id);

    const [durationPolicy, bufferPolicy] = await Promise.all([
      this.db.query<DurationPolicy>(
        `SELECT duration_step_minutes,min_duration_minutes,max_duration_minutes
         FROM tenant_booking_policies WHERE tenant_id=$1`, [actor.tenantId]),
      this.db.query<BufferPolicy>(
        `SELECT buffer_enabled,buffer_minutes FROM tenant_availability_policies WHERE tenant_id=$1`, [actor.tenantId])
    ]);
    const duration = durationPolicy.rows[0] ?? {
      duration_step_minutes: 30, min_duration_minutes: 60, max_duration_minutes: 480
    };
    const buffer = bufferPolicy.rows[0] ?? { buffer_enabled: true, buffer_minutes: 15 };
    const minutes = input.durationMinutes;
    if (minutes < duration.min_duration_minutes || minutes > duration.max_duration_minutes ||
        (minutes - duration.min_duration_minutes) % duration.duration_step_minutes !== 0) {
      throw new UnprocessableEntityException({
        message: 'Requested duration does not match the merchant booking-duration policy',
        policy: {
          durationStepMinutes: duration.duration_step_minutes,
          minDurationMinutes: duration.min_duration_minutes,
          maxDurationMinutes: duration.max_duration_minutes
        }
      });
    }

    const appliedBufferMinutes = buffer.buffer_enabled ? buffer.buffer_minutes : 0;
    const end = new Date(start.getTime() + minutes * 60_000);
    const reservedEnd = new Date(end.getTime() + appliedBufferMinutes * 60_000);
    const rooms = await this.db.query<AvailableRoom>(
      `SELECT r.id,r.code,r.name,r.capacity
       FROM rooms r JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id
       WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.status='ACTIVE' AND b.status='ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM room_occupancy o
           WHERE o.tenant_id=r.tenant_id AND o.room_id=r.id
             AND o.status IN ('HELD','CONFIRMED','IN_USE','MAINTENANCE')
             -- BKG-011: a HELD occupancy whose hold passed its TTL no longer blocks (released on the next write).
             AND NOT (o.status='HELD' AND EXISTS (SELECT 1 FROM booking_holds h WHERE h.occupancy_id=o.id AND h.status='HELD'
               AND h.expires_at<=clock_timestamp()))
             AND o.occupied_range && tstzrange($3::timestamptz,
                 $3::timestamptz + (($4::integer + $5::integer) * interval '1 minute'),'[)')
         )
       ORDER BY r.name,r.id`,
      [actor.tenantId, branchId, start.toISOString(), minutes, appliedBufferMinutes]);
    return {
      branchId,
      startAt: start.toISOString(),
      requestedEndAt: end.toISOString(),
      durationMinutes: minutes,
      bufferEnabled: buffer.buffer_enabled,
      bufferMinutes: buffer.buffer_minutes,
      appliedBufferMinutes,
      reservedEndAt: reservedEnd.toISOString(),
      rooms: rooms.rows
    };
  }

  private assertBranchAccess(actor: Actor, branchId: string): void {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) {
      throw new ForbiddenException('Branch access denied');
    }
  }
}
