import {
  ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { QuoteRequestDto, UpdateBookingDurationPolicyDto } from './pricing.dto';
import { calculatePriceRuleAmount, type PriceAmountUnit } from './price-rule-amount';
import { AmbiguousPriceRuleError, selectPriceRule } from './price-rule-precedence';

export interface BookingDurationPolicy {
  durationStepMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  version?: string;
}

interface RoomContext { id: string; branchId: string; timezone: string }
interface PriceRuleRow extends QueryResultRow {
  id: string; price_plan_id: string; plan_code: string; plan_version: string;
  rule_code: string; rule_name: string; priority: number; amount_unit: PriceAmountUnit | null;
  amount_vnd: string; rule_version: string; weekdays: number[]; start_time: string | null; end_time: string | null;
  min_duration_minutes: number | null; max_duration_minutes: number | null;
  plan_effective_from: string | null; plan_effective_to: string | null;
  special_date_code: string | null; special_date_start: string | null; special_date_end: string | null;
}

@Injectable()
export class PricingService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async getDurationPolicy(tenantId: string, db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.db): Promise<BookingDurationPolicy> {
    const result = await db.query<BookingDurationPolicy>(
      `SELECT duration_step_minutes AS "durationStepMinutes", min_duration_minutes AS "minDurationMinutes",
              max_duration_minutes AS "maxDurationMinutes", version::text
       FROM tenant_booking_policies WHERE tenant_id=$1`, [tenantId]);
    return result.rows[0] ?? { durationStepMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480 };
  }

  async updateDurationPolicy(actor: Actor, dto: UpdateBookingDurationPolicyDto): Promise<BookingDurationPolicy> {
    if (dto.minDurationMinutes > dto.maxDurationMinutes) {
      throw new UnprocessableEntityException('Maximum duration must be at least the minimum duration');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const tenantId = actor.tenantId!;
      const before = (await client.query<BookingDurationPolicy>(
        `SELECT duration_step_minutes AS "durationStepMinutes", min_duration_minutes AS "minDurationMinutes",
                max_duration_minutes AS "maxDurationMinutes", version::text
         FROM tenant_booking_policies WHERE tenant_id=$1 FOR UPDATE`, [tenantId])).rows[0] ?? {
        durationStepMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480, version: '0'
      };
      const result = await client.query<BookingDurationPolicy>(
        `INSERT INTO tenant_booking_policies(tenant_id,duration_step_minutes,min_duration_minutes,max_duration_minutes,updated_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id) DO UPDATE SET duration_step_minutes=EXCLUDED.duration_step_minutes,
           min_duration_minutes=EXCLUDED.min_duration_minutes,max_duration_minutes=EXCLUDED.max_duration_minutes,
           updated_by=EXCLUDED.updated_by,updated_at=now(),version=tenant_booking_policies.version+1
         RETURNING duration_step_minutes AS "durationStepMinutes", min_duration_minutes AS "minDurationMinutes",
                   max_duration_minutes AS "maxDurationMinutes", version::text`,
        [tenantId, dto.durationStepMinutes, dto.minDurationMinutes, dto.maxDurationMinutes, actor.userId]);
      await this.insertAudit(client, actor, 'BOOKING_DURATION_POLICY_UPDATED', 'BOOKING_DURATION_POLICY', tenantId, before, result.rows[0]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async quote(actor: Actor, roomId: string, input: QuoteRequestDto, db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.db) {
    const start = new Date(input.startAt);
    if (!Number.isFinite(start.getTime()) || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(input.startAt)) {
      throw new UnprocessableEntityException('startAt must be an ISO-8601 timestamp with an explicit timezone');
    }
    const roomResult = await db.query<RoomContext>(
      `SELECT r.id,r.branch_id AS "branchId",b.timezone
       FROM rooms r JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id
       WHERE r.id=$1 AND r.tenant_id=$2 AND r.status='ACTIVE' AND b.status='ACTIVE'`, [roomId, actor.tenantId]);
    const room = roomResult.rows[0];
    if (!room) throw new NotFoundException('Active room not found');
    this.assertBranchAccess(actor, room.branchId);

    const policy = await this.getDurationPolicy(actor.tenantId!, db);
    const duration = input.durationMinutes;
    if (duration < policy.minDurationMinutes || duration > policy.maxDurationMinutes ||
        (duration - policy.minDurationMinutes) % policy.durationStepMinutes !== 0) {
      throw new UnprocessableEntityException({
        message: 'Requested duration does not match the merchant booking-duration policy', policy
      });
    }
    const local = this.localBookingParts(start, room.timezone);
    const rules = await db.query<PriceRuleRow>(
      `SELECT r.id,r.price_plan_id,p.code AS plan_code,p.version::text AS plan_version,
              r.code AS rule_code,r.name AS rule_name,r.priority,r.amount_unit,r.amount_vnd::text,r.version::text AS rule_version,
              r.weekdays,r.start_time::text,r.end_time::text,r.min_duration_minutes,r.max_duration_minutes,
              p.effective_from::text AS plan_effective_from,p.effective_to::text AS plan_effective_to,
              sd.code AS special_date_code,sd.start_date::text AS special_date_start,sd.end_date::text AS special_date_end
       FROM price_rules r
       JOIN price_plans p ON p.id=r.price_plan_id AND p.tenant_id=r.tenant_id
       LEFT JOIN special_dates sd ON sd.id=r.special_date_id AND sd.tenant_id=r.tenant_id
       WHERE r.tenant_id=$1 AND r.status='ACTIVE' AND p.status='ACTIVE'
         AND (r.room_id IS NULL OR r.room_id=$2)
         AND (p.effective_from IS NULL OR p.effective_from <= $3::date)
         AND (p.effective_to IS NULL OR p.effective_to >= $3::date)
         AND (r.special_date_id IS NULL OR (sd.status='ACTIVE' AND sd.start_date <= $3::date AND sd.end_date >= $3::date))`,
      [actor.tenantId, roomId, local.date]);
    const matches = rules.rows.filter((rule) => this.ruleMatches(rule, local.weekday, local.time, duration));
    let rule: PriceRuleRow | null;
    try { rule = selectPriceRule(matches); }
    catch (error) {
      if (error instanceof AmbiguousPriceRuleError) throw new ConflictException('Pricing configuration is ambiguous for this request');
      throw error;
    }
    if (!rule) throw new UnprocessableEntityException('No active price rule matches the requested room and start time');
    if (!rule.amount_unit) throw new ConflictException('The matching price rule must have an amount unit configured');

    const total = calculatePriceRuleAmount(rule.amount_vnd, rule.amount_unit, duration);
    const end = new Date(start.getTime() + duration * 60_000);
    const priceSnapshot = {
      schemaVersion: 1,
      tenantId: actor.tenantId,
      branchId: room.branchId,
      roomId: room.id,
      timezone: room.timezone,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: duration,
      currency: 'VND',
      totalAmountVnd: total,
      calculation: {
        pricePlanId: rule.price_plan_id,
        pricePlanCode: rule.plan_code,
        pricePlanVersion: rule.plan_version,
        priceRuleId: rule.id,
        priceRuleCode: rule.rule_code,
        priceRuleVersion: rule.rule_version,
        priority: rule.priority,
        amountUnit: rule.amount_unit,
        configuredAmountVnd: rule.amount_vnd,
        matchedOnLocalStart: { date: local.date, time: local.time, weekday: local.weekday },
        specialDate: rule.special_date_code ? {
          code: rule.special_date_code, startDate: rule.special_date_start, endDate: rule.special_date_end
        } : null,
        rounding: 'nearest 1 VND, half up'
      },
      bookingDurationPolicy: policy
    };
    return { priceSnapshot };
  }

  private ruleMatches(rule: PriceRuleRow, weekday: number, time: string, duration: number): boolean {
    if (rule.weekdays.length > 0 && !rule.weekdays.includes(weekday)) return false;
    if (rule.min_duration_minutes !== null && duration < rule.min_duration_minutes) return false;
    if (rule.max_duration_minutes !== null && duration > rule.max_duration_minutes) return false;
    if (rule.start_time !== null && rule.end_time !== null) {
      const start = rule.start_time.slice(0, 8);
      const end = rule.end_time.slice(0, 8);
      const matchesTime = start < end ? time >= start && time < end : time >= start || time < end;
      if (!matchesTime) return false;
    }
    return true;
  }

  private localBookingParts(value: Date, timezone: string): { date: string; time: string; weekday: number } {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
      }).formatToParts(value);
    } catch { throw new UnprocessableEntityException('Branch timezone is not supported'); }
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[fields.weekday];
    if (weekday === undefined) throw new UnprocessableEntityException('Could not resolve local weekday for branch timezone');
    return {
      date: `${fields.year}-${fields.month}-${fields.day}`,
      time: `${fields.hour}:${fields.minute}:${fields.second}`,
      weekday
    };
  }

  private assertBranchAccess(actor: Actor, branchId: string): void {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }

  private insertAudit(client: PoolClient, actor: Actor, action: string, entityType: string,
                      entityId: string, before: unknown, after: unknown) {
    return client.query(
      `INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), actor.tenantId, actor.userId, action, entityType, entityId,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  }
}
