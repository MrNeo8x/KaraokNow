import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingDates, openingWindow, quickSlots, fitsWindow, calendarStart, isPast, pickTime, initialChoice, durationOptions, nearestDuration } from '../src/lib/booking-time.ts';

const at = iso => Date.parse(iso);

test('ngày theo giờ Việt Nam, kể cả khi UTC vẫn là hôm trước', () => {
  const dates = upcomingDates(3, at('2026-11-27T01:30:00+07:00'));
  assert.deepEqual(dates.map(item => item.value), ['2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(dates[0].weekday, 'Hôm nay'); assert.equal(dates[2].weekday, 'CN');
});

test('khung qua nửa đêm: nút giờ, ngày lịch thật và giờ lẻ 15 phút', () => {
  const night = openingWindow('18:00', '02:00');
  assert.deepEqual(quickSlots(night, 120), ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00']);
  assert.deepEqual(calendarStart('2026-11-28', '00:00', night), { date: '2026-11-29', nextDay: true });
  assert.deepEqual(calendarStart('2026-11-28', '23:15', night), { date: '2026-11-28', nextDay: false });
  assert.equal(fitsWindow('23:45', 120, night), true);
  assert.equal(fitsWindow('00:15', 120, night), false); // ends 02:15, after closing
  assert.equal(fitsWindow('17:45', 60, night), false);  // before opening
  assert.equal(fitsWindow('20:10', 60, night), false);  // not on the 15-minute grid
});

test('mở 24 giờ: giữ nút 09:00–23:00, cho đặt qua nửa đêm', () => {
  const allDay = openingWindow(null, null);
  assert.equal(quickSlots(allDay, 120).length, 15);
  assert.equal(fitsWindow('23:30', 180, allDay), true);
  assert.equal(calendarStart('2026-11-28', '01:00', allDay).nextDay, false);
});

test('khung trong ngày: không có nút làm khoảng đặt vượt giờ đóng cửa', () => {
  const day = openingWindow('10:00', '22:00');
  assert.deepEqual(quickSlots(day, 180), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']);
  assert.equal(fitsWindow('19:15', 180, day), false);
});

test('bỏ giờ đã qua và chọn giờ mặc định hợp lệ', () => {
  const night = openingWindow('18:00', '02:00');
  const now = at('2026-11-28T21:10:00+07:00');
  assert.equal(isPast('2026-11-28', '21:00', night, now), true);
  assert.equal(isPast('2026-11-28', '00:00', night, now), false); // 00:00 of the 29th
  assert.equal(pickTime('2026-11-28', '20:00', night, 120, now), '22:00');
  assert.deepEqual(initialChoice(at('2026-11-28T23:20:00+07:00')), { date: '2026-11-29', time: '20:00' });
  assert.deepEqual(initialChoice(at('2026-11-28T10:00:00+07:00')), { date: '2026-11-28', time: '20:00' });
});

test('thời lượng theo chính sách merchant', () => {
  assert.deepEqual(durationOptions({ minDurationMinutes: 60, maxDurationMinutes: 180, durationStepMinutes: 30 }), [60, 90, 120, 150, 180]);
  assert.deepEqual(durationOptions({ minDurationMinutes: 90, maxDurationMinutes: 240, durationStepMinutes: 45 }), [90, 135, 180, 225]);
  assert.equal(nearestDuration([90, 135, 180, 225], 120), 135);
});
