import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../platform/database/database.module';
import type { Actor } from '../platform/auth/auth.types';
import { PricingService } from '../pricing/pricing.service';
import { normalizePhone } from './phone';
import { snapshotDepositPolicy } from './deposit-snapshot';
import { lockRoomOccupancy } from '../availability/occupancy-lock';
import { assertPublicStartAllowed } from '../venue/opening-hours';
import { CreatePublicHoldDto, PublicBookingLookupDto } from './public-booking.dto';
import { bookingCodeHash, deriveBookingCode } from './booking-code';

@Injectable()
export class PublicBookingService {
  private readonly secret: string;
  private readonly windowMinutes: number;
  private readonly holdIpLimit: number;
  private readonly holdPhoneLimit: number;
  private readonly lookupIpLimit: number;
  private readonly lookupPhoneLimit: number;

  constructor(@Inject(PG_POOL) private readonly db: Pool, private readonly pricing: PricingService, config: ConfigService) {
    this.secret = config.get<string>('JWT_SECRET')!;
    this.windowMinutes = this.setting(config, 'PUBLIC_RATE_LIMIT_WINDOW_MINUTES', 15);
    this.holdIpLimit = this.setting(config, 'PUBLIC_HOLD_IP_LIMIT', 20);
    this.holdPhoneLimit = this.setting(config, 'PUBLIC_HOLD_PHONE_LIMIT', 5);
    this.lookupIpLimit = this.setting(config, 'PUBLIC_LOOKUP_IP_LIMIT', 60);
    this.lookupPhoneLimit = this.setting(config, 'PUBLIC_LOOKUP_PHONE_LIMIT', 10);
  }

  async create(ip: string, key: string, dto: CreatePublicHoldDto) {
    this.assertKey(key);
    const start = new Date(dto.startAt);
    if (!Number.isFinite(start.getTime()) || !/[Tt].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(dto.startAt)) {
      throw new UnprocessableEntityException('startAt must include an explicit timezone');
    }
    const phone = normalizePhone(dto.phone);
    const phoneHash = this.keyedHash('phone', phone);
    await this.consumeLimit('PUBLIC_HOLD_IP', this.keyedHash('ip', ip), this.holdIpLimit);
    const requestHash = createHash('sha256').update(JSON.stringify([
      dto.roomId, start.toISOString(), dto.durationMinutes, phone, dto.email ?? null,
      dto.expectedTotalAmountVnd, dto.termsVersion
    ])).digest('hex');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const room = (await client.query(`SELECT r.tenant_id AS "tenantId",r.branch_id AS "branchId" FROM rooms r
        JOIN branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id JOIN tenants t ON t.id=r.tenant_id
        JOIN tenant_public_catalog c ON c.tenant_id=t.id WHERE r.id=$1 AND r.status='ACTIVE' AND b.status='ACTIVE'
        AND t.status='ACTIVE' AND c.published=true AND c.platform_approved=true FOR SHARE OF r,b,t,c`, [dto.roomId])).rows[0];
      if (!room) throw new NotFoundException('Published room not found');
      await assertPublicStartAllowed(client, room.branchId, dto.startAt, dto.durationMinutes);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`public-hold:${room.tenantId}:${phoneHash}:${key}`]);
      const existing = (await client.query(`SELECT id,request_hash FROM booking_holds WHERE tenant_id=$1 AND created_by IS NULL
        AND public_phone_hash=$2 AND idempotency_key=$3 FOR UPDATE`, [room.tenantId, phoneHash, key])).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash) throw new ConflictException('Idempotency key was used for a different request');
        await this.expireIfNeeded(client, existing.id);
        const replay = await this.holdResponse(client, room.tenantId, existing.id);
        await client.query('COMMIT'); return replay;
      }
      await this.consumeLimit('PUBLIC_HOLD_PHONE', phoneHash, this.holdPhoneLimit);
      const terms = (await client.query(`SELECT public_booking_terms AS text,public_booking_terms_version::text AS version
        FROM tenant_public_catalog WHERE tenant_id=$1 AND public_booking_terms IS NOT NULL FOR SHARE`, [room.tenantId])).rows[0];
      if (!terms) throw new ConflictException('Public booking terms are not configured');
      if (terms.version !== dto.termsVersion) throw new ConflictException('Booking terms have changed; review the current terms');
      const actor: Actor = { userId: '00000000-0000-4000-8000-000000000000', tenantId: room.tenantId, roles: ['OWNER'], branchIds: [] };
      const quote = await this.pricing.quote(actor, dto.roomId, { startAt: start.toISOString(), durationMinutes: dto.durationMinutes }, client);
      if (quote.priceSnapshot.totalAmountVnd !== dto.expectedTotalAmountVnd) throw new ConflictException('Price has changed; request a new quote');
      const buffer = (await client.query(`SELECT buffer_enabled,buffer_minutes FROM tenant_availability_policies WHERE tenant_id=$1`, [room.tenantId])).rows[0]
        ?? { buffer_enabled: true, buffer_minutes: 15 };
      const ttl = (await client.query(`SELECT ttl_minutes FROM tenant_hold_ttl_policies WHERE tenant_id=$1 AND channel='WEB'`, [room.tenantId])).rows[0]?.ttl_minutes ?? 15;
      const bufferMinutes = buffer.buffer_enabled ? buffer.buffer_minutes : 0;
      const deposit = await snapshotDepositPolicy(client, room.tenantId, 'WEB', quote.priceSnapshot.totalAmountVnd);
      const occupancyId = randomUUID();
      const holdId = await this.newHoldIdWithUniqueCode(client, phoneHash);
      const bookingCode = this.bookingCode(holdId);
      await lockRoomOccupancy(client, dto.roomId);
      try {
        await client.query(`INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
          VALUES($1,$2,$3,$4,'BOOKING',$5,tstzrange($6::timestamptz,$6::timestamptz+(($7::integer+$8::integer)*interval '1 minute'),'[)'),'HELD')`,
        [occupancyId, room.tenantId, room.branchId, dto.roomId, holdId, start.toISOString(), dto.durationMinutes, bufferMinutes]);
      } catch (error) {
        if ((error as { code?: string }).code === '23P01') throw new ConflictException('Room already has an active occupancy in this interval');
        throw error;
      }
      await client.query(`INSERT INTO booking_holds(id,tenant_id,branch_id,room_id,occupancy_id,created_by,idempotency_key,request_hash,channel,
        start_at,duration_minutes,buffer_minutes,expires_at,customer_phone,customer_email,price_snapshot,public_phone_hash,booking_code_hash,
        public_accepted_terms,public_accepted_terms_version,deposit_policy_snapshot)
        VALUES($1,$2,$3,$4,$5,NULL,$6,$7,'WEB',$8,$9,$10,clock_timestamp()+($11::integer*interval '1 minute'),$12,$13,$14,$15,$16,$17,$18,$19)`,
      [holdId, room.tenantId, room.branchId, dto.roomId, occupancyId, key, requestHash, start.toISOString(), dto.durationMinutes, bufferMinutes,
        ttl, dto.phone, dto.email ?? null, JSON.stringify(quote.priceSnapshot), phoneHash, this.codeHash(bookingCode), terms.text, terms.version, JSON.stringify(deposit)]);
      await client.query(`INSERT INTO audit_logs(id,tenant_id,action,entity_type,entity_id,after_data)
        VALUES($1,$2,'PUBLIC_HOLD_CREATED','BOOKING_HOLD',$3,$4)`,
      [randomUUID(), room.tenantId, holdId, JSON.stringify({ branchId: room.branchId, roomId: dto.roomId, channel: 'WEB', termsVersion: terms.version, depositMode: deposit.mode, requiredDepositVnd: deposit.requiredAmountVnd })]);
      const response = await this.holdResponse(client, room.tenantId, holdId);
      await client.query('COMMIT'); return response;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async lookup(ip: string, dto: PublicBookingLookupDto) {
    const phoneHash = this.keyedHash('phone', normalizePhone(dto.phone));
    await this.consumeLimit('PUBLIC_LOOKUP_IP', this.keyedHash('ip', ip), this.lookupIpLimit);
    await this.consumeLimit('PUBLIC_LOOKUP_PHONE', phoneHash, this.lookupPhoneLimit);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const hold = (await client.query(`SELECT id,tenant_id FROM booking_holds WHERE created_by IS NULL AND public_phone_hash=$1
        AND booking_code_hash=$2 FOR UPDATE`, [phoneHash, this.codeHash(dto.bookingCode)])).rows[0];
      if (!hold) throw new NotFoundException('Booking lookup details are invalid');
      await this.expireIfNeeded(client, hold.id);
      const row = (await client.query(`SELECT h.id AS "holdId",b.id AS "bookingId",b.status AS "bookingStatus",h.branch_id AS "branchId",h.room_id AS "roomId",
        h.start_at AS "startAt",h.duration_minutes AS "durationMinutes",h.status,h.price_snapshot->>'totalAmountVnd' AS "totalAmountVnd",
        h.public_accepted_terms_version::text AS "termsVersion",COALESCE(h.deposit_policy_snapshot->>'requiredAmountVnd','0') AS "depositRequiredVnd",
        (SELECT COALESCE(SUM(d.amount_vnd),0)::text FROM hold_deposits d WHERE d.tenant_id=h.tenant_id AND d.hold_id=h.id) AS "depositRecordedVnd" FROM booking_holds h LEFT JOIN bookings b ON b.hold_id=h.id AND b.tenant_id=h.tenant_id
        WHERE h.id=$1 AND h.tenant_id=$2`, [hold.id, hold.tenant_id])).rows[0];
      await client.query('COMMIT'); return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async holdResponse(client: PoolClient, tenantId: string, holdId: string) {
    const row = (await client.query(`SELECT h.id AS "holdId",h.branch_id AS "branchId",h.room_id AS "roomId",h.start_at AS "startAt",
      h.duration_minutes AS "durationMinutes",upper(o.occupied_range) AS "reservedEndAt",h.expires_at AS "expiresAt",h.status,
      h.price_snapshot->>'totalAmountVnd' AS "totalAmountVnd",h.public_accepted_terms_version::text AS "termsVersion",
      COALESCE(h.deposit_policy_snapshot->>'requiredAmountVnd','0') AS "depositRequiredVnd"
      FROM booking_holds h JOIN room_occupancy o ON o.id=h.occupancy_id WHERE h.tenant_id=$1 AND h.id=$2`, [tenantId, holdId])).rows[0];
    return { ...row, bookingCode: this.bookingCode(holdId) };
  }

  private async expireIfNeeded(client: PoolClient, holdId: string) {
    const expired = (await client.query(`UPDATE booking_holds SET status='EXPIRED',updated_at=clock_timestamp()
      WHERE id=$1 AND status='HELD' AND expires_at<=clock_timestamp() RETURNING tenant_id,occupancy_id`, [holdId])).rows[0];
    if (!expired) return;
    await client.query(`UPDATE room_occupancy SET status='RELEASED',updated_at=clock_timestamp() WHERE id=$1 AND status='HELD'`, [expired.occupancy_id]);
    await client.query(`INSERT INTO audit_logs(id,tenant_id,action,entity_type,entity_id,after_data)
      VALUES($1,$2,'HOLD_EXPIRED','BOOKING_HOLD',$3,$4)`, [randomUUID(), expired.tenant_id, holdId, JSON.stringify({ status: 'EXPIRED' })]);
  }

  private async consumeLimit(scope: string, hash: string, limit: number) {
    const row = (await this.db.query(`INSERT INTO public_rate_limit_buckets(scope,key_hash,window_started_at,request_count,updated_at)
      VALUES($1,$2,clock_timestamp(),1,clock_timestamp()) ON CONFLICT(scope,key_hash) DO UPDATE SET
      request_count=CASE WHEN public_rate_limit_buckets.window_started_at<=clock_timestamp()-($3::integer*interval '1 minute') THEN 1 ELSE public_rate_limit_buckets.request_count+1 END,
      window_started_at=CASE WHEN public_rate_limit_buckets.window_started_at<=clock_timestamp()-($3::integer*interval '1 minute') THEN clock_timestamp() ELSE public_rate_limit_buckets.window_started_at END,
      updated_at=clock_timestamp() RETURNING request_count`, [scope, hash, this.windowMinutes])).rows[0];
    if (row.request_count > limit) throw new HttpException('Too many public booking requests', HttpStatus.TOO_MANY_REQUESTS);
  }

  private keyedHash(context: string, value: string) { return createHmac('sha256', this.secret).update(`${context}:${value}`).digest('hex'); }
  private bookingCode(holdId: string) { return deriveBookingCode(this.secret, holdId); }
  private codeHash(code: string) { return bookingCodeHash(this.secret, code); }
  /** PD-038: short codes can collide; pick a hold id whose code is not already used by this phone (lookup is phone + code). */
  private async newHoldIdWithUniqueCode(client: PoolClient, phoneHash: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const holdId = randomUUID();
      const taken = (await client.query(`SELECT 1 FROM booking_holds WHERE created_by IS NULL AND public_phone_hash=$1 AND booking_code_hash=$2 LIMIT 1`,
        [phoneHash, this.codeHash(this.bookingCode(holdId))])).rowCount;
      if (!taken) return holdId;
    }
    throw new ConflictException('Could not allocate a booking code; retry');
  }
  private assertKey(key: string) {
    if (!key || !/^[\x21-\x7e]{1,100}$/.test(key)) throw new BadRequestException('Idempotency-Key must contain 1–100 visible ASCII characters');
  }
  private setting(config: ConfigService, name: string, fallback: number) {
    const value = Number(config.get(name) ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > 10000) throw new Error(`${name} must be an integer between 1 and 10000`);
    return value;
  }
}
