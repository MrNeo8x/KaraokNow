import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { hash } from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/platform/database/database.module';
import { NOTIFICATION_ADAPTER, NotificationAdapter, NotificationRequest } from '../src/notification/notification.port';
import { OutboxService } from '../src/outbox/outbox.service';
import { OutboxWorker } from '../src/outbox/outbox.worker';
import { HoldService } from '../src/booking/hold.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_PASSWORD = 'Owner-password-123';

class RecordingNotificationAdapter implements NotificationAdapter {
  delivered: NotificationRequest[] = [];
  failNext = false;
  async deliver(request: NotificationRequest): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('Synthetic provider failure with secret detail'); }
    this.delivered.push(request);
  }
}

describe('Authentication, membership, RBAC and venue API', () => {
  let postgres: StartedPostgreSqlContainer;
  let app: INestApplication;
  let pool: Pool;
  let ownerToken: string;
  let outbox: OutboxService;
  let worker: OutboxWorker;
  const notifications = new RecordingNotificationAdapter();

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.JWT_SECRET = 'integration-test-secret-at-least-32-characters';
    execFileSync(resolve('node_modules/.bin/node-pg-migrate'), ['up', '-m', 'migrations'], {
      cwd: resolve('.'), env: { ...process.env }, stdio: 'pipe'
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NOTIFICATION_ADAPTER).useValue(notifications).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    pool = app.get<Pool>(PG_POOL);
    outbox = app.get(OutboxService);
    worker = app.get(OutboxWorker);
    await pool.query(`INSERT INTO tenants(id,code,name,status) VALUES ($1,'A','Tenant A','ACTIVE'),($2,'B','Tenant B','ACTIVE')`,
      [TENANT_A, TENANT_B]);
    await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES ($1,'owner@example.com',$2,'Owner','ACTIVE')`,
      [OWNER_ID, await hash(OWNER_PASSWORD, 4)]);
    await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES ($1,$2,$3,'ACTIVE')`,
      [OWNER_MEMBERSHIP_ID, TENANT_A, OWNER_ID]);
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES ($1,'OWNER')`, [OWNER_MEMBERSHIP_ID]);
    ownerToken = (await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: OWNER_PASSWORD }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (postgres) await postgres.stop();
  });

  it('requires authentication and an active tenant membership', async () => {
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('X-Tenant-ID', TENANT_A)
      .set('X-Correlation-ID', 'contract-test-401').expect(401)
      .expect('X-Correlation-ID', 'contract-test-401')
      .expect(({ body }) => {
        expect(body.correlationId).toBe('contract-test-401');
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(body.error.message).toBe('Bearer token is required');
      });
    await request(app.getHttpServer()).get('/v1/merchant/branches')
      .set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(403);
  });

  it('exposes liveness, database readiness, process-local metrics and correlation IDs', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await request(app.getHttpServer()).get('/v1/health/live').set('traceparent',
      `00-${traceId}-00f067aa0ba902b7-01`).expect(200)
      .expect('X-Trace-ID', traceId)
      .expect('X-Correlation-ID', /^[A-Za-z0-9._-]{1,128}$/)
      .expect(({ body }) => expect(body).toEqual({ status: 'ok' }));
    await request(app.getHttpServer()).get('/v1/health/ready').expect(200)
      .expect(({ body }) => expect(body).toEqual({ status: 'ok', dependencies: { database: 'ok' } }));
    (jest.spyOn(pool, 'query') as jest.Mock).mockRejectedValueOnce(new Error('synthetic database outage'));
    await request(app.getHttpServer()).get('/v1/health/ready').expect(503)
      .expect(({ body }) => expect(body.error.code).toBe('SERVICE_UNAVAILABLE'));
    await request(app.getHttpServer()).get('/v1/metrics').expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect(({ text }) => {
        expect(text).toContain('# TYPE karaokenow_http_requests_total counter');
        expect(text).toContain('karaokenow_http_requests_total{method="GET",status="200"}');
        expect(text).toContain('karaokenow_http_request_duration_seconds_sum');
      });
  });

  it('rotates refresh tokens, detects reuse and revokes logout sessions', async () => {
    const login = (await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: OWNER_PASSWORD }).expect(200)).body;
    expect(login.expiresIn).toBe(900);
    const rotated = (await request(app.getHttpServer()).post('/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken }).expect(200)).body;
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    await request(app.getHttpServer()).post('/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/v1/auth/refresh')
      .send({ refreshToken: rotated.refreshToken }).expect(401);

    const logoutLogin = (await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: OWNER_PASSWORD }).expect(200)).body;
    await request(app.getHttpServer()).get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${logoutLogin.accessToken}`).expect(200);
    await request(app.getHttpServer()).post('/v1/auth/logout')
      .send({ refreshToken: logoutLogin.refreshToken }).expect(204);
    await request(app.getHttpServer()).get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${logoutLogin.accessToken}`).expect(401);
  });

  it('locks repeated failed logins in PostgreSQL and records security events', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await request(app.getHttpServer()).post('/v1/auth/login')
        .send({ email: 'attacker@example.com', password: 'wrong-password' }).expect(401);
    }
    await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'attacker@example.com', password: 'wrong-password' }).expect(429);
    await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'attacker@example.com', password: 'wrong-password' }).expect(429);
    const events = await pool.query(`SELECT event FROM auth_security_events WHERE event IN ('LOGIN_FAILED','LOGIN_LOCKED')`);
    expect(events.rows.filter((row) => row.event === 'LOGIN_FAILED')).toHaveLength(4);
    expect(events.rows.filter((row) => row.event === 'LOGIN_LOCKED')).toHaveLength(2);
  });

  it('publishes committed outbox notifications, retries failures and recovers stale claims', async () => {
    const rolledBackAggregate = '33333333-3333-4333-8333-333333333333';
    const rollbackClient = await pool.connect();
    await rollbackClient.query('BEGIN');
    await outbox.enqueue(rollbackClient, {
      tenantId: TENANT_A, eventType: 'NOTIFICATION_REQUESTED', aggregateType: 'TEST', aggregateId: rolledBackAggregate,
      payload: { channel: 'EMAIL', destinationRef: 'test-user', template: 'test', variables: { code: 'redacted' } }
    });
    await rollbackClient.query('ROLLBACK');
    rollbackClient.release();
    expect((await pool.query('SELECT 1 FROM outbox_events WHERE aggregate_id=$1', [rolledBackAggregate])).rowCount).toBe(0);

    const aggregateId = '44444444-4444-4444-8444-444444444444';
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO auth_security_events(id,user_id,event) VALUES (gen_random_uuid(),$1,'DOMAIN_COMMITTED')`, [OWNER_ID]);
    const eventId = await outbox.enqueue(client, {
      tenantId: TENANT_A, eventType: 'NOTIFICATION_REQUESTED', aggregateType: 'TEST', aggregateId,
      payload: { channel: 'EMAIL', destinationRef: 'test-user', template: 'booking-confirmed', variables: { bookingCode: 'TEST' } }
    });
    await client.query('COMMIT');
    client.release();

    notifications.failNext = true;
    expect(await worker.runOnce()).toBe(1);
    expect((await pool.query('SELECT status,attempts,last_error FROM outbox_events WHERE id=$1', [eventId])).rows[0])
      .toEqual({ status: 'PENDING', attempts: 1, last_error: 'Error' });
    expect((await pool.query(`SELECT 1 FROM auth_security_events WHERE event='DOMAIN_COMMITTED'`)).rowCount).toBe(1);

    await pool.query(`UPDATE outbox_events SET available_at=now() WHERE id=$1`, [eventId]);
    expect(await worker.runOnce()).toBe(1);
    expect(notifications.delivered).toHaveLength(1);
    expect((await pool.query('SELECT status FROM outbox_events WHERE id=$1', [eventId])).rows[0].status).toBe('PUBLISHED');

    const staleId = await outboxEvent('55555555-5555-4555-8555-555555555555');
    await pool.query(`UPDATE outbox_events SET status='PROCESSING',locked_at=now()-interval '10 minutes' WHERE id=$1`, [staleId]);
    expect(await worker.runOnce(1)).toBe(1);
    expect((await pool.query('SELECT status FROM outbox_events WHERE id=$1', [staleId])).rows[0].status).toBe('PUBLISHED');
  });

  it('supports audited branch and room CRUD/status using soft deletion', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'HN01', name: 'Hoan Kiem', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/branches/${branch.id}`)
      .send({ name: 'Hoan Kiem Central' }).expect(200).expect(({ body }) => expect(body.name).toBe('Hoan Kiem Central'));

    const room = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'VIP01', name: 'VIP 01', capacity: 12 }).expect(201)).body;
    await authorized('patch', `/v1/merchant/rooms/${room.id}`)
      .send({ capacity: 15 }).expect(200).expect(({ body }) => expect(body.capacity).toBe(15));
    await authorized('patch', `/v1/merchant/rooms/${room.id}/status`)
      .send({ status: 'MAINTENANCE' }).expect(200).expect(({ body }) => expect(body.status).toBe('MAINTENANCE'));
    await authorized('patch', `/v1/merchant/branches/${branch.id}/status`)
      .send({ status: 'INACTIVE' }).expect(200).expect(({ body }) => expect(body.status).toBe('INACTIVE'));

    const audit = await pool.query('SELECT action FROM audit_logs WHERE tenant_id=$1 ORDER BY occurred_at', [TENANT_A]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      'BRANCH_CREATED','BRANCH_UPDATED','ROOM_CREATED','ROOM_UPDATED','ROOM_STATUS_CHANGED','BRANCH_STATUS_CHANGED'
    ]));
    await authorized('get', '/v1/merchant/audit-logs?limit=10').expect(200)
      .expect(({ body }) => expect(body.length).toBeGreaterThanOrEqual(6));
  });

  it('manages tenant-scoped room amenities and metadata-only media with audit records', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'META01', name: 'Metadata', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'META-R1', name: 'Metadata room', capacity: 8 }).expect(201)).body;
    const otherRoom = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'META-R2', name: 'Other room', capacity: 6 }).expect(201)).body;

    const amenity = (await authorized('post', `/v1/merchant/rooms/${room.id}/amenities`)
      .send({ label: 'Wireless microphones' }).expect(201)).body;
    await authorized('get', `/v1/merchant/rooms/${room.id}/amenities`).expect(200)
      .expect(({ body }) => expect(body.map((item: { label: string }) => item.label)).toEqual(['Wireless microphones']));
    await authorized('patch', `/v1/merchant/rooms/${room.id}/amenities/${amenity.id}`)
      .send({ label: 'Wireless microphone set' }).expect(200)
      .expect(({ body }) => expect(body.label).toBe('Wireless microphone set'));
    await authorized('post', `/v1/merchant/rooms/${room.id}/amenities`)
      .send({ label: 'Wireless microphone set' }).expect(409);
    const otherAmenity = (await authorized('post', `/v1/merchant/rooms/${otherRoom.id}/amenities`)
      .send({ label: 'Other room only' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/rooms/${room.id}/amenities/${otherAmenity.id}`)
      .send({ label: 'Cross-room attempt' }).expect(404);
    await authorized('delete', `/v1/merchant/rooms/${room.id}/amenities/${amenity.id}`).expect(204);
    await authorized('post', `/v1/merchant/rooms/${room.id}/amenities`)
      .send({ label: '   ' }).expect(400);

    const media = (await authorized('post', `/v1/merchant/rooms/${room.id}/media`)
      .send({ assetRef: 'catalog/rooms/vip-front-v1', altText: 'Front view', displayOrder: 1 }).expect(201)).body;
    expect(media).toMatchObject({ roomId: room.id, assetRef: 'catalog/rooms/vip-front-v1', altText: 'Front view', displayOrder: 1 });
    await authorized('patch', `/v1/merchant/rooms/${room.id}/media/${media.id}`)
      .send({ altText: null, displayOrder: 3 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ altText: null, displayOrder: 3 }));
    await authorized('get', `/v1/merchant/rooms/${room.id}/media`).expect(200)
      .expect(({ body }) => expect(body).toHaveLength(1));
    const otherMedia = (await authorized('post', `/v1/merchant/rooms/${otherRoom.id}/media`)
      .send({ assetRef: 'catalog/rooms/other-room' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/rooms/${room.id}/media/${otherMedia.id}`)
      .send({ displayOrder: 4 }).expect(404);
    await authorized('post', `/v1/merchant/rooms/${room.id}/media`)
      .send({ assetRef: '' }).expect(400);
    await authorized('post', `/v1/merchant/rooms/${room.id}/media`)
      .send({ assetRef: 'https://cdn.example.invalid/image.jpg?token=secret' }).expect(400);
    await authorized('delete', `/v1/merchant/rooms/${room.id}/media/${media.id}`).expect(204);

    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_type IN ('ROOM_AMENITY','ROOM_MEDIA')`, [TENANT_A]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      'ROOM_AMENITY_CREATED', 'ROOM_AMENITY_UPDATED', 'ROOM_AMENITY_DELETED',
      'ROOM_MEDIA_CREATED', 'ROOM_MEDIA_UPDATED', 'ROOM_MEDIA_DELETED'
    ]));
  });

  it('migrates tenant-scoped price plans, special dates and prioritized rules with constraints', async () => {
    const planA = '66666666-6666-4666-8666-666666666661';
    const planB = '66666666-6666-4666-8666-666666666662';
    const specialDateA = '77777777-7777-4777-8777-777777777771';
    const specialDateB = '77777777-7777-4777-8777-777777777772';
    await pool.query(`INSERT INTO price_plans(id,tenant_id,code,name) VALUES
      ($1,$3,'STANDARD','Standard'),($2,$4,'STANDARD','Other tenant')`, [planA, planB, TENANT_A, TENANT_B]);
    await pool.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date) VALUES
      ($1,$3,'TET-2027','Tet',DATE '2027-02-06',DATE '2027-02-09'),
      ($2,$4,'OTHER-2027','Other tenant date',DATE '2027-02-06',DATE '2027-02-09')`,
    [specialDateA, specialDateB, TENANT_A, TENANT_B]);

    const ruleId = '88888888-8888-4888-8888-888888888881';
    await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,special_date_id,code,name,priority,
      weekdays,start_time,end_time,min_duration_minutes,max_duration_minutes,amount_vnd,amount_unit)
      VALUES ($1,$2,$3,$4,'TET-EVENING','Tet evening',25,ARRAY[5,6]::smallint[],TIME '18:00',TIME '23:00',60,240,500000,'PER_HOUR')`,
    [ruleId, TENANT_A, planA, specialDateA]);
    const stored = await pool.query(`SELECT priority,weekdays,amount_vnd,amount_unit FROM price_rules WHERE id=$1`, [ruleId]);
    expect(stored.rows[0]).toEqual({ priority: 25, weekdays: [5, 6], amount_vnd: '500000', amount_unit: 'PER_HOUR' });

    await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,start_time,end_time,amount_vnd,amount_unit)
      VALUES (gen_random_uuid(),$1,$2,'OVERNIGHT','Overnight window',1,TIME '23:00',TIME '02:00',0,'PER_BOOKING')`, [TENANT_A, planA]);

    await expect(pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,special_date_id,code,name,priority,amount_vnd)
      VALUES (gen_random_uuid(),$1,$2,$3,'CROSS-TENANT','Invalid reference',1,0)`,
    [TENANT_A, planA, specialDateB])).rejects.toMatchObject({ code: '23503' });
    await expect(pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,start_time,end_time,amount_vnd)
      VALUES (gen_random_uuid(),$1,$2,'BAD-TIME','Invalid time window',1,TIME '18:00',TIME '18:00',0)`,
    [TENANT_A, planA])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date)
      VALUES (gen_random_uuid(),$1,'BAD-DATE','Invalid date',DATE '2027-02-10',DATE '2027-02-09')`,
    [TENANT_A])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,amount_vnd,amount_unit)
      VALUES (gen_random_uuid(),$1,$2,'BAD-UNIT','Invalid unit',1,1000,'PER_MINUTE')`,
    [TENANT_A, planA])).rejects.toMatchObject({ code: '23514' });
  });

  it('creates idempotent holds with buffer, concurrency protection and expiry', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'HOLD-API', name: 'Hold branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'HOLD-ROOM', name: 'Hold room', capacity: 8 }).expect(201)).body;
    const input = { roomId: room.id, channel: 'WALK_IN', startAt: '2036-01-01T18:00:00+07:00', durationMinutes: 60 };
    const path = '/v1/merchant/booking/holds';
    await authorized('post', path).send(input).expect(400);
    const hold = (await authorized('post', path).set('Idempotency-Key', 'hold-one').send(input).expect(201)).body;
    expect(hold).toMatchObject({ roomId: room.id, status: 'HELD', bufferMinutes: 15, reservedEndAt: '2036-01-01T12:15:00.000Z' });
    await authorized('get', `${path}/${hold.id}`).expect(200).expect(({ body }) => expect(body).toMatchObject({ id: hold.id, status: 'HELD' }));
    const membershipB = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_B, OWNER_ID])).rows[0].id;
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER')`, [membershipB]);
    await request(app.getHttpServer()).get(`${path}/${hold.id}`).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(404);
    await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).set('Idempotency-Key', 'cross-tenant').send(input).expect(404);
    await pool.query('DELETE FROM membership_roles WHERE membership_id=$1', [membershipB]);
    await pool.query('DELETE FROM tenant_memberships WHERE id=$1', [membershipB]);
    const replay = (await authorized('post', path).set('Idempotency-Key', 'hold-one').send({ ...input, startAt: '2036-01-01T11:00:00Z' }).expect(201)).body;
    expect(replay.id).toBe(hold.id);
    await authorized('post', path).set('Idempotency-Key', 'hold-one').send({ ...input, durationMinutes: 90 }).expect(409);
    await authorized('post', path).set('Idempotency-Key', 'overlap').send({ ...input, startAt: '2036-01-01T19:00:00+07:00' }).expect(409);
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => authorized('post', path).set('Idempotency-Key', `parallel-${i}`).send({ ...input, startAt: '2036-01-02T18:00:00+07:00' })));
    expect(results.filter(response => response.status === 201)).toHaveLength(1);
    expect(results.filter(response => response.status === 409)).toHaveLength(99);
    const replays = await Promise.all(Array.from({ length: 10 }, () => authorized('post', path).set('Idempotency-Key', 'same-key').send({ ...input, startAt: '2036-01-03T18:00:00+07:00' }).expect(201)));
    expect(new Set(replays.map(response => response.body.id)).size).toBe(1);
    const listPath = `/v1/merchant/branches/${branch.id}/booking/holds`;
    const range = { from: '2036-01-01T11:30:00Z', to: '2036-01-04T00:00:00Z', limit: 1 };
    const page1 = (await authorized('get', listPath).query(range).expect(200)).body;
    expect(page1).toMatchObject({ limit: 1, offset: 0, hasMore: true, items: [{ id: hold.id, status: 'HELD' }] });
    const page2 = (await authorized('get', listPath).query({ ...range, offset: 1 }).expect(200)).body;
    expect(page2.items[0].id).not.toBe(hold.id);
    await authorized('get', listPath).query({ from: '2036-01-01T12:00:00Z', to: '2036-01-02T00:00:00Z' }).expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
    await authorized('get', listPath).query({ from: '2036-01-01T11:00:00', to: '2036-01-02T00:00:00Z' }).expect(422);
    await authorized('get', listPath).query({ ...range, limit: 101 }).expect(400);
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [hold.id]);
    await authorized('get', listPath).query(range).expect(200).expect(({ body }) => expect(body.items[0].status).toBe('EXPIRED'));
    expect((await pool.query(`SELECT status FROM booking_holds WHERE id=$1`, [hold.id])).rows[0].status).toBe('HELD');
    await authorized('get', `${path}/${hold.id}`).expect(200).expect(({ body }) => expect(body.status).toBe('EXPIRED'));
    expect(await app.get(HoldService).expireBatch()).toBe(0);
    const parallelId = replays[0].body.id;
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [parallelId]);
    expect(await app.get(HoldService).expireBatch()).toBe(1);
    const expired = (await authorized('post', path).set('Idempotency-Key', 'hold-one').send(input).expect(201)).body;
    expect(expired).toMatchObject({ id: hold.id, status: 'EXPIRED' });
    await authorized('post', path).set('Idempotency-Key', 'after-expiry').send(input).expect(201);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2`, [TENANT_A, hold.id]);
    expect(audit.rows.map(row => row.action).sort()).toEqual(['HOLD_CREATED', 'HOLD_EXPIRED']);
  }, 30000);

  it('attaches customer details and an immutable server-calculated price snapshot to a hold', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'SNAPSHOT', name: 'Snapshot', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'SNAP-ROOM', name: 'Snapshot room', capacity: 8 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'SNAP-PLAN', name: 'Snapshot plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Snapshot plan', status: 'ACTIVE' }).expect(200);
    const ruleInput = { pricePlanId: plan.id, code: 'SNAP-RULE', name: 'Snapshot rule', priority: 900, amountVnd: '100000', amountUnit: 'PER_BOOKING', roomId: room.id };
    const rule = (await authorized('post', '/v1/merchant/pricing/rules').send(ruleInput).expect(201)).body;
    const input = { roomId: room.id, channel: 'WALK_IN', startAt: '2038-01-01T18:00:00+07:00', durationMinutes: 60 };
    const hold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'snapshot-hold').send(input).expect(201)).body;
    const detailsPath = `/v1/merchant/booking/holds/${hold.id}/details`;
    await authorized('post', detailsPath).send({ expectedTotalAmountVnd: '100000' }).expect(400);
    await authorized('post', detailsPath).send({ phone: '0912345678', email: 'invalid', expectedTotalAmountVnd: '100000' }).expect(400);
    await authorized('post', detailsPath).send({ phone: '0912345678', expectedTotalAmountVnd: '99999' }).expect(409);
    const unchanged = (await authorized('get', `/v1/merchant/booking/holds/${hold.id}`).expect(200)).body;
    expect(unchanged.priceSnapshot).toBeNull();
    const details = { phone: '0912345678', email: 'guest@example.com', expectedTotalAmountVnd: '100000' };
    const saved = (await authorized('post', detailsPath).send(details).expect(200)).body;
    expect(saved).toMatchObject({ customerPhone: details.phone, customerEmail: details.email, priceSnapshot: { totalAmountVnd: '100000', calculation: { priceRuleId: rule.id } } });
    const { pricePlanId: _plan, code: _code, ...ruleValues } = ruleInput;
    await authorized('patch', `/v1/merchant/pricing/rules/${rule.id}`).send({ ...ruleValues, amountVnd: '200000', status: 'ACTIVE' }).expect(200);
    const replay = (await authorized('post', detailsPath).send(details).expect(200)).body;
    expect(replay.priceSnapshot.totalAmountVnd).toBe('100000');
    await authorized('post', detailsPath).send({ ...details, phone: '0987654321' }).expect(409);
    const audit = await pool.query(`SELECT after_data FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='HOLD_DETAILS_ATTACHED'`, [TENANT_A, hold.id]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain(details.phone);
    expect(JSON.stringify(audit.rows[0])).not.toContain(details.email);
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [hold.id]);
    await authorized('post', detailsPath).send(details).expect(409);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Snapshot plan', status: 'INACTIVE' }).expect(200);
  });

  it('stores audited hold TTL settings separately by tenant and channel', async () => {
    const path = '/v1/merchant/booking/hold-ttl';
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body).toEqual({ channel: 'WEB', ttlMinutes: 15 }));
    await authorized('get', `${path}/web`).expect(400);
    await authorized('patch', `${path}/WEB`).send({ ttlMinutes: 0 }).expect(400);
    await authorized('patch', `${path}/WEB`).send({ ttlMinutes: 25 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ channel: 'WEB', ttlMinutes: 25, version: '0' }));
    await authorized('get', `${path}/WALK_IN`).expect(200).expect(({ body }) => expect(body.ttlMinutes).toBe(15));
    await pool.query(`INSERT INTO tenant_hold_ttl_policies(tenant_id,channel,ttl_minutes,updated_by) VALUES($1,'WEB',60,$2)`, [TENANT_B, OWNER_ID]);
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body.ttlMinutes).toBe(25));
    await Promise.all([35, 45].map(ttlMinutes => authorized('patch', `${path}/WEB`).send({ ttlMinutes }).expect(200)));
    const audit = await pool.query(`SELECT before_data,after_data FROM audit_logs WHERE tenant_id=$1 AND action='HOLD_TTL_POLICY_UPDATED' ORDER BY (after_data->>'version')::integer`, [TENANT_A]);
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows[0].before_data.ttlMinutes).toBe(15);
    expect(audit.rows[1].before_data.ttlMinutes).toBe(25);
    expect(audit.rows[2].before_data.ttlMinutes).toBe(audit.rows[1].after_data.ttlMinutes);
  });

  it('manages price rules and quotes a room from the configured rule', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'RULE-API', name: 'Rule API', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'RULE-ROOM', name: 'Rule room', capacity: 8 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'RULE-PLAN', name: 'Rule plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Rule plan', status: 'ACTIVE' }).expect(200);
    const special = (await authorized('post', '/v1/merchant/pricing/special-dates').send({ code: 'RULE-DATE', name: 'Rule date', startDate: '2035-01-01', endDate: '2035-01-01' }).expect(201)).body;
    const input = { pricePlanId: plan.id, code: 'SPECIAL', name: 'Special', priority: 500, amountVnd: '120001', amountUnit: 'PER_HOUR', roomId: room.id, specialDateId: special.id, weekdays: [], startTime: '22:00', endTime: '02:00' };
    const rule = (await authorized('post', '/v1/merchant/pricing/rules').send(input).expect(201)).body;
    expect(rule).toMatchObject({ status: 'ACTIVE', amountVnd: '120001', version: '0' });
    await authorized('post', '/v1/merchant/pricing/rules').send(input).expect(409);
    await authorized('post', '/v1/merchant/pricing/rules').send({ ...input, code: 'BAD-TIME', endTime: '22:00' }).expect(422);
    await authorized('post', '/v1/merchant/pricing/rules').send({ ...input, code: 'BAD-AMOUNT', amountVnd: '9223372036854775808' }).expect(422);
    const foreignDate = (await pool.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date) VALUES(gen_random_uuid(),$1,'RULE-FOREIGN','Foreign','2035-01-01','2035-01-01') RETURNING id`, [TENANT_B])).rows[0].id;
    await authorized('post', '/v1/merchant/pricing/rules').send({ ...input, code: 'BAD-REF', specialDateId: foreignDate }).expect(422);
    await authorized('get', `/v1/merchant/pricing/plans/${plan.id}/rules`).expect(200).expect(({ body }) => expect(body.map((r: {id: string}) => r.id)).toContain(rule.id));
    await authorized('get', `/v1/merchant/pricing/rules/${rule.id}`).expect(200);
    const quote = (await authorized('post', `/v1/merchant/rooms/${room.id}/quote`).send({ startAt: '2035-01-01T22:30:00+07:00', durationMinutes: 90 }).expect(201)).body.priceSnapshot;
    expect(quote).toMatchObject({ totalAmountVnd: '180002', calculation: { priceRuleId: rule.id, priceRuleVersion: '0' } });
    const { code: _code, pricePlanId: _plan, ...values } = input;
    await authorized('patch', `/v1/merchant/pricing/rules/${rule.id}`).send({ ...values, status: 'INACTIVE' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'INACTIVE', version: '1' }));
    await authorized('post', `/v1/merchant/rooms/${room.id}/quote`).send({ startAt: '2035-01-01T22:30:00+07:00', durationMinutes: 90 }).expect(422);
    const foreignPlan = (await pool.query(`INSERT INTO price_plans(id,tenant_id,code,name) VALUES(gen_random_uuid(),$1,'RULE-FOREIGN','Foreign') RETURNING id`, [TENANT_B])).rows[0].id;
    await authorized('get', `/v1/merchant/pricing/plans/${foreignPlan}/rules`).expect(404);
    await authorized('post', '/v1/merchant/pricing/rules').send({ ...input, code: 'FOREIGN', pricePlanId: foreignPlan }).expect(404);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2`, [TENANT_A, rule.id]);
    expect(audit.rows.map(row => row.action).sort()).toEqual(['PRICE_RULE_CREATED', 'PRICE_RULE_UPDATED']);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Rule plan', status: 'INACTIVE' }).expect(200);
  });

  it('manages tenant-scoped special dates with audited changes', async () => {
    const path = '/v1/merchant/pricing/special-dates';
    const date = (await authorized('post', path).send({ code: 'API-HOLIDAY', name: 'Holiday', startDate: '2031-01-01', endDate: '2031-01-02' }).expect(201)).body;
    expect(date).toMatchObject({ status: 'ACTIVE', startDate: '2031-01-01', endDate: '2031-01-02' });
    await authorized('post', path).send({ code: 'API-HOLIDAY', name: 'Duplicate', startDate: '2031-01-01', endDate: '2031-01-02' }).expect(409);
    await authorized('post', path).send({ code: 'INVALID-DATE', name: 'Invalid', startDate: '2031-02-30', endDate: '2031-03-01' }).expect(400);
    await authorized('patch', `${path}/${date.id}`).send({ name: 'Holiday', startDate: '2031-01-03', endDate: '2031-01-02', status: 'ACTIVE' }).expect(422);
    await authorized('patch', `${path}/${date.id}`).send({ name: 'Holiday changed', startDate: '2031-01-01', endDate: '2031-01-03', status: 'INACTIVE' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ name: 'Holiday changed', status: 'INACTIVE', endDate: '2031-01-03' }));
    await authorized('get', `${path}/${date.id}`).expect(200);
    await authorized('get', path).expect(200).expect(({ body }) => expect(body.some((entry: { id: string }) => entry.id === date.id)).toBe(true));
    const foreign = (await pool.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date) VALUES(gen_random_uuid(),$1,'FOREIGN-API','Foreign','2031-01-01','2031-01-02') RETURNING id`, [TENANT_B])).rows[0].id;
    await authorized('get', `${path}/${foreign}`).expect(404);
    await authorized('patch', `${path}/${foreign}`).send({ name: 'Denied', startDate: '2031-01-01', endDate: '2031-01-02', status: 'ACTIVE' }).expect(404);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2`, [TENANT_A, date.id]);
    expect(audit.rows.map(row => row.action).sort()).toEqual(['SPECIAL_DATE_CREATED', 'SPECIAL_DATE_UPDATED']);
  });

  it('manages tenant-scoped price plans with audited changes', async () => {
    const created = (await authorized('post', '/v1/merchant/pricing/plans')
      .send({ code: 'PLAN-API', name: 'Plan API', effectiveFrom: '2030-01-01' }).expect(201)).body;
    expect(created).toMatchObject({ status: 'DRAFT', version: '0', effectiveFrom: '2030-01-01' });
    await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'PLAN-API', name: 'Duplicate' }).expect(409);
    await authorized('patch', `/v1/merchant/pricing/plans/${created.id}`)
      .send({ name: 'Active plan', status: 'ACTIVE', effectiveFrom: '2030-01-01', effectiveTo: '2029-12-31' }).expect(422);
    await authorized('patch', `/v1/merchant/pricing/plans/${created.id}`)
      .send({ name: 'Active plan', status: 'ACTIVE', effectiveFrom: '2030-01-01', effectiveTo: '2030-12-31' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'ACTIVE', version: '1' }));
    await authorized('get', `/v1/merchant/pricing/plans/${created.id}`).expect(200);
    await authorized('get', '/v1/merchant/pricing/plans').expect(200)
      .expect(({ body }) => expect(body.some((plan: { id: string }) => plan.id === created.id)).toBe(true));
    const foreign = (await pool.query(`INSERT INTO price_plans(id,tenant_id,code,name) VALUES(gen_random_uuid(),$1,'FOREIGN-API','Foreign') RETURNING id`, [TENANT_B])).rows[0].id;
    await authorized('get', `/v1/merchant/pricing/plans/${foreign}`).expect(404);
    await authorized('patch', `/v1/merchant/pricing/plans/${foreign}`).send({ name: 'Denied', status: 'ACTIVE' }).expect(404);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2`, [TENANT_A, created.id]);
    expect(audit.rows.map(row => row.action).sort()).toEqual(['PRICE_PLAN_CREATED', 'PRICE_PLAN_UPDATED']);
  });

  it('reads and updates audited merchant booking-duration policy with approved defaults', async () => {
    await authorized('get', '/v1/merchant/pricing/duration-policy').expect(200)
      .expect(({ body }) => expect(body).toEqual({
        durationStepMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480
      }));
    await authorized('patch', '/v1/merchant/pricing/duration-policy')
      .send({ durationStepMinutes: 45, minDurationMinutes: 90, maxDurationMinutes: 180 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        durationStepMinutes: 45, minDurationMinutes: 90, maxDurationMinutes: 180, version: '0'
      }));
    await authorized('get', '/v1/merchant/pricing/duration-policy').expect(200)
      .expect(({ body }) => expect(body.durationStepMinutes).toBe(45));
    await authorized('patch', '/v1/merchant/pricing/duration-policy')
      .send({ durationStepMinutes: 30, minDurationMinutes: 300, maxDurationMinutes: 120 }).expect(422);
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_type='BOOKING_DURATION_POLICY'`, [TENANT_A]);
    expect(audit.rows.map((row) => row.action)).toContain('BOOKING_DURATION_POLICY_UPDATED');
  });

  it('quotes by local booking start, applies priority and returns a versioned price snapshot', async () => {
    await authorized('patch', '/v1/merchant/pricing/duration-policy')
      .send({ durationStepMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480 }).expect(200);
    const branch = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'QUOTE01', name: 'Quote branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'QUOTE-R1', name: 'Quote room', capacity: 10 }).expect(201)).body;
    const planId = '99999999-9999-4999-8999-999999999991';
    const specialDateId = '99999999-9999-4999-8999-999999999992';
    await pool.query(`INSERT INTO price_plans(id,tenant_id,code,name,status) VALUES ($1,$2,'QUOTE','Quote plan','ACTIVE')`,
      [planId, TENANT_A]);
    await pool.query(`INSERT INTO special_dates(id,tenant_id,code,name,start_date,end_date,status)
      VALUES ($1,$2,'QUOTE-NIGHT','Quote night',DATE '2030-04-10',DATE '2030-04-10','ACTIVE')`,
    [specialDateId, TENANT_A]);
    await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,amount_vnd,amount_unit)
      VALUES ('99999999-9999-4999-8999-999999999993',$1,$2,'HOURLY','Hourly base',10,100001,'PER_HOUR')`,
    [TENANT_A, planId]);
    await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,special_date_id,code,name,priority,
      start_time,end_time,amount_vnd,amount_unit)
      VALUES ('99999999-9999-4999-8999-999999999994',$1,$2,$3,'NIGHT-FIXED','Fixed special night',20,
      TIME '22:00',TIME '02:00',175000,'PER_BOOKING')`, [TENANT_A, planId, specialDateId]);

    const specialQuote = (await authorized('post', `/v1/merchant/rooms/${room.id}/quote`)
      .send({ startAt: '2030-04-10T22:30:00+07:00', durationMinutes: 120 }).expect(201)).body.priceSnapshot;
    expect(specialQuote).toMatchObject({
      schemaVersion: 1, tenantId: TENANT_A, branchId: branch.id, roomId: room.id,
      timezone: 'Asia/Ho_Chi_Minh', startAt: '2030-04-10T15:30:00.000Z',
      endAt: '2030-04-10T17:30:00.000Z', durationMinutes: 120, currency: 'VND', totalAmountVnd: '175000',
      calculation: { priceRuleCode: 'NIGHT-FIXED', amountUnit: 'PER_BOOKING', priority: 20,
        matchedOnLocalStart: { date: '2030-04-10', time: '22:30:00' } }
    });

    const nextDateQuote = (await authorized('post', `/v1/merchant/rooms/${room.id}/quote`)
      .send({ startAt: '2030-04-11T00:30:00+07:00', durationMinutes: 120 }).expect(201)).body.priceSnapshot;
    expect(nextDateQuote.totalAmountVnd).toBe('200002');
    expect(nextDateQuote.calculation.priceRuleCode).toBe('HOURLY');

    await authorized('post', `/v1/merchant/rooms/${room.id}/quote`)
      .send({ startAt: '2030-04-10T22:30:00+07:00', durationMinutes: 91 }).expect(422);
    await authorized('post', `/v1/merchant/rooms/${room.id}/quote`)
      .send({ startAt: '2030-04-10T22:30:00', durationMinutes: 120 }).expect(422);

    await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,special_date_id,code,name,priority,
      start_time,end_time,amount_vnd,amount_unit)
      VALUES ('99999999-9999-4999-8999-999999999995',$1,$2,$3,'NIGHT-TIE','Tied special night',20,
      TIME '22:00',TIME '02:00',175000,'PER_BOOKING')`, [TENANT_A, planId, specialDateId]);
    await authorized('post', `/v1/merchant/rooms/${room.id}/quote`)
      .send({ startAt: '2030-04-10T22:30:00+07:00', durationMinutes: 120 }).expect(409);
  });

  it('reads and updates the audited merchant buffer policy with the approved defaults', async () => {
    await authorized('get', '/v1/merchant/availability/buffer-policy').expect(200)
      .expect(({ body }) => expect(body).toEqual({ bufferEnabled: true, bufferMinutes: 15 }));
    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: false, bufferMinutes: 35 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ bufferEnabled: false, bufferMinutes: 35, version: '0' }));
    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: true, bufferMinutes: 10 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ bufferEnabled: true, bufferMinutes: 10, version: '1' }));
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE tenant_id=$1 AND entity_type='AVAILABILITY_POLICY'`, [TENANT_A]);
    expect(audit.rows.filter((row) => row.action === 'AVAILABILITY_POLICY_UPDATED')).toHaveLength(2);
    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: true, bufferMinutes: 1441 }).expect(400);
  });

  it('searches active rooms using an after-booking buffer and half-open occupancy ranges', async () => {
    await authorized('patch', '/v1/merchant/pricing/duration-policy')
      .send({ durationStepMinutes: 30, minDurationMinutes: 60, maxDurationMinutes: 480 }).expect(200);
    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: true, bufferMinutes: 15 }).expect(200);
    const branch = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'SEARCH01', name: 'Search branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const bookingRoom = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'SEARCH-R1', name: 'Booking room', capacity: 10 }).expect(201)).body;
    const maintenanceRoom = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'SEARCH-R2', name: 'Maintenance room', capacity: 8 }).expect(201)).body;
    await pool.query(`INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
      VALUES (gen_random_uuid(),$1,$2,$3,'BOOKING',gen_random_uuid(),tstzrange($4,$5,'[)'),'CONFIRMED')`,
    [TENANT_A, branch.id, bookingRoom.id, '2030-05-10T05:00:00Z', '2030-05-10T06:00:00Z']);
    await authorized('post', '/v1/merchant/room-blocks').send({
      roomId: maintenanceRoom.id, startAt: '2030-05-10T11:45:00+07:00', endAt: '2030-05-10T12:45:00+07:00', reason: 'Maintenance'
    }).expect(201);

    const withBuffer = (await authorized('get', `/v1/merchant/branches/${branch.id}/availability`)
      .query({ startAt: '2030-05-10T11:00:00+07:00', durationMinutes: 60 }).expect(200)).body;
    expect(withBuffer).toMatchObject({
      bufferEnabled: true, bufferMinutes: 15, appliedBufferMinutes: 15,
      startAt: '2030-05-10T04:00:00.000Z', requestedEndAt: '2030-05-10T05:00:00.000Z',
      reservedEndAt: '2030-05-10T05:15:00.000Z'
    });
    expect(withBuffer.rooms).toHaveLength(0);

    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: false, bufferMinutes: 15 }).expect(200);
    const withoutBuffer = (await authorized('get', `/v1/merchant/branches/${branch.id}/availability`)
      .query({ startAt: '2030-05-10T11:00:00+07:00', durationMinutes: 60 }).expect(200)).body;
    expect(withoutBuffer.appliedBufferMinutes).toBe(0);
    expect(withoutBuffer.rooms.map((room: { id: string }) => room.id)).toEqual([bookingRoom.id]);

    await authorized('patch', '/v1/merchant/availability/buffer-policy')
      .send({ bufferEnabled: true, bufferMinutes: 15 }).expect(200);
    const adjacent = (await authorized('get', `/v1/merchant/branches/${branch.id}/availability`)
      .query({ startAt: '2030-05-10T10:30:00+07:00', durationMinutes: 60 }).expect(200)).body;
    expect(adjacent.rooms.map((room: { id: string }) => room.id).sort()).toEqual([bookingRoom.id, maintenanceRoom.id].sort());
    await authorized('get', `/v1/merchant/branches/${branch.id}/availability`)
      .query({ startAt: '2030-05-10T11:00:00', durationMinutes: 60 }).expect(422);
  });

  it('enforces maintenance and booking occupancy overlap with [start,end) ranges', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'AVL01', name: 'Availability', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms')
      .send({ branchId: branch.id, code: 'AVL-R1', name: 'Availability Room', capacity: 10 }).expect(201)).body;
    const first = (await authorized('post', '/v1/merchant/room-blocks').send({
      roomId: room.id, startAt: '2030-01-01T10:00:00Z', endAt: '2030-01-01T12:00:00Z', reason: 'Maintenance'
    }).expect(201)).body;
    await authorized('post', '/v1/merchant/room-blocks').send({
      roomId: room.id, startAt: '2030-01-01T12:00:00Z', endAt: '2030-01-01T13:00:00Z', reason: 'Adjacent block'
    }).expect(201);
    await authorized('post', '/v1/merchant/room-blocks').send({
      roomId: room.id, startAt: '2030-01-01T11:00:00Z', endAt: '2030-01-01T11:30:00Z', reason: 'Overlap'
    }).expect(409);
    await authorized('post', '/v1/merchant/room-blocks').send({
      roomId: room.id, startAt: '2030-01-02T11:00:00Z', endAt: '2030-01-02T10:00:00Z', reason: 'Invalid'
    }).expect(400);
    await authorized('patch', `/v1/merchant/room-blocks/${first.id}`).send({
      startAt: '2030-01-01T09:00:00Z', endAt: '2030-01-01T11:00:00Z', reason: 'Updated maintenance'
    }).expect(200).expect(({ body }) => expect(body.reason).toBe('Updated maintenance'));

    await expect(pool.query(
      `INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
       VALUES (gen_random_uuid(),$1,$2,$3,'BOOKING',gen_random_uuid(),tstzrange($4,$5,'[)'),'HELD')`,
      [TENANT_A, branch.id, room.id, '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z']
    )).rejects.toMatchObject({ code: '23P01' });

    await authorized('post', `/v1/merchant/room-blocks/${first.id}/release`)
      .expect(200).expect(({ body }) => expect(body.status).toBe('RELEASED'));
    await pool.query(
      `INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
       VALUES (gen_random_uuid(),$1,$2,$3,'BOOKING',gen_random_uuid(),tstzrange($4,$5,'[)'),'HELD')`,
      [TENANT_A, branch.id, room.id, '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z']
    );
    await authorized('get', `/v1/merchant/branches/${branch.id}/room-blocks`)
      .expect(200).expect(({ body }) => expect(body).toHaveLength(2));
  });

  it('manages memberships and restricts a branch manager to assigned branches', async () => {
    const assigned = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'HN02', name: 'Assigned', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const unassigned = (await authorized('post', '/v1/merchant/branches')
      .send({ code: 'HN03', name: 'Unassigned', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const membership = (await authorized('post', '/v1/merchant/memberships').send({
      email: 'manager@example.com', displayName: 'Manager', temporaryPassword: 'Manager-password-123',
      roles: ['BRANCH_MANAGER'], branchIds: [assigned.id]
    }).expect(201)).body;
    expect(membership.roles).toContain('BRANCH_MANAGER');

    const temporaryLogin = (await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'manager@example.com', password: 'Manager-password-123' }).expect(200)).body;
    expect(temporaryLogin.mustChangePassword).toBe(true);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${temporaryLogin.accessToken}`)
      .set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${temporaryLogin.accessToken}`)
      .send({ currentPassword: 'Manager-password-123', newPassword: 'Manager-new-password-456' }).expect(204);
    await request(app.getHttpServer()).get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${temporaryLogin.accessToken}`).expect(401);
    const managerLogin = (await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'manager@example.com', password: 'Manager-new-password-456' }).expect(200)).body;
    expect(managerLogin.mustChangePassword).toBe(false);
    const managerToken = managerLogin.accessToken;
    const deniedRoom = (await authorized('post', '/v1/merchant/rooms').send({ branchId: unassigned.id, code: 'DENY-HOLD', name: 'Denied hold', capacity: 8 }).expect(201)).body;
    const ownedHold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'manager-denied-hold').send({ roomId: deniedRoom.id, channel: 'WALK_IN', startAt: '2037-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(201)).body;
    await request(app.getHttpServer()).get(`/v1/merchant/booking/holds/${ownedHold.id}`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post(`/v1/merchant/booking/holds/${ownedHold.id}/details`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ phone: '0912345678', expectedTotalAmountVnd: '100000' }).expect(403);
    await request(app.getHttpServer()).get(`/v1/merchant/branches/${unassigned.id}/booking/holds`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).query({ from: '2037-01-01T00:00:00Z', to: '2037-01-02T00:00:00Z' }).expect(403);
    await request(app.getHttpServer()).post('/v1/merchant/booking/holds').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).set('Idempotency-Key', 'denied').send({ roomId: deniedRoom.id, channel: 'WALK_IN', startAt: '2037-01-02T18:00:00+07:00', durationMinutes: 60 }).expect(403);
    await request(app.getHttpServer()).get(`/v1/merchant/booking/holds/${ownedHold.id}`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_B).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/pricing/special-dates').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/pricing/plans').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post('/v1/merchant/pricing/rules').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({}).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', TENANT_A).expect(200).expect(({ body }) => {
        expect(body.map((branch: { id: string }) => branch.id)).toEqual([assigned.id]);
      });
    await request(app.getHttpServer()).post('/v1/merchant/branches').set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', TENANT_A).send({ code: 'NO', name: 'Denied', timezone: 'Asia/Ho_Chi_Minh' }).expect(403);
    await request(app.getHttpServer()).get(`/v1/merchant/branches/${unassigned.id}`).set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', TENANT_A).expect(403);

    await authorized('patch', `/v1/merchant/memberships/${membership.id}`)
      .send({ status: 'INACTIVE' }).expect(200);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${managerToken}`)
      .set('X-Tenant-ID', TENANT_A).expect(403);
  });

  it('rejects invalid credentials, tenant context and timezones', async () => {
    await request(app.getHttpServer()).post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: 'wrong-password' }).expect(401);
    await request(app.getHttpServer()).get('/v1/merchant/branches')
      .set('Authorization', `Bearer ${ownerToken}`).expect(400);
    await authorized('post', '/v1/merchant/branches')
      .send({ code: 'BAD', name: 'Bad timezone', timezone: 'Mars/Olympus' }).expect(400);
    await authorized('post', '/v1/merchant/branches')
      .send({ code: 'DUP', name: 'First', timezone: 'Asia/Ho_Chi_Minh' }).expect(201);
    await authorized('post', '/v1/merchant/branches')
      .send({ code: 'DUP', name: 'Second', timezone: 'Asia/Ho_Chi_Minh' }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('CONFLICT'));
  });

  function authorized(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
    return request(app.getHttpServer())[method](path)
      .set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_A);
  }

  async function outboxEvent(aggregateId: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await outbox.enqueue(client, {
        tenantId: TENANT_A, eventType: 'NOTIFICATION_REQUESTED', aggregateType: 'TEST', aggregateId,
        payload: { channel: 'EMAIL', destinationRef: 'test-user', template: 'recovered', variables: {} }
      });
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
});
