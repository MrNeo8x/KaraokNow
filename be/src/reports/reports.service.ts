import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { MerchantReportQueryDto, ReportRangeQueryDto } from './reports.dto';

/** Platform-wide reports bucket dates in Vietnam time (all merchants are in Vietnam). */
export const PLATFORM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MAX_RANGE_DAYS = 366;
type GroupBy = 'day' | 'week' | 'month';

/** SQL expression that maps a local date expression to its period start (groupBy is a validated literal). */
function bucket(groupBy: GroupBy, dateExpr: string) {
  return groupBy === 'day' ? dateExpr : `date_trunc('${groupBy}', ${dateExpr})::date`;
}
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 10000) / 10000 : 0);
const big = (value: unknown) => BigInt((value as string | null) ?? '0');

/**
 * Money recorded in a period, by local recorded date of each branch — identical categories to the daily cash report
 * (PAY-007): deposits, booking cash, reversals of deposits/cash, refunds (booking outcomes and expired-hold resolutions).
 * `$1..` parameters are supplied by the caller; `scope` filters `b` (branches) and `group` is the GROUP BY key.
 */
function moneySql(scope: string, key: string) {
  const src = (table: string, amount: string, extra = '') =>
    `SELECT e.tenant_id,e.branch_id,e.recorded_at,${amount} AS amount FROM ${table} e ${extra}`;
  return `SELECT ${key} AS key,
      COALESCE(sum(amount) FILTER (WHERE category='DEPOSIT'),0)::text AS deposits,
      COALESCE(sum(amount) FILTER (WHERE category='CASH'),0)::text AS cash,
      COALESCE(sum(amount) FILTER (WHERE category='REVERSAL'),0)::text AS reversals,
      COALESCE(sum(amount) FILTER (WHERE category='REFUND'),0)::text AS refunds
    FROM (
      SELECT m.*,'DEPOSIT' AS category FROM (${src('hold_deposits', 'e.amount_vnd')}) m
      UNION ALL SELECT m.*,'CASH' FROM (${src('manual_payments', 'e.amount_vnd')}) m
      UNION ALL SELECT m.*,'REVERSAL' FROM (${src('money_reversals', 'e.amount_vnd', "WHERE e.entry_type<>'SURCHARGE'")}) m
      UNION ALL SELECT m.*,'REFUND' FROM (${src('booking_outcomes', 'e.refund_amount_vnd', 'WHERE e.refund_amount_vnd>0')}) m
      UNION ALL SELECT m.*,'REFUND' FROM (${src('hold_deposit_resolutions', 'e.refund_amount_vnd', 'WHERE e.refund_amount_vnd>0')}) m
    ) ev JOIN branches b ON b.id=ev.branch_id AND b.tenant_id=ev.tenant_id
    CROSS JOIN LATERAL (SELECT (ev.recorded_at AT TIME ZONE b.timezone)::date AS ld) x
    WHERE ${scope} GROUP BY 1`;
}

/** Expected revenue of a booking: price snapshot + surcharges not reversed (PD-036 due amount, before cancellation). */
const EXPECTED = `(k.price_snapshot->>'totalAmountVnd')::bigint + COALESCE((SELECT sum(s.amount_vnd) FROM booking_surcharges s
  WHERE s.booking_id=k.id AND NOT EXISTS (SELECT 1 FROM money_reversals r WHERE r.entry_type='SURCHARGE' AND r.entry_id=s.id)),0)`;

/**
 * RPT-001 / PD-044: merchant and platform reports. Counts and money only — no customer contact data.
 * Bookings are attributed to their service date (local start date), money to its recorded date, holds to their creation date.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(PG_POOL) private readonly db: Pool) {}

  // ---------------- merchant ----------------

  async bookings(actor: Actor, query: MerchantReportQueryDto) {
    const { from, to, groupBy } = this.range(query);
    const branchIds = this.scope(actor, query.branchId);
    const params = [actor.tenantId, branchIds, from, to];
    const scope = `b.tenant_id=$1 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) AND x.ld BETWEEN $3::date AND $4::date`;
    const [periods, bookingRows, money] = await Promise.all([
      this.periods(groupBy, from, to),
      this.db.query(`SELECT ${bucket(groupBy, 'x.ld')}::text AS key,count(*)::int AS bookings,
          count(*) FILTER (WHERE k.status IN ('CONFIRMED','CHECKED_IN'))::int AS upcoming,
          count(*) FILTER (WHERE k.status='COMPLETED')::int AS completed,
          count(*) FILTER (WHERE k.status='CANCELLED')::int AS cancelled,
          count(*) FILTER (WHERE k.status='NO_SHOW')::int AS "noShow",
          COALESCE(sum(${EXPECTED}) FILTER (WHERE k.status NOT IN ('CANCELLED','NO_SHOW')),0)::text AS expected
        FROM bookings k JOIN branches b ON b.id=k.branch_id AND b.tenant_id=k.tenant_id
        CROSS JOIN LATERAL (SELECT (k.start_at AT TIME ZONE b.timezone)::date AS ld) x
        WHERE ${scope} GROUP BY 1`, params),
      this.db.query(moneySql(scope, `${bucket(groupBy, 'x.ld')}::text`), params)
    ]);
    const rows = this.mergeBookingRows(periods, bookingRows.rows, money.rows);
    return { from, to, groupBy, branchIds: await this.branchList(actor, branchIds), totals: this.sumBookingRows(rows, from), rows };
  }

  async occupancy(actor: Actor, query: MerchantReportQueryDto) {
    const { from, to } = this.range(query);
    const branchIds = this.scope(actor, query.branchId);
    const params = [actor.tenantId, branchIds, from, to];
    const rooms = (await this.db.query(`SELECT b.id AS "branchId",b.name AS "branchName",r.id AS "roomId",r.name AS "roomName",
        COALESCE((SELECT sum(k.duration_minutes) FROM bookings k WHERE k.room_id=r.id AND k.tenant_id=r.tenant_id
          AND k.status IN ('CONFIRMED','CHECKED_IN','COMPLETED') AND (k.start_at AT TIME ZONE b.timezone)::date BETWEEN $3::date AND $4::date),0)::int AS "bookedMinutes",
        (($4::date - $3::date + 1) * CASE WHEN b.opens_at IS NULL THEN 1440
          ELSE (extract(epoch FROM (b.closes_at - b.opens_at))/60)::int + CASE WHEN b.closes_at <= b.opens_at THEN 1440 ELSE 0 END END)::int AS "availableMinutes"
      FROM rooms r JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id
      WHERE b.tenant_id=$1 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) AND r.status='ACTIVE'
      ORDER BY b.name,b.id,r.name,r.id`, params)).rows.map(row => ({ ...row, occupancyRate: rate(row.bookedMinutes, row.availableMinutes) }));
    const peakHours = (await this.db.query(`SELECT extract(isodow FROM x.ls)::int AS weekday,extract(hour FROM x.ls)::int AS hour,count(*)::int AS bookings
      FROM bookings k JOIN branches b ON b.id=k.branch_id AND b.tenant_id=k.tenant_id
      CROSS JOIN LATERAL (SELECT (k.start_at AT TIME ZONE b.timezone) AS ls) x
      WHERE b.tenant_id=$1 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) AND k.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
        AND x.ls::date BETWEEN $3::date AND $4::date GROUP BY 1,2 ORDER BY 1,2`, params)).rows;
    const booked = rooms.reduce((s, r) => s + r.bookedMinutes, 0), available = rooms.reduce((s, r) => s + r.availableMinutes, 0);
    return { from, to, branchIds: await this.branchList(actor, branchIds), bookedMinutes: booked, availableMinutes: available,
      occupancyRate: rate(booked, available), rooms, peakHours };
  }

  async channels(actor: Actor, query: MerchantReportQueryDto) {
    const { from, to } = this.range(query);
    const branchIds = this.scope(actor, query.branchId);
    const rows = (await this.db.query(`SELECT h.channel,count(*)::int AS holds,
        count(k.id)::int AS confirmed,
        count(*) FILTER (WHERE k.id IS NULL AND (h.status='EXPIRED' OR (h.status='HELD' AND h.expires_at<=clock_timestamp())))::int AS expired
      FROM booking_holds h JOIN branches b ON b.id=h.branch_id AND b.tenant_id=h.tenant_id
      LEFT JOIN bookings k ON k.hold_id=h.id AND k.tenant_id=h.tenant_id
      CROSS JOIN LATERAL (SELECT (h.created_at AT TIME ZONE b.timezone)::date AS ld) x
      WHERE b.tenant_id=$1 AND ($2::uuid[] IS NULL OR b.id=ANY($2::uuid[])) AND x.ld BETWEEN $3::date AND $4::date
      GROUP BY 1 ORDER BY 2 DESC,1`, [actor.tenantId, branchIds, from, to])).rows.map(r => ({ ...r, conversionRate: rate(r.confirmed, r.holds) }));
    const sum = (k: 'holds' | 'confirmed' | 'expired') => rows.reduce((s, r) => s + r[k], 0);
    return { from, to, branchIds: await this.branchList(actor, branchIds),
      totals: { channel: 'ALL', holds: sum('holds'), confirmed: sum('confirmed'), expired: sum('expired'), conversionRate: rate(sum('confirmed'), sum('holds')) }, rows };
  }

  // ---------------- platform ----------------

  async platformOverview(query: ReportRangeQueryDto) {
    const { from, to, groupBy } = this.range(query);
    const tz = PLATFORM_TIMEZONE;
    const local = (col: string) => `(${col} AT TIME ZONE '${tz}')::date`;
    const series = (table: string, col: string, where = 'true') => this.db.query(
      `SELECT ${bucket(groupBy, local(col))}::text AS key,count(*)::int AS n FROM ${table} WHERE ${where} AND ${local(col)} BETWEEN $1::date AND $2::date GROUP BY 1`, [from, to]);
    const [periods, merchants, branches, users, holds, bookings, snapshot] = await Promise.all([
      this.periods(groupBy, from, to),
      series('tenants', 'created_at'), series('branches', 'created_at'), series('users', 'created_at'),
      series('booking_holds', 'created_at'), series('bookings', 'confirmed_at'),
      this.db.query(`SELECT
          (SELECT count(*)::int FROM tenants WHERE status='ACTIVE') AS "merchantsActive",
          (SELECT count(*)::int FROM tenants WHERE status='INACTIVE') AS "merchantsSuspended",
          (SELECT count(*)::int FROM tenant_public_catalog WHERE published AND NOT platform_approved) AS "listingsPendingApproval",
          (SELECT count(*)::int FROM tenant_public_catalog c JOIN tenants t ON t.id=c.tenant_id WHERE c.published AND c.platform_approved AND t.status='ACTIVE') AS "listingsLive",
          (SELECT count(DISTINCT tenant_id)::int FROM bookings WHERE ${local('confirmed_at')} BETWEEN $1::date AND $2::date) AS "merchantsWithBookings",
          (SELECT count(*)::int FROM users WHERE status='ACTIVE') AS "activeUsers"`, [from, to])
    ]);
    const index = (rows: { key: string; n: number }[]) => new Map(rows.map(r => [r.key, r.n]));
    const m = index(merchants.rows), b = index(branches.rows), u = index(users.rows), h = index(holds.rows), k = index(bookings.rows);
    const rows = periods.map(period => ({ period, newMerchants: m.get(period) ?? 0, newBranches: b.get(period) ?? 0, newUsers: u.get(period) ?? 0,
      holds: h.get(period) ?? 0, bookingsConfirmed: k.get(period) ?? 0 }));
    const total = (key: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[key] as number), 0);
    return { from, to, groupBy, timezone: tz, snapshot: snapshot.rows[0],
      totals: { period: from, newMerchants: total('newMerchants'), newBranches: total('newBranches'), newUsers: total('newUsers'), holds: total('holds'), bookingsConfirmed: total('bookingsConfirmed') },
      rows };
  }

  async platformMerchants(query: ReportRangeQueryDto) {
    const { from, to } = this.range(query);
    const params = [from, to];
    const [base, money] = await Promise.all([
      this.db.query(`SELECT t.id AS "tenantId",t.name AS "tenantName",t.status AS "tenantStatus",
          COALESCE(c.published AND c.platform_approved AND t.status='ACTIVE',false) AS "listingLive",
          (SELECT count(*)::int FROM branches b WHERE b.tenant_id=t.id) AS branches,
          (SELECT count(*)::int FROM rooms r WHERE r.tenant_id=t.id AND r.status='ACTIVE') AS rooms,
          (SELECT count(*)::int FROM booking_holds h JOIN branches b ON b.id=h.branch_id WHERE h.tenant_id=t.id
            AND (h.created_at AT TIME ZONE b.timezone)::date BETWEEN $1::date AND $2::date) AS holds,
          (SELECT count(*)::int FROM booking_holds h JOIN branches b ON b.id=h.branch_id JOIN bookings k ON k.hold_id=h.id WHERE h.tenant_id=t.id
            AND (h.created_at AT TIME ZONE b.timezone)::date BETWEEN $1::date AND $2::date) AS "convertedHolds",
          s.bookings,s.completed,s.cancelled,s."noShow",s.expected
        FROM tenants t LEFT JOIN tenant_public_catalog c ON c.tenant_id=t.id
        CROSS JOIN LATERAL (SELECT count(*)::int AS bookings,count(*) FILTER (WHERE k.status='COMPLETED')::int AS completed,
            count(*) FILTER (WHERE k.status='CANCELLED')::int AS cancelled,count(*) FILTER (WHERE k.status='NO_SHOW')::int AS "noShow",
            COALESCE(sum(${EXPECTED}) FILTER (WHERE k.status NOT IN ('CANCELLED','NO_SHOW')),0)::text AS expected
          FROM bookings k JOIN branches b ON b.id=k.branch_id AND b.tenant_id=k.tenant_id
          WHERE k.tenant_id=t.id AND (k.start_at AT TIME ZONE b.timezone)::date BETWEEN $1::date AND $2::date) s
        ORDER BY s.bookings DESC,t.name,t.id`, params),
      this.db.query(moneySql('x.ld BETWEEN $1::date AND $2::date', 'b.tenant_id::text'), params)
    ]);
    const net = new Map(money.rows.map(r => [r.key, (big(r.deposits) + big(r.cash) - big(r.reversals) - big(r.refunds)).toString()]));
    return { from, to, rows: base.rows.map(({ convertedHolds, expected, ...r }) => ({ ...r, conversionRate: rate(convertedHolds, r.holds),
      expectedRevenueVnd: expected, netCollectedVnd: net.get(r.tenantId) ?? '0' })) };
  }

  // ---------------- helpers ----------------

  private range(query: ReportRangeQueryDto) {
    const valid = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d; };
    if (!valid(query.from) || !valid(query.to)) throw new UnprocessableEntityException('from and to must be valid dates (YYYY-MM-DD)');
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    if (days < 0) throw new UnprocessableEntityException('to must not be before from');
    if (days >= MAX_RANGE_DAYS) throw new UnprocessableEntityException(`The range is limited to ${MAX_RANGE_DAYS} days`);
    return { from: query.from, to: query.to, groupBy: (query.groupBy ?? 'day') as GroupBy };
  }

  /** null = every branch of the tenant (Owner); otherwise the explicit list the caller may see. */
  private scope(actor: Actor, branchId?: string): string[] | null {
    const owner = actor.roles.includes('OWNER');
    if (branchId) {
      if (!owner && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
      return [branchId];
    }
    return owner ? null : [...actor.branchIds];
  }

  private async branchList(actor: Actor, branchIds: string[] | null): Promise<string[]> {
    return (await this.db.query(`SELECT id FROM branches WHERE tenant_id=$1 AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY name,id`,
      [actor.tenantId, branchIds])).rows.map(r => r.id);
  }

  private async periods(groupBy: GroupBy, from: string, to: string): Promise<string[]> {
    return (await this.db.query(`SELECT to_char(g,'YYYY-MM-DD') AS p FROM generate_series(${bucket(groupBy, '$1::date')}::timestamp, $2::date::timestamp, $3::interval) g`,
      [from, to, `1 ${groupBy}`])).rows.map(r => r.p);
  }

  private mergeBookingRows(periods: string[], bookingRows: Record<string, unknown>[], moneyRows: Record<string, unknown>[]) {
    const b = new Map(bookingRows.map(r => [r.key as string, r])), m = new Map(moneyRows.map(r => [r.key as string, r]));
    return periods.map(period => {
      const k = b.get(period) ?? {}, money = m.get(period) ?? {};
      const deposits = big(money.deposits), cash = big(money.cash), reversals = big(money.reversals), refunds = big(money.refunds);
      return { period, bookings: (k.bookings as number) ?? 0, upcoming: (k.upcoming as number) ?? 0, completed: (k.completed as number) ?? 0,
        cancelled: (k.cancelled as number) ?? 0, noShow: (k.noShow as number) ?? 0, expectedRevenueVnd: big(k.expected).toString(),
        depositsVnd: deposits.toString(), bookingCashVnd: cash.toString(), reversalsVnd: reversals.toString(), refundsVnd: refunds.toString(),
        netCollectedVnd: (deposits + cash - reversals - refunds).toString() };
    });
  }

  private sumBookingRows(rows: ReturnType<ReportsService['mergeBookingRows']>, from: string) {
    const n = (k: 'bookings' | 'upcoming' | 'completed' | 'cancelled' | 'noShow') => rows.reduce((s, r) => s + r[k], 0);
    const v = (k: 'expectedRevenueVnd' | 'depositsVnd' | 'bookingCashVnd' | 'reversalsVnd' | 'refundsVnd' | 'netCollectedVnd') =>
      rows.reduce<bigint>((s, r) => s + BigInt(r[k]), 0n).toString();
    return { period: from, bookings: n('bookings'), upcoming: n('upcoming'), completed: n('completed'), cancelled: n('cancelled'), noShow: n('noShow'),
      expectedRevenueVnd: v('expectedRevenueVnd'), depositsVnd: v('depositsVnd'), bookingCashVnd: v('bookingCashVnd'), reversalsVnd: v('reversalsVnd'),
      refundsVnd: v('refundsVnd'), netCollectedVnd: v('netCollectedVnd') };
  }
}
