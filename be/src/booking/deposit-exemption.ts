import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put,
  Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested, IsDefined } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ROLES, type Actor, type AuthenticatedRequest, type Role } from '../platform/auth/auth.types';
import { AuthGuard } from '../platform/auth/auth.guard';
import { RequireRoles } from '../platform/auth/roles.decorator';
import { RolesGuard } from '../platform/auth/roles.guard';
import { PG_POOL } from '../platform/database/database.module';
import { TenantGuard } from '../platform/tenant/tenant.guard';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EXEMPTION_REASONS = ['AMOUNT', 'OFF_PEAK', 'REGULAR_CUSTOMER', 'MANUAL_WAIVER'] as const;
export type ExemptionReason = typeof EXEMPTION_REASONS[number];

export class OffPeakWindowDto {
  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5], description: 'ISO weekdays, 1 = Monday … 7 = Sunday' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) weekdays!: number[];
  @ApiProperty({ example: '10:00', description: 'Start time HH:mm (branch local time), inclusive' }) @Matches(TIME) from!: string;
  @ApiProperty({ example: '17:00', description: 'End time HH:mm, exclusive, later than from (same day)' }) @Matches(TIME) to!: string;
}
export class UpdateDepositExemptionPolicyDto {
  @ApiProperty({ nullable: true, type: String, example: '300000', description: 'Bookings with total ≤ this amount need no deposit; null = off' })
  @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^[1-9]\d{0,14}$/) maxAmountVnd!: string | null;
  @ApiProperty({ type: [OffPeakWindowDto], description: 'Bookings starting inside one of these windows need no deposit; [] = off' })
  @IsDefined() @IsArray() @ArrayMaxSize(14) @ValidateNested({ each: true }) @Type(() => OffPeakWindowDto) offPeakWindows!: OffPeakWindowDto[];
  @ApiProperty({ nullable: true, type: Number, example: 3, description: 'Regular customer: at least this many COMPLETED bookings and no NO_SHOW within the lookback; null = off' })
  @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(100) regularMinCompleted!: number | null;
  @ApiProperty({ example: 90, minimum: 7, maximum: 730 }) @IsInt() @Min(7) @Max(730) regularLookbackDays!: number;
  @ApiProperty({ enum: ROLES, isArray: true, description: 'Roles that may waive the deposit of a single hold (OWNER always included)' })
  @IsArray() @ArrayUnique() @IsEnum(ROLES, { each: true }) waiverRoles!: Role[];
}
export class DepositExemptionPolicyDto {
  @ApiProperty({ description: 'False while the merchant has never saved a policy (defaults shown)' }) configured!: boolean;
  @ApiProperty({ nullable: true, type: String }) maxAmountVnd!: string | null;
  @ApiProperty({ type: [OffPeakWindowDto] }) offPeakWindows!: OffPeakWindowDto[];
  @ApiProperty({ nullable: true, type: Number }) regularMinCompleted!: number | null;
  @ApiProperty() regularLookbackDays!: number;
  @ApiProperty({ enum: ROLES, isArray: true }) waiverRoles!: string[];
  @ApiProperty({ nullable: true, type: String }) version!: string | null;
}
export class DepositWaiverDto {
  @ApiProperty({ maxLength: 500, example: 'Khách đoàn công ty quen, quản lý đồng ý' }) @IsString() @Matches(/\S/) @MaxLength(500) reason!: string;
}
class WaiverInfoDto {
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) recordedBy!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class DepositExemptionStatusDto {
  @ApiProperty({ format: 'uuid' }) holdId!: string;
  @ApiProperty({ description: 'True when at least one case applies: confirmation needs no deposit and no channel no-deposit permission' }) exempt!: boolean;
  @ApiProperty({ enum: EXEMPTION_REASONS, isArray: true }) reasons!: string[];
  @ApiProperty({ type: WaiverInfoDto, nullable: true }) waiver!: WaiverInfoDto | null;
  @ApiProperty({ description: 'Whether the caller may waive or revoke the waiver of this hold' }) canWaive!: boolean;
}

/** Same canonical form as `normalizePhone` (be/src/booking/phone.ts), in SQL, for matching staff-entered phones. */
const NORMALIZED_PHONE = (col: string) => `CASE WHEN ${col} LIKE '+840%' THEN '+84'||substr(${col},5) WHEN ${col} LIKE '+%' THEN ${col}
  WHEN ${col} LIKE '0%' THEN '+84'||substr(${col},2) WHEN ${col} LIKE '84%' AND length(${col}) BETWEEN 11 AND 12 THEN '+'||${col} ELSE ${col} END`;

const DEFAULT_POLICY = { configured: false, maxAmountVnd: null, offPeakWindows: [], regularMinCompleted: null, regularLookbackDays: 90, waiverRoles: ['OWNER', 'BRANCH_MANAGER'], version: null };

/**
 * BKG-008 / PD-050: a hold can be confirmed without (full) deposit and without the channel's no-deposit permission when one
 * merchant-configured case applies — small booking total, off-peak start, regular customer — or when an authorised staff
 * member waived it with a reason. Cases are evaluated at confirmation and snapshotted into the booking.
 */
@Injectable()
export class DepositExemptionService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  async getPolicy(actor: Actor, client: Pick<Pool | PoolClient, 'query'> = this.db) {
    const row = (await client.query(`SELECT max_amount_vnd::text AS "maxAmountVnd",off_peak_windows AS "offPeakWindows",regular_min_completed AS "regularMinCompleted",
      regular_lookback_days AS "regularLookbackDays",waiver_roles AS "waiverRoles",version::text FROM tenant_deposit_exemption_policies WHERE tenant_id=$1`, [actor.tenantId])).rows[0];
    return row ? { configured: true, ...row } : { ...DEFAULT_POLICY };
  }

  async updatePolicy(actor: Actor, dto: UpdateDepositExemptionPolicyDto) {
    for (const w of dto.offPeakWindows) if (w.to <= w.from) throw new ConflictException('Each off-peak window must end after it starts (same day)');
    const roles = [...new Set<Role>(['OWNER', ...dto.waiverRoles])].sort();
    const windows = dto.offPeakWindows.map(w => ({ weekdays: [...w.weekdays].sort(), from: w.from, to: w.to }));
    return this.tx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`deposit-exemption:${actor.tenantId}`]);
      const before = await this.getPolicy(actor, client);
      await client.query(`INSERT INTO tenant_deposit_exemption_policies(tenant_id,max_amount_vnd,off_peak_windows,regular_min_completed,regular_lookback_days,waiver_roles,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id) DO UPDATE SET max_amount_vnd=EXCLUDED.max_amount_vnd,off_peak_windows=EXCLUDED.off_peak_windows,
        regular_min_completed=EXCLUDED.regular_min_completed,regular_lookback_days=EXCLUDED.regular_lookback_days,waiver_roles=EXCLUDED.waiver_roles,
        updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),version=tenant_deposit_exemption_policies.version+1`,
      [actor.tenantId, dto.maxAmountVnd, JSON.stringify(windows), dto.regularMinCompleted, dto.regularLookbackDays, roles, actor.userId]);
      const after = await this.getPolicy(actor, client);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
        VALUES ($1,$2,$3,'DEPOSIT_EXEMPTION_POLICY_UPDATED','DEPOSIT_EXEMPTION_POLICY',$2,$4,$5)`,
      [randomUUID(), actor.tenantId, actor.userId, JSON.stringify(before), JSON.stringify(after)]);
      return after;
    });
  }

  /** Cases that apply to this hold right now. Caller holds the hold row lock when used inside confirmation. */
  async evaluate(client: Pick<Pool | PoolClient, 'query'>, tenantId: string, holdId: string): Promise<ExemptionReason[]> {
    const row = (await client.query(`SELECT h.customer_phone,(h.price_snapshot->>'totalAmountVnd') AS total,
        extract(isodow FROM h.start_at AT TIME ZONE b.timezone)::int AS dow,to_char(h.start_at AT TIME ZONE b.timezone,'HH24:MI') AS hm,
        p.max_amount_vnd::text AS max_amount,p.off_peak_windows AS windows,p.regular_min_completed AS min_completed,p.regular_lookback_days AS lookback,
        EXISTS(SELECT 1 FROM hold_deposit_waivers w WHERE w.hold_id=h.id) AS waived
      FROM booking_holds h JOIN branches b ON b.id=h.branch_id AND b.tenant_id=h.tenant_id
      LEFT JOIN tenant_deposit_exemption_policies p ON p.tenant_id=h.tenant_id
      WHERE h.tenant_id=$1 AND h.id=$2`, [tenantId, holdId])).rows[0];
    if (!row) return [];
    const reasons: ExemptionReason[] = [];
    if (row.max_amount && row.total && BigInt(row.total) <= BigInt(row.max_amount)) reasons.push('AMOUNT');
    if ((row.windows ?? []).some((w: OffPeakWindowDto) => w.weekdays.includes(row.dow) && row.hm >= w.from && row.hm < w.to)) reasons.push('OFF_PEAK');
    if (row.min_completed && row.customer_phone) {
      const history = (await client.query(`SELECT count(*) FILTER (WHERE k.status='COMPLETED')::int AS completed,count(*) FILTER (WHERE k.status='NO_SHOW')::int AS no_show
        FROM bookings k WHERE k.tenant_id=$1 AND ${NORMALIZED_PHONE('k.customer_phone')}=${NORMALIZED_PHONE('$2::text')}
          AND k.start_at >= clock_timestamp()-($3::int*interval '1 day')`, [tenantId, row.customer_phone, row.lookback])).rows[0];
      if (history.completed >= row.min_completed && history.no_show === 0) reasons.push('REGULAR_CUSTOMER');
    }
    if (row.waived) reasons.push('MANUAL_WAIVER');
    return reasons;
  }

  async status(actor: Actor, holdId: string) {
    const hold = await this.hold(this.db, actor, holdId);
    const reasons = await this.evaluate(this.db, actor.tenantId!, holdId);
    const waiver = (await this.db.query(`SELECT reason,recorded_by AS "recordedBy",recorded_at AS "recordedAt" FROM hold_deposit_waivers WHERE hold_id=$1`, [holdId])).rows[0] ?? null;
    return { holdId: hold.id, exempt: reasons.length > 0, reasons, waiver, canWaive: await this.mayWaive(this.db, actor) };
  }

  async waive(actor: Actor, holdId: string, reason: string) {
    await this.tx(async (client) => {
      const hold = await this.hold(client, actor, holdId, true);
      if (hold.status !== 'HELD' || !hold.valid) throw new ConflictException('Hold has expired or is already confirmed');
      if (!(await this.mayWaive(client, actor))) throw new ForbiddenException('Your role may not waive deposits for this merchant');
      const inserted = await client.query(`INSERT INTO hold_deposit_waivers(id,tenant_id,branch_id,hold_id,reason,recorded_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (hold_id) DO NOTHING`,
        [randomUUID(), actor.tenantId, hold.branch_id, holdId, reason.trim(), actor.userId]);
      if (inserted.rowCount) await this.audit(client, actor, 'HOLD_DEPOSIT_WAIVED', holdId, { holdId, branchId: hold.branch_id });
    });
    return this.status(actor, holdId);
  }

  async revoke(actor: Actor, holdId: string) {
    await this.tx(async (client) => {
      const hold = await this.hold(client, actor, holdId, true);
      if (hold.status !== 'HELD') throw new ConflictException('A confirmed hold keeps its waiver');
      if (!(await this.mayWaive(client, actor))) throw new ForbiddenException('Your role may not waive deposits for this merchant');
      const deleted = await client.query('DELETE FROM hold_deposit_waivers WHERE hold_id=$1', [holdId]);
      if (deleted.rowCount) await this.audit(client, actor, 'HOLD_DEPOSIT_WAIVER_REVOKED', holdId, { holdId, branchId: hold.branch_id });
    });
  }

  private async mayWaive(client: Pick<Pool | PoolClient, 'query'>, actor: Actor) {
    if (actor.roles.includes('OWNER')) return true;
    const roles: string[] = (await client.query('SELECT waiver_roles FROM tenant_deposit_exemption_policies WHERE tenant_id=$1', [actor.tenantId])).rows[0]?.waiver_roles
      ?? DEFAULT_POLICY.waiverRoles;
    return actor.roles.some(r => roles.includes(r));
  }
  private async hold(client: Pick<Pool | PoolClient, 'query'>, actor: Actor, holdId: string, lock = false) {
    const hold = (await client.query(`SELECT id,branch_id,status,expires_at>clock_timestamp() AS valid FROM booking_holds WHERE tenant_id=$1 AND id=$2 ${lock ? 'FOR UPDATE' : ''}`,
      [actor.tenantId, holdId])).rows[0];
    if (!hold) throw new NotFoundException('Hold not found');
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(hold.branch_id)) throw new ForbiddenException('Branch access denied');
    return hold;
  }
  private audit(client: PoolClient, actor: Actor, action: string, holdId: string, data: Record<string, unknown>) {
    return client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES ($1,$2,$3,$4,'BOOKING_HOLD',$5,$6)`,
      [randomUUID(), actor.tenantId, actor.userId, action, holdId, JSON.stringify(data)]);
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const r = await work(client); await client.query('COMMIT'); return r; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

const ALL = ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST', 'CASHIER'] as const;

@ApiTags('deposit exemptions') @ApiBearerAuth() @ApiHeader({ name: 'X-Tenant-ID', required: true })
@UseGuards(AuthGuard, TenantGuard, RolesGuard) @Controller('merchant/booking')
export class DepositExemptionController {
  constructor(private readonly exemptions: DepositExemptionService) {}

  @Get('deposit-exemptions') @RequireRoles(...ALL) @ApiResponse({ status: 200, type: DepositExemptionPolicyDto })
  get(@Req() req: AuthenticatedRequest) { return this.exemptions.getPolicy(req.actor); }

  @Put('deposit-exemptions') @RequireRoles('OWNER', 'BRANCH_MANAGER')
  @ApiOperation({ description: 'Replaces the merchant case-level deposit exemption policy (PD-050)' })
  @ApiResponse({ status: 200, type: DepositExemptionPolicyDto }) @ApiResponse({ status: 409, description: 'An off-peak window ends before it starts' })
  put(@Req() req: AuthenticatedRequest, @Body() dto: UpdateDepositExemptionPolicyDto) { return this.exemptions.updatePolicy(req.actor, dto); }

  @Get('holds/:id/deposit-exemption') @RequireRoles(...ALL) @ApiResponse({ status: 200, type: DepositExemptionStatusDto })
  status(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.exemptions.status(req.actor, id); }

  @Post('holds/:id/deposit-waiver') @HttpCode(200) @RequireRoles(...ALL)
  @ApiOperation({ description: 'Waives the deposit of one hold with a reason; allowed for the roles in waiverRoles (Owner always). Idempotent' })
  @ApiResponse({ status: 200, type: DepositExemptionStatusDto }) @ApiResponse({ status: 403, description: 'Role not allowed to waive, or branch outside scope' })
  @ApiResponse({ status: 409, description: 'Hold expired or already confirmed' })
  waive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DepositWaiverDto) { return this.exemptions.waive(req.actor, id, dto.reason); }

  @Delete('holds/:id/deposit-waiver') @HttpCode(204) @RequireRoles(...ALL) @ApiResponse({ status: 204, description: 'Waiver removed (no-op when none)' })
  revoke(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.exemptions.revoke(req.actor, id); }
}

