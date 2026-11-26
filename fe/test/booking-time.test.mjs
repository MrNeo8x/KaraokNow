import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingDates, slotOpen, firstSlot, initialChoice } from '../src/lib/booking-time.ts';

const at = iso => Date.parse(iso); // instants written with explicit +07:00

test('ngày theo giờ Việt Nam, kể cả khi UTC vẫn là hôm trước', () => {
  const dates = upcomingDates(3, at('2026-11-27T01:30:00+07:00'));
  assert.deepEqual(dates.map(item => item.value), ['2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(dates[0].weekday, 'Hôm nay'); assert.equal(dates[1].weekday, 'Ngày mai'); assert.equal(dates[2].weekday, 'CN');
});

test('khung giờ đã bắt đầu của hôm nay bị khoá, ngày khác thì mở', () => {
  const now = at('2026-11-26T22:10:00+07:00');
  assert.equal(slotOpen('2026-11-26', '22:00', now), false);
  assert.equal(slotOpen('2026-11-26', '23:00', now), true);
  assert.equal(slotOpen('2026-12-01', '09:00', now), true);
});

test('chọn mặc định: hôm nay nếu còn khung giờ, hết thì sang ngày mai', () => {
  assert.deepEqual(initialChoice(at('2026-11-26T10:00:00+07:00')), { date: '2026-11-26', time: '20:00' });
  assert.deepEqual(initialChoice(at('2026-11-26T22:10:00+07:00')), { date: '2026-11-26', time: '23:00' });
  assert.deepEqual(initialChoice(at('2026-11-26T23:20:00+07:00')), { date: '2026-11-27', time: '20:00' });
  assert.equal(firstSlot('2026-11-26', '20:00', at('2026-11-26T23:20:00+07:00')), null);
});
