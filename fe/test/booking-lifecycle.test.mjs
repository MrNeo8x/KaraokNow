import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedActions, parseVnd, depositAmountError, confirmationMode } from '../src/lib/booking-lifecycle.ts';

test('chỉ cho check-in/hủy từ CONFIRMED và check-out từ CHECKED_IN', () => {
  assert.deepEqual(allowedActions('CONFIRMED'), { checkIn: true, checkOut: false, outcome: true });
  assert.deepEqual(allowedActions('CHECKED_IN'), { checkIn: false, checkOut: true, outcome: false });
  for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) assert.deepEqual(allowedActions(status), { checkIn: false, checkOut: false, outcome: false });
});

test('đọc số tiền VND nguyên, có thể cho phép 0', () => {
  assert.equal(parseVnd('150.000'), 150000n);
  assert.equal(parseVnd('0'), null);
  assert.equal(parseVnd('0', { allowZero: true }), 0n);
  assert.equal(parseVnd('-5'), null);
  assert.equal(parseVnd('1.5e3'), null);
});

test('không cho ghi cọc vượt số còn thiếu', () => {
  assert.equal(depositAmountError('50000', '50000'), null);
  assert.match(depositAmountError('50001', '50000'), /vượt/);
  assert.match(depositAmountError('abc', '50000'), /nguyên dương/);
});

test('chọn đường xác nhận theo snapshot cọc', () => {
  assert.equal(confirmationMode(null, false), 'NO_SNAPSHOT');
  assert.equal(confirmationMode({ mode: 'NONE' }, false), 'NO_DEPOSIT');
  assert.equal(confirmationMode({ mode: 'FIXED' }, false), 'DEPOSIT_MISSING');
  assert.equal(confirmationMode({ mode: 'PERCENT' }, true), 'DEPOSIT_COVERED');
});
