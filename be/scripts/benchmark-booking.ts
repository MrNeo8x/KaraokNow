/**
 * QA-002 — reproducible booking performance and concurrency benchmark.
 *
 * Starts an isolated PostgreSQL 17 (Testcontainers), applies all migrations, seeds a fixed
 * dataset, boots the real Nest application on a random port and drives it over HTTP.
 * Requires Docker. Usage: `npm run bench:booking` (optional `BENCH_OUTPUT=path.json`).
 *
 * Targets come from PRD/Master Plan: standard API p95 < 500 ms, availability search p95 < 1 s.
 * Results are local-machine evidence only, not production capacity.
 */
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { hash } from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const BRANCHES = 5;
const ROOMS_PER_BRANCH = 20;
const HISTORY_DAYS = 30;
const BOOKINGS_PER_ROOM_DAY = 4;
const TIMEZONE = 'Asia/Ho_Chi_Minh';
const PASSWORD = 'Benchmark-password-2026';

interface Sample { ms: number; status: number }
interface ScenarioResult {
  name: string; requests: number; concurrency: number; wallMs: number; throughputRps: number;
  p50: number; p95: number; p99: number; max: number; statuses: Record<string, number>; targetP95Ms?: number; pass?: boolean; notes?: string;
}

const realWrite = process.stdout.write.bind(process.stdout);
function log(line: string) { realWrite(`${line}\n`); }
// The app writes one structured JSON log line per request; keep producing them (realistic cost) but hide them.
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
  if (text.startsWith('{') && text.includes('"correlationId"')) return true;
  return (realWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<Sample>) {
  const samples: Sample[] = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++];
      samples.push(await worker(item));
    }
  }));
  return { samples, wallMs: performance.now() - started };
}

function summarize(name: string, concurrency: number, run: { samples: Sample[]; wallMs: number }, targetP95Ms?: number, notes?: string): ScenarioResult {
  const sorted = run.samples.map(s => s.ms).sort((a, b) => a - b);
  const statuses: Record<string, number> = {};
  for (const s of run.samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1;
  const round = (n: number) => Math.round(n * 10) / 10;
  const result: ScenarioResult = {
    name, requests: run.samples.length, concurrency, wallMs: round(run.wallMs), throughputRps: round(run.samples.length / (run.wallMs / 1000)),
    p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted[sorted.length - 1] ?? 0), statuses, notes
  };
  if (targetP95Ms !== undefined) { result.targetP95Ms = targetP95Ms; result.pass = result.p95 < targetP95Ms; }
  log(`  ${name}: n=${result.requests} c=${concurrency} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms rps=${result.throughputRps} statuses=${JSON.stringify(statuses)}`);
  return result;
}

async function main() {
  log('Starting PostgreSQL 17 container…');
  const postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.JWT_SECRET = 'benchmark-secret-at-least-32-characters-long';
  process.env.PUBLIC_HOLD_IP_LIMIT = '10000';
  process.env.PUBLIC_HOLD_PHONE_LIMIT = '10000';
  execFileSync(resolve('node_modules/.bin/node-pg-migrate'), ['up', '-m', 'migrations'], { cwd: resolve('.'), env: { ...process.env }, stdio: 'pipe' });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = randomUUID(), userId = randomUUID(), membershipId = randomUUID(), planId = randomUUID();
  log('Seeding dataset…');
  await pool.query(`INSERT INTO tenants(id,code,name,status) VALUES($1,'BENCH','Benchmark merchant','ACTIVE')`, [tenantId]);
  await pool.query(`INSERT INTO users(id,email,password_hash,display_name,status) VALUES($1,'bench.owner@example.com',$2,'Bench Owner','ACTIVE')`, [userId, await hash(PASSWORD, 4)]);
  await pool.query(`INSERT INTO tenant_memberships(id,tenant_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')`, [membershipId, tenantId, userId]);
  await pool.query(`INSERT INTO membership_roles(membership_id,role) VALUES($1,'OWNER')`, [membershipId]);
  const branchIds: string[] = [], roomIds: string[] = [], roomBranch = new Map<string, string>();
  for (let b = 0; b < BRANCHES; b++) {
    const branchId = randomUUID(); branchIds.push(branchId);
    await pool.query(`INSERT INTO branches(id,tenant_id,code,name,timezone,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')`, [branchId, tenantId, `B${b}`, `Branch ${b}`, TIMEZONE]);
    for (let r = 0; r < ROOMS_PER_BRANCH; r++) {
      const roomId = randomUUID(); roomIds.push(roomId); roomBranch.set(roomId, branchId);
      await pool.query(`INSERT INTO rooms(id,tenant_id,branch_id,code,name,capacity,status) VALUES($1,$2,$3,$4,$5,8,'ACTIVE')`, [roomId, tenantId, branchId, `B${b}-R${r}`, `Room ${r}`]);
    }
  }
  await pool.query(`INSERT INTO price_plans(id,tenant_id,code,name,status) VALUES($1,$2,'BENCH','Bench plan','ACTIVE')`, [planId, tenantId]);
  await pool.query(`INSERT INTO price_rules(id,tenant_id,price_plan_id,code,name,priority,amount_vnd,amount_unit) VALUES($1,$2,$3,'BASE','Base hourly',100,150000,'PER_HOUR')`, [randomUUID(), tenantId, planId]);
  await pool.query(`INSERT INTO tenant_no_deposit_confirmation_policies(tenant_id,channel,allowed,updated_by) VALUES($1,'PHONE',true,$2)`, [tenantId, userId]);
  // Historical confirmed occupancy: BOOKINGS_PER_ROOM_DAY two-hour slots per room per day over the past HISTORY_DAYS days (+ buffer).
  await pool.query(`INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
    SELECT gen_random_uuid(),$1,r.branch_id,r.id,'BOOKING',gen_random_uuid(),
      tstzrange(d + (s * interval '3 hours') + interval '10 hours', d + (s * interval '3 hours') + interval '12 hours 15 minutes','[)'),'CONFIRMED'
    FROM rooms r, generate_series(date_trunc('day', now()) - ($2::int * interval '1 day'), date_trunc('day', now()) - interval '1 day', interval '1 day') d,
      generate_series(0, $3::int - 1) s WHERE r.tenant_id=$1`, [tenantId, HISTORY_DAYS, BOOKINGS_PER_ROOM_DAY]);
  // Upcoming week: half of the rooms already booked in the evening peak.
  await pool.query(`INSERT INTO room_occupancy(id,tenant_id,branch_id,room_id,source_type,source_id,occupied_range,status)
    SELECT gen_random_uuid(),$1,r.branch_id,r.id,'BOOKING',gen_random_uuid(),
      tstzrange(d + interval '12 hours', d + interval '14 hours 15 minutes','[)'),'CONFIRMED'
    FROM (SELECT id,branch_id,row_number() OVER (ORDER BY id) n FROM rooms WHERE tenant_id=$1) r,
      generate_series(date_trunc('day', now()) + interval '1 day', date_trunc('day', now()) + interval '7 days', interval '1 day') d WHERE r.n % 2 = 0`, [tenantId]);
  const occupancyRows = Number((await pool.query('SELECT count(*) FROM room_occupancy')).rows[0].count);
  await pool.query('ANALYZE');

  const { NestFactory } = await import('@nestjs/core');
  const { ValidationPipe } = await import('@nestjs/common');
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/v1`.replace('[::1]', '127.0.0.1');
  const token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bench.owner@example.com', password: PASSWORD }) })).json()).accessToken as string;
  const headers = { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId, 'content-type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Sample & { json?: any }> => {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const ms = performance.now() - started;
    return { ms, status: response.status, json: text ? JSON.parse(text) : undefined };
  };
  const dayIso = (daysAhead: number, hour: number) => {
    const d = new Date(); d.setUTCHours(hour - 7, 0, 0, 0); d.setUTCDate(d.getUTCDate() + daysAhead); return d.toISOString();
  };

  log('Warm-up…');
  for (let i = 0; i < 20; i++) await call('GET', `/merchant/branches/${branchIds[i % BRANCHES]}/availability?startAt=${encodeURIComponent(dayIso(1 + (i % 6), 19))}&durationMinutes=120`);

  const results: ScenarioResult[] = [];
  log('Scenarios:');
  const searches = Array.from({ length: 600 }, (_, i) => ({ branch: branchIds[i % BRANCHES], startAt: dayIso(1 + (i % 7), 14 + (i % 9)), duration: 60 + 30 * (i % 4) }));
  results.push(summarize('availability-search', 20, await runPool(searches, 20, s => call('GET', `/merchant/branches/${s.branch}/availability?startAt=${encodeURIComponent(s.startAt)}&durationMinutes=${s.duration}`)), 1000));

  const quotes = Array.from({ length: 600 }, (_, i) => ({ room: roomIds[i % roomIds.length], startAt: dayIso(1 + (i % 7), 14 + (i % 9)) }));
  results.push(summarize('quote', 20, await runPool(quotes, 20, q => call('POST', `/merchant/rooms/${q.room}/quote`, { startAt: q.startAt, durationMinutes: 120 })), 500));

  // Distinct slots: day 20+ is empty, so every hold must succeed.
  const distinct = Array.from({ length: 600 }, (_, i) => ({ room: roomIds[i % roomIds.length], startAt: dayIso(20 + Math.floor(i / roomIds.length), 10 + 3 * (Math.floor(i / roomIds.length) % 4)) }));
  results.push(summarize('hold-distinct-slots', 20, await runPool(distinct, 20, h => call('POST', '/merchant/booking/holds', { roomId: h.room, channel: 'PHONE', startAt: h.startAt, durationMinutes: 120 }, { 'idempotency-key': randomUUID() })), 500));

  // Contention: 10 rounds × 100 concurrent attempts on one room/slot — exactly one 201 per round.
  const contention: Sample[] = [];
  let contentionStarted = performance.now(), roundsWithSingleWinner = 0;
  for (let round = 0; round < 10; round++) {
    const room = roomIds[round], startAt = dayIso(40 + round, 19);
    const attempts = await Promise.all(Array.from({ length: 100 }, () => call('POST', '/merchant/booking/holds', { roomId: room, channel: 'PHONE', startAt, durationMinutes: 120 }, { 'idempotency-key': randomUUID() })));
    contention.push(...attempts);
    if (attempts.filter(a => a.status === 201).length === 1 && attempts.filter(a => a.status === 409).length === 99) roundsWithSingleWinner++;
  }
  results.push(summarize('hold-contention-100x10', 100, { samples: contention, wallMs: performance.now() - contentionStarted }, 500, `${roundsWithSingleWinner}/10 rounds had exactly one 201 and 99 x 409`));

  // Full staff flow on distinct slots: hold → details (quote snapshot) → phone verification → confirm.
  const flowSamples: Record<string, Sample[]> = { hold: [], details: [], verify: [], confirm: [] };
  const flows = Array.from({ length: 100 }, (_, i) => ({ room: roomIds[i], startAt: dayIso(60 + Math.floor(i / 100), 18) }));
  contentionStarted = performance.now();
  let confirmedFlows = 0;
  await runPool(flows, 10, async f => {
    const hold = await call('POST', '/merchant/booking/holds', { roomId: f.room, channel: 'PHONE', startAt: f.startAt, durationMinutes: 120 }, { 'idempotency-key': randomUUID() });
    flowSamples.hold.push(hold);
    const id = hold.json?.id;
    const details = await call('POST', `/merchant/booking/holds/${id}/details`, { phone: '0912345678', expectedTotalAmountVnd: '300000' });
    flowSamples.details.push(details);
    const verify = await call('POST', `/merchant/booking/holds/${id}/phone-verification`);
    flowSamples.verify.push(verify);
    const confirm = await call('POST', `/merchant/booking/holds/${id}/confirm`, { cancellationTerms: 'Liên hệ cơ sở để hủy.' });
    flowSamples.confirm.push(confirm);
    if (confirm.status === 200) confirmedFlows++;
    return confirm;
  });
  const flowWall = performance.now() - contentionStarted;
  for (const step of Object.keys(flowSamples)) results.push(summarize(`staff-flow-${step}`, 10, { samples: flowSamples[step], wallMs: flowWall }, 500));

  const overlaps = Number((await pool.query(`SELECT count(*) FROM room_occupancy a JOIN room_occupancy b ON a.room_id=b.room_id AND a.id<b.id
    AND a.occupied_range && b.occupied_range WHERE a.status IN ('HELD','CONFIRMED','IN_USE','MAINTENANCE') AND b.status IN ('HELD','CONFIRMED','IN_USE','MAINTENANCE')`)).rows[0].count);
  const pgVersion = (await pool.query('SHOW server_version')).rows[0].server_version;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: `${platform()} ${release()}`, cpus: cpus().length, cpuModel: cpus()[0]?.model, memoryGb: Math.round(totalmem() / 1024 ** 3), postgres: pgVersion, note: 'App and PostgreSQL container on the same machine; single Node process; Docker Desktop' },
    dataset: { branches: BRANCHES, rooms: roomIds.length, occupancyRows, historyDays: HISTORY_DAYS, bookingsPerRoomDay: BOOKINGS_PER_ROOM_DAY, upcomingEveningPeakBookedShare: 0.5 },
    correctness: { activeOverlappingOccupancyPairs: overlaps, contentionRoundsWithSingleWinner: roundsWithSingleWinner, confirmedStaffFlows: confirmedFlows, staffFlows: flows.length },
    scenarios: results
  };
  log(`Correctness: overlapping active occupancy pairs=${overlaps}; contention single-winner rounds=${roundsWithSingleWinner}/10; confirmed staff flows=${confirmedFlows}/${flows.length}`);
  const output = process.env.BENCH_OUTPUT;
  if (output) { writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); log(`Report written to ${output}`); }
  else log(JSON.stringify(report, null, 2));

  await app.close();
  await pool.end();
  await postgres.stop();
  const failed = overlaps !== 0 || roundsWithSingleWinner !== 10 || confirmedFlows !== flows.length;
  process.exitCode = failed ? 1 : 0;
}

void main().catch((error: unknown) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
