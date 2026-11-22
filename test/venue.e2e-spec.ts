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
    await request(app.getHttpServer()).get('/v1/health/live').expect(200)
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

  function authorized(method: 'get' | 'post' | 'patch', path: string) {
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
