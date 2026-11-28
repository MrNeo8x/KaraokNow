import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/platform/database/database.module';
import { NOTIFICATION_ADAPTER, NotificationAdapter, NotificationRequest } from '../src/notification/notification.port';
import { OutboxService } from '../src/outbox/outbox.service';
import { OutboxWorker } from '../src/outbox/outbox.worker';
import { HoldService } from '../src/booking/hold.service';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertMatchesContract } from './openapi-contract';

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
    // Dotted directory like the default `be/.storage` (regression: express send refused dot-paths → 500).
    process.env.STORAGE_LOCAL_DIR = join(mkdtempSync(join(tmpdir(), 'karaokenow-storage-')), '.storage');
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

  it('revokes the rotated token family when logout races with refresh', async () => {
    const login = () => request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'owner@example.com', password: OWNER_PASSWORD }).expect(200);
    const sequential = (await login()).body;
    const rotated = (await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: sequential.refreshToken }).expect(200)).body;
    await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken: sequential.refreshToken }).expect(204);
    await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${rotated.accessToken}`).expect(401);
    await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
    for (let i = 0; i < 5; i++) {
      const pair = (await login()).body;
      const [refresh, logout] = await Promise.all([
        request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: pair.refreshToken }),
        request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken: pair.refreshToken })
      ]);
      expect(logout.status).toBe(204);
      expect([200, 401]).toContain(refresh.status);
      if (refresh.status === 200) {
        await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${refresh.body.accessToken}`).expect(401);
        await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: refresh.body.refreshToken }).expect(401);
      }
      await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${pair.accessToken}`).expect(401);
    }
    await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken: 'unknown-token-with-sufficient-length-12345' }).expect(204);
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

  it('does not persist untrusted provider error names or messages', async () => {
    const eventId = await outboxEvent('66666666-6666-4666-8666-666666666666');
    const failing = new OutboxWorker(pool, { deliver: async () => { const error = new Error('message-secret'); error.name = 'provider-secret'; throw error; } });
    expect(await failing.runOnce()).toBe(1);
    const event = (await pool.query('SELECT status,last_error FROM outbox_events WHERE id=$1', [eventId])).rows[0];
    expect(event).toEqual({ status: 'PENDING', last_error: 'DeliveryError' });
    await pool.query(`UPDATE outbox_events SET status='DEAD' WHERE id=$1`, [eventId]);
  });

  it('prevents a stale outbox claimant from overwriting the new claim result', async () => {
    const eventId = await outboxEvent('77777777-7777-4777-8777-777777777777');
    let release!: () => void;
    let started!: () => void;
    const claimed = new Promise<void>(resolveStart => { started = resolveStart; });
    const pending = new Promise<void>(resolveDelivery => { release = resolveDelivery; });
    const slow = new OutboxWorker(pool, { deliver: async () => { started(); await pending; } });
    const slowRun = slow.runOnce();
    try {
      await claimed;
      await pool.query(`UPDATE outbox_events SET locked_at=clock_timestamp()-interval '10 minutes' WHERE id=$1`, [eventId]);
      const failing = new OutboxWorker(pool, { deliver: async () => { throw new Error('synthetic provider failure'); } });
      expect(await failing.runOnce(1)).toBe(1);
      const before = (await pool.query(`SELECT status,attempts FROM outbox_events WHERE id=$1`, [eventId])).rows[0];
      expect(before).toEqual({ status: 'PENDING', attempts: 2 });
      release(); await slowRun;
      expect((await pool.query(`SELECT status,attempts FROM outbox_events WHERE id=$1`, [eventId])).rows[0]).toEqual(before);
    } finally { release(); await slowRun; }
    await pool.query(`UPDATE outbox_events SET status='DEAD' WHERE id=$1`, [eventId]);
  });

  it('runs the outbox worker process without reporting unconfigured delivery as success', async () => {
    const id = await outboxEvent('88888888-8888-4888-8888-888888888888');
    const child = spawn(process.execPath, ['-r', 'ts-node/register', 'scripts/run-outbox-worker.ts'], { cwd: resolve('.'), env: process.env, stdio: 'ignore' });
    const exited = once(child, 'exit');
    try {
      let row: { status: string; attempts: number } = { status: 'PENDING', attempts: 0 };
      const deadline = Date.now() + 15000;
      while (row.attempts === 0 && Date.now() < deadline && child.exitCode === null) {
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
        row = (await pool.query('SELECT status,attempts FROM outbox_events WHERE id=$1', [id])).rows[0];
      }
      expect(row.attempts).toBeGreaterThanOrEqual(1);
      expect(['PENDING', 'PROCESSING', 'DEAD']).toContain(row.status);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const result = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Outbox worker did not shut down')); }, 5000).unref())]);
      expect(result).toEqual([0, null]);
      const final = (await pool.query('SELECT status FROM outbox_events WHERE id=$1', [id])).rows[0];
      expect(['PENDING', 'DEAD']).toContain(final.status);
      await pool.query('DELETE FROM outbox_events WHERE id=$1', [id]);
    }
  }, 25000);

  it('reports tenant-scoped outbox backlog without exposing payloads', async () => {
    const path = '/v1/merchant/notifications/outbox/backlog';
    await request(app.getHttpServer()).get(path).set('X-Tenant-ID', TENANT_A).expect(401);
    const baseline = (await authorized('get', path).expect(200)).body;
    const ids = (await pool.query(`INSERT INTO outbox_events(id,tenant_id,event_type,aggregate_type,aggregate_id,payload,status,available_at,locked_at)
      VALUES (gen_random_uuid(),$1,'TEST','TEST',gen_random_uuid(),'{"secret":"hidden"}','PENDING',clock_timestamp()-interval '1 minute',NULL),
      (gen_random_uuid(),$1,'TEST','TEST',gen_random_uuid(),'{}','PROCESSING',clock_timestamp(),clock_timestamp()),
      (gen_random_uuid(),$1,'TEST','TEST',gen_random_uuid(),'{}','DEAD',clock_timestamp(),NULL),
      (gen_random_uuid(),$2,'TEST','TEST',gen_random_uuid(),'{}','DEAD',clock_timestamp(),NULL) RETURNING id`, [TENANT_A, TENANT_B])).rows.map(row => row.id);
    try {
      const response = (await authorized('get', path).expect(200)).body;
      expect(BigInt(response.pendingCount)).toBe(BigInt(baseline.pendingCount) + 1n);
      expect(BigInt(response.processingCount)).toBe(BigInt(baseline.processingCount) + 1n);
      expect(BigInt(response.deadCount)).toBe(BigInt(baseline.deadCount) + 1n);
      expect(response.oldestReadySeconds).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(response)).not.toContain('hidden');
    } finally { await pool.query('DELETE FROM outbox_events WHERE id=ANY($1::uuid[])', [ids]); }
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
    await authorized('get', '/v1/merchant/booking/hold-expiry/backlog').expect(200).expect(({ body }) => {
      expect(body.overdueCount).toBe('1'); expect(body.oldestOverdueSeconds).toBeGreaterThanOrEqual(60);
    });
    await authorized('get', listPath).query(range).expect(200).expect(({ body }) => expect(body.items[0].status).toBe('EXPIRED'));
    expect((await pool.query(`SELECT status FROM booking_holds WHERE id=$1`, [hold.id])).rows[0].status).toBe('HELD');
    await authorized('get', `${path}/${hold.id}`).expect(200).expect(({ body }) => expect(body.status).toBe('EXPIRED'));
    await authorized('get', '/v1/merchant/booking/hold-expiry/backlog').expect(200)
      .expect(({ body }) => expect(body).toEqual({ overdueCount: '0', oldestOverdueSeconds: null }));
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

  it('runs the expiry worker as a process, drains overdue holds and shuts down', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'WORKER-TEST', name: 'Worker branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'WORKER-ROOM', name: 'Worker room', capacity: 8 }).expect(201)).body;
    const hold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'worker-process-test')
      .send({ roomId: room.id, channel: 'WALK_IN', startAt: '2039-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(201)).body;
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [hold.id]);
    const child = spawn(process.execPath, ['-r', 'ts-node/register', 'scripts/run-hold-expiry-worker.ts'], { cwd: resolve('.'), env: process.env, stdio: 'ignore' });
    const exited = once(child, 'exit');
    try {
      let status = 'HELD';
      const deadline = Date.now() + 15000;
      while (status === 'HELD' && Date.now() < deadline && child.exitCode === null) {
        await new Promise(resolveWait => setTimeout(resolveWait, 100));
        status = (await pool.query('SELECT status FROM booking_holds WHERE id=$1', [hold.id])).rows[0].status;
      }
      expect(status).toBe('EXPIRED');
      const occupancy = await pool.query(`SELECT o.status FROM room_occupancy o JOIN booking_holds h ON h.occupancy_id=o.id WHERE h.id=$1`, [hold.id]);
      expect(occupancy.rows[0].status).toBe('RELEASED');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const result = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker did not shut down')); }, 5000).unref())]);
      expect(result).toEqual([0, null]);
    }
  }, 25000);

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
    const verificationPath = `/v1/merchant/booking/holds/${hold.id}/phone-verification`;
    await authorized('post', verificationPath).expect(409);
    await authorized('post', detailsPath).send({ expectedTotalAmountVnd: '100000' }).expect(400);
    await authorized('post', detailsPath).send({ phone: '0912345678', email: 'invalid', expectedTotalAmountVnd: '100000' }).expect(400);
    await authorized('post', detailsPath).send({ phone: '0912345678', expectedTotalAmountVnd: '99999' }).expect(409);
    const unchanged = (await authorized('get', `/v1/merchant/booking/holds/${hold.id}`).expect(200)).body;
    expect(unchanged.priceSnapshot).toBeNull();
    const details = { phone: '0912345678', email: 'guest@example.com', expectedTotalAmountVnd: '100000' };
    const saved = (await authorized('post', detailsPath).send(details).expect(200)).body;
    expect(saved).toMatchObject({ customerPhone: details.phone, customerEmail: details.email, priceSnapshot: { totalAmountVnd: '100000', calculation: { priceRuleId: rule.id } } });
    expect(saved.phoneVerifiedAt).toBeNull();
    const verifications = await Promise.all(Array.from({ length: 4 }, () => authorized('post', verificationPath).expect(200)));
    expect(new Set(verifications.map(response => response.body.phoneVerifiedAt)).size).toBe(1);
    expect(verifications[0].body.phoneVerifiedBy).toBe(OWNER_ID);
    const verifiedAudit = await pool.query(`SELECT after_data FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='HOLD_PHONE_VERIFIED'`, [TENANT_A, hold.id]);
    expect(verifiedAudit.rows).toHaveLength(1);
    expect(verifiedAudit.rows[0].after_data).toEqual({ method: 'STAFF_PHONE_CALL' });
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
    await authorized('post', verificationPath).expect(409);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Snapshot plan', status: 'INACTIVE' }).expect(200);
  });

  it('publishes only explicitly opted-in merchants, active branches and active rooms', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'PUBLIC-CAT', name: 'Public catalog branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const active = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'PUBLIC-OK', name: 'Public room', capacity: 8 }).expect(201)).body;
    const inactive = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'PUBLIC-NO', name: 'Inactive room', capacity: 6 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'PUBLIC-PLAN', name: 'Public plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Public plan', status: 'ACTIVE' }).expect(200);
    await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'PUBLIC-RULE', name: 'Public price', priority: 1000, amountVnd: '180000', amountUnit: 'PER_BOOKING', roomId: active.id }).expect(201);
    await authorized('patch', `/v1/merchant/rooms/${inactive.id}/status`).send({ status: 'INACTIVE' }).expect(200);
    await authorized('get', '/v1/merchant/catalog/publication').expect(200).expect(({ body }) => expect(body.published).toBe(false));
    await authorized('get', '/v1/merchant/catalog/public-booking-terms').expect(200).expect(({ body }) => expect(body).toEqual({ configured: false, terms: null, version: null, updatedAt: null }));
    await authorized('patch', '/v1/merchant/catalog/public-booking-terms').send({ terms: '   ' }).expect(400);
    await authorized('patch', '/v1/merchant/catalog/public-booking-terms').send({ terms: 'Khách liên hệ chi nhánh để xử lý hủy booking.' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ configured: true, terms: 'Khách liên hệ chi nhánh để xử lý hủy booking.', version: '1' }));
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/rooms`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/booking-terms`).expect(404);
    await request(app.getHttpServer()).get('/v1/public/branches').expect(200).expect(({ body }) => expect(body.items.some((item: { id: string }) => item.id === branch.id)).toBe(false));
    await authorized('patch', '/v1/merchant/catalog/publication').send({ published: true }).expect(200);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/rooms`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/availability`).query({ startAt: '2041-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(404);
    await request(app.getHttpServer()).post(`/v1/public/rooms/${active.id}/quote`).send({ startAt: '2041-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(404);
    await pool.query('UPDATE tenant_public_catalog SET platform_approved=true WHERE tenant_id=$1', [TENANT_A]);
    await request(app.getHttpServer()).get('/v1/public/branches').query({ limit: 100 }).expect(200)
      .expect(({ body }) => expect(body.items).toContainEqual(expect.objectContaining({ id: branch.id, merchantId: TENANT_A })));
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/rooms`).expect(200)
      .expect(({ body }) => expect(body.items).toEqual([{ id: active.id, branchId: branch.id, name: 'Public room', capacity: 8 }]));
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/booking-terms`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ configured: true, terms: 'Khách liên hệ chi nhánh để xử lý hủy booking.', version: '1' }));
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/availability`).query({ startAt: '2041-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(200)
      .expect(({ body }) => { expect(body).toMatchObject({ branchId: branch.id, durationMinutes: 60, rooms: [{ id: active.id, name: 'Public room', capacity: 8 }] }); expect(JSON.stringify(body)).not.toContain('PUBLIC-OK'); });
    await request(app.getHttpServer()).post(`/v1/public/rooms/${active.id}/quote`).send({ startAt: '2041-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(201)
      .expect(({ body }) => { expect(body).toMatchObject({ roomId: active.id, branchId: branch.id, totalAmountVnd: '180000', currency: 'VND' }); expect(body).not.toHaveProperty('priceSnapshot'); expect(JSON.stringify(body)).not.toContain('PUBLIC-RULE'); });
    const publicHoldBody = { roomId: active.id, startAt: '2041-01-02T18:00:00+07:00', durationMinutes: 60, phone: '0911222333',
      email: 'public-guest@example.com', expectedTotalAmountVnd: '180000', termsVersion: '1' };
    await request(app.getHttpServer()).post('/v1/public/booking/holds').send(publicHoldBody).expect(400);
    const publicHold = (await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'public-hold-1').send(publicHoldBody).expect(201)).body;
    expect(publicHold).toMatchObject({ roomId: active.id, branchId: branch.id, status: 'HELD', totalAmountVnd: '180000', termsVersion: '1' });
    expect(publicHold.bookingCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'public-hold-1').send(publicHoldBody).expect(201)
      .expect(({ body }) => expect(body).toEqual(publicHold));
    await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'public-hold-1')
      .send({ ...publicHoldBody, expectedTotalAmountVnd: '180001' }).expect(409);
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: '0911222334', bookingCode: publicHold.bookingCode }).expect(404);
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: publicHoldBody.phone, bookingCode: publicHold.bookingCode }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ holdId: publicHold.holdId, bookingId: null, status: 'HELD', totalAmountVnd: '180000', termsVersion: '1' }));
    const looseCode = `${publicHold.bookingCode.slice(0, 3).toLowerCase()}-${publicHold.bookingCode.slice(3)} `;
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: publicHoldBody.phone, bookingCode: looseCode }).expect(200);
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: publicHoldBody.phone, bookingCode: 'ABC12O' }).expect(400);
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: '+84911222333', bookingCode: publicHold.bookingCode }).expect(200)
      .expect(({ body }) => expect(body.holdId).toBe(publicHold.holdId));
    await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'public-hold-1')
      .send({ ...publicHoldBody, phone: '84911222333' }).expect(201)
      .expect(({ body }) => expect(body).toEqual(publicHold));
    const publicAudit = await pool.query(`SELECT after_data FROM audit_logs WHERE action='PUBLIC_HOLD_CREATED' AND entity_id=$1`, [publicHold.holdId]);
    expect(publicAudit.rows).toHaveLength(1);
    expect(JSON.stringify(publicAudit.rows)).not.toContain(publicHoldBody.phone);
    expect(JSON.stringify(publicAudit.rows)).not.toContain(publicHold.bookingCode);
    // PD-038: codes issued before the change (32 hex, unkeyed SHA-256) still work for lookup.
    const legacyCode = 'abcdef0123456789abcdef0123456789';
    const savedHash = (await pool.query(`SELECT booking_code_hash FROM booking_holds WHERE id=$1`, [publicHold.holdId])).rows[0].booking_code_hash;
    await pool.query(`UPDATE booking_holds SET booking_code_hash=encode(sha256($2::bytea),'hex') WHERE id=$1`, [publicHold.holdId, legacyCode]);
    await request(app.getHttpServer()).post('/v1/public/booking/lookup').send({ phone: publicHoldBody.phone, bookingCode: legacyCode.toUpperCase() }).expect(200)
      .expect(({ body }) => expect(body.holdId).toBe(publicHold.holdId));
    await pool.query(`UPDATE booking_holds SET booking_code_hash=$2 WHERE id=$1`, [publicHold.holdId, savedHash]);
    expect(JSON.stringify((await pool.query('SELECT key_hash FROM public_rate_limit_buckets')).rows)).not.toContain(publicHoldBody.phone);
    await pool.query(`UPDATE public_rate_limit_buckets SET request_count=20 WHERE scope='PUBLIC_HOLD_IP'`);
    await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'public-hold-rate-limit')
      .send({ ...publicHoldBody, startAt: '2041-01-03T18:00:00+07:00' }).expect(429);
    await request(app.getHttpServer()).get('/v1/public/branches').query({ limit: 101 }).expect(400);
    await authorized('patch', `/v1/merchant/branches/${branch.id}/status`).send({ status: 'INACTIVE' }).expect(200);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/rooms`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/availability`).query({ startAt: '2041-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(404);
    await authorized('patch', '/v1/merchant/catalog/publication').send({ published: false }).expect(200);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND action='PUBLIC_CATALOG_UPDATED'`, [TENANT_A]);
    expect(audit.rows).toHaveLength(2);
    expect((await pool.query(`SELECT action FROM audit_logs WHERE tenant_id=$1 AND action='PUBLIC_BOOKING_TERMS_UPDATED'`, [TENANT_A])).rows).toHaveLength(1);
  });

  it('confirms a verified no-deposit hold once and snapshots booking terms', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'CONFIRM', name: 'Confirmation', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'CONFIRM-R', name: 'Confirmation room', capacity: 8 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'CONFIRM-PLAN', name: 'Confirmation plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Confirmation plan', status: 'ACTIVE' }).expect(200);
    await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'CONFIRM-RULE', name: 'Price', priority: 999, amountVnd: '120000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
    const createHold = (key: string, startAt: string) => authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', key).send({ roomId: room.id, channel: 'CONFIRM_TEST', startAt, durationMinutes: 60 });
    const hold = (await createHold('confirm-test', '2040-01-01T18:00:00+07:00').expect(201)).body;
    const confirmPath = `/v1/merchant/booking/holds/${hold.id}/confirm`;
    const terms = { cancellationTerms: 'Liên hệ cơ sở để xử lý hủy.' };
    await authorized('post', confirmPath).send(terms).expect(409);
    await authorized('post', `/v1/merchant/booking/holds/${hold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '120000' }).expect(200);
    await authorized('post', confirmPath).send(terms).expect(409);
    await authorized('post', `/v1/merchant/booking/holds/${hold.id}/phone-verification`).expect(200);
    await authorized('post', confirmPath).send(terms).expect(409);
    await authorized('patch', '/v1/merchant/booking/no-deposit-confirmation/CONFIRM_TEST').send({ allowed: true }).expect(200);
    // A policy change after the price/deposit snapshot does not affect this hold (UAT-PD-002); restore NONE for later holds.
    await authorized('patch', '/v1/merchant/booking/deposit-policy/CONFIRM_TEST').send({ mode: 'FIXED', fixedAmountVnd: '30000' }).expect(200);
    await authorized('get', `/v1/merchant/booking/holds/${hold.id}/deposits`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ depositPolicySnapshot: { mode: 'NONE' }, requiredAmountVnd: '0', depositSatisfied: false }));
    await authorized('patch', '/v1/merchant/booking/deposit-policy/CONFIRM_TEST').send({ mode: 'NONE' }).expect(200);
    await authorized('post', confirmPath).send({ cancellationTerms: '   ' }).expect(400);
    const confirmations = await Promise.all(Array.from({ length: 8 }, () => authorized('post', confirmPath).send(terms).expect(200)));
    expect(new Set(confirmations.map(response => response.body.id)).size).toBe(1);
    const booking = confirmations[0].body;
    expect(booking).toMatchObject({ holdId: hold.id, status: 'CONFIRMED', customerPhone: '0912345678', cancellationTerms: terms.cancellationTerms,
      priceSnapshot: { totalAmountVnd: '120000' }, confirmationPolicySnapshot: { depositMode: 'NONE', noDepositAllowed: true } });
    await authorized('get', `/v1/merchant/booking/bookings/${booking.id}`).expect(200).expect(({ body }) => expect(body).toEqual(booking));
    const paymentPath = `/v1/merchant/booking/bookings/${booking.id}/manual-payments`;
    await authorized('post', paymentPath).send({ method: 'CASH', amountVnd: '10000' }).expect(400);
    await authorized('post', paymentPath).set('Idempotency-Key', 'invalid').send({ method: 'CASH', amountVnd: '0' }).expect(400);
    await authorized('post', paymentPath).set('Idempotency-Key', 'invalid').send({ method: 'CASH', amountVnd: '9223372036854775808' }).expect(422);
    const payments = await Promise.all(Array.from({ length: 5 }, () => authorized('post', paymentPath).set('Idempotency-Key', 'cash-payment-1').send({ method: 'CASH', amountVnd: '30000', note: 'Phiếu số 1' }).expect(200)));
    expect(new Set(payments.map(response => response.body.id)).size).toBe(1);
    await authorized('post', paymentPath).set('Idempotency-Key', 'cash-payment-1').send({ method: 'CASH', amountVnd: '40000' }).expect(409);
    await authorized('post', paymentPath).set('Idempotency-Key', 'cash-payment-2').send({ method: 'CASH', amountVnd: '90000' }).expect(200);
    await authorized('get', paymentPath).query({ limit: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ amountVnd: '30000' }], hasMore: true }));
    await authorized('get', paymentPath).query({ limit: 1, offset: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ amountVnd: '90000' }], hasMore: false }));
    await authorized('get', `${paymentPath}/summary`).expect(200).expect(({ body }) => expect(body).toEqual({ totalRecordedVnd: '120000', paymentCount: 2 }));
    const payAudit = await pool.query(`SELECT after_data FROM audit_logs WHERE entity_type='MANUAL_PAYMENT' AND after_data->>'bookingId'=$1`, [booking.id]);
    expect(payAudit.rows).toHaveLength(2);
    expect(JSON.stringify(payAudit.rows)).not.toContain('Phiếu số 1');
    const calendarPath = `/v1/merchant/branches/${branch.id}/booking/bookings`;
    await authorized('get', calendarPath).query({ from: '2040-01-01T11:30:00Z', to: '2040-01-01T12:30:00Z', limit: 1 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ items: [{ id: booking.id }], limit: 1, offset: 0, hasMore: false }));
    await authorized('get', calendarPath).query({ from: '2040-01-01T12:00:00Z', to: '2040-01-01T13:00:00Z' }).expect(200)
      .expect(({ body }) => expect(body.items).toEqual([]));
    await authorized('get', calendarPath).query({ from: '2040-01-01T11:00:00', to: '2040-01-01T13:00:00Z' }).expect(422);
    await authorized('get', calendarPath).query({ from: '2040-01-01T11:00:00Z', to: '2040-01-01T13:00:00Z', limit: 101 }).expect(400);
    const otherMembership = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_B, OWNER_ID])).rows[0].id;
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER')`, [otherMembership]);
    await request(app.getHttpServer()).get(`/v1/merchant/booking/bookings/${booking.id}`).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(404);
    await request(app.getHttpServer()).get(paymentPath).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(404);
    await request(app.getHttpServer()).get(calendarPath).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).query({ from: '2040-01-01T11:00:00Z', to: '2040-01-01T13:00:00Z' }).expect(404);
    await request(app.getHttpServer()).post(confirmPath).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).send(terms).expect(404);
    await pool.query('DELETE FROM membership_roles WHERE membership_id=$1', [otherMembership]);
    await pool.query('DELETE FROM tenant_memberships WHERE id=$1', [otherMembership]);
    await authorized('post', confirmPath).send({ cancellationTerms: 'Khác' }).expect(409);
    await authorized('get', `/v1/merchant/booking/holds/${hold.id}`).expect(200).expect(({ body }) => expect(body.status).toBe('CONFIRMED'));
    const persisted = await pool.query(`SELECT h.status AS hold_status,o.status AS occupancy_status,b.price_snapshot,b.cancellation_terms FROM booking_holds h
      JOIN room_occupancy o ON o.id=h.occupancy_id JOIN bookings b ON b.hold_id=h.id WHERE h.id=$1`, [hold.id]);
    expect(persisted.rows[0]).toMatchObject({ hold_status: 'CONFIRMED', occupancy_status: 'CONFIRMED', cancellation_terms: terms.cancellationTerms, price_snapshot: { totalAmountVnd: '120000' } });
    expect((await pool.query(`SELECT id FROM audit_logs WHERE entity_id=$1 AND action='BOOKING_CONFIRMED'`, [booking.id])).rowCount).toBe(1);
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [hold.id]);
    await app.get(HoldService).expireBatch();
    expect((await pool.query('SELECT status FROM room_occupancy WHERE id=(SELECT occupancy_id FROM booking_holds WHERE id=$1)', [hold.id])).rows[0].status).toBe('CONFIRMED');
    const expired = (await createHold('confirm-expired', '2040-01-02T18:00:00+07:00').expect(201)).body;
    await authorized('post', `/v1/merchant/booking/holds/${expired.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '120000' }).expect(200);
    await authorized('post', `/v1/merchant/booking/holds/${expired.id}/phone-verification`).expect(200);
    const lockingClient = await pool.connect();
    try {
      await lockingClient.query('BEGIN');
      await lockingClient.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [expired.id]);
      const confirmation = authorized('post', `/v1/merchant/booking/holds/${expired.id}/confirm`).send(terms).then(response => response);
      const expiryRun = app.get(HoldService).expireBatch();
      await expiryRun;
      await lockingClient.query('COMMIT');
      expect((await confirmation).status).toBe(409);
    } finally { await lockingClient.query('ROLLBACK'); lockingClient.release(); }
    await app.get(HoldService).expireBatch();
    expect((await pool.query(`SELECT h.status,o.status AS occupancy_status FROM booking_holds h JOIN room_occupancy o ON o.id=h.occupancy_id WHERE h.id=$1`, [expired.id])).rows[0]).toEqual({ status: 'EXPIRED', occupancy_status: 'RELEASED' });
    expect((await pool.query(`SELECT id FROM bookings WHERE hold_id=$1`, [expired.id])).rowCount).toBe(0);
    const secondHold = (await createHold('confirm-second', '2040-01-03T18:00:00+07:00').expect(201)).body;
    await authorized('post', `/v1/merchant/booking/holds/${secondHold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '120000' }).expect(200);
    await authorized('post', `/v1/merchant/booking/holds/${secondHold.id}/phone-verification`).expect(200);
    const secondBooking = (await authorized('post', `/v1/merchant/booking/holds/${secondHold.id}/confirm`).send(terms).expect(200)).body;
    const calendarRange = { from: '2040-01-01T00:00:00Z', to: '2040-01-04T00:00:00Z', limit: 1 };
    await authorized('get', calendarPath).query(calendarRange).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ id: booking.id }], hasMore: true }));
    await authorized('get', calendarPath).query({ ...calendarRange, offset: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ id: secondBooking.id }], hasMore: false }));
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Confirmation plan', status: 'INACTIVE' }).expect(200);
    await pool.query(`DELETE FROM tenant_deposit_policies WHERE tenant_id=$1 AND channel='CONFIRM_TEST'`, [TENANT_A]);
    await pool.query(`DELETE FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel='CONFIRM_TEST'`, [TENANT_A]);
    await pool.query(`DELETE FROM audit_logs WHERE tenant_id=$1 AND action IN ('DEPOSIT_POLICY_UPDATED','NO_DEPOSIT_CONFIRMATION_POLICY_UPDATED') AND after_data->>'channel'='CONFIRM_TEST'`, [TENANT_A]);
  }, 30000);

  it('limits manual payment access to permitted roles and assigned branches', async () => {
    const booking = (await pool.query(`SELECT id,branch_id FROM bookings WHERE tenant_id=$1 LIMIT 1`, [TENANT_A])).rows[0];
    const user = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'cashier@example.com',$1,'Cashier','ACTIVE') RETURNING id`, [await hash('Cashier-password-123', 4)])).rows[0];
    const member = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A,user.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'CASHIER')`, [member.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [member.id,TENANT_A,booking.branch_id]);
    const token = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'cashier@example.com', password: 'Cashier-password-123' }).expect(200)).body.accessToken;
    const path = `/v1/merchant/booking/bookings/${booking.id}/manual-payments`;
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_A).expect(200);
    await request(app.getHttpServer()).get(`${path}/summary`).set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_A).expect(200).expect(({ body }) => expect(body.paymentCount).toBe(2));
    await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_A).set('Idempotency-Key', 'cashier-test').send({ method:'CASH',amountVnd:'1' }).expect(200);
  });

  it('manages audited deposit modes per tenant and channel', async () => {
    const path = '/v1/merchant/booking/deposit-policy';
    await authorized('get', path).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [], limit: 50, offset: 0, hasMore: false }));
    await request(app.getHttpServer()).get(path).set('X-Tenant-ID', TENANT_A).expect(401);
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body).toEqual({ channel: 'WEB', configured: false, mode: 'NONE', fixedAmountVnd: null, percent: null }));
    await authorized('get', `${path}/web`).expect(400);
    await authorized('patch', `${path}/WEB`).send({ mode: 'FIXED' }).expect(422);
    await authorized('patch', `${path}/WEB`).send({ mode: 'FIXED', fixedAmountVnd: '9223372036854775808' }).expect(422);
    await authorized('patch', `${path}/WEB`).send({ mode: 'PERCENT', percent: '100.0001' }).expect(422);
    await authorized('patch', `${path}/WEB`).send({ mode: 'NONE', percent: '20' }).expect(422);
    await authorized('patch', `${path}/WEB`).send({ mode: 'FIXED', fixedAmountVnd: '150000' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ mode: 'FIXED', fixedAmountVnd: '150000', percent: null, version: '0' }));
    await authorized('patch', `${path}/WEB`).send({ mode: 'PERCENT', percent: '25.125' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ mode: 'PERCENT', percent: '25.1250', fixedAmountVnd: null, version: '1' }));
    await authorized('get', `${path}/WALK_IN`).expect(200).expect(({ body }) => expect(body.mode).toBe('NONE'));
    await pool.query(`INSERT INTO tenant_deposit_policies(tenant_id,channel,mode,updated_by) VALUES($1,'WEB','NONE',$2)`, [TENANT_B, OWNER_ID]);
    await pool.query(`INSERT INTO tenant_deposit_policies(tenant_id,channel,mode,updated_by) VALUES($1,'ZZ_OTHER','NONE',$2),($3,'FOREIGN_ONLY','NONE',$2)`, [TENANT_A, OWNER_ID, TENANT_B]);
    await authorized('get', path).query({ limit: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'WEB' }], limit: 1, offset: 0, hasMore: true }));
    await authorized('get', path).query({ limit: 1, offset: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'ZZ_OTHER' }], hasMore: false }));
    await authorized('get', path).query({ limit: 101 }).expect(400);
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body.mode).toBe('PERCENT'));
    await expect(pool.query(`INSERT INTO tenant_deposit_policies(tenant_id,channel,mode,updated_by) VALUES($1,'BAD_FIXED','FIXED',$2)`, [TENANT_A, OWNER_ID])).rejects.toMatchObject({ code: '23514' });
    await Promise.all([{ mode: 'NONE' }, { mode: 'FIXED', fixedAmountVnd: '50000' }].map(body => authorized('patch', `${path}/WEB`).send(body).expect(200)));
    const audit = await pool.query(`SELECT before_data,after_data FROM audit_logs WHERE tenant_id=$1 AND action='DEPOSIT_POLICY_UPDATED' ORDER BY (after_data->>'version')::integer`, [TENANT_A]);
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows[0].before_data.mode).toBe('NONE');
    expect(audit.rows[3].before_data).toEqual(audit.rows[2].after_data);
  });

  it('stores audited no-deposit confirmation settings per tenant and channel', async () => {
    const path = '/v1/merchant/booking/no-deposit-confirmation';
    await authorized('get', path).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body).toEqual({ channel: 'WEB', configured: false, allowed: null }));
    await authorized('get', `${path}/web`).expect(400);
    await authorized('patch', `${path}/WEB`).send({ allowed: 'true' }).expect(400);
    await authorized('patch', `${path}/WEB`).send({ allowed: true }).expect(200)
      .expect(({ body }) => expect(body).toEqual({ channel: 'WEB', configured: true, allowed: true, version: '0' }));
    await authorized('get', `${path}/WALK_IN`).expect(200).expect(({ body }) => expect(body).toEqual({ channel: 'WALK_IN', configured: false, allowed: null }));
    await pool.query(`INSERT INTO tenant_no_deposit_confirmation_policies(tenant_id,channel,allowed,updated_by) VALUES($1,'WEB',false,$2)`, [TENANT_B, OWNER_ID]);
    await pool.query(`INSERT INTO tenant_no_deposit_confirmation_policies(tenant_id,channel,allowed,updated_by) VALUES($1,'ZZ_OTHER',true,$2),($3,'FOREIGN_ONLY',true,$2)`, [TENANT_A, OWNER_ID, TENANT_B]);
    await authorized('get', path).query({ limit: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'WEB', configured: true }], hasMore: true }));
    await authorized('get', path).query({ limit: 1, offset: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'ZZ_OTHER' }], hasMore: false }));
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body.allowed).toBe(true));
    await Promise.all([false, true].map(allowed => authorized('patch', `${path}/WEB`).send({ allowed }).expect(200)));
    const audit = await pool.query(`SELECT before_data,after_data FROM audit_logs WHERE tenant_id=$1 AND action='NO_DEPOSIT_CONFIRMATION_POLICY_UPDATED' ORDER BY (after_data->>'version')::integer`, [TENANT_A]);
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows[0].before_data).toEqual({ channel: 'WEB', configured: false, allowed: null });
    expect(audit.rows[1].before_data.allowed).toBe(true);
    expect(audit.rows[2].before_data.allowed).toBe(audit.rows[1].after_data.allowed);
  });

  it('restricts policy listings to owner and branch manager', async () => {
    const user = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'policy-reception@example.com',$1,'Reception','ACTIVE') RETURNING id`, [await hash('Reception-password-123', 4)])).rows[0];
    const membership = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, user.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')`, [membership.id]);
    const token = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'policy-reception@example.com', password: 'Reception-password-123' }).expect(200)).body.accessToken;
    for (const policy of ['deposit-policy', 'no-deposit-confirmation', 'hold-ttl']) {
      await request(app.getHttpServer()).get(`/v1/merchant/booking/${policy}`).set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_A).expect(403);
    }
  });

  it('stores audited hold TTL settings separately by tenant and channel', async () => {
    const path = '/v1/merchant/booking/hold-ttl';
    await authorized('get', path).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
    await authorized('get', `${path}/WEB`).expect(200).expect(({ body }) => expect(body).toEqual({ channel: 'WEB', ttlMinutes: 15 }));
    await authorized('get', `${path}/web`).expect(400);
    await authorized('patch', `${path}/WEB`).send({ ttlMinutes: 0 }).expect(400);
    await authorized('patch', `${path}/WEB`).send({ ttlMinutes: 25 }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ channel: 'WEB', ttlMinutes: 25, version: '0' }));
    await authorized('get', `${path}/WALK_IN`).expect(200).expect(({ body }) => expect(body.ttlMinutes).toBe(15));
    await pool.query(`INSERT INTO tenant_hold_ttl_policies(tenant_id,channel,ttl_minutes,updated_by) VALUES($1,'WEB',60,$2)`, [TENANT_B, OWNER_ID]);
    await pool.query(`INSERT INTO tenant_hold_ttl_policies(tenant_id,channel,ttl_minutes,updated_by) VALUES($1,'ZZ_OTHER',30,$2),($3,'FOREIGN_ONLY',30,$2)`, [TENANT_A, OWNER_ID, TENANT_B]);
    await authorized('get', path).query({ limit: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'WEB', ttlMinutes: 25 }], hasMore: true }));
    await authorized('get', path).query({ limit: 1, offset: 1 }).expect(200).expect(({ body }) => expect(body).toMatchObject({ items: [{ channel: 'ZZ_OTHER' }], hasMore: false }));
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
    // Free-text reasons stay out of the audit log; an edit is recorded as a flag.
    const blockAudit = await pool.query(`SELECT action,after_data FROM audit_logs WHERE entity_id=$1 ORDER BY occurred_at`, [first.id]);
    expect(blockAudit.rows.map(r => r.action)).toEqual(['ROOM_BLOCK_CREATED', 'ROOM_BLOCK_UPDATED', 'ROOM_BLOCK_RELEASED']);
    expect(JSON.stringify(blockAudit.rows)).not.toMatch(/Maintenance|maintenance/);
    expect(blockAudit.rows[1].after_data.reasonChanged).toBe(true);
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
    await request(app.getHttpServer()).patch('/v1/merchant/catalog/publication').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ published: true }).expect(403);
    await request(app.getHttpServer()).patch('/v1/merchant/catalog/public-booking-terms').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ terms: 'Không được phép' }).expect(403);
    const otherBranchBooking = (await pool.query(`SELECT b.id FROM bookings b JOIN branches br ON br.id=b.branch_id WHERE b.tenant_id=$1 AND br.code='CONFIRM' LIMIT 1`, [TENANT_A])).rows[0];
    await request(app.getHttpServer()).get(`/v1/merchant/booking/bookings/${otherBranchBooking.id}`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post(`/v1/merchant/booking/bookings/${otherBranchBooking.id}/manual-payments`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).set('Idempotency-Key', 'deny-pay').send({ method: 'CASH', amountVnd: '10000' }).expect(403);
    const otherBookingBranch = (await pool.query(`SELECT branch_id FROM bookings WHERE id=$1`, [otherBranchBooking.id])).rows[0].branch_id;
    await request(app.getHttpServer()).get(`/v1/merchant/branches/${otherBookingBranch}/booking/bookings`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).query({ from: '2040-01-01T11:00:00Z', to: '2040-01-01T13:00:00Z' }).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/notifications/outbox/backlog').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/booking/hold-expiry/backlog').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    for (const policy of ['deposit-policy', 'no-deposit-confirmation', 'hold-ttl']) {
      await request(app.getHttpServer()).get(`/v1/merchant/booking/${policy}`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(200);
    }
    await request(app.getHttpServer()).patch('/v1/merchant/booking/deposit-policy/WALK_IN').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ mode: 'NONE' }).expect(200);
    await request(app.getHttpServer()).patch('/v1/merchant/booking/no-deposit-confirmation/WALK_IN').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ allowed: true }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ channel: 'WALK_IN', configured: true, allowed: true }));
    await request(app.getHttpServer()).get('/v1/merchant/booking/no-deposit-confirmation/WALK_IN').set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(200);
    const deniedRoom = (await authorized('post', '/v1/merchant/rooms').send({ branchId: unassigned.id, code: 'DENY-HOLD', name: 'Denied hold', capacity: 8 }).expect(201)).body;
    const ownedHold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'manager-denied-hold').send({ roomId: deniedRoom.id, channel: 'WALK_IN', startAt: '2037-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(201)).body;
    await request(app.getHttpServer()).get(`/v1/merchant/booking/holds/${ownedHold.id}`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post(`/v1/merchant/booking/holds/${ownedHold.id}/details`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ phone: '0912345678', expectedTotalAmountVnd: '100000' }).expect(403);
    await request(app.getHttpServer()).post(`/v1/merchant/booking/holds/${ownedHold.id}/phone-verification`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(app.getHttpServer()).post(`/v1/merchant/booking/holds/${ownedHold.id}/confirm`).set('Authorization', `Bearer ${managerToken}`).set('X-Tenant-ID', TENANT_A).send({ cancellationTerms: 'Terms' }).expect(403);
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

  it('records idempotent CASH deposits on a hold against the snapshotted policy and confirms only when covered', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'DEPOSIT', name: 'Deposit branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'DEPOSIT-R', name: 'Deposit room', capacity: 8 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'DEPOSIT-PLAN', name: 'Deposit plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Deposit plan', status: 'ACTIVE' }).expect(200);
    await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'DEPOSIT-RULE', name: 'Price', priority: 998, amountVnd: '200000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
    await authorized('patch', '/v1/merchant/booking/deposit-policy/DEPOSIT_TEST').send({ mode: 'PERCENT', percent: '30' }).expect(200);
    const createHold = (key: string, startAt: string) => authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', key)
      .send({ roomId: room.id, channel: 'DEPOSIT_TEST', startAt, durationMinutes: 60 }).expect(201).then(response => response.body);
    const hold = await createHold('deposit-hold', '2042-01-01T18:00:00+07:00');
    const depositPath = `/v1/merchant/booking/holds/${hold.id}/deposits`;
    const confirmPath = `/v1/merchant/booking/holds/${hold.id}/confirm`;
    const terms = { cancellationTerms: 'Liên hệ cơ sở để xử lý hủy và hoàn cọc.' };
    await authorized('get', depositPath).expect(200).expect(({ body }) => expect(body).toEqual({ holdId: hold.id, holdStatus: 'HELD', depositPolicySnapshot: null,
      requiredAmountVnd: '0', totalRecordedVnd: '0', remainingVnd: '0', depositSatisfied: false, items: [] }));
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-early').send({ method: 'CASH', amountVnd: '10000' }).expect(409);
    const detailed = (await authorized('post', `/v1/merchant/booking/holds/${hold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '200000' }).expect(200)).body;
    expect(detailed.depositPolicySnapshot).toEqual({ mode: 'PERCENT', fixedAmountVnd: null, percent: '30.0000', policyVersion: '0', requiredAmountVnd: '60000' });
    await authorized('patch', '/v1/merchant/booking/deposit-policy/DEPOSIT_TEST').send({ mode: 'FIXED', fixedAmountVnd: '10000' }).expect(200);
    await authorized('post', `/v1/merchant/booking/holds/${hold.id}/phone-verification`).expect(200);
    await authorized('post', confirmPath).send(terms).expect(409);
    await authorized('post', depositPath).send({ method: 'CASH', amountVnd: '10000' }).expect(400);
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-zero').send({ method: 'CASH', amountVnd: '0' }).expect(400);
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-card').send({ method: 'CARD', amountVnd: '10000' }).expect(400);
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-too-much').send({ method: 'CASH', amountVnd: '60001' }).expect(409);
    const first = await Promise.all(Array.from({ length: 5 }, () => authorized('post', depositPath).set('Idempotency-Key', 'dep-1').send({ method: 'CASH', amountVnd: '40000', note: 'Phiếu cọc 1' }).expect(200)));
    expect(new Set(first.map(response => response.body.id)).size).toBe(1);
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-1').send({ method: 'CASH', amountVnd: '40001' }).expect(409);
    await authorized('post', confirmPath).send(terms).expect(409);
    const racing = await Promise.all(['dep-2a', 'dep-2b'].map(key => authorized('post', depositPath).set('Idempotency-Key', key).send({ method: 'CASH', amountVnd: '20000' })));
    expect(racing.map(response => response.status).sort()).toEqual([200, 409]);
    await authorized('get', depositPath).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ requiredAmountVnd: '60000', totalRecordedVnd: '60000', remainingVnd: '0', depositSatisfied: true, depositPolicySnapshot: { mode: 'PERCENT' } });
      expect(body.items.map((item: { amountVnd: string }) => item.amountVnd)).toEqual(['40000', '20000']);
    });
    const confirmations = await Promise.all(Array.from({ length: 4 }, () => authorized('post', confirmPath).send(terms).expect(200)));
    expect(new Set(confirmations.map(response => response.body.id)).size).toBe(1);
    expect(confirmations[0].body.confirmationPolicySnapshot).toEqual({ depositMode: 'PERCENT', depositPolicyVersion: '0', requiredDepositVnd: '60000',
      depositRecordedVnd: '60000', noDepositAllowed: false, noDepositPolicyVersion: null });
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-after').send({ method: 'CASH', amountVnd: '1' }).expect(409);
    await authorized('post', depositPath).set('Idempotency-Key', 'dep-1').send({ method: 'CASH', amountVnd: '40000', note: 'Phiếu cọc 1' }).expect(200)
      .expect(({ body }) => expect(body.id).toBe(first[0].body.id));
    const depositAudit = await pool.query(`SELECT after_data FROM audit_logs WHERE tenant_id=$1 AND action='HOLD_DEPOSIT_RECORDED' AND after_data->>'holdId'=$2`, [TENANT_A, hold.id]);
    expect(depositAudit.rows).toHaveLength(2);
    expect(JSON.stringify(depositAudit.rows)).not.toContain('Phiếu cọc 1');
    expect((await pool.query(`SELECT after_data FROM audit_logs WHERE action='BOOKING_CONFIRMED' AND entity_id=$1`, [confirmations[0].body.id])).rows[0].after_data.depositMode).toBe('PERCENT');

    const receptionist = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'deposit-reception@example.com',$1,'Reception','ACTIVE') RETURNING id`, [await hash('Reception-password-123', 4)])).rows[0];
    const member = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, receptionist.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')`, [member.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [member.id, TENANT_A, branch.id]);
    const receptionToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'deposit-reception@example.com', password: 'Reception-password-123' }).expect(200)).body.accessToken;
    const second = await createHold('deposit-hold-2', '2042-01-02T18:00:00+07:00');
    await authorized('post', `/v1/merchant/booking/holds/${second.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '200000' }).expect(200)
      .expect(({ body }) => expect(body.depositPolicySnapshot).toMatchObject({ mode: 'FIXED', requiredAmountVnd: '10000', policyVersion: '1' }));
    const asReception = (method: 'get' | 'post', path: string) => request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${receptionToken}`).set('X-Tenant-ID', TENANT_A);
    await asReception('get', `/v1/merchant/booking/holds/${second.id}/deposits`).expect(200);
    await asReception('post', `/v1/merchant/booking/holds/${second.id}/deposits`).set('Idempotency-Key', 'reception-dep').send({ method: 'CASH', amountVnd: '10000' }).expect(403);
    await request(app.getHttpServer()).get(`/v1/merchant/booking/holds/${second.id}/deposits`).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(403);
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [second.id]);
    await authorized('post', `/v1/merchant/booking/holds/${second.id}/deposits`).set('Idempotency-Key', 'dep-expired').send({ method: 'CASH', amountVnd: '10000' }).expect(409);
    await authorized('get', `/v1/merchant/booking/holds/${second.id}/deposits`).expect(200).expect(({ body }) => expect(body.holdStatus).toBe('EXPIRED'));
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Deposit plan', status: 'INACTIVE' }).expect(200);
  }, 30000);

  it('lets only a non-member Platform Admin approve or revoke a published merchant listing with audit', async () => {
    const adminId = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'platform@example.com',$1,'Platform Admin','ACTIVE') RETURNING id`, [await hash('Platform-password-123', 4)])).rows[0].id;
    await pool.query('INSERT INTO platform_admins(user_id) VALUES($1)', [adminId]);
    const adminToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'platform@example.com', password: 'Platform-password-123' }).expect(200)).body.accessToken;
    const asAdmin = (method: 'get' | 'post', path: string) => request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${adminToken}`);
    const branchB = (await pool.query(`INSERT INTO branches(id,tenant_id,code,name,timezone,status) VALUES(gen_random_uuid(),$1,'B-PUBLIC','Tenant B public','Asia/Ho_Chi_Minh','ACTIVE') RETURNING id`, [TENANT_B])).rows[0].id;
    await pool.query(`INSERT INTO tenant_public_catalog(tenant_id,published,updated_by) VALUES($1,true,$2)`, [TENANT_B, OWNER_ID]);
    const publicBranchIds = async () => (await request(app.getHttpServer()).get('/v1/public/branches').query({ limit: 100 }).expect(200)).body.items.map((item: { id: string }) => item.id);

    await request(app.getHttpServer()).get('/v1/platform/catalog/listings').expect(401);
    await request(app.getHttpServer()).get('/v1/platform/catalog/listings').set('Authorization', `Bearer ${ownerToken}`).expect(403);
    await request(app.getHttpServer()).post(`/v1/platform/catalog/listings/${TENANT_B}/approve`).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_A).send({}).expect(403);
    await asAdmin('get', '/v1/platform/catalog/listings').expect(200).expect(({ body }) => {
      expect(body.items).toContainEqual(expect.objectContaining({ tenantId: TENANT_B, merchantCode: 'B', published: true, platformApproved: false, activeBranchCount: 1, termsConfigured: false }));
      expect(body.items.some((item: { tenantId: string }) => item.tenantId === TENANT_A)).toBe(false);
    });
    await asAdmin('get', '/v1/platform/catalog/listings').query({ status: 'OTHER' }).expect(400);
    expect(await publicBranchIds()).not.toContain(branchB);

    const approvals = await Promise.all(Array.from({ length: 4 }, () => asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/approve`).send({ note: 'Đã kiểm tra giấy phép' }).expect(200)));
    for (const response of approvals) expect(response.body).toMatchObject({ tenantId: TENANT_B, platformApproved: true, platformDecidedBy: adminId });
    expect(await publicBranchIds()).toContain(branchB);
    await asAdmin('get', '/v1/platform/catalog/listings').query({ status: 'APPROVED' }).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { tenantId: string }) => item.tenantId)).toContain(TENANT_B));

    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/revoke`).send({}).expect(400);
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/revoke`).send({ reason: '   ' }).expect(400);
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/revoke`).send({ reason: 'Thông tin chi nhánh chưa đúng' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ platformApproved: false, platformDecidedBy: adminId }));
    expect(await publicBranchIds()).not.toContain(branchB);
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/revoke`).send({ reason: 'Lặp lại' }).expect(200);

    await pool.query('UPDATE tenant_public_catalog SET published=false WHERE tenant_id=$1', [TENANT_B]);
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/approve`).send({}).expect(409);
    await pool.query('UPDATE tenant_public_catalog SET published=true WHERE tenant_id=$1', [TENANT_B]);
    await asAdmin('post', '/v1/platform/catalog/listings/cccccccc-cccc-4ccc-8ccc-cccccccccccc/approve').send({}).expect(404);
    await asAdmin('post', '/v1/platform/catalog/listings/not-a-uuid/approve').send({}).expect(400);

    const selfMembership = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_B, adminId])).rows[0].id;
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/approve`).send({}).expect(403);
    await pool.query('DELETE FROM tenant_memberships WHERE id=$1', [selfMembership]);
    await pool.query('UPDATE platform_admins SET revoked_at=clock_timestamp() WHERE user_id=$1', [adminId]);
    await asAdmin('post', `/v1/platform/catalog/listings/${TENANT_B}/approve`).send({}).expect(403);

    const audit = await pool.query(`SELECT action,actor_user_id,before_data,after_data FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'PLATFORM_LISTING_%' ORDER BY occurred_at`, [TENANT_B]);
    expect(audit.rows.map(row => row.action)).toEqual(['PLATFORM_LISTING_APPROVED', 'PLATFORM_LISTING_REVOKED']);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: adminId, before_data: { platformApproved: false }, after_data: { platformApproved: true, note: 'Đã kiểm tra giấy phép' } });
    expect(audit.rows[1].after_data).toMatchObject({ platformApproved: false, note: 'Thông tin chi nhánh chưa đúng' });
  });

  it('checks in, checks out (shortening early departures) and records staff-reviewed cancellation and no-show outcomes', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'LIFECYCLE', name: 'Lifecycle branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'LIFE-R', name: 'Lifecycle room', capacity: 8 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'LIFE-PLAN', name: 'Lifecycle plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Lifecycle plan', status: 'ACTIVE' }).expect(200);
    await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'LIFE-RULE', name: 'Price', priority: 997, amountVnd: '100000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
    await authorized('patch', '/v1/merchant/booking/no-deposit-confirmation/LIFE_TEST').send({ allowed: true }).expect(200);
    const minuteIso = (offsetMinutes: number) => new Date(Math.floor(Date.now() / 60000) * 60000 + offsetMinutes * 60000).toISOString();
    const createHold = (key: string, startAt: string) => authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', key)
      .send({ roomId: room.id, channel: 'LIFE_TEST', startAt, durationMinutes: 90 });
    const confirmBooking = async (key: string, startAt: string) => {
      const hold = (await createHold(key, startAt).expect(201)).body;
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '100000' }).expect(200);
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/phone-verification`).expect(200);
      return (await authorized('post', `/v1/merchant/booking/holds/${hold.id}/confirm`).send({ cancellationTerms: 'Liên hệ cơ sở để hủy.' }).expect(200)).body;
    };
    const path = (id: string, action: string) => `/v1/merchant/booking/bookings/${id}/${action}`;
    const occupancy = async (bookingId: string) => (await pool.query(`SELECT o.status,upper(o.occupied_range) AS upper FROM bookings b JOIN room_occupancy o ON o.id=b.occupancy_id WHERE b.id=$1`, [bookingId])).rows[0];

    // Early departure: in use now, leaves before the scheduled end.
    const current = await confirmBooking('life-current', minuteIso(-10));
    expect(current).toMatchObject({ status: 'CONFIRMED', checkedInAt: null, checkedOutAt: null, outcome: null });
    await authorized('post', path(current.id, 'check-out')).expect(409);
    const checkIns = await Promise.all(Array.from({ length: 4 }, () => authorized('post', path(current.id, 'check-in')).expect(200)));
    expect(new Set(checkIns.map(response => response.body.checkedInAt)).size).toBe(1);
    expect(checkIns[0].body).toMatchObject({ status: 'CHECKED_IN', checkedInBy: OWNER_ID });
    expect((await occupancy(current.id)).status).toBe('IN_USE');
    await authorized('post', path(current.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED', note: 'Khách đổi ý' }).expect(409);
    const before = Date.now();
    const checkedOut = (await authorized('post', path(current.id, 'check-out')).expect(200)).body;
    expect(checkedOut).toMatchObject({ status: 'COMPLETED', checkedOutBy: OWNER_ID });
    const newEnd = new Date(checkedOut.reservedEndAt).getTime();
    expect(newEnd).toBeLessThan(new Date(current.reservedEndAt).getTime());
    expect(newEnd - before).toBeGreaterThanOrEqual(current.bufferMinutes * 60000 - 1000);
    expect(newEnd - before).toBeLessThan(current.bufferMinutes * 60000 + 10000);
    await authorized('post', path(current.id, 'check-out')).expect(200).expect(({ body }) => expect(body.checkedOutAt).toBe(checkedOut.checkedOutAt));
    await authorized('post', path(current.id, 'check-in')).expect(409);
    // PostgreSQL keeps microseconds; start one minute after the new end, still well before the original end.
    const reopened = newEnd + 60000;
    expect(reopened).toBeLessThan(new Date(current.reservedEndAt).getTime());
    await createHold('life-after-early', new Date(reopened).toISOString()).expect(201);

    // Late departure: scheduled window already over, occupancy is not extended or shortened.
    const late = await confirmBooking('life-late', minuteIso(-300));
    await authorized('post', path(late.id, 'check-in')).expect(200);
    const lateOut = (await authorized('post', path(late.id, 'check-out')).expect(200)).body;
    expect(lateOut.reservedEndAt).toEqual(late.reservedEndAt);
    expect(new Date(lateOut.checkedOutAt).getTime()).toBeGreaterThan(new Date(late.startAt).getTime() + 90 * 60000);
    expect((await pool.query(`SELECT after_data FROM audit_logs WHERE action='BOOKING_CHECKED_OUT' AND entity_id=$1`, [late.id])).rows[0].after_data).toMatchObject({ status: 'COMPLETED', occupancyShortened: false, graceMinutes: 10, overtimeMinutes: lateOut.lateMinutes });

    // No check-in time window (PD-026): a far-future booking can be checked in.
    const future = await confirmBooking('life-future', '2043-01-01T18:00:00+07:00');
    await authorized('post', path(future.id, 'check-in')).expect(200).expect(({ body }) => expect(body.status).toBe('CHECKED_IN'));

    // Cancellation with a staff-recorded refund, capped by recorded money.
    const cancel = await confirmBooking('life-cancel', '2043-01-02T18:00:00+07:00');
    await authorized('post', `/v1/merchant/booking/bookings/${cancel.id}/manual-payments`).set('Idempotency-Key', 'life-pay').send({ method: 'CASH', amountVnd: '30000' }).expect(200);
    await authorized('post', path(cancel.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED' }).expect(400);
    await authorized('post', path(cancel.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED', note: '   ' }).expect(400);
    await authorized('post', path(cancel.id, 'outcome')).send({ type: 'REFUNDED', note: 'x' }).expect(400);
    await authorized('post', path(cancel.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED', note: 'x', refundAmountVnd: '-1' }).expect(400);
    await authorized('post', path(cancel.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED', note: 'Khách báo hủy qua điện thoại', refundAmountVnd: '30001' }).expect(409);
    const receptionist = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'life-reception@example.com',$1,'Reception','ACTIVE') RETURNING id`, [await hash('Reception-password-123', 4)])).rows[0];
    const member = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, receptionist.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')`, [member.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [member.id, TENANT_A, branch.id]);
    const receptionToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'life-reception@example.com', password: 'Reception-password-123' }).expect(200)).body.accessToken;
    const asReception = (p: string) => request(app.getHttpServer()).post(p).set('Authorization', `Bearer ${receptionToken}`).set('X-Tenant-ID', TENANT_A);
    await asReception(path(cancel.id, 'outcome')).send({ type: 'CUSTOMER_CANCELLED', note: 'Lễ tân thử hủy' }).expect(403);
    await request(app.getHttpServer()).post(path(cancel.id, 'check-in')).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(403);
    const outcomeBody = { type: 'CUSTOMER_CANCELLED', note: 'Khách báo hủy qua điện thoại, hoàn một phần', refundAmountVnd: '20000' };
    const outcomes = await Promise.all(Array.from({ length: 3 }, () => authorized('post', path(cancel.id, 'outcome')).send(outcomeBody).expect(200)));
    expect(outcomes[0].body).toMatchObject({ status: 'CANCELLED', outcome: { type: 'CUSTOMER_CANCELLED', note: outcomeBody.note, refundAmountVnd: '20000', recordedBy: OWNER_ID } });
    expect(new Set(outcomes.map(response => response.body.outcome.recordedAt)).size).toBe(1);
    await authorized('post', path(cancel.id, 'outcome')).send({ ...outcomeBody, refundAmountVnd: '0' }).expect(409);
    await authorized('post', path(cancel.id, 'check-in')).expect(409);
    expect((await occupancy(cancel.id)).status).toBe('RELEASED');
    await createHold('life-rebook', '2043-01-02T18:00:00+07:00').expect(201);
    const cancelAudit = await pool.query(`SELECT after_data FROM audit_logs WHERE action='BOOKING_CANCELLED' AND entity_id=$1`, [cancel.id]);
    expect(cancelAudit.rows).toEqual([{ after_data: { status: 'CANCELLED', outcomeType: 'CUSTOMER_CANCELLED', refundAmountVnd: '20000', collectedVnd: '30000' } }]);
    expect(JSON.stringify(cancelAudit.rows)).not.toContain('hoàn một phần');

    // No-show without refund; receptionist may still check in other bookings.
    const noShow = await confirmBooking('life-no-show', '2043-01-03T18:00:00+07:00');
    await authorized('post', path(noShow.id, 'outcome')).send({ type: 'NO_SHOW', note: 'Khách không đến, gọi không nghe máy' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'NO_SHOW', outcome: { type: 'NO_SHOW', refundAmountVnd: '0' } }));
    const receptionBooking = await confirmBooking('life-reception', '2043-01-04T18:00:00+07:00');
    await asReception(path(receptionBooking.id, 'check-in')).expect(200).expect(({ body }) => expect(body.checkedInBy).toBe(receptionist.id));
    await authorized('get', `/v1/merchant/booking/bookings/${cancel.id}`).expect(200).expect(({ body }) => expect(body.outcome.type).toBe('CUSTOMER_CANCELLED'));
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Lifecycle plan', status: 'INACTIVE' }).expect(200);
  }, 30000);

  it('lets a Platform Admin onboard a merchant with its first Owner who must change the temporary password', async () => {
    const adminId = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'onboard-admin@example.com',$1,'Onboarding Admin','ACTIVE') RETURNING id`, [await hash('Onboard-password-123', 4)])).rows[0].id;
    await pool.query('INSERT INTO platform_admins(user_id) VALUES($1)', [adminId]);
    const adminToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'onboard-admin@example.com', password: 'Onboard-password-123' }).expect(200)).body.accessToken;
    const asAdmin = (method: 'get' | 'post', p: string) => request(app.getHttpServer())[method](p).set('Authorization', `Bearer ${adminToken}`);
    const input = { code: 'NEW_MERCHANT', name: 'Karaoke Mới', owner: { email: 'New.Owner@Example.com', displayName: 'Chủ mới', temporaryPassword: 'Temp-password-123' } };

    await request(app.getHttpServer()).post('/v1/platform/merchants').send(input).expect(401);
    await request(app.getHttpServer()).post('/v1/platform/merchants').set('Authorization', `Bearer ${ownerToken}`).send(input).expect(403);
    await asAdmin('post', '/v1/platform/merchants').send({ ...input, code: 'lower' }).expect(400);
    await asAdmin('post', '/v1/platform/merchants').send({ ...input, name: '  ' }).expect(400);
    await asAdmin('post', '/v1/platform/merchants').send({ ...input, owner: { ...input.owner, temporaryPassword: 'short' } }).expect(400);
    await asAdmin('post', '/v1/platform/merchants').send({ code: 'NO_OWNER', name: 'No owner' }).expect(400);

    const created = (await asAdmin('post', '/v1/platform/merchants').send(input).expect(201)).body;
    expect(created).toMatchObject({ code: 'NEW_MERCHANT', name: 'Karaoke Mới', status: 'ACTIVE', ownerCount: 1, activeBranchCount: 0, published: false, platformApproved: false,
      owner: { email: 'new.owner@example.com', accountCreated: true } });
    await asAdmin('post', '/v1/platform/merchants').send({ ...input, owner: { ...input.owner, email: 'other@example.com' } }).expect(409);
    const racing = await Promise.all(['race-a@example.com', 'race-b@example.com'].map(email =>
      asAdmin('post', '/v1/platform/merchants').send({ code: 'RACE_MERCHANT', name: 'Race', owner: { ...input.owner, email } })));
    expect(racing.map(response => response.status).sort()).toEqual([201, 409]);

    const firstLogin = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'new.owner@example.com', password: 'Temp-password-123' }).expect(200)).body;
    expect(firstLogin.mustChangePassword).toBe(true);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${firstLogin.accessToken}`).set('X-Tenant-ID', created.tenantId).expect(403);
    await request(app.getHttpServer()).post('/v1/auth/password/change').set('Authorization', `Bearer ${firstLogin.accessToken}`)
      .send({ currentPassword: 'Temp-password-123', newPassword: 'New-owner-password-456' }).expect(204);
    const newOwnerToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'new.owner@example.com', password: 'New-owner-password-456' }).expect(200)).body.accessToken;
    await request(app.getHttpServer()).post('/v1/merchant/branches').set('Authorization', `Bearer ${newOwnerToken}`).set('X-Tenant-ID', created.tenantId)
      .send({ code: 'NEW-HQ', name: 'Chi nhánh đầu tiên', timezone: 'Asia/Ho_Chi_Minh' }).expect(201);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${newOwnerToken}`).set('X-Tenant-ID', TENANT_A).expect(403);

    // An existing account becomes Owner of a second merchant without its password being replaced.
    const second = (await asAdmin('post', '/v1/platform/merchants').send({ code: 'SECOND_MERCHANT', name: 'Second', owner: { email: 'owner@example.com', displayName: 'Ignored', temporaryPassword: 'Ignored-password-123' } }).expect(201)).body;
    expect(second.owner).toMatchObject({ userId: OWNER_ID, accountCreated: false });
    await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'owner@example.com', password: 'Ignored-password-123' }).expect(401);
    await request(app.getHttpServer()).get('/v1/merchant/branches').set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', second.tenantId).expect(200);

    await asAdmin('get', '/v1/platform/merchants').query({ status: 'ACTIVE', limit: 100 }).expect(200).expect(({ body }) => {
      const codes = body.items.map((item: { code: string }) => item.code);
      expect(codes).toEqual(expect.arrayContaining(['NEW_MERCHANT', 'SECOND_MERCHANT', 'RACE_MERCHANT', 'A', 'B']));
      expect(body.items.find((item: { code: string }) => item.code === 'NEW_MERCHANT')).toMatchObject({ activeBranchCount: 1, ownerCount: 1 });
    });
    await asAdmin('get', '/v1/platform/merchants').query({ status: 'INACTIVE' }).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
    await asAdmin('get', '/v1/platform/merchants').query({ limit: 101 }).expect(400);
    const audit = await pool.query(`SELECT actor_user_id,after_data FROM audit_logs WHERE tenant_id=$1 AND action='MERCHANT_CREATED'`, [created.tenantId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: adminId, after_data: { code: 'NEW_MERCHANT', ownerAccountCreated: true } });
    expect(JSON.stringify(audit.rows)).not.toContain('Temp-password-123');
  }, 30000);

  it('serializes conflicting concurrent holds per room without deadlocks or 5xx (QA-002 regression)', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'CONTENTION', name: 'Contention', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'CONT-R', name: 'Contention room', capacity: 8 }).expect(201)).body;
    for (let round = 0; round < 10; round++) {
      const startAt = new Date(Date.UTC(2044, 0, 1 + round, 12)).toISOString();
      const statuses = (await Promise.all(Array.from({ length: 100 }, (_, i) => authorized('post', '/v1/merchant/booking/holds')
        .set('Idempotency-Key', `contention-${round}-${i}`).send({ roomId: room.id, channel: 'CONTENTION', startAt, durationMinutes: 90 })))).map(response => response.status);
      expect({ round, created: statuses.filter(s => s === 201).length, conflicts: statuses.filter(s => s === 409).length }).toEqual({ round, created: 1, conflicts: 99 });
    }
    // Deterministic check that writers take the per-room occupancy lock before inserting (the deadlock itself is probabilistic).
    const blocker = await pool.connect();
    const settlesWithin = (promise: Promise<unknown>, ms: number) => Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), ms))]);
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`room-occupancy:${room.id}`]);
      const hold = authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'contention-lock-check')
        .send({ roomId: room.id, channel: 'CONTENTION', startAt: '2044-02-01T12:00:00Z', durationMinutes: 90 }).then(response => response.status);
      const block = authorized('post', '/v1/merchant/room-blocks')
        .send({ roomId: room.id, startAt: '2044-02-02T12:00:00Z', endAt: '2044-02-02T14:00:00Z', reason: 'Lock check' }).then(response => response.status);
      expect(await settlesWithin(hold, 500)).toBe(false);
      expect(await settlesWithin(block, 100)).toBe(false);
      await blocker.query('COMMIT');
      expect(await hold).toBe(201);
      expect(await block).toBe(201);
    } finally { await blocker.query('ROLLBACK').catch(() => undefined); blocker.release(); }
  }, 60000);

  it('records late minutes and overtime at check-out using the merchant grace snapshot (PD-030)', async () => {
    const policyPath = '/v1/merchant/booking/overtime-policy';
    await authorized('get', policyPath).expect(200).expect(({ body }) => expect(body).toEqual({ configured: false, graceMinutes: 10, version: null }));
    await authorized('patch', policyPath).send({ graceMinutes: 61 }).expect(400);
    await authorized('patch', policyPath).send({ graceMinutes: -1 }).expect(400);
    const cashierToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'cashier@example.com', password: 'Cashier-password-123' }).expect(200)).body.accessToken;
    await request(app.getHttpServer()).get(policyPath).set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).expect(200);
    await request(app.getHttpServer()).patch(policyPath).set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).send({ graceMinutes: 5 }).expect(403);
    await authorized('patch', policyPath).send({ graceMinutes: 10 }).expect(200).expect(({ body }) => expect(body).toEqual({ configured: true, graceMinutes: 10, version: '0' }));

    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'OVERTIME', name: 'Overtime', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'OT-PLAN', name: 'Overtime plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Overtime plan', status: 'ACTIVE' }).expect(200);
    await authorized('patch', '/v1/merchant/booking/no-deposit-confirmation/OT_TEST').send({ allowed: true }).expect(200);
    const minuteIso = (offsetMinutes: number) => new Date(Math.floor(Date.now() / 60000) * 60000 + offsetMinutes * 60000).toISOString();
    const completeBooking = async (code: string, startOffset: number) => {
      const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code, name: code, capacity: 6 }).expect(201)).body;
      await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code, name: code, priority: 996, amountVnd: '100000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
      const hold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', `ot-${code}`).send({ roomId: room.id, channel: 'OT_TEST', startAt: minuteIso(startOffset), durationMinutes: 90 }).expect(201)).body;
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '100000' }).expect(200);
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/phone-verification`).expect(200);
      const booking = (await authorized('post', `/v1/merchant/booking/holds/${hold.id}/confirm`).send({ cancellationTerms: 'Liên hệ cơ sở.' }).expect(200)).body;
      expect(booking).toMatchObject({ lateMinutes: null, overtimeMinutes: null, overtimeGraceMinutes: null });
      await authorized('post', `/v1/merchant/booking/bookings/${booking.id}/check-in`).expect(200);
      return { before: booking, after: (await authorized('post', `/v1/merchant/booking/bookings/${booking.id}/check-out`).expect(200)).body };
    };

    const late = await completeBooking('OT-LATE', -300);
    expect(late.after.lateMinutes).toBeGreaterThanOrEqual(209);
    expect(late.after.lateMinutes).toBeLessThanOrEqual(211);
    expect(late.after).toMatchObject({ overtimeMinutes: late.after.lateMinutes, overtimeGraceMinutes: 10, reservedEndAt: late.before.reservedEndAt });
    const audit = (await pool.query(`SELECT after_data FROM audit_logs WHERE action='BOOKING_CHECKED_OUT' AND entity_id=$1`, [late.after.id])).rows[0].after_data;
    expect(audit).toMatchObject({ occupancyShortened: false, lateMinutes: late.after.lateMinutes, overtimeMinutes: late.after.lateMinutes, graceMinutes: 10 });

    const withinGrace = await completeBooking('OT-GRACE', -95);
    expect(withinGrace.after.lateMinutes).toBeGreaterThanOrEqual(5);
    expect(withinGrace.after.lateMinutes).toBeLessThanOrEqual(6);
    expect(withinGrace.after).toMatchObject({ overtimeMinutes: 0, overtimeGraceMinutes: 10 });

    const early = await completeBooking('OT-EARLY', -10);
    expect(early.after).toMatchObject({ lateMinutes: 0, overtimeMinutes: 0 });

    await authorized('patch', policyPath).send({ graceMinutes: 0 }).expect(200);
    const noGrace = await completeBooking('OT-NOGRACE', -95);
    expect(noGrace.after).toMatchObject({ overtimeGraceMinutes: 0, overtimeMinutes: noGrace.after.lateMinutes });
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=$1 AND action='OVERTIME_POLICY_UPDATED'`, [TENANT_A])).rows[0].n).toBe(2);
    await pool.query(`DELETE FROM tenant_overtime_policies WHERE tenant_id=$1`, [TENANT_A]);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Overtime plan', status: 'INACTIVE' }).expect(200);
  }, 30000);

  it('lets a Platform Admin suspend and reactivate a merchant: hidden from customers, no new holds, staff keep existing work (PD-031)', async () => {
    const adminId = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'suspend-admin@example.com',$1,'Suspend Admin','ACTIVE') RETURNING id`, [await hash('Suspend-password-123', 4)])).rows[0].id;
    await pool.query('INSERT INTO platform_admins(user_id) VALUES($1)', [adminId]);
    const adminToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'suspend-admin@example.com', password: 'Suspend-password-123' }).expect(200)).body.accessToken;
    const asAdmin = (p: string) => request(app.getHttpServer()).post(p).set('Authorization', `Bearer ${adminToken}`);
    const tenantC = (await pool.query(`INSERT INTO tenants(id,code,name,status) VALUES(gen_random_uuid(),'SUSPEND_ME','Suspend me','ACTIVE') RETURNING id`)).rows[0].id;
    const membership = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [tenantC, OWNER_ID])).rows[0].id;
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER')`, [membership]);
    const asOwner = (method: 'get' | 'post' | 'patch', p: string) => request(app.getHttpServer())[method](p).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', tenantC);
    const branch = (await asOwner('post', '/v1/merchant/branches').send({ code: 'SUSP-B', name: 'Suspend branch', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await asOwner('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'SUSP-R', name: 'Suspend room', capacity: 6 }).expect(201)).body;
    const plan = (await asOwner('post', '/v1/merchant/pricing/plans').send({ code: 'SUSP-PLAN', name: 'Plan' }).expect(201)).body;
    await asOwner('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Plan', status: 'ACTIVE' }).expect(200);
    await asOwner('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'SUSP-RULE', name: 'Price', priority: 1, amountVnd: '100000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
    await asOwner('patch', '/v1/merchant/catalog/public-booking-terms').send({ terms: 'Điều khoản thử.' }).expect(200);
    await asOwner('patch', '/v1/merchant/catalog/publication').send({ published: true }).expect(200);
    await asOwner('patch', '/v1/merchant/booking/no-deposit-confirmation/WALK_IN').send({ allowed: true }).expect(200);
    await asAdmin(`/v1/platform/catalog/listings/${tenantC}/approve`).send({}).expect(200);
    const publicIds = async () => (await request(app.getHttpServer()).get('/v1/public/branches').query({ limit: 100 }).expect(200)).body.items.map((item: { id: string }) => item.id);
    expect(await publicIds()).toContain(branch.id);
    const existing = (await asOwner('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'susp-existing').send({ roomId: room.id, channel: 'WALK_IN', startAt: '2045-01-01T18:00:00+07:00', durationMinutes: 60 }).expect(201)).body;

    await asAdmin(`/v1/platform/merchants/${tenantC}/suspend`).send({}).expect(400);
    await request(app.getHttpServer()).post(`/v1/platform/merchants/${tenantC}/suspend`).set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'x' }).expect(403);
    await asAdmin(`/v1/platform/merchants/${tenantC}/suspend`).send({ reason: 'Giấy phép hết hạn' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ tenantId: tenantC, status: 'INACTIVE', published: true, platformApproved: true }));
    await asAdmin(`/v1/platform/merchants/${tenantC}/suspend`).send({ reason: 'Lặp lại' }).expect(200);
    expect(await publicIds()).not.toContain(branch.id);
    await request(app.getHttpServer()).get(`/v1/public/branches/${branch.id}/rooms`).expect(404);
    await pool.query('DELETE FROM public_rate_limit_buckets'); // an earlier test deliberately exhausts the IP bucket
    await request(app.getHttpServer()).post('/v1/public/booking/holds').set('Idempotency-Key', 'susp-public').send({ roomId: room.id, startAt: '2045-01-02T18:00:00+07:00', durationMinutes: 60, phone: '0911000111', expectedTotalAmountVnd: '100000', termsVersion: '1' }).expect(404);
    await asOwner('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'susp-new').send({ roomId: room.id, channel: 'WALK_IN', startAt: '2045-01-03T18:00:00+07:00', durationMinutes: 60 }).expect(409)
      .expect(({ body }) => expect(body.error.message).toContain('suspended'));
    await asOwner('get', '/v1/merchant/catalog/publication').expect(200).expect(({ body }) => expect(body).toMatchObject({ tenantStatus: 'INACTIVE', published: true, platformApproved: true }));
    await asOwner('get', '/v1/merchant/branches').expect(200);
    await asOwner('post', `/v1/merchant/booking/holds/${existing.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '100000' }).expect(200);
    await asOwner('post', `/v1/merchant/booking/holds/${existing.id}/phone-verification`).expect(200);
    await asOwner('post', `/v1/merchant/booking/holds/${existing.id}/confirm`).send({ cancellationTerms: 'Điều khoản thử.' }).expect(200);
    await request(app.getHttpServer()).get('/v1/platform/merchants').query({ status: 'INACTIVE', limit: 100 }).set('Authorization', `Bearer ${adminToken}`).expect(200)
      .expect(({ body }) => expect(body.items.map((item: { tenantId: string }) => item.tenantId)).toContain(tenantC));

    await asAdmin(`/v1/platform/merchants/${tenantC}/reactivate`).send({ reason: 'Đã gia hạn giấy phép' }).expect(200).expect(({ body }) => expect(body.status).toBe('ACTIVE'));
    expect(await publicIds()).toContain(branch.id);
    await asAdmin('/v1/platform/merchants/cccccccc-cccc-4ccc-8ccc-cccccccccccc/suspend').send({ reason: 'x' }).expect(404);
    const selfMembership = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [tenantC, adminId])).rows[0].id;
    await asAdmin(`/v1/platform/merchants/${tenantC}/suspend`).send({ reason: 'x' }).expect(403);
    await pool.query('DELETE FROM tenant_memberships WHERE id=$1', [selfMembership]);
    const audit = await pool.query(`SELECT action,actor_user_id,after_data FROM audit_logs WHERE tenant_id=$1 AND action IN ('MERCHANT_SUSPENDED','MERCHANT_REACTIVATED') ORDER BY occurred_at`, [tenantC]);
    expect(audit.rows.map(row => row.action)).toEqual(['MERCHANT_SUSPENDED', 'MERCHANT_REACTIVATED']);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: adminId, after_data: { status: 'INACTIVE', reason: 'Giấy phép hết hạn' } });
    await pool.query('DELETE FROM membership_roles WHERE membership_id=$1', [membership]);
    await pool.query('DELETE FROM tenant_memberships WHERE id=$1', [membership]);
  }, 30000);

  it('serves FE role needs: accepted public terms on WEB holds, cashier read access and /merchant/me', async () => {
    // WEB hold created by the public catalog test: detail exposes the exact accepted terms so non-Owner staff can confirm.
    const publicHold = (await pool.query(`SELECT id,branch_id,public_accepted_terms FROM booking_holds WHERE tenant_id=$1 AND created_by IS NULL AND status='HELD' ORDER BY created_at LIMIT 1`, [TENANT_A])).rows[0];
    const receptionist = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'web-reception@example.com',$1,'Web Reception','ACTIVE') RETURNING id`, [await hash('Reception-password-123', 4)])).rows[0];
    const member = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, receptionist.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')`, [member.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [member.id, TENANT_A, publicHold.branch_id]);
    const receptionToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'web-reception@example.com', password: 'Reception-password-123' }).expect(200)).body.accessToken;
    const asReception = (method: 'get' | 'post', p: string) => request(app.getHttpServer())[method](p).set('Authorization', `Bearer ${receptionToken}`).set('X-Tenant-ID', TENANT_A);
    const detail = (await asReception('get', `/v1/merchant/booking/holds/${publicHold.id}`).expect(200)).body;
    expect(detail).toMatchObject({ channel: 'WEB', publicAcceptedTerms: publicHold.public_accepted_terms, publicAcceptedTermsVersion: '1' });
    await asReception('get', '/v1/merchant/catalog/public-booking-terms').expect(403);
    await authorized('patch', '/v1/merchant/booking/no-deposit-confirmation/WEB').send({ allowed: true }).expect(200);
    await asReception('post', `/v1/merchant/booking/holds/${publicHold.id}/phone-verification`).expect(200);
    await asReception('post', `/v1/merchant/booking/holds/${publicHold.id}/confirm`).send({ cancellationTerms: detail.publicAcceptedTerms }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'CONFIRMED', channel: 'WEB', cancellationTerms: publicHold.public_accepted_terms }));
    const staffHold = (await pool.query(`SELECT id FROM booking_holds WHERE tenant_id=$1 AND created_by IS NOT NULL LIMIT 1`, [TENANT_A])).rows[0];
    await authorized('get', `/v1/merchant/booking/holds/${staffHold.id}`).expect(200).expect(({ body }) => expect(body).toMatchObject({ publicAcceptedTerms: null, publicAcceptedTermsVersion: null }));

    // Cashier can now find the hold/booking it records money against, still limited to granted branches.
    const cashierToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'cashier@example.com', password: 'Cashier-password-123' }).expect(200)).body.accessToken;
    const asCashier = (p: string) => request(app.getHttpServer()).get(p).set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A);
    const me = (await asCashier('/v1/merchant/me').expect(200)).body;
    expect(me).toMatchObject({ email: 'cashier@example.com', tenantId: TENANT_A, tenantName: 'Tenant A', tenantStatus: 'ACTIVE', roles: ['CASHIER'], platformAdmin: false });
    expect(me.branchIds).toHaveLength(1);
    const cashierBranch = me.branchIds[0];
    const range = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z', limit: 100 };
    const bookings = (await asCashier(`/v1/merchant/branches/${cashierBranch}/booking/bookings`).query(range).expect(200)).body.items;
    expect(bookings.length).toBeGreaterThan(0);
    await asCashier(`/v1/merchant/booking/bookings/${bookings[0].id}`).expect(200);
    const holds = (await asCashier(`/v1/merchant/branches/${cashierBranch}/booking/holds`).query(range).expect(200)).body.items;
    await asCashier(`/v1/merchant/booking/holds/${holds[0].id}`).expect(200);
    const otherBranchHold = (await pool.query(`SELECT id,branch_id FROM booking_holds WHERE tenant_id=$1 AND branch_id<>$2 LIMIT 1`, [TENANT_A, cashierBranch])).rows[0];
    await asCashier(`/v1/merchant/booking/holds/${otherBranchHold.id}`).expect(403);
    await asCashier(`/v1/merchant/branches/${otherBranchHold.branch_id}/booking/bookings`).query(range).expect(403);

    await authorized('get', '/v1/merchant/me').expect(200).expect(({ body }) => expect(body).toMatchObject({ userId: OWNER_ID, roles: ['OWNER'], branchIds: [], platformAdmin: false }));
    await request(app.getHttpServer()).get('/v1/merchant/me').set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_B).expect(403);
    await request(app.getHttpServer()).get('/v1/merchant/me').set('X-Tenant-ID', TENANT_A).expect(401);
    await pool.query(`DELETE FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel='WEB'`, [TENANT_A]);
  }, 30000);

  it('applies bounded PostgreSQL pool timeouts and turns a long lock wait into a retryable 409 (OPS-004)', async () => {
    expect((await pool.query('SHOW lock_timeout')).rows[0].lock_timeout).toBe('5s');
    expect((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout).toBe('15s');
    expect((await pool.query('SHOW idle_in_transaction_session_timeout')).rows[0].idle_in_transaction_session_timeout).toBe('1min');
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'LOCK-TIMEOUT', name: 'Lock timeout', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'LOCK-R', name: 'Lock room', capacity: 4 }).expect(201)).body;
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`room-occupancy:${room.id}`]);
      const started = Date.now();
      await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'lock-timeout-hold')
        .send({ roomId: room.id, channel: 'LOCK_TEST', startAt: '2046-01-01T12:00:00Z', durationMinutes: 90 }).expect(409)
        .expect(({ body }) => expect(body.error.message).toBe('The resource was changed concurrently; retry the request'));
      expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
      expect(Date.now() - started).toBeLessThan(10000);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'lock-timeout-hold-retry')
      .send({ roomId: room.id, channel: 'LOCK_TEST', startAt: '2046-01-01T12:00:00Z', durationMinutes: 90 }).expect(201);
  }, 30000);

  it('returns responses that match the published OpenAPI contract (FE-011 support)', async () => {
    const doc = JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8'));
    const check = async (method: 'get' | 'post' | 'patch', template: string, actual: string, status: number, body?: object, headers: Record<string, string> = {}) => {
      let req = authorized(method, actual);
      for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
      const response = await (body === undefined ? req : req.send(body)).expect(status);
      assertMatchesContract(doc, method, template, status, response.body);
      return response.body;
    };
    // Health and sessions
    assertMatchesContract(doc, 'get', '/v1/health/live', 200, (await request(app.getHttpServer()).get('/v1/health/live').expect(200)).body);
    assertMatchesContract(doc, 'get', '/v1/health/ready', 200, (await request(app.getHttpServer()).get('/v1/health/ready').expect(200)).body);
    assertMatchesContract(doc, 'get', '/v1/auth/sessions', 200, (await request(app.getHttpServer()).get('/v1/auth/sessions').set('Authorization', `Bearer ${ownerToken}`).expect(200)).body);
    // Venue
    const branch = await check('post', '/v1/merchant/branches', '/v1/merchant/branches', 201, { code: 'CONTRACT', name: 'Contract', timezone: 'Asia/Ho_Chi_Minh' });
    await check('get', '/v1/merchant/branches', '/v1/merchant/branches', 200);
    await check('get', '/v1/merchant/branches/{id}', `/v1/merchant/branches/${branch.id}`, 200);
    await check('patch', '/v1/merchant/branches/{id}', `/v1/merchant/branches/${branch.id}`, 200, { name: 'Contract branch', timezone: 'Asia/Ho_Chi_Minh' });
    const room = await check('post', '/v1/merchant/rooms', '/v1/merchant/rooms', 201, { branchId: branch.id, code: 'CONTRACT-R', name: 'Contract room', capacity: 6 });
    await check('get', '/v1/merchant/branches/{branchId}/rooms', `/v1/merchant/branches/${branch.id}/rooms`, 200);
    await check('get', '/v1/merchant/rooms/{id}', `/v1/merchant/rooms/${room.id}`, 200);
    await check('patch', '/v1/merchant/rooms/{id}', `/v1/merchant/rooms/${room.id}`, 200, { name: 'Contract room 2', capacity: 8 });
    const amenity = await check('post', '/v1/merchant/rooms/{id}/amenities', `/v1/merchant/rooms/${room.id}/amenities`, 201, { label: 'Micro không dây' });
    await check('get', '/v1/merchant/rooms/{id}/amenities', `/v1/merchant/rooms/${room.id}/amenities`, 200);
    await check('patch', '/v1/merchant/rooms/{id}/amenities/{amenityId}', `/v1/merchant/rooms/${room.id}/amenities/${amenity.id}`, 200, { label: 'Micro' });
    const media = await check('post', '/v1/merchant/rooms/{id}/media', `/v1/merchant/rooms/${room.id}/media`, 201, { assetRef: 'rooms/contract.jpg', displayOrder: 1 });
    await check('get', '/v1/merchant/rooms/{id}/media', `/v1/merchant/rooms/${room.id}/media`, 200);
    await check('patch', '/v1/merchant/rooms/{id}/media/{mediaId}', `/v1/merchant/rooms/${room.id}/media/${media.id}`, 200, { assetRef: 'rooms/contract-2.jpg', altText: 'Ảnh', displayOrder: 2 });
    // Memberships and audit
    await check('get', '/v1/merchant/memberships', '/v1/merchant/memberships', 200);
    const membership = await check('post', '/v1/merchant/memberships', '/v1/merchant/memberships', 201, { email: 'contract.staff@example.com', displayName: 'Contract', temporaryPassword: 'Contract-password-123', roles: ['RECEPTIONIST'], branchIds: [branch.id] });
    await check('patch', '/v1/merchant/memberships/{id}', `/v1/merchant/memberships/${membership.id}`, 200, { status: 'INACTIVE' });
    await check('get', '/v1/merchant/audit-logs', '/v1/merchant/audit-logs?limit=20', 200);
    // Availability and room blocks
    await check('get', '/v1/merchant/availability/buffer-policy', '/v1/merchant/availability/buffer-policy', 200);
    const block = await check('post', '/v1/merchant/room-blocks', '/v1/merchant/room-blocks', 201, { roomId: room.id, startAt: '2047-01-01T10:00:00Z', endAt: '2047-01-01T12:00:00Z', reason: 'Bảo trì' });
    await check('get', '/v1/merchant/branches/{branchId}/room-blocks', `/v1/merchant/branches/${branch.id}/room-blocks`, 200);
    await check('get', '/v1/merchant/room-blocks/{id}', `/v1/merchant/room-blocks/${block.id}`, 200);
    await check('patch', '/v1/merchant/room-blocks/{id}', `/v1/merchant/room-blocks/${block.id}`, 200, { reason: 'Bảo trì loa' });
    await check('post', '/v1/merchant/room-blocks/{id}/release', `/v1/merchant/room-blocks/${block.id}/release`, 200);
    // Pricing
    const plan = await check('post', '/v1/merchant/pricing/plans', '/v1/merchant/pricing/plans', 201, { code: 'CONTRACT-PLAN', name: 'Contract plan' });
    await check('get', '/v1/merchant/pricing/plans', '/v1/merchant/pricing/plans', 200);
    await check('get', '/v1/merchant/pricing/plans/{id}', `/v1/merchant/pricing/plans/${plan.id}`, 200);
    await check('patch', '/v1/merchant/pricing/plans/{id}', `/v1/merchant/pricing/plans/${plan.id}`, 200, { name: 'Contract plan', status: 'ACTIVE' });
    const special = await check('post', '/v1/merchant/pricing/special-dates', '/v1/merchant/pricing/special-dates', 201, { code: 'CONTRACT-SD', name: 'Lễ', startDate: '2047-04-30', endDate: '2047-05-01' });
    await check('get', '/v1/merchant/pricing/special-dates', '/v1/merchant/pricing/special-dates', 200);
    await check('get', '/v1/merchant/pricing/special-dates/{id}', `/v1/merchant/pricing/special-dates/${special.id}`, 200);
    await check('patch', '/v1/merchant/pricing/special-dates/{id}', `/v1/merchant/pricing/special-dates/${special.id}`, 200, { name: 'Lễ 30/4', startDate: '2047-04-30', endDate: '2047-05-01', status: 'ACTIVE' });
    const rule = await check('post', '/v1/merchant/pricing/rules', '/v1/merchant/pricing/rules', 201, { pricePlanId: plan.id, code: 'CONTRACT-RULE', name: 'Giá', priority: 995, amountVnd: '100000', amountUnit: 'PER_BOOKING', roomId: room.id });
    await check('get', '/v1/merchant/pricing/plans/{id}/rules', `/v1/merchant/pricing/plans/${plan.id}/rules`, 200);
    await check('get', '/v1/merchant/pricing/rules/{id}', `/v1/merchant/pricing/rules/${rule.id}`, 200);
    // Booking path (previously documented): hold, details, deposits, confirm, booking, calendar, /me
    await authorized('patch', '/v1/merchant/booking/no-deposit-confirmation/CONTRACT').send({ allowed: true }).expect(200);
    const hold = await check('post', '/v1/merchant/booking/holds', '/v1/merchant/booking/holds', 201, { roomId: room.id, channel: 'CONTRACT', startAt: '2047-02-01T12:00:00Z', durationMinutes: 90 }, { 'Idempotency-Key': 'contract-hold' });
    await check('post', '/v1/merchant/booking/holds/{id}/details', `/v1/merchant/booking/holds/${hold.id}/details`, 200, { phone: '0912345678', expectedTotalAmountVnd: '100000' });
    await check('post', '/v1/merchant/booking/holds/{id}/phone-verification', `/v1/merchant/booking/holds/${hold.id}/phone-verification`, 200);
    await check('get', '/v1/merchant/booking/holds/{id}', `/v1/merchant/booking/holds/${hold.id}`, 200);
    await check('get', '/v1/merchant/booking/holds/{id}/deposits', `/v1/merchant/booking/holds/${hold.id}/deposits`, 200);
    const booking = await check('post', '/v1/merchant/booking/holds/{id}/confirm', `/v1/merchant/booking/holds/${hold.id}/confirm`, 200, { cancellationTerms: 'Liên hệ cơ sở.' });
    await check('get', '/v1/merchant/booking/bookings/{id}', `/v1/merchant/booking/bookings/${booking.id}`, 200);
    await check('get', '/v1/merchant/branches/{branchId}/booking/bookings', `/v1/merchant/branches/${branch.id}/booking/bookings?from=2047-01-01T00:00:00Z&to=2048-01-01T00:00:00Z`, 200);
    await check('get', '/v1/merchant/branches/{branchId}/booking/holds', `/v1/merchant/branches/${branch.id}/booking/holds?from=2047-01-01T00:00:00Z&to=2048-01-01T00:00:00Z`, 200);
    await check('post', '/v1/merchant/booking/bookings/{id}/check-in', `/v1/merchant/booking/bookings/${booking.id}/check-in`, 200);
    await check('post', '/v1/merchant/booking/bookings/{id}/check-out', `/v1/merchant/booking/bookings/${booking.id}/check-out`, 200);
    await check('get', '/v1/merchant/me', '/v1/merchant/me', 200);
    await check('get', '/v1/merchant/booking/overtime-policy', '/v1/merchant/booking/overtime-policy', 200);
    await check('get', '/v1/merchant/catalog/publication', '/v1/merchant/catalog/publication', 200);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Contract plan', status: 'INACTIVE' }).expect(200);
    await pool.query(`DELETE FROM tenant_no_deposit_confirmation_policies WHERE tenant_id=$1 AND channel='CONTRACT'`, [TENANT_A]);
  }, 30000);

  it('reconciles cash per booking: due vs paid, surcharges, reversals, expired-hold deposits and a daily report (PAY-007, PD-036)', async () => {
    const doc = JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8'));
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'LEDGER', name: 'Ledger', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'LEDGER-R', name: 'Ledger room', capacity: 6 }).expect(201)).body;
    const plan = (await authorized('post', '/v1/merchant/pricing/plans').send({ code: 'LEDGER-PLAN', name: 'Ledger plan' }).expect(201)).body;
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Ledger plan', status: 'ACTIVE' }).expect(200);
    await authorized('post', '/v1/merchant/pricing/rules').send({ pricePlanId: plan.id, code: 'LEDGER-RULE', name: 'Giá', priority: 994, amountVnd: '200000', amountUnit: 'PER_BOOKING', roomId: room.id }).expect(201);
    await authorized('patch', '/v1/merchant/booking/deposit-policy/LEDGER').send({ mode: 'FIXED', fixedAmountVnd: '50000' }).expect(200);
    const receptionist = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'ledger-reception@example.com',$1,'Ledger Reception','ACTIVE') RETURNING id`, [await hash('Reception-password-123', 4)])).rows[0];
    const member = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, receptionist.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'RECEPTIONIST')`, [member.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [member.id, TENANT_A, branch.id]);
    const receptionToken = (await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'ledger-reception@example.com', password: 'Reception-password-123' }).expect(200)).body.accessToken;
    const asReception = (method: 'get' | 'post', p: string) => request(app.getHttpServer())[method](p).set('Authorization', `Bearer ${receptionToken}`).set('X-Tenant-ID', TENANT_A);
    const pricedHold = async (key: string, startAt: string) => {
      const hold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', key).send({ roomId: room.id, channel: 'LEDGER', startAt, durationMinutes: 90 }).expect(201)).body;
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/details`).send({ phone: '0912345678', expectedTotalAmountVnd: '200000' }).expect(200);
      await authorized('post', `/v1/merchant/booking/holds/${hold.id}/phone-verification`).expect(200);
      return hold;
    };
    const deposit = (holdId: string, key: string) => authorized('post', `/v1/merchant/booking/holds/${holdId}/deposits`).set('Idempotency-Key', key).send({ method: 'CASH', amountVnd: '50000' }).expect(200).then(r => r.body);
    const account = async (bookingId: string) => {
      const body = (await authorized('get', `/v1/merchant/booking/bookings/${bookingId}/account`).expect(200)).body;
      assertMatchesContract(doc, 'get', '/v1/merchant/booking/bookings/{id}/account', 200, body);
      return body;
    };
    const terms = { cancellationTerms: 'Liên hệ cơ sở.' };

    // Booking 1: deposit, confirm, surcharge, CASH, over-collection, reversals.
    const hold1 = await pricedHold('ledger-1', '2048-01-01T12:00:00Z');
    const dep1 = await deposit(hold1.id, 'ledger-dep-1');
    const booking = (await authorized('post', `/v1/merchant/booking/holds/${hold1.id}/confirm`).send(terms).expect(200)).body;
    expect(await account(booking.id)).toMatchObject({ priceTotalVnd: '200000', depositsVnd: '50000', dueVnd: '200000', paidVnd: '50000', balanceVnd: '150000', settlement: 'PARTIAL', retainedVnd: null });
    const surcharge = (await asReception('post', `/v1/merchant/booking/bookings/${booking.id}/surcharges`).set('Idempotency-Key', 'ledger-sur').send({ amountVnd: '30000', reason: 'Nước uống' }).expect(200)).body;
    assertMatchesContract(doc, 'post', '/v1/merchant/booking/bookings/{id}/surcharges', 200, surcharge);
    await asReception('post', `/v1/merchant/booking/bookings/${booking.id}/surcharges`).set('Idempotency-Key', 'ledger-sur').send({ amountVnd: '30000', reason: 'Nước uống' }).expect(200)
      .expect(({ body }) => expect(body.id).toBe(surcharge.id));
    await asReception('post', `/v1/merchant/booking/bookings/${booking.id}/surcharges`).set('Idempotency-Key', 'ledger-sur-bad').send({ amountVnd: '0', reason: 'x' }).expect(400);
    await asReception('post', `/v1/merchant/booking/bookings/${booking.id}/surcharges`).set('Idempotency-Key', 'ledger-sur-blank').send({ amountVnd: '1000', reason: '  ' }).expect(400);
    const cashPath = `/v1/merchant/booking/bookings/${booking.id}/manual-payments`;
    await authorized('post', cashPath).set('Idempotency-Key', 'ledger-cash-1').send({ method: 'CASH', amountVnd: '150000' }).expect(200);
    expect(await account(booking.id)).toMatchObject({ dueVnd: '230000', paidVnd: '200000', balanceVnd: '30000', settlement: 'PARTIAL' });
    const extra = (await authorized('post', cashPath).set('Idempotency-Key', 'ledger-cash-2').send({ method: 'CASH', amountVnd: '40000' }).expect(200)).body;
    expect(await account(booking.id)).toMatchObject({ paidVnd: '240000', balanceVnd: '-10000', settlement: 'OVERPAID' });

    const reversal = { entryType: 'MANUAL_PAYMENT', entryId: extra.id, reason: 'Ghi trùng phiếu' };
    await asReception('post', '/v1/merchant/booking/money-reversals').send(reversal).expect(403);
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ ...reversal, reason: ' ' }).expect(400);
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ ...reversal, entryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }).expect(404);
    const reversed = (await authorized('post', '/v1/merchant/booking/money-reversals').send(reversal).expect(200)).body;
    assertMatchesContract(doc, 'post', '/v1/merchant/booking/money-reversals', 200, reversed);
    expect(reversed).toMatchObject({ entryType: 'MANUAL_PAYMENT', entryId: extra.id, amountVnd: '40000' });
    await authorized('post', '/v1/merchant/booking/money-reversals').send(reversal).expect(200).expect(({ body }) => expect(body.id).toBe(reversed.id));
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ ...reversal, reason: 'Khác' }).expect(409);
    const afterCashReversal = await account(booking.id);
    expect(afterCashReversal).toMatchObject({ cashVnd: '150000', paidVnd: '200000', balanceVnd: '30000', settlement: 'PARTIAL' });
    expect(afterCashReversal.entries.find((e: { id: string }) => e.id === extra.id)).toMatchObject({ kind: 'CASH', reversed: true });
    expect(afterCashReversal.entries.find((e: { id: string }) => e.id === reversed.id)).toMatchObject({ kind: 'REVERSAL', reversesType: 'MANUAL_PAYMENT', reversesId: extra.id, note: 'Ghi trùng phiếu' });
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ entryType: 'SURCHARGE', entryId: surcharge.id, reason: 'Khách không dùng' }).expect(200);
    expect(await account(booking.id)).toMatchObject({ surchargesVnd: '0', dueVnd: '200000', paidVnd: '200000', balanceVnd: '0', settlement: 'PAID' });

    // Booking 2: a reversed deposit no longer covers confirmation.
    const hold2 = await pricedHold('ledger-2', '2048-01-02T12:00:00Z');
    const dep2 = await deposit(hold2.id, 'ledger-dep-2');
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ entryType: 'HOLD_DEPOSIT', entryId: dep2.id, reason: 'Nhầm hold' }).expect(200);
    await authorized('get', `/v1/merchant/booking/holds/${hold2.id}/deposits`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ totalRecordedVnd: '0', remainingVnd: '50000', depositSatisfied: false, items: [{ id: dep2.id, reversed: true }] }));
    await authorized('post', `/v1/merchant/booking/holds/${hold2.id}/confirm`).send(terms).expect(409);
    await authorized('post', `/v1/merchant/booking/holds/${hold2.id}/deposit-resolution`).send({ refundAmountVnd: '0', reason: 'x' }).expect(409);
    await deposit(hold2.id, 'ledger-dep-2b');
    await authorized('post', `/v1/merchant/booking/holds/${hold2.id}/confirm`).send(terms).expect(200);

    // Hold 3: expires with a deposit; staff records the refund decision.
    const hold3 = await pricedHold('ledger-3', '2048-01-03T12:00:00Z');
    const dep3 = await deposit(hold3.id, 'ledger-dep-3');
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [hold3.id]);
    const unresolved = (await authorized('get', `/v1/merchant/branches/${branch.id}/booking/unresolved-deposits`).expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/merchant/branches/{branchId}/booking/unresolved-deposits', 200, unresolved);
    expect(unresolved.items).toEqual([expect.objectContaining({ holdId: hold3.id, netDepositVnd: '50000', customerPhone: '0912345678' })]);
    const resolutionPath = `/v1/merchant/booking/holds/${hold3.id}/deposit-resolution`;
    await asReception('post', resolutionPath).send({ refundAmountVnd: '20000', reason: 'Khách huỷ' }).expect(403);
    await authorized('post', resolutionPath).send({ refundAmountVnd: '60000', reason: 'Khách huỷ' }).expect(409);
    const resolution = (await authorized('post', resolutionPath).send({ refundAmountVnd: '20000', reason: 'Khách huỷ, giữ phí' }).expect(200)).body;
    assertMatchesContract(doc, 'post', '/v1/merchant/booking/holds/{id}/deposit-resolution', 200, resolution);
    expect(resolution).toMatchObject({ netDepositVnd: '50000', refundAmountVnd: '20000', retainedVnd: '30000' });
    await authorized('post', resolutionPath).send({ refundAmountVnd: '20000', reason: 'Khách huỷ, giữ phí' }).expect(200);
    await authorized('post', resolutionPath).send({ refundAmountVnd: '0', reason: 'Khác' }).expect(409);
    expect((await pool.query('SELECT status FROM booking_holds WHERE id=$1', [hold3.id])).rows[0].status).toBe('EXPIRED');
    await authorized('get', `/v1/merchant/branches/${branch.id}/booking/unresolved-deposits`).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
    await authorized('post', '/v1/merchant/booking/money-reversals').send({ entryType: 'HOLD_DEPOSIT', entryId: dep3.id, reason: 'Muộn' }).expect(409);

    // Cancellation refund is capped by the net collected; a closed booking has nothing due.
    await authorized('post', `/v1/merchant/booking/bookings/${booking.id}/outcome`).send({ type: 'CUSTOMER_CANCELLED', note: 'Huỷ, hoàn toàn bộ', refundAmountVnd: '200001' }).expect(409);
    await authorized('post', `/v1/merchant/booking/bookings/${booking.id}/outcome`).send({ type: 'CUSTOMER_CANCELLED', note: 'Huỷ, hoàn toàn bộ', refundAmountVnd: '150000' }).expect(200);
    expect(await account(booking.id)).toMatchObject({ bookingStatus: 'CANCELLED', dueVnd: '0', refundsVnd: '150000', paidVnd: '50000', settlement: 'CLOSED', retainedVnd: '50000' });
    await asReception('post', `/v1/merchant/booking/bookings/${booking.id}/surcharges`).set('Idempotency-Key', 'ledger-sur-closed').send({ amountVnd: '1000', reason: 'Muộn' }).expect(409);

    // Daily report for the branch's local day.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const report = (await authorized('get', `/v1/merchant/branches/${branch.id}/cash-report`).query({ date: today }).expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/merchant/branches/{branchId}/cash-report', 200, report);
    expect(report).toMatchObject({ branchId: branch.id, date: today, timezone: 'Asia/Ho_Chi_Minh', totals: {
      depositsVnd: '200000', bookingCashVnd: '190000', cashReversalsVnd: '90000', refundsVnd: '170000', netCashVnd: '130000', surchargesVnd: '0' } });
    expect(report.byRecorder.map((r: { userId: string }) => r.userId).sort()).toEqual([OWNER_ID, receptionist.id].sort());
    expect(report.byRecorder.find((r: { userId: string }) => r.userId === receptionist.id)).toMatchObject({ netCashVnd: '0', surchargesVnd: '30000' });
    await authorized('get', `/v1/merchant/branches/${branch.id}/cash-report`).query({ date: '2026-02-30' }).expect(422);
    await asReception('get', `/v1/merchant/branches/${branch.id}/cash-report`).query({ date: today }).expect(403);
    const audit = await pool.query(`SELECT action,after_data FROM audit_logs WHERE tenant_id=$1 AND action IN ('MONEY_REVERSED','BOOKING_SURCHARGE_ADDED','HOLD_DEPOSIT_RESOLVED')`, [TENANT_A]);
    expect(audit.rows.map(r => r.action).sort()).toEqual(['BOOKING_SURCHARGE_ADDED', 'HOLD_DEPOSIT_RESOLVED', 'MONEY_REVERSED', 'MONEY_REVERSED', 'MONEY_REVERSED']);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Ghi trùng phiếu|Nước uống|giữ phí/);
    expect(dep1.reversed).toBe(false);
    await authorized('patch', `/v1/merchant/pricing/plans/${plan.id}`).send({ name: 'Ledger plan', status: 'INACTIVE' }).expect(200);
  }, 30000);

  it('resolves the public client IP from the configured platform header for per-IP limits, with a guarded diagnostic (OPS-007)', async () => {
    const previous = { cron: process.env.CRON_SECRET, header: process.env.CLIENT_IP_HEADER };
    process.env.CRON_SECRET = 'ops-007-cron-secret-for-e2e';
    process.env.CLIENT_IP_HEADER = 'x-real-ip';
    try {
      await request(app.getHttpServer()).get('/v1/internal/diag/client-ip').set('x-real-ip', '203.0.113.10').expect(404);
      await request(app.getHttpServer()).get('/v1/internal/diag/client-ip').set('Authorization', 'Bearer wrong').expect(404);
      await request(app.getHttpServer()).get('/v1/internal/diag/client-ip').set('Authorization', 'Bearer ops-007-cron-secret-for-e2e')
        .set('x-real-ip', '203.0.113.10').set('x-forwarded-for', '198.51.100.99').expect(200)
        .expect(({ body }) => expect(body).toMatchObject({
          resolved: { ip: '203.0.113.10', source: 'platform-header' }, config: { clientIpHeader: 'x-real-ip', proxySecretConfigured: false },
          headers: { 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.99' } }));
      const ipBuckets = async () => Number((await pool.query(`SELECT count(*) FROM public_rate_limit_buckets WHERE scope='PUBLIC_LOOKUP_IP'`)).rows[0].count);
      const lookup = (ip: string, phone: string) => request(app.getHttpServer()).post('/v1/public/booking/lookup').set('x-real-ip', ip)
        .send({ phone, bookingCode: '0'.repeat(32) }).expect(404);
      const before = await ipBuckets();
      await lookup('203.0.113.21', '0911000201');
      await lookup('203.0.113.22', '0911000202');
      await lookup('203.0.113.21', '0911000203');
      expect(await ipBuckets()).toBe(before + 2);
    } finally {
      if (previous.cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous.cron;
      if (previous.header === undefined) delete process.env.CLIENT_IP_HEADER; else process.env.CLIENT_IP_HEADER = previous.header;
    }
  });

  it('stores room photos, the merchant logo and private merchant PDFs with type, size, count and role checks (PD-037)', async () => {
    const doc = JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8'));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024, 3)]);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1500, 65)]);
    const server = app.getHttpServer();
    const owner = (method: 'get' | 'post' | 'put' | 'delete', p: string) => request(server)[method](p).set('Authorization', `Bearer ${ownerToken}`).set('X-Tenant-ID', TENANT_A);
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'FILES', name: 'Files', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'FILES-R', name: 'Files room', capacity: 6 }).expect(201)).body;
    const uploadPath = `/v1/merchant/rooms/${room.id}/media/upload`;

    // Room photos
    const media = (await owner('post', uploadPath).attach('file', jpeg, { filename: 'room.jpg', contentType: 'image/jpeg' }).field('altText', 'Phòng nhìn từ cửa').expect(201)).body;
    assertMatchesContract(doc, 'post', '/v1/merchant/rooms/{id}/media/upload', 201, media);
    expect(media).toMatchObject({ roomId: room.id, contentType: 'image/jpeg', sizeBytes: jpeg.length, altText: 'Phòng nhìn từ cửa', displayOrder: 0 });
    expect(media.url).toBe(`/v1/files/public/${media.assetRef}`);
    expect(media.assetRef).toMatch(new RegExp(`^rooms/${TENANT_A}/${room.id}/[0-9a-f-]{36}\\.jpg$`));
    const served = await request(server).get(media.url).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(served.body, jpeg)).toBe(0);
    await owner('post', uploadPath).attach('file', pdf, { filename: 'fake.jpg', contentType: 'image/jpeg' }).expect(422);
    await owner('post', uploadPath).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(422);
    await owner('post', uploadPath).field('altText', 'no file').expect(400);
    await owner('post', uploadPath).attach('file', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024)]), { filename: 'big.jpg' }).expect(413);
    const cashier = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'files-cashier@example.com',$1,'Files Cashier','ACTIVE') RETURNING id`, [await hash('Cashier-password-123', 4)])).rows[0];
    const cashierMember = (await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),$1,$2,'ACTIVE') RETURNING id`, [TENANT_A, cashier.id])).rows[0];
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'CASHIER')`, [cashierMember.id]);
    await pool.query(`INSERT INTO membership_branches(membership_id,tenant_id,branch_id) VALUES($1,$2,$3)`, [cashierMember.id, TENANT_A, branch.id]);
    const cashierToken = (await request(server).post('/v1/auth/login').send({ email: 'files-cashier@example.com', password: 'Cashier-password-123' }).expect(200)).body.accessToken;
    await request(server).post(uploadPath).set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).attach('file', jpeg, { filename: 'r.jpg' }).expect(403);
    for (let i = 0; i < 9; i++) await authorized('post', `/v1/merchant/rooms/${room.id}/media`).send({ assetRef: `rooms/meta-${i}.jpg`, displayOrder: i + 1 }).expect(201);
    await owner('post', uploadPath).attach('file', png, { filename: 'eleventh.png' }).expect(409);
    await authorized('get', `/v1/merchant/rooms/${room.id}/media`).expect(200).expect(({ body }) => {
      expect(body).toHaveLength(10);
      assertMatchesContract(doc, 'get', '/v1/merchant/rooms/{id}/media', 200, body);
    });
    await authorized('delete', `/v1/merchant/rooms/${room.id}/media/${media.id}`).expect(204);
    await request(server).get(media.url).expect(404);

    // Merchant logo
    await owner('get', '/v1/merchant/catalog/logo').expect(200).expect(({ body }) => expect(body).toEqual({ configured: false, url: null, contentType: null, sizeBytes: null, updatedAt: null }));
    const first = (await owner('put', '/v1/merchant/catalog/logo').attach('file', png, { filename: 'logo.png' }).expect(200)).body;
    assertMatchesContract(doc, 'put', '/v1/merchant/catalog/logo', 200, first);
    expect(first).toMatchObject({ configured: true, contentType: 'image/png', sizeBytes: png.length });
    await request(server).put('/v1/merchant/catalog/logo').set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).attach('file', png, { filename: 'l.png' }).expect(403);
    await owner('put', '/v1/merchant/catalog/logo').attach('file', pdf, { filename: 'logo.png' }).expect(422);
    const second = (await owner('put', '/v1/merchant/catalog/logo').attach('file', jpeg, { filename: 'logo.jpg' }).expect(200)).body;
    expect(second.url).not.toBe(first.url);
    await request(server).get(first.url).expect(404);
    await request(server).get(second.url).expect(200);
    const catalog = (await pool.query('SELECT published,platform_approved FROM tenant_public_catalog WHERE tenant_id=$1', [TENANT_A])).rows[0];
    if (catalog) await pool.query('UPDATE tenant_public_catalog SET published=true,platform_approved=true WHERE tenant_id=$1', [TENANT_A]);
    else await pool.query('INSERT INTO tenant_public_catalog(tenant_id,published,platform_approved,updated_by) VALUES($1,true,true,$2)', [TENANT_A, OWNER_ID]);
    try {
      const listed = (await request(server).get('/v1/public/branches').query({ limit: 100 }).expect(200)).body;
      assertMatchesContract(doc, 'get', '/v1/public/branches', 200, listed);
      expect(listed.items.find((item: { id: string }) => item.id === branch.id)).toMatchObject({ merchantLogoUrl: second.url });
    } finally {
      if (catalog) await pool.query('UPDATE tenant_public_catalog SET published=$2,platform_approved=$3 WHERE tenant_id=$1', [TENANT_A, catalog.published, catalog.platform_approved]);
      else await pool.query('DELETE FROM tenant_public_catalog WHERE tenant_id=$1', [TENANT_A]);
    }
    await owner('delete', '/v1/merchant/catalog/logo').expect(204);
    await request(server).get(second.url).expect(404);
    await owner('get', '/v1/merchant/catalog/logo').expect(200).expect(({ body }) => expect(body.configured).toBe(false));

    // Private merchant documents
    await owner('post', '/v1/merchant/documents').attach('file', pdf, { filename: 'gp.pdf' }).expect(400);
    await owner('post', '/v1/merchant/documents').field('title', 'Giấy phép').attach('file', jpeg, { filename: 'gp.pdf' }).expect(422);
    const pdfDoc = (await owner('post', '/v1/merchant/documents').field('title', 'Giấy phép kinh doanh số 0312345678').attach('file', pdf, { filename: 'gp.pdf' }).expect(201)).body;
    assertMatchesContract(doc, 'post', '/v1/merchant/documents', 201, pdfDoc);
    expect(pdfDoc).toMatchObject({ tenantId: TENANT_A, contentType: 'application/pdf', sizeBytes: pdf.length, uploadedBy: OWNER_ID });
    const download = async (req: request.Test) => req.buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    const ownerFile = await download(owner('get', `/v1/merchant/documents/${pdfDoc.id}/file`).expect(200));
    expect(ownerFile.headers).toMatchObject({ 'content-type': 'application/pdf', 'cache-control': 'private, no-store' });
    expect(Buffer.compare(ownerFile.body, pdf)).toBe(0);
    await request(server).get('/v1/merchant/documents').set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    await request(server).get(`/v1/merchant/documents/${pdfDoc.id}/file`).set('Authorization', `Bearer ${cashierToken}`).set('X-Tenant-ID', TENANT_A).expect(403);
    const adminId = (await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES(gen_random_uuid(),'docs-admin@example.com',$1,'Docs Admin','ACTIVE') RETURNING id`, [await hash('Docs-password-123', 4)])).rows[0].id;
    await pool.query('INSERT INTO platform_admins(user_id) VALUES($1)', [adminId]);
    const adminToken = (await request(server).post('/v1/auth/login').send({ email: 'docs-admin@example.com', password: 'Docs-password-123' }).expect(200)).body.accessToken;
    const adminList = (await request(server).get(`/v1/platform/merchants/${TENANT_A}/documents`).set('Authorization', `Bearer ${adminToken}`).expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/platform/merchants/{tenantId}/documents', 200, adminList);
    expect(adminList.map((d: { id: string }) => d.id)).toContain(pdfDoc.id);
    const adminFile = await download(request(server).get(`/v1/platform/merchants/${TENANT_A}/documents/${pdfDoc.id}/file`).set('Authorization', `Bearer ${adminToken}`).expect(200));
    expect(Buffer.compare(adminFile.body, pdf)).toBe(0);
    await request(server).get(`/v1/platform/merchants/${TENANT_B}/documents/${pdfDoc.id}/file`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    await request(server).get(`/v1/platform/merchants/${TENANT_A}/documents`).set('Authorization', `Bearer ${ownerToken}`).expect(403);
    for (let i = 1; i < 10; i++) await owner('post', '/v1/merchant/documents').field('title', `Hồ sơ ${i}`).attach('file', pdf, { filename: `d${i}.pdf` }).expect(201);
    await owner('post', '/v1/merchant/documents').field('title', 'Hồ sơ 11').attach('file', pdf, { filename: 'd11.pdf' }).expect(409);
    await owner('delete', `/v1/merchant/documents/${pdfDoc.id}`).expect(204);
    await owner('get', `/v1/merchant/documents/${pdfDoc.id}/file`).expect(404);
    await owner('delete', `/v1/merchant/documents/${pdfDoc.id}`).expect(404);
    const audit = await pool.query(`SELECT action,after_data FROM audit_logs WHERE tenant_id=$1 AND action IN ('MERCHANT_DOCUMENT_UPLOADED','MERCHANT_LOGO_UPDATED','ROOM_MEDIA_UPLOADED')`, [TENANT_A]);
    expect(audit.rows.filter(r => r.action === 'MERCHANT_DOCUMENT_UPLOADED')).toHaveLength(10);
    expect(JSON.stringify(audit.rows)).not.toContain('0312345678');
  }, 60000);

  it('keeps the staff session in an HttpOnly cookie and lists the user\'s merchants (FE-012, PD-039)', async () => {
    const server = app.getHttpServer();
    const userId = randomUUID(), password = 'Cookie-pass-123';
    await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES ($1,'cookie-user@example.com',$2,'Cookie User','ACTIVE')`, [userId, await hash(password, 4)]);
    for (const [tenantId, role, status] of [[TENANT_A, 'RECEPTIONIST', 'ACTIVE'], [TENANT_B, 'CASHIER', 'ACTIVE']] as const) {
      const membershipId = randomUUID();
      await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES ($1,$2,$3,$4)`, [membershipId, tenantId, userId, status]);
      await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES ($1,$2)`, [membershipId, role]);
    }
    const cookieOf = (res: { headers: Record<string, unknown> }) => {
      const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []).find(c => c.startsWith('kn_refresh='));
      return raw;
    };
    const login = await request(server).post('/v1/auth/login').send({ email: 'cookie-user@example.com', password }).expect(200);
    const setCookie = cookieOf(login)!;
    expect(setCookie).toMatch(/HttpOnly/i); expect(setCookie).toMatch(/SameSite=Strict/i); expect(setCookie).toMatch(/Path=\/v1\/auth/); expect(setCookie).toMatch(/Secure/);
    const cookie = setCookie.split(';')[0];
    expect(cookie).toBe(`kn_refresh=${login.body.refreshToken}`);

    // Reload: no token in JS, only the cookie + X-KN-Session header.
    await request(server).post('/v1/auth/refresh').set('Cookie', cookie).send({}).expect(401);
    const refreshed = await request(server).post('/v1/auth/refresh').set('Cookie', cookie).set('X-KN-Session', '1').send({}).expect(200);
    const rotated = cookieOf(refreshed)!.split(';')[0];
    expect(rotated).not.toBe(cookie);
    // Second tab refreshing with the same (now rotated) cookie within the grace window: new sibling session, family intact.
    const sibling = await request(server).post('/v1/auth/refresh').set('Cookie', cookie).set('X-KN-Session', '1').send({}).expect(200);
    await request(server).post('/v1/auth/refresh').set('Cookie', rotated).set('X-KN-Session', '1').send({}).expect(200);
    await request(server).post('/v1/auth/refresh').set('Cookie', cookieOf(sibling)!.split(';')[0]).set('X-KN-Session', '1').send({}).expect(200);
    // Outside the grace window the same reuse revokes the family (unchanged security rule).
    await pool.query(`UPDATE auth_sessions SET revoked_at=revoked_at-interval '1 minute' WHERE user_id=$1 AND revoked_at IS NOT NULL`, [userId]);
    const reuse = await request(server).post('/v1/auth/refresh').set('Cookie', cookie).set('X-KN-Session', '1').send({}).expect(401);
    expect(cookieOf(reuse)).toMatch(/kn_refresh=;|Expires=Thu, 01 Jan 1970/);
    const active = await pool.query(`SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
    expect(active.rows[0].n).toBe(0);

    // Merchant picker
    const again = await request(server).post('/v1/auth/login').send({ email: 'cookie-user@example.com', password }).expect(200);
    const tenants = (await request(server).get('/v1/me/tenants').set('Authorization', `Bearer ${again.body.accessToken}`).expect(200)).body;
    expect(tenants).toEqual([
      { tenantId: TENANT_A, tenantName: 'Tenant A', tenantStatus: expect.any(String), roles: ['RECEPTIONIST'] },
      { tenantId: TENANT_B, tenantName: 'Tenant B', tenantStatus: expect.any(String), roles: ['CASHIER'] }
    ]);
    assertMatchesContract(JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8')), 'get', '/v1/me/tenants', 200, tenants);
    await pool.query(`UPDATE tenant_memberships SET status='INACTIVE' WHERE user_id=$1 AND tenant_id=$2`, [userId, TENANT_B]);
    expect((await request(server).get('/v1/me/tenants').set('Authorization', `Bearer ${again.body.accessToken}`).expect(200)).body.map((x: { tenantId: string }) => x.tenantId)).toEqual([TENANT_A]);
    await request(server).get('/v1/me/tenants').expect(401);

    // Logout with the cookie revokes the family and clears the cookie.
    const againCookie = cookieOf(again)!.split(';')[0];
    const out = await request(server).post('/v1/auth/logout').set('Cookie', againCookie).set('X-KN-Session', '1').send({}).expect(204);
    expect(cookieOf(out)).toMatch(/kn_refresh=;/);
    await request(server).post('/v1/auth/refresh').set('Cookie', againCookie).set('X-KN-Session', '1').send({}).expect(401);
    await request(server).post('/v1/auth/logout').send({}).expect(204);
  });

  it('lets a Platform Admin manage users and merchant memberships with audit and self-protection (PD-040)', async () => {
    const server = app.getHttpServer();
    const doc = JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8'));
    const mkUser = async (email: string, password: string) => {
      const id = randomUUID();
      await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [id, email, await hash(password, 4), email.split('@')[0]]);
      return id;
    };
    const login = async (email: string, password: string) => (await request(server).post('/v1/auth/login').send({ email, password }).expect(200)).body;
    const adminId = await mkUser('pu-admin@example.com', 'Pu-admin-pass-1');
    await pool.query('INSERT INTO platform_admins(user_id) VALUES($1)', [adminId]);
    const admin = (await login('pu-admin@example.com', 'Pu-admin-pass-1')).accessToken;
    const as = (token: string) => ({
      get: (path: string) => request(server).get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string) => request(server).post(path).set('Authorization', `Bearer ${token}`),
      patch: (path: string) => request(server).patch(path).set('Authorization', `Bearer ${token}`)
    });
    const A = as(admin);

    // Merchant with an Owner and a branch, created directly.
    const tenantId = randomUUID(), branchId = randomUUID(), ownerId = await mkUser('pu-owner@example.com', 'Pu-owner-pass-1');
    await pool.query(`INSERT INTO tenants(id,code,name,status) VALUES ($1,'PU','PU Karaoke','ACTIVE')`, [tenantId]);
    await pool.query(`INSERT INTO branches(id,tenant_id,code,name,timezone,status) VALUES ($1,$2,'PU-1','PU Q1','Asia/Ho_Chi_Minh','ACTIVE')`, [branchId, tenantId]);
    const ownerMembership = randomUUID();
    await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES ($1,$2,$3,'ACTIVE')`, [ownerMembership, tenantId, ownerId]);
    await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES ($1,'OWNER')`, [ownerMembership]);

    await request(server).get('/v1/platform/users').set('Authorization', `Bearer ${ownerToken}`).expect(403);
    const list = (await A.get('/v1/platform/users?q=PU-OWNER&limit=10').expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/platform/users', 200, list);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: ownerId, status: 'ACTIVE', platformAdmin: false, lastLoginAt: null,
      memberships: [{ membershipId: ownerMembership, tenantId, tenantName: 'PU Karaoke', status: 'ACTIVE', roles: ['OWNER'], branchIds: [] }] });
    expect((await A.get('/v1/platform/users?q=%25').expect(200)).body.items).toHaveLength(0); // LIKE wildcards are literal
    expect((await A.get('/v1/platform/users?platformAdmin=true&limit=100').expect(200)).body.items.map((u: { id: string }) => u.id)).toContain(adminId);

    // Disable: sessions die immediately, login refused; enable restores.
    const ownerSession = await login('pu-owner@example.com', 'Pu-owner-pass-1');
    await A.post(`/v1/platform/users/${adminId}/disable`).send({ reason: 'self' }).expect(403);
    await A.post(`/v1/platform/users/${ownerId}/disable`).send({ reason: ' ' }).expect(400);
    const disabled = (await A.post(`/v1/platform/users/${ownerId}/disable`).send({ reason: 'Báo mất điện thoại' }).expect(200)).body;
    assertMatchesContract(doc, 'post', '/v1/platform/users/{id}/disable', 200, disabled);
    expect(disabled).toMatchObject({ status: 'DISABLED', disabledReason: 'Báo mất điện thoại' });
    await request(server).get('/v1/me/tenants').set('Authorization', `Bearer ${ownerSession.accessToken}`).expect(401);
    await request(server).post('/v1/auth/login').send({ email: 'pu-owner@example.com', password: 'Pu-owner-pass-1' }).expect(401);
    await A.post(`/v1/platform/users/${ownerId}/disable`).send({ reason: 'again' }).expect(200);
    await A.post(`/v1/platform/users/${ownerId}/temporary-password`).send({ reason: 'quên mật khẩu' }).expect(409);
    expect((await A.post(`/v1/platform/users/${ownerId}/enable`).send({ reason: 'Đã xác minh' }).expect(200)).body).toMatchObject({ status: 'ACTIVE', disabledReason: null });
    expect((await A.get(`/v1/platform/users/${ownerId}`).expect(200)).body.lastLoginAt).not.toBeNull();

    // Temporary password: shown once, forces a change, old password and sessions stop working.
    const fresh = await login('pu-owner@example.com', 'Pu-owner-pass-1');
    const temp = await A.post(`/v1/platform/users/${ownerId}/temporary-password`).send({ reason: 'Gọi tổng đài quên mật khẩu' }).expect(200);
    expect(temp.headers['cache-control']).toBe('no-store');
    assertMatchesContract(doc, 'post', '/v1/platform/users/{id}/temporary-password', 200, temp.body);
    expect(temp.body.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(temp.body.user.mustChangePassword).toBe(true);
    await request(server).get('/v1/me/tenants').set('Authorization', `Bearer ${fresh.accessToken}`).expect(401);
    await request(server).post('/v1/auth/login').send({ email: 'pu-owner@example.com', password: 'Pu-owner-pass-1' }).expect(401);
    expect((await login('pu-owner@example.com', temp.body.temporaryPassword)).mustChangePassword).toBe(true);

    // Platform Admin grant/revoke.
    const helperId = await mkUser('pu-helper@example.com', 'Pu-helper-pass-1');
    expect((await A.post(`/v1/platform/users/${helperId}/platform-admin`).send({ reason: 'Nhân sự vận hành mới' }).expect(200)).body.platformAdmin).toBe(true);
    const helper = (await login('pu-helper@example.com', 'Pu-helper-pass-1')).accessToken;
    await as(helper).get('/v1/platform/users').expect(200);
    await as(helper).post(`/v1/platform/users/${helperId}/platform-admin/revoke`).send({ reason: 'self' }).expect(403);
    expect((await A.post(`/v1/platform/users/${helperId}/platform-admin/revoke`).send({ reason: 'Hết nhiệm vụ' }).expect(200)).body.platformAdmin).toBe(false);
    await as(helper).get('/v1/platform/users').expect(403);
    await A.post(`/v1/platform/users/${randomUUID()}/disable`).send({ reason: 'x' }).expect(404);

    // Memberships of a merchant.
    const members = (await A.get(`/v1/platform/merchants/${tenantId}/memberships`).expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/platform/merchants/{tenantId}/memberships', 200, members);
    const branches = (await A.get(`/v1/platform/merchants/${tenantId}/branches`).expect(200)).body;
    assertMatchesContract(doc, 'get', '/v1/platform/merchants/{tenantId}/branches', 200, branches);
    expect(branches).toEqual([{ id: branchId, name: 'PU Q1', status: 'ACTIVE' }]);
    await A.get(`/v1/platform/merchants/${randomUUID()}/memberships`).expect(404);
    const cashier = (await A.post(`/v1/platform/merchants/${tenantId}/memberships`).send({ email: 'pu-cashier@example.com', displayName: 'PU Cashier',
      temporaryPassword: 'Pu-cashier-temp-1', roles: ['CASHIER'], branchIds: [branchId], reason: 'Owner nghỉ phép, nhờ thêm thu ngân' }).expect(201)).body;
    assertMatchesContract(doc, 'post', '/v1/platform/merchants/{tenantId}/memberships', 201, cashier);
    await A.post(`/v1/platform/merchants/${tenantId}/memberships`).send({ email: 'pu-cashier@example.com', displayName: 'x', temporaryPassword: 'Pu-cashier-temp-1', roles: ['CASHIER'], branchIds: [branchId] }).expect(400);
    await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${ownerMembership}`).send({ roles: ['CASHIER'], branchIds: [branchId], reason: 'thử' }).expect(409);
    await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${ownerMembership}`).send({ status: 'INACTIVE', reason: 'thử' }).expect(409);
    await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${cashier.id}`).send({ reason: 'không đổi gì' }).expect(400);
    const promoted = (await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${cashier.id}`).send({ roles: ['OWNER'], reason: 'Owner cũ nghỉ việc' }).expect(200)).body;
    assertMatchesContract(doc, 'patch', '/v1/platform/merchants/{tenantId}/memberships/{membershipId}', 200, promoted);
    expect(promoted.roles).toEqual(['OWNER']);
    await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${ownerMembership}`).send({ status: 'INACTIVE', reason: 'Owner cũ nghỉ việc' }).expect(200);
    const merchantAudit = await pool.query(`SELECT action,actor_user_id,before_data,after_data FROM audit_logs WHERE tenant_id=$1 ORDER BY occurred_at`, [tenantId]);
    expect(JSON.stringify(merchantAudit.rows)).not.toMatch(/@example\.com|PU Cashier/); // no email or name in audit
    expect(merchantAudit.rows[0].after_data).toEqual({ userId: cashier.userId, newUser: true, roles: ['CASHIER'], branchIds: [branchId], status: 'ACTIVE' });
    expect(merchantAudit.rows.map(r => r.action)).toEqual(['MEMBERSHIP_CREATED', 'MEMBERSHIP_UPDATED', 'MEMBERSHIP_UPDATED']);
    expect(merchantAudit.rows.every(r => r.actor_user_id === adminId)).toBe(true);

    // Admin who belongs to the merchant cannot edit its memberships.
    await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES (gen_random_uuid(),$1,$2,'ACTIVE')`, [tenantId, adminId]);
    await A.patch(`/v1/platform/merchants/${tenantId}/memberships/${cashier.id}`).send({ roles: ['OWNER', 'CASHIER'], branchIds: [branchId], reason: 'x' }).expect(403);

    const platformAudit = await pool.query(`SELECT action,actor_user_id,tenant_id,before_data,after_data FROM platform_audit_logs WHERE actor_user_id=$1 ORDER BY occurred_at`, [adminId]);
    expect(platformAudit.rows.map(r => r.action)).toEqual(['USER_DISABLED', 'USER_ENABLED', 'USER_TEMPORARY_PASSWORD_ISSUED', 'PLATFORM_ADMIN_GRANTED', 'PLATFORM_ADMIN_REVOKED',
      'PLATFORM_MEMBERSHIP_CREATED', 'PLATFORM_MEMBERSHIP_UPDATED', 'PLATFORM_MEMBERSHIP_UPDATED']);
    expect(platformAudit.rows[0].after_data).toEqual({ status: 'DISABLED', reason: 'Báo mất điện thoại' });
    const auditText = JSON.stringify(platformAudit.rows);
    expect(auditText).not.toContain(temp.body.temporaryPassword);
    expect(auditText).not.toContain('@example.com');
  });

  it('frees the slot of an overdue hold without waiting for the daily cron (BKG-011)', async () => {
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'BKG011', name: 'Overdue holds', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'BKG011-R', name: 'Overdue room', capacity: 4 }).expect(201)).body;
    const slot = { roomId: room.id, channel: 'BKG011', startAt: '2047-03-01T12:00:00Z', durationMinutes: 90 };
    const first = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'bkg011-first').send(slot).expect(201)).body;
    await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'bkg011-early').send(slot).expect(409);
    const free = async () => (await authorized('get', `/v1/merchant/branches/${branch.id}/availability`)
      .query({ startAt: slot.startAt, durationMinutes: 90 }).expect(200)).body.rooms.map((r: { id: string }) => r.id);
    expect(await free()).not.toContain(room.id);

    // TTL passes; no cron runs.
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [first.id]);
    expect(await free()).toContain(room.id);
    const second = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'bkg011-second').send(slot).expect(201)).body;
    const states = await pool.query(`SELECT h.id,h.status,o.status AS occupancy FROM booking_holds h JOIN room_occupancy o ON o.id=h.occupancy_id WHERE h.id=ANY($1::uuid[])`, [[first.id, second.id]]);
    expect(Object.fromEntries(states.rows.map(r => [r.id, [r.status, r.occupancy]]))).toEqual({ [first.id]: ['EXPIRED', 'RELEASED'], [second.id]: ['HELD', 'HELD'] });
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='HOLD_EXPIRED' AND entity_id=$1`, [first.id]);
    expect(audit.rows[0].n).toBe(1);
    // A maintenance block over an overdue hold also succeeds.
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`, [second.id]);
    await authorized('post', '/v1/merchant/room-blocks').send({ roomId: room.id, startAt: '2047-03-01T12:00:00Z', endAt: '2047-03-01T14:00:00Z', reason: 'Sửa loa' }).expect(201);
  });

  it('reports background job backlog for an uptime monitor with 200/503 and counts only (OPS-003, PD-041)', async () => {
    const server = app.getHttpServer();
    const doc = JSON.parse(readFileSync(resolve('../docs/02-architecture/openapi.json'), 'utf8'));
    const check = async () => {
      const res = await request(server).get('/v1/health/jobs');
      expect([200, 503]).toContain(res.status);
      assertMatchesContract(doc, 'get', '/v1/health/jobs', res.status, res.body);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.status === 200).toBe(res.body.status === 'ok');
      expect(res.body.status === 'ok').toBe(res.body.checks.holdExpiry.ok && res.body.checks.outbox.ok);
      return res;
    };
    await check();
    // An overdue hold older than the threshold makes the endpoint degraded.
    const branch = (await authorized('post', '/v1/merchant/branches').send({ code: 'OPS003', name: 'Job health', timezone: 'Asia/Ho_Chi_Minh' }).expect(201)).body;
    const room = (await authorized('post', '/v1/merchant/rooms').send({ branchId: branch.id, code: 'OPS003-R', name: 'Job room', capacity: 4 }).expect(201)).body;
    const hold = (await authorized('post', '/v1/merchant/booking/holds').set('Idempotency-Key', 'ops003-hold')
      .send({ roomId: room.id, channel: 'OPS003', startAt: '2047-04-01T12:00:00Z', durationMinutes: 90 }).expect(201)).body;
    await pool.query(`UPDATE booking_holds SET expires_at=clock_timestamp()-interval '2 days' WHERE id=$1`, [hold.id]);
    const degraded = await check();
    expect(degraded.status).toBe(503);
    expect(degraded.body.checks.holdExpiry).toMatchObject({ ok: false, thresholdMinutes: 1560 });
    expect(degraded.body.checks.holdExpiry.oldestOverdueMinutes).toBeGreaterThanOrEqual(2880);
    expect(JSON.stringify(degraded.body)).not.toContain(hold.id);
    await pool.query(`UPDATE booking_holds SET status='EXPIRED' WHERE id=$1`, [hold.id]);
    await pool.query(`UPDATE room_occupancy SET status='RELEASED' WHERE source_id=$1`, [hold.id]);
    expect((await check()).body.checks.holdExpiry.oldestOverdueMinutes ?? 0).toBeLessThan(2880);
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
