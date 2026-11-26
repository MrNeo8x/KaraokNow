import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/lib/permissions.ts';

test('ma trận quyền khớp backend', () => {
  assert.equal(can(['RECEPTIONIST'], 'hold.create'), true);
  assert.equal(can(['CASHIER'], 'hold.create'), false);
  assert.equal(can(['RECEPTIONIST'], 'deposit.record'), false);
  assert.equal(can(['CASHIER'], 'deposit.record'), true);
  assert.equal(can(['CASHIER'], 'booking.checkInOut'), false);
  assert.equal(can(['RECEPTIONIST'], 'booking.outcome'), false);
  assert.equal(can(['BRANCH_MANAGER'], 'booking.outcome'), true);
  assert.equal(can(['RECEPTIONIST'], 'cash.access'), false);
  assert.equal(can(['BRANCH_MANAGER'], 'owner.admin'), false);
  assert.equal(can(['RECEPTIONIST', 'CASHIER'], 'deposit.record'), true);
});

test('chưa biết vai trò thì không ẩn, để backend quyết định', () => {
  assert.equal(can(null, 'owner.admin'), true);
  assert.equal(can([], 'hold.create'), false);
});
