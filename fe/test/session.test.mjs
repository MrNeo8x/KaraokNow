import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, refreshDelay, classifyRefresh, cookieRefresh, cookieLogout, autoTenant, readLastTenant, rememberTenant, forgetTenant } from '../src/lib/session.ts';

test('chấp nhận token và thời hạn hợp lệ, không giữ refresh token', () => {
  const session = parseSession({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, mustChangePassword: false });
  assert.equal(refreshDelay(session.expiresIn), 840000);
  assert.equal(refreshDelay(30), 1000);
  assert.equal('refreshToken' in session, false);
});

test('từ chối phản hồi thiếu token, trạng thái hoặc thời hạn bất thường', () => {
  const valid = { accessToken: 'access', expiresIn: 900, mustChangePassword: false };
  for (const value of [null, {}, { ...valid, accessToken: '' }, { ...valid, expiresIn: 0 }, { ...valid, expiresIn: NaN }, { ...valid, expiresIn: 90000 }, { ...valid, mustChangePassword: 'false' }]) assert.throws(() => parseSession(value));
});

test('phân loại kết quả refresh: 401 đăng xuất, 409/503/mạng thử lại', () => {
  assert.equal(classifyRefresh(200), 'ok');
  assert.equal(classifyRefresh(401), 'signed-out');
  assert.equal(classifyRefresh(409), 'retry');
  assert.equal(classifyRefresh(503), 'retry');
  assert.equal(classifyRefresh(null), 'retry');
});

test('refresh bằng cookie: gửi X-KN-Session, body rỗng, cùng origin', async () => {
  const result = await cookieRefresh(async (url, options) => {
    assert.equal(url, '/v1/auth/refresh'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.headers['X-KN-Session'], '1'); assert.equal(options.body, '{}');
    return Response.json({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, mustChangePassword: false });
  });
  assert.equal(result.kind, 'session'); assert.equal(result.session.accessToken, 'a');
  assert.equal((await cookieRefresh(async () => new Response(null, { status: 401 }))).kind, 'signed-out');
  assert.equal((await cookieRefresh(async () => new Response(null, { status: 503 }))).kind, 'retry');
  assert.equal((await cookieRefresh(async () => { throw new TypeError('offline'); })).kind, 'retry');
  assert.equal(await cookieLogout(async () => new Response(null, { status: 204 })), true);
  assert.equal(await cookieLogout(async () => { throw new TypeError('offline'); }), false);
});

test('tự chọn merchant khi chỉ có một hoặc merchant đã nhớ còn trong danh sách', () => {
  const a = { tenantId: 'a', tenantName: 'A', tenantStatus: 'ACTIVE', roles: ['OWNER'] }; const b = { ...a, tenantId: 'b', tenantName: 'B' };
  assert.equal(autoTenant([a], null), 'a');
  assert.equal(autoTenant([a, b], 'b'), 'b');
  assert.equal(autoTenant([a, b], 'gone'), null);
  assert.equal(autoTenant([], 'a'), null);
  const data = new Map(); const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  rememberTenant(store, 'b'); assert.equal(readLastTenant(store), 'b'); forgetTenant(store); assert.equal(readLastTenant(store), null);
  assert.equal(readLastTenant(null), null);
});
