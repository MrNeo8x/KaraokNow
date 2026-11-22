import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositPayload } from '../src/lib/deposit-policy.ts';

test('NONE xóa số tiền và tỷ lệ cũ', () => assert.deepEqual(depositPayload('NONE', '500', '10'), { mode: 'NONE', fixedAmountVnd: null, percent: null }));
test('FIXED giữ nguyên số tiền lớn dạng chuỗi, không dùng số thực', () => {
  assert.deepEqual(depositPayload('FIXED', '9223372036854775807', '10'), { mode: 'FIXED', fixedAmountVnd: '9223372036854775807', percent: null });
  for (const amount of ['0', '01', '-1', '1.5', '9223372036854775808']) assert.throws(() => depositPayload('FIXED', amount, ''));
});
test('PERCENT chấp nhận > 0 đến 100 với tối đa bốn chữ số thập phân', () => {
  for (const value of ['0.0001', '25.1234', '100.0000']) assert.equal(depositPayload('PERCENT', '', value).percent, value);
  for (const value of ['0', '100.0001', '1.00001', '-1', 'abc']) assert.throws(() => depositPayload('PERCENT', '', value));
});
