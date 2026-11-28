import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesLeft, supportHref, supportTenantFromSearch } from '../src/lib/support.ts';
import { isMerchantWrite, request, setReadOnlyGuard } from '../src/lib/api.ts';

test('support tenant comes only from a UUID query parameter', () => {
  assert.equal(supportTenantFromSearch('?support=10000000-0000-4000-8000-000000000001'), '10000000-0000-4000-8000-000000000001');
  assert.equal(supportTenantFromSearch('?support=ABCDEF00-0000-4000-8000-000000000001&x=1'), 'abcdef00-0000-4000-8000-000000000001');
  assert.equal(supportTenantFromSearch('?support=../platform'), null);
  assert.equal(supportTenantFromSearch(''), null);
  assert.equal(supportHref('a b'), '/merchant?support=a%20b');
});

test('only merchant writes are blocked in a read-only session', () => {
  assert.equal(isMerchantWrite('/merchant/branches', 'POST'), true);
  assert.equal(isMerchantWrite('/merchant/branches/1', 'patch'), true);
  assert.equal(isMerchantWrite('/merchant/branches'), false);
  assert.equal(isMerchantWrite('/merchant/reports/bookings?format=csv', 'GET'), false);
  assert.equal(isMerchantWrite('/platform/support-sessions/1/end', 'POST'), false);
  assert.equal(isMerchantWrite('/auth/refresh', 'POST'), false);
});

test('minutes left rounds up and stops at zero', () => {
  const now = Date.parse('2026-11-28T10:00:00Z');
  assert.equal(minutesLeft('2026-11-28T11:00:00Z', now), 60);
  assert.equal(minutesLeft('2026-11-28T10:00:30Z', now), 1);
  assert.equal(minutesLeft('2026-11-28T09:59:00Z', now), 0);
});

test('read-only guard rejects merchant writes before any fetch', async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
  try {
    setReadOnlyGuard(true);
    await assert.rejects(request('/merchant/branches', { method: 'POST', body: '{}' }, 't', 'x'), error => error.status === 403 && /chỉ được xem/.test(error.message));
    await request('/merchant/branches', {}, 't', 'x'); await request('/platform/support-sessions/1/end', { method: 'POST' }, 't');
    assert.equal(calls, 2);
  } finally { setReadOnlyGuard(false); globalThis.fetch = original; }
});
