import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdStorageKey, readHoldAttempt, writeHoldAttempt, clearHoldAttempt } from '../src/lib/hold-attempt.ts';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const branch = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = `header.${btoa(JSON.stringify({ sub: user }))}.signature`;
const sample = { key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', room: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'VIP', code: 'V1', capacity: 8 }, input: { roomId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', startAt: '2036-01-01T18:00:00+07:00', durationMinutes: 120, channel: 'WALK_IN' } };
function memory() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }

test('lưu và khôi phục nguyên key và body để retry sau reload', () => {
  const store = memory(); const key = holdStorageKey(token, tenant, branch);
  writeHoldAttempt(store, key, sample);
  assert.deepEqual(readHoldAttempt(store, key), sample);
  clearHoldAttempt(store, key);
  assert.equal(readHoldAttempt(store, key), null);
});

test('phân vùng theo người dùng, tenant và chi nhánh', () => {
  const store = memory();
  writeHoldAttempt(store, holdStorageKey(token, tenant, branch), sample);
  const otherToken = `header.${btoa(JSON.stringify({ sub: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }))}.signature`;
  assert.equal(readHoldAttempt(store, holdStorageKey(otherToken, tenant, branch)), null);
  assert.equal(readHoldAttempt(store, holdStorageKey(token, tenant, '11111111-1111-4111-8111-111111111111')), null);
  assert.equal(readHoldAttempt(store, holdStorageKey(token, '22222222-2222-4222-8222-222222222222', branch)), null);
  assert.throws(() => holdStorageKey('invalid', tenant, branch), /đăng nhập lại/);
});

test('dữ liệu hỏng hoặc bị thay đổi không được gửi lại', () => {
  const store = memory(); const key = holdStorageKey(token, tenant, branch);
  store.setItem(key, '{broken');
  assert.throws(() => readHoldAttempt(store, key), /không hợp lệ/);
  store.setItem(key, JSON.stringify({ ...sample, input: { ...sample.input, roomId: branch } }));
  assert.throws(() => readHoldAttempt(store, key), /không hợp lệ/);
});
