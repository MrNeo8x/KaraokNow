import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhone, cleanBookingCode, formatBookingCode, prepareAttempt, isRetryable, readAttempt, readReceipt, save, clear, PUBLIC_HOLD_ATTEMPT_KEY, PUBLIC_HOLD_RECEIPT_KEY } from '../src/lib/public-booking.ts';

const body = { roomId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', startAt: '2036-01-01T18:00:00+07:00', durationMinutes: 120, phone: '0912345678', expectedTotalAmountVnd: '180000', termsVersion: '1' };
const key = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function memory() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }

test('làm sạch số điện thoại theo quy tắc backend', () => {
  assert.equal(cleanPhone(' 091 234-5678 '), '0912345678');
  assert.equal(cleanPhone('+84 (912) 345.678'), '+84912345678');
  assert.equal(cleanPhone('12345'), null);
  assert.equal(cleanPhone('09a2345678'), null);
});

test('mã đặt phòng 6 ký tự (PD-038) và mã cũ 32 hex', () => {
  assert.equal(cleanBookingCode(' k7m-4xq '), 'K7M4XQ');
  assert.equal(cleanBookingCode('K7M 4XQ'), 'K7M4XQ');
  assert.equal(cleanBookingCode('K0M4XQ'), null); // 0 is not in the alphabet
  assert.equal(cleanBookingCode('K7M4X'), null);
  assert.equal(cleanBookingCode(' ABCDEF0123456789abcdef0123456789 '), 'abcdef0123456789abcdef0123456789');
  assert.equal(cleanBookingCode('xyz'), null);
  assert.equal(formatBookingCode('K7M4XQ'), 'K7M 4XQ');
  assert.equal(formatBookingCode('abcdef0123456789abcdef0123456789'), 'abcdef0123456789abcdef0123456789');
});

test('giữ idempotency key khi body giống hệt, tạo key mới khi body đổi', () => {
  const stored = { key, body };
  assert.equal(prepareAttempt(stored, { ...body }, () => 'new').key, key);
  assert.equal(prepareAttempt(stored, { ...body, expectedTotalAmountVnd: '200000' }, () => 'new').key, 'new');
  assert.equal(prepareAttempt(stored, { ...body, email: 'a@b.vn' }, () => 'new').key, 'new');
  assert.equal(prepareAttempt(null, body, () => 'new').key, 'new');
});

test('chỉ 429, 5xx và lỗi mạng được thử lại cùng key', () => {
  assert.equal(isRetryable(undefined), true);
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(409), false);
  assert.equal(isRetryable(400), false);
});

test('lưu, đọc và bỏ qua dữ liệu khôi phục hỏng', () => {
  const store = memory();
  save(store, PUBLIC_HOLD_ATTEMPT_KEY, { key, body });
  assert.deepEqual(readAttempt(store), { key, body });
  store.setItem(PUBLIC_HOLD_ATTEMPT_KEY, '{broken');
  assert.equal(readAttempt(store), null);
  save(store, PUBLIC_HOLD_ATTEMPT_KEY, { key: 'x', body });
  assert.equal(readAttempt(store), null);
  clear(store, PUBLIC_HOLD_ATTEMPT_KEY);
  const receipt = { holdId: key, branchId: key, roomId: body.roomId, startAt: body.startAt, durationMinutes: 120, reservedEndAt: body.startAt, expiresAt: body.startAt, status: 'HELD', totalAmountVnd: '180000', termsVersion: '1', bookingCode: 'abcdef0123456789abcdef0123456789', phone: '0912345678' };
  save(store, PUBLIC_HOLD_RECEIPT_KEY, receipt);
  assert.deepEqual(readReceipt(store), receipt);
  save(store, PUBLIC_HOLD_RECEIPT_KEY, { ...receipt, bookingCode: 'short' });
  assert.equal(readReceipt(store), null);
});

test('biên nhận với mã 6 ký tự vẫn đọc lại được', () => {
  const store = memory(); const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const receipt = { holdId: id, branchId: id, roomId: body.roomId, startAt: body.startAt, durationMinutes: 120, reservedEndAt: body.startAt, expiresAt: body.startAt, status: 'HELD', totalAmountVnd: '180000', termsVersion: '1', bookingCode: 'K7M4XQ', phone: '0912345678' };
  save(store, PUBLIC_HOLD_RECEIPT_KEY, receipt);
  assert.deepEqual(readReceipt(store), receipt);
});
