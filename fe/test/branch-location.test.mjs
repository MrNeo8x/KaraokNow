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

test('giờ mở cửa: gửi cùng nhau, 24 giờ = null, không đổi thì bỏ', async () => {
  const { hoursPayload } = await import('../src/lib/branch-location.ts');
  assert.deepEqual(hoursPayload({ allDay: false, openingTime: '18:00', closingTime: '02:00' }), { openingTime: '18:00', closingTime: '02:00' });
  assert.equal(hoursPayload({ allDay: true, openingTime: '', closingTime: '' }), undefined);
  assert.deepEqual(hoursPayload({ allDay: true, openingTime: '', closingTime: '' }, { openingTime: '18:00', closingTime: '02:00' }), { openingTime: null, closingTime: null });
  assert.equal(hoursPayload({ allDay: false, openingTime: '18:00', closingTime: '02:00' }, { openingTime: '18:00', closingTime: '02:00' }), undefined);
  assert.match(hoursPayload({ allDay: false, openingTime: '18:00', closingTime: '' }).error, /cả giờ mở/);
  assert.match(hoursPayload({ allDay: false, openingTime: '18:00', closingTime: '18:00' }).error, /trùng/);
});
