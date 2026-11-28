import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reversalTypeOf, entrySign, balanceText } from '../src/lib/cash-account.ts';
import { can } from '../src/lib/permissions.ts';

test('chỉ đảo được cọc, tiền mặt, phụ thu chưa bị đảo', () => {
  assert.equal(reversalTypeOf({ kind: 'DEPOSIT', reversed: false }), 'HOLD_DEPOSIT');
  assert.equal(reversalTypeOf({ kind: 'CASH', reversed: false }), 'MANUAL_PAYMENT');
  assert.equal(reversalTypeOf({ kind: 'SURCHARGE', reversed: false }), 'SURCHARGE');
  assert.equal(reversalTypeOf({ kind: 'CASH', reversed: true }), null);
  assert.equal(reversalTypeOf({ kind: 'REVERSAL', reversed: false }), null);
  assert.equal(reversalTypeOf({ kind: 'REFUND', reversed: false }), null);
});

test('dấu và mô tả số dư', () => {
  assert.equal(entrySign('SURCHARGE'), '+'); assert.equal(entrySign('REFUND'), '−');
  assert.match(balanceText('50000'), /Còn thiếu 50\.000/);
  assert.match(balanceText('-20000'), /Thu dư 20\.000/);
  assert.equal(balanceText('0'), 'Đã khớp');
});

test('quyền đối soát theo PD-036', () => {
  assert.equal(can(['RECEPTIONIST'], 'surcharge.record'), true);
  assert.equal(can(['CASHIER'], 'money.reverse'), false);
  assert.equal(can(['BRANCH_MANAGER'], 'money.reverse'), true);
  assert.equal(can(['CASHIER'], 'cash.report'), true);
  assert.equal(can(['RECEPTIONIST'], 'cash.report'), false);
  assert.equal(can(['CASHIER'], 'deposit.resolve'), false);
});

test('số tiền không tách "₫" và không hiện "−0"', async () => {
  const { money, minus } = await import('../src/lib/cash-account.ts');
  assert.equal(money('1400000'), '1.400.000 ₫');
  assert.equal(minus('0'), '0 ₫');
  assert.equal(minus('250000'), '−250.000 ₫');
});
