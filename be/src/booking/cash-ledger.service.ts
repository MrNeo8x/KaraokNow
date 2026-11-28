import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../platform/auth/auth.types';
import { PG_POOL } from '../platform/database/database.module';
import { AddSurchargeDto, CreateReversalDto, PageQueryDto, ResolveDepositDto } from './cash-ledger.dto';
import { NET_HOLD_DEPOSITS_SQL } from './hold-deposit.service';
import { HoldService } from './hold.service';

const SURCHARGE_FIELDS = `id,booking_id AS "bookingId",branch_id AS "branchId",amount_vnd::text AS "amountVnd",reason,recorded_by AS "recordedBy",recorded_at AS "recordedAt"`;
const REVERSAL_FIELDS = `id,branch_id AS "branchId",entry_type AS "entryType",entry_id AS "entryId",amount_vnd::text AS "amountVnd",reason,recorded_by AS "recordedBy",recorded_at AS "recordedAt"`;
const RESOLUTION_FIELDS = `hold_id AS "holdId",branch_id AS "branchId",net_deposit_vnd::text AS "netDepositVnd",refund_amount_vnd::text AS "refundAmountVnd",
  (net_deposit_vnd-refund_amount_vnd)::text AS "retainedVnd",reason,recorded_by AS "recordedBy",recorded_at AS "recordedAt"`;
const OPEN_BOOKING = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'];

/**
 * PAY-007 / PD-036 manual cash reconciliation: amount due vs paid per booking, surcharges, reversals of mistaken
 * entries, resolution of deposits on expired holds and a daily cash report. Money rows are never edited or deleted.
 */
@Injectable()
export class CashLedgerService {
  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly holds: HoldService) {}

  async account(actor: Actor, bookingId: string) {
    const booking = (await this.db.query(`SELECT id,branch_id,hold_id,status,price_snapshot->>'totalAmountVnd' AS total FROM bookings WHERE tenant_id=$1 AND id=$2`,
      [actor.tenantId, bookingId])).rows[0];
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertBranch(actor, booking.branch_id);
    const entries = (await this.db.query(`
      WITH dep AS (SELECT * FROM hold_deposits WHERE tenant_id=$1 AND hold_id=$3),
           pay AS (SELECT * FROM manual_payments WHERE tenant_id=$1 AND booking_id=$2),
           sur AS (SELECT * FROM booking_surcharges WHERE tenant_id=$1 AND booking_id=$2)
      SELECT 'DEPOSIT' AS kind,d.id,d.amount_vnd::text AS "amountVnd",d.note,NULL AS "reversesType",NULL::uuid AS "reversesId",
        EXISTS(SELECT 1 FROM money_reversals r WHERE r.entry_type='HOLD_DEPOSIT' AND r.entry_id=d.id) AS reversed,d.recorded_by AS "recordedBy",d.recorded_at AS "recordedAt" FROM dep d
      UNION ALL SELECT 'CASH',p.id,p.amount_vnd::text,p.note,NULL,NULL,
        EXISTS(SELECT 1 FROM money_reversals r WHERE r.entry_type='MANUAL_PAYMENT' AND r.entry_id=p.id),p.recorded_by,p.recorded_at FROM pay p
      UNION ALL SELECT 'SURCHARGE',s.id,s.amount_vnd::text,s.reason,NULL,NULL,
        EXISTS(SELECT 1 FROM money_reversals r WHERE r.entry_type='SURCHARGE' AND r.entry_id=s.id),s.recorded_by,s.recorded_at FROM sur s
      UNION ALL SELECT 'REVERSAL',r.id,r.amount_vnd::text,r.reason,r.entry_type,r.entry_id,false,r.recorded_by,r.recorded_at FROM money_reversals r
        WHERE r.tenant_id=$1 AND ((r.entry_type='HOLD_DEPOSIT' AND r.entry_id IN (SELECT id FROM dep))
          OR (r.entry_type='MANUAL_PAYMENT' AND r.entry_id IN (SELECT id FROM pay)) OR (r.entry_type='SURCHARGE' AND r.entry_id IN (SELECT id FROM sur)))
      UNION ALL SELECT 'REFUND',o.id,o.refund_amount_vnd::text,o.note,NULL,NULL,false,o.recorded_by,o.recorded_at FROM booking_outcomes o
        WHERE o.tenant_id=$1 AND o.booking_id=$2 AND o.refund_amount_vnd > 0
      ORDER BY "recordedAt",id`, [actor.tenantId, bookingId, booking.hold_id])).rows;
    const sum = (kind: string): bigint => entries.filter(e => e.kind === kind && !e.reversed).reduce<bigint>((acc, e) => acc + BigInt(e.amountVnd), 0n);
    const priceTotal = BigInt(booking.total ?? '0');
    const surcharges = sum('SURCHARGE'), deposits = sum('DEPOSIT'), cash = sum('CASH'), refunds = sum('REFUND');
    const paid = deposits + cash - refunds;
    const closed = booking.status === 'CANCELLED' || booking.status === 'NO_SHOW';
    const due = closed ? 0n : priceTotal + surcharges;
    const balance = due - paid;
    const settlement = closed ? 'CLOSED' : paid <= 0n && due > 0n ? 'UNPAID' : balance > 0n ? 'PARTIAL' : balance === 0n ? 'PAID' : 'OVERPAID';
    return {
      bookingId, bookingStatus: booking.status, priceTotalVnd: priceTotal.toString(), surchargesVnd: surcharges.toString(), dueVnd: due.toString(),
      depositsVnd: deposits.toString(), cashVnd: cash.toString(), refundsVnd: refunds.toString(), paidVnd: paid.toString(), balanceVnd: balance.toString(),
      settlement, retainedVnd: closed ? paid.toString() : null, entries
    };
  }

  async addSurcharge(actor: Actor, bookingId: string, key: string, dto: AddSurchargeDto) {
    this.assertKey(key);
    const hash = createHash('sha256').update(JSON.stringify([bookingId, dto.amountVnd, dto.reason])).digest('hex');
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`surcharge:${actor.tenantId}:${actor.userId}:${key}`]);
      const booking = await this.lockBooking(client, actor, bookingId);
      const prior = (await client.query(`SELECT ${SURCHARGE_FIELDS},request_hash FROM booking_surcharges WHERE tenant_id=$1 AND recorded_by=$2 AND idempotency_key=$3`,
        [actor.tenantId, actor.userId, key])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('Idempotency key was used for a different surcharge');
        delete prior.request_hash; return prior;
      }
      if (!OPEN_BOOKING.includes(booking.status)) throw new ConflictException(`Surcharges cannot be added to a ${booking.status} booking`);
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO booking_surcharges(id,tenant_id,branch_id,booking_id,amount_vnd,reason,recorded_by,idempotency_key,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${SURCHARGE_FIELDS}`,
      [id, actor.tenantId, booking.branch_id, bookingId, dto.amountVnd, dto.reason, actor.userId, key, hash])).rows[0];
      await this.audit(client, actor, 'BOOKING_SURCHARGE_ADDED', 'BOOKING_SURCHARGE', id, { bookingId, amountVnd: dto.amountVnd });
      return row;
    });
  }

  async reverse(actor: Actor, dto: CreateReversalDto) {
    return this.transaction(async client => {
      const entry = await this.lockEntry(client, actor, dto.entryType, dto.entryId);
      const existing = (await client.query(`SELECT ${REVERSAL_FIELDS} FROM money_reversals WHERE entry_type=$1 AND entry_id=$2`, [dto.entryType, dto.entryId])).rows[0];
      if (existing) {
        if (existing.reason !== dto.reason) throw new ConflictException('This entry has already been reversed');
        return existing;
      }
      const id = randomUUID();
      const row = (await client.query(`INSERT INTO money_reversals(id,tenant_id,branch_id,entry_type,entry_id,amount_vnd,reason,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${REVERSAL_FIELDS}`,
      [id, actor.tenantId, entry.branchId, dto.entryType, dto.entryId, entry.amount, dto.reason, actor.userId])).rows[0];
      // The reason is free text; the audit keeps structured fields only.
      await this.audit(client, actor, 'MONEY_REVERSED', 'MONEY_REVERSAL', id, { entryType: dto.entryType, entryId: dto.entryId, amountVnd: entry.amount });
      return row;
    });
  }

  async unresolvedDeposits(actor: Actor, branchId: string, query: PageQueryDto) {
    await this.assertBranchExists(actor, branchId);
    const limit = query.limit ?? 50, offset = query.offset ?? 0;
    const rows = (await this.db.query(`SELECT h.id AS "holdId",h.branch_id AS "branchId",h.room_id AS "roomId",h.channel,h.start_at AS "startAt",
        h.expires_at AS "expiresAt",h.customer_phone AS "customerPhone",net.total::text AS "netDepositVnd"
      FROM booking_holds h
      CROSS JOIN LATERAL (SELECT COALESCE(SUM(d.amount_vnd),0) AS total FROM hold_deposits d WHERE d.tenant_id=h.tenant_id AND d.hold_id=h.id
        AND NOT EXISTS (SELECT 1 FROM money_reversals r WHERE r.entry_type='HOLD_DEPOSIT' AND r.entry_id=d.id)) net
      WHERE h.tenant_id=$1 AND h.branch_id=$2 AND (h.status='EXPIRED' OR (h.status='HELD' AND h.expires_at<=clock_timestamp()))
        AND net.total > 0 AND NOT EXISTS (SELECT 1 FROM hold_deposit_resolutions x WHERE x.hold_id=h.id)
      ORDER BY h.expires_at,h.id LIMIT $3 OFFSET $4`, [actor.tenantId, branchId, limit + 1, offset])).rows;
    return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit };
  }

  async resolveDeposit(actor: Actor, holdId: string, dto: ResolveDepositDto) {
    const hash = createHash('sha256').update(JSON.stringify([holdId, dto.refundAmountVnd, dto.reason])).digest('hex');
    return this.transaction(async client => {
      const hold = (await client.query(`SELECT id,branch_id,status,expires_at>clock_timestamp() AS active FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [actor.tenantId, holdId])).rows[0];
      if (!hold) throw new NotFoundException('Hold not found');
      this.assertBranch(actor, hold.branch_id);
      const prior = (await client.query(`SELECT ${RESOLUTION_FIELDS},request_hash FROM hold_deposit_resolutions WHERE tenant_id=$1 AND hold_id=$2`, [actor.tenantId, holdId])).rows[0];
      if (prior) {
        if (prior.request_hash !== hash) throw new ConflictException('A different resolution is already recorded for this hold');
        delete prior.request_hash; return prior;
      }
      if (hold.status === 'CONFIRMED') throw new ConflictException('The deposit belongs to a confirmed booking; record refunds with the booking outcome');
      if (hold.status === 'HELD' && hold.active) throw new ConflictException('Hold is still active');
      await this.holds.expireById(client, holdId);
      const net = BigInt((await client.query(NET_HOLD_DEPOSITS_SQL, [actor.tenantId, holdId])).rows[0].total);
      if (net === 0n) throw new ConflictException('There is no deposit to resolve on this hold');
      if (BigInt(dto.refundAmountVnd) > net) throw new ConflictException(`Refund exceeds the net deposit (${net} VND)`);
      const row = (await client.query(`INSERT INTO hold_deposit_resolutions(id,tenant_id,branch_id,hold_id,net_deposit_vnd,refund_amount_vnd,reason,request_hash,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${RESOLUTION_FIELDS}`,
      [randomUUID(), actor.tenantId, hold.branch_id, holdId, net.toString(), dto.refundAmountVnd, dto.reason, hash, actor.userId])).rows[0];
      await this.audit(client, actor, 'HOLD_DEPOSIT_RESOLVED', 'BOOKING_HOLD', holdId, { netDepositVnd: net.toString(), refundAmountVnd: dto.refundAmountVnd });
      return row;
    });
  }

  async dailyReport(actor: Actor, branchId: string, date: string) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new UnprocessableEntityException('date must be a valid calendar date (YYYY-MM-DD)');
    const branch = await this.assertBranchExists(actor, branchId);
    const window = (await this.db.query(`SELECT ($1::date::timestamp AT TIME ZONE $2) AS "from",(($1::date + 1)::timestamp AT TIME ZONE $2) AS "to"`, [date, branch.timezone])).rows[0];
    const rows = (await this.db.query(`
      SELECT recorded_by,category,SUM(amount)::text AS amount FROM (
        SELECT recorded_by,'DEPOSIT' AS category,amount_vnd AS amount FROM hold_deposits WHERE tenant_id=$1 AND branch_id=$2 AND recorded_at>=$3 AND recorded_at<$4
        UNION ALL SELECT recorded_by,'CASH',amount_vnd FROM manual_payments WHERE tenant_id=$1 AND branch_id=$2 AND recorded_at>=$3 AND recorded_at<$4
        UNION ALL SELECT recorded_by,CASE WHEN entry_type='SURCHARGE' THEN 'SURCHARGE_REVERSAL' ELSE 'CASH_REVERSAL' END,amount_vnd FROM money_reversals
          WHERE tenant_id=$1 AND branch_id=$2 AND recorded_at>=$3 AND recorded_at<$4
        UNION ALL SELECT recorded_by,'REFUND',refund_amount_vnd FROM booking_outcomes WHERE tenant_id=$1 AND branch_id=$2 AND refund_amount_vnd>0 AND recorded_at>=$3 AND recorded_at<$4
        UNION ALL SELECT recorded_by,'REFUND',refund_amount_vnd FROM hold_deposit_resolutions WHERE tenant_id=$1 AND branch_id=$2 AND refund_amount_vnd>0 AND recorded_at>=$3 AND recorded_at<$4
        UNION ALL SELECT recorded_by,'SURCHARGE',amount_vnd FROM booking_surcharges WHERE tenant_id=$1 AND branch_id=$2 AND recorded_at>=$3 AND recorded_at<$4
      ) events GROUP BY recorded_by,category`, [actor.tenantId, branchId, window.from, window.to])).rows;
    const names = new Map<string, string>((await this.db.query(`SELECT id,display_name FROM users WHERE id = ANY($1::uuid[])`,
      [[...new Set(rows.map(row => row.recorded_by))]])).rows.map(row => [row.id, row.display_name]));
    const empty = () => ({ DEPOSIT: 0n, CASH: 0n, CASH_REVERSAL: 0n, REFUND: 0n, SURCHARGE: 0n, SURCHARGE_REVERSAL: 0n } as Record<string, bigint>);
    const totals = empty(); const perUser = new Map<string, Record<string, bigint>>();
    for (const row of rows) {
      const amount = BigInt(row.amount);
      totals[row.category] += amount;
      if (!perUser.has(row.recorded_by)) perUser.set(row.recorded_by, empty());
      perUser.get(row.recorded_by)![row.category] += amount;
    }
    const shape = (t: Record<string, bigint>) => ({
      depositsVnd: t.DEPOSIT.toString(), bookingCashVnd: t.CASH.toString(), cashReversalsVnd: t.CASH_REVERSAL.toString(), refundsVnd: t.REFUND.toString(),
      netCashVnd: (t.DEPOSIT + t.CASH - t.CASH_REVERSAL - t.REFUND).toString(), surchargesVnd: (t.SURCHARGE - t.SURCHARGE_REVERSAL).toString()
    });
    return {
      branchId, date, timezone: branch.timezone, from: window.from, to: window.to, totals: shape(totals),
      byRecorder: [...perUser.entries()].map(([userId, t]) => ({ userId, displayName: names.get(userId) ?? '', ...shape(t) }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.userId.localeCompare(b.userId))
    };
  }

  private async lockEntry(client: PoolClient, actor: Actor, type: CreateReversalDto['entryType'], id: string): Promise<{ branchId: string; amount: string }> {
    if (type === 'HOLD_DEPOSIT') {
      const row = (await client.query(`SELECT hold_id,branch_id AS "branchId",amount_vnd::text AS amount FROM hold_deposits WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0];
      if (!row) throw new NotFoundException('Deposit not found');
      this.assertBranch(actor, row.branchId);
      // Same row lock as deposit recording and confirmation, so coverage checks see a stable net total.
      await client.query('SELECT 1 FROM booking_holds WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [actor.tenantId, row.hold_id]);
      if ((await client.query('SELECT 1 FROM hold_deposit_resolutions WHERE hold_id=$1', [row.hold_id])).rowCount) {
        throw new ConflictException('The deposit of this expired hold has already been resolved');
      }
      return row;
    }
    const table = type === 'MANUAL_PAYMENT' ? 'manual_payments' : 'booking_surcharges';
    const row = (await client.query(`SELECT booking_id,branch_id AS "branchId",amount_vnd::text AS amount FROM ${table} WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id])).rows[0];
    if (!row) throw new NotFoundException(type === 'MANUAL_PAYMENT' ? 'Payment not found' : 'Surcharge not found');
    this.assertBranch(actor, row.branchId);
    await client.query('SELECT 1 FROM bookings WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [actor.tenantId, row.booking_id]);
    return row;
  }

  private async lockBooking(client: PoolClient, actor: Actor, bookingId: string) {
    const booking = (await client.query(`SELECT id,branch_id,status FROM bookings WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [actor.tenantId, bookingId])).rows[0];
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertBranch(actor, booking.branch_id);
    return booking;
  }

  private async assertBranchExists(actor: Actor, branchId: string) {
    const branch = (await this.db.query(`SELECT id,timezone FROM branches WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, branchId])).rows[0];
    if (!branch) throw new NotFoundException('Branch not found');
    this.assertBranch(actor, branchId);
    return branch;
  }

  private assertBranch(actor: Actor, branchId: string) {
    if (!actor.roles.includes('OWNER') && !actor.branchIds.includes(branchId)) throw new ForbiddenException('Branch access denied');
  }

  private assertKey(key: string) {
    if (!key || !/^[\x21-\x7e]{1,100}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 1–100 visible ASCII characters');
  }

  private async audit(client: PoolClient, actor: Actor, action: string, entityType: string, entityId: string, after: Record<string, unknown>) {
    await client.query(`INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), actor.tenantId, actor.userId, action, entityType, entityId, JSON.stringify(after)]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
