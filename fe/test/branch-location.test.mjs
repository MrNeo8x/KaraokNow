import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, telHref, patchText } from '../src/lib/branch-location.ts';

test('hiển thị SĐT chi nhánh và link gọi', () => {
  assert.equal(formatPhone('+84989015619'), '0989 015 619');
  assert.equal(formatPhone('0989015619'), '0989 015 619');
  assert.equal(formatPhone('+6591234567'), '+6591234567');
  assert.equal(formatPhone(null), '');
  assert.equal(telHref('+84 989-015.619'), 'tel:+84989015619');
});

test('PATCH: không đổi thì bỏ trường, xoá thì gửi null', () => {
  assert.equal(patchText('  Số 1 Hàng Bài  ', 'Số 1 Hàng Bài'), undefined);
  assert.equal(patchText('', 'Số 1 Hàng Bài'), null);
  assert.equal(patchText('', null), undefined);
  assert.equal(patchText('Số 2 Tràng Tiền', null), 'Số 2 Tràng Tiền');
});
