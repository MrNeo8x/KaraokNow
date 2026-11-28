// API smoke test through the FE proxy (`/v1` rewrite) for every endpoint the FE calls. No browser required.
import { BASE, TENANT as T, OWNER, PLATFORM, api as call, reporter } from './lib.mjs';
const { log, finish } = reporter();
function check(name, cond, extra) { log(Boolean(cond), name, cond ? '' : JSON.stringify(extra)?.slice(0, 400)); }

// pages
for (const p of ['/booking', '/merchant', '/platform']) { const r = await fetch(BASE + p); check(`page ${p} 200`, r.status === 200, r.status); }

// platform
const pl = await call('POST', '/auth/login', { body: PLATFORM });
check('platform login', pl.status === 200 || pl.status === 201, pl);
const pt = pl.json.accessToken;
let r = await call('GET', '/platform/catalog/listings?status=ALL&limit=20&offset=0', { token: pt }); check('listings ALL', r.status === 200 && Array.isArray(r.json.items), r);
r = await call('GET', '/platform/merchants?status=ALL&limit=20&offset=0', { token: pt }); check('merchants list', r.status === 200 && Array.isArray(r.json.items), r);
const code = 'SMOKE_' + Date.now().toString(36).toUpperCase();
r = await call('POST', '/platform/merchants', { token: pt, body: { code, name: 'Smoke merchant', owner: { email: `smoke.${Date.now()}@karaokenow.local`, displayName: 'Smoke Owner', temporaryPassword: 'Smoke-password-2026' } } });
check('create merchant 201 accountCreated', r.status === 201 && r.json.owner?.accountCreated === true, r);
const smokeTenant = r.json.tenantId;
r = await call('POST', `/platform/merchants/${smokeTenant}/suspend`, { token: pt, body: {} }); check('suspend without reason 400', r.status === 400, r);
r = await call('POST', `/platform/merchants/${smokeTenant}/suspend`, { token: pt, body: { reason: 'smoke' } }); check('suspend merchant → INACTIVE', r.status === 200 && r.json.status === 'INACTIVE', r);
r = await call('POST', `/platform/merchants/${smokeTenant}/suspend`, { token: pt, body: { reason: 'smoke' } }); check('suspend replay 200', r.status === 200 && r.json.status === 'INACTIVE', r);
r = await call('GET', '/platform/merchants?status=INACTIVE&limit=100', { token: pt }); check('INACTIVE filter lists suspended', r.status === 200 && r.json.items.some(item => item.tenantId === smokeTenant), r);
r = await call('POST', `/platform/merchants/${smokeTenant}/reactivate`, { token: pt, body: { reason: 'smoke' } }); check('reactivate → ACTIVE', r.status === 200 && r.json.status === 'ACTIVE', r);
r = await call('POST', '/platform/merchants', { token: pt, body: { code, name: 'dup', owner: { email: 'x@karaokenow.local', displayName: 'x', temporaryPassword: 'Smoke-password-2026' } } });
check('duplicate merchant code 409', r.status === 409, r);
r = await call('POST', '/platform/merchants', { token: pt, body: { code: code + 'B', name: 'Existing owner', owner: { email: OWNER.email, displayName: 'x', temporaryPassword: 'Smoke-password-2026' } } });
check('existing email accountCreated=false', r.status === 201 && r.json.owner?.accountCreated === false, r);
r = await call('GET', '/auth/sessions', { token: pt }); check('platform sessions', r.status === 200 && Array.isArray(r.json), r);

// owner
const ol = await call('POST', '/auth/login', { body: OWNER });
check('owner login', ol.status === 200 || ol.status === 201, ol);
const ot = ol.json.accessToken;
r = await call('GET', '/platform/merchants', { token: ot }); check('owner forbidden on platform 403', r.status === 403, r);
r = await call('GET', '/merchant/catalog/publication', { token: ot, tenant: T }); check('publication get', r.status === 200 && typeof r.json.published === 'boolean', r);
const pub = r.json;
r = await call('PATCH', '/merchant/catalog/publication', { token: ot, tenant: T, body: { published: pub.published } }); check('publication patch same value', r.status === 200, r);
r = await call('GET', '/merchant/memberships', { token: ot, tenant: T }); check('memberships list array', r.status === 200 && Array.isArray(r.json), r);
const branches = (await call('GET', '/merchant/branches', { token: ot, tenant: T })).json;
const memberEmail = `smoke.staff.${Date.now()}@karaokenow.local`;
r = await call('POST', '/merchant/memberships', { token: ot, tenant: T, body: { email: memberEmail, displayName: 'Smoke staff', temporaryPassword: 'Smoke-password-2026', roles: ['RECEPTIONIST'], branchIds: [] } });
check('receptionist without branch 400', r.status === 400, r);
r = await call('POST', '/merchant/memberships', { token: ot, tenant: T, body: { email: memberEmail, displayName: 'Smoke staff', temporaryPassword: 'Smoke-password-2026', roles: ['RECEPTIONIST'], branchIds: [branches[0].id] } });
check('create membership', r.status === 201 && r.json.roles?.includes('RECEPTIONIST'), r);
const mid = r.json.id;
r = await call('PATCH', `/merchant/memberships/${mid}`, { token: ot, tenant: T, body: { status: 'INACTIVE' } }); check('deactivate membership', r.status === 200 && r.json.status === 'INACTIVE', r);
r = await call('GET', '/merchant/audit-logs?limit=5&offset=0', { token: ot, tenant: T }); check('audit array ≤ limit', r.status === 200 && Array.isArray(r.json) && r.json.length <= 5 && r.json[0]?.action, r);
r = await call('GET', '/merchant/booking/hold-expiry/backlog', { token: ot, tenant: T }); check('hold backlog', r.status === 200 && typeof r.json.overdueCount === 'string', r);
r = await call('GET', '/merchant/notifications/outbox/backlog', { token: ot, tenant: T }); check('outbox backlog', r.status === 200 && typeof r.json.pendingCount === 'string', r);
r = await call('GET', '/auth/sessions', { token: ot }); check('owner sessions', r.status === 200, r);
r = await call('GET', '/merchant/booking/overtime-policy', { token: ot, tenant: T }); check('overtime policy get', r.status === 200 && Number.isInteger(r.json.graceMinutes), r);
const grace = r.json.graceMinutes;
r = await call('PATCH', '/merchant/booking/overtime-policy', { token: ot, tenant: T, body: { graceMinutes: 61 } }); check('overtime grace 61 → 400', r.status === 400, r);
r = await call('PATCH', '/merchant/booking/overtime-policy', { token: ot, tenant: T, body: { graceMinutes: grace } }); check('overtime policy patch (giữ nguyên giá trị)', r.status === 200 && r.json.graceMinutes === grace && r.json.configured === true, r);
r = await call('GET', '/merchant/catalog/publication', { token: ot, tenant: T }); check('publication có tenantStatus ACTIVE', r.json.tenantStatus === 'ACTIVE', r);

// public booking flow
const pb = await call('GET', '/public/branches?limit=100'); check('public branches', pb.status === 200, pb);
const branch = pb.json.items?.find(b => b.id === '10000000-0000-4000-8000-000000000004') ?? pb.json.items?.[0];
if (branch) {
  const terms = (await call('GET', `/public/branches/${branch.id}/booking-terms`)).json;
  check('public terms', terms && 'configured' in terms, terms);
  const day = new Date(Date.now() + (20 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
  const startAt = `${day}T${String(10 + Math.floor(Math.random() * 8)).padStart(2, '0')}:00:00+07:00`;
  const av = await call('GET', `/public/branches/${branch.id}/availability?startAt=${encodeURIComponent(startAt)}&durationMinutes=120`);
  check('public availability', av.status === 200, av);
  const room = av.json.rooms?.[0];
  if (room && terms.configured) {
    const q = await call('POST', `/public/rooms/${room.id}/quote`, { body: { startAt, durationMinutes: 120 } }); check('public quote', q.status === 200 || q.status === 201, q);
    const phone = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const body = { roomId: room.id, startAt, durationMinutes: 120, phone, expectedTotalAmountVnd: q.json.totalAmountVnd, termsVersion: terms.version };
    const key = crypto.randomUUID();
    const h = await call('POST', '/public/booking/holds', { body, headers: { 'Idempotency-Key': key } }); check('public hold 201 + code + depositRequiredVnd', h.status === 201 && /^[a-f0-9]{32}$/.test(h.json.bookingCode) && typeof h.json.depositRequiredVnd === 'string', h);
    const h2 = await call('POST', '/public/booking/holds', { body, headers: { 'Idempotency-Key': key } }); check('idempotent replay same code', [200, 201].includes(h2.status) && h2.json.bookingCode === h.json.bookingCode, h2);
    const h3 = await call('POST', '/public/booking/holds', { body: { ...body, termsVersion: String(Number(terms.version) + 1) }, headers: { 'Idempotency-Key': crypto.randomUUID() } }); check('stale terms 409', h3.status === 409, h3);
    const h4 = await call('POST', '/public/booking/holds', { body: { ...body, expectedTotalAmountVnd: '1' }, headers: { 'Idempotency-Key': crypto.randomUUID() } }); check('wrong price 409', h4.status === 409, h4);
    const lk = await call('POST', '/public/booking/lookup', { body: { phone: '+84' + phone.slice(1), bookingCode: h.json.bookingCode } }); check('lookup with +84 form', lk.status === 200 && lk.json.holdId === h.json.holdId && 'bookingStatus' in lk.json, lk);
    const lk404 = await call('POST', '/public/booking/lookup', { body: { phone, bookingCode: 'f'.repeat(32) } }); check('lookup wrong code 404', lk404.status === 404, lk404);

    // staff path: deposits, verify, confirm, check-in/out
    const holdId = h.json.holdId;
    let d = await call('GET', `/merchant/booking/holds/${holdId}/deposits`, { token: ot, tenant: T }); check('hold deposits status', d.status === 200 && 'remainingVnd' in d.json, d);
    if (d.json.depositPolicySnapshot && d.json.depositPolicySnapshot.mode !== 'NONE' && BigInt(d.json.remainingVnd) > 0n) {
      const over = await call('POST', `/merchant/booking/holds/${holdId}/deposits`, { token: ot, tenant: T, body: { method: 'CASH', amountVnd: String(BigInt(d.json.remainingVnd) + 1n) }, headers: { 'Idempotency-Key': crypto.randomUUID() } }); check('over-remaining deposit 409', over.status === 409, over);
      const dk = crypto.randomUUID();
      const dep = await call('POST', `/merchant/booking/holds/${holdId}/deposits`, { token: ot, tenant: T, body: { method: 'CASH', amountVnd: d.json.remainingVnd }, headers: { 'Idempotency-Key': dk } }); check('record deposit', dep.status === 200 || dep.status === 201, dep);
      const depR = await call('POST', `/merchant/booking/holds/${holdId}/deposits`, { token: ot, tenant: T, body: { method: 'CASH', amountVnd: d.json.remainingVnd }, headers: { 'Idempotency-Key': dk } }); check('deposit replay same id', depR.json.id === dep.json.id, depR);
      d = await call('GET', `/merchant/booking/holds/${holdId}/deposits`, { token: ot, tenant: T }); check('deposit satisfied', d.json.depositSatisfied === true, d.json);
    } else console.log('… deposit policy NONE for this channel; deposit path skipped', d.json.depositPolicySnapshot);
    const v = await call('POST', `/merchant/booking/holds/${holdId}/phone-verification`, { token: ot, tenant: T }); check('phone verification', [200, 201].includes(v.status), v);
    const c = await call('POST', `/merchant/booking/holds/${holdId}/confirm`, { token: ot, tenant: T, body: { cancellationTerms: terms.terms } }); check('confirm', [200, 201].includes(c.status), c);
    if (c.json.id) {
      const bid = c.json.id;
      const co = await call('POST', `/merchant/booking/bookings/${bid}/check-out`, { token: ot, tenant: T }); check('check-out before check-in 409', co.status === 409, co);
      const ci = await call('POST', `/merchant/booking/bookings/${bid}/check-in`, { token: ot, tenant: T }); check('check-in', ci.status === 200 && ci.json.status === 'CHECKED_IN', ci);
      const oc = await call('POST', `/merchant/booking/bookings/${bid}/outcome`, { token: ot, tenant: T, body: { type: 'NO_SHOW', note: 'smoke' } }); check('outcome after check-in 409', oc.status === 409, oc);
      const co2 = await call('POST', `/merchant/booking/bookings/${bid}/check-out`, { token: ot, tenant: T }); check('check-out', co2.status === 200 && co2.json.status === 'COMPLETED', co2);
      check('check-out ghi lateMinutes/overtimeMinutes', Number.isInteger(co2.json.lateMinutes) && Number.isInteger(co2.json.overtimeMinutes), co2.json);
      let acc = await call('GET', `/merchant/booking/bookings/${bid}/account`, { token: ot, tenant: T }); check('account: phải thu = giá, đã thu = cọc', acc.status === 200 && acc.json.dueVnd === q.json.totalAmountVnd && acc.json.paidVnd === acc.json.depositsVnd, acc.json);
      const sk = crypto.randomUUID();
      const sur = await call('POST', `/merchant/booking/bookings/${bid}/surcharges`, { token: ot, tenant: T, headers: { 'Idempotency-Key': sk }, body: { amountVnd: '30000', reason: 'smoke nước uống' } }); check('surcharge 200', sur.status === 200 && sur.json.amountVnd === '30000', sur);
      const sur2 = await call('POST', `/merchant/booking/bookings/${bid}/surcharges`, { token: ot, tenant: T, headers: { 'Idempotency-Key': sk }, body: { amountVnd: '30000', reason: 'smoke nước uống' } }); check('surcharge replay cùng id', sur2.json.id === sur.json.id, sur2);
      const pay = await call('POST', `/merchant/booking/bookings/${bid}/manual-payments`, { token: ot, tenant: T, headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { method: 'CASH', amountVnd: '40000' } });
      acc = await call('GET', `/merchant/booking/bookings/${bid}/account`, { token: ot, tenant: T }); check('account: phụ thu vào phải thu, tiền mặt vào đã thu', BigInt(acc.json.dueVnd) === BigInt(q.json.totalAmountVnd) + 30000n && acc.json.cashVnd === '40000', acc.json);
      const rev = await call('POST', '/merchant/booking/money-reversals', { token: ot, tenant: T, body: { entryType: 'MANUAL_PAYMENT', entryId: pay.json.id, reason: 'smoke ghi nhầm' } }); check('reversal 200', rev.status === 200 && rev.json.amountVnd === '40000', rev);
      const rev2 = await call('POST', '/merchant/booking/money-reversals', { token: ot, tenant: T, body: { entryType: 'MANUAL_PAYMENT', entryId: pay.json.id, reason: 'lý do khác' } }); check('reversal lần hai lý do khác → 409', rev2.status === 409, rev2);
      acc = await call('GET', `/merchant/booking/bookings/${bid}/account`, { token: ot, tenant: T }); check('account: khoản bị đảo không còn tính', acc.json.cashVnd === '0' && acc.json.entries.some(entry => entry.kind === 'CASH' && entry.reversed), acc.json);
      const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const rep = await call('GET', `/merchant/branches/${branch.id}/cash-report?date=${day}`, { token: ot, tenant: T }); check('cash report hôm nay', rep.status === 200 && typeof rep.json.totals?.netCashVnd === 'string', rep);
      const bad = await call('GET', `/merchant/branches/${branch.id}/cash-report?date=2026-13-40`, { token: ot, tenant: T }); check('cash report ngày sai → 422', bad.status === 422, bad);
      const unr = await call('GET', `/merchant/branches/${branch.id}/booking/unresolved-deposits?limit=5`, { token: ot, tenant: T }); check('unresolved deposits list', unr.status === 200 && Array.isArray(unr.json.items), unr);
      const lk2 = await call('POST', '/public/booking/lookup', { body: { phone, bookingCode: h.json.bookingCode } }); check('lookup bookingStatus COMPLETED', lk2.json.bookingStatus === 'COMPLETED', lk2);
    }
  } else console.log('… no room or terms not configured; public flow skipped', { room: !!room, terms });
} else console.log('… no public branch (catalog not approved?)');
finish();
