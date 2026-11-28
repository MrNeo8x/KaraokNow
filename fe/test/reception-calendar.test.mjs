import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOffset, zoneDay, dayWindow, mergeEntries, visibleEntries, placement } from '../src/lib/reception-calendar.ts';

test('múi giờ và cửa sổ 06:00 → 06:00 hôm sau theo chi nhánh', () => {
  assert.equal(zoneOffset('2026-11-28', 'Asia/Ho_Chi_Minh'), '+07:00');
  assert.equal(zoneOffset('2026-07-01', 'UTC'), '+00:00');
  assert.equal(zoneDay(Date.parse('2026-11-27T18:30:00Z'), 'Asia/Ho_Chi_Minh'), '2026-11-28');
  const window = dayWindow('2026-11-28', 'Asia/Ho_Chi_Minh');
  assert.equal(window.from, '2026-11-28T06:00:00+07:00'); assert.equal(window.to, '2026-11-29T06:00:00+07:00');
  assert.equal(window.endMs - window.startMs, 86_400_000);
});

const holds = [
  { id: 'h1', roomId: 'r1', startAt: '2026-11-28T19:00:00+07:00', durationMinutes: 120, reservedEndAt: '2026-11-28T21:15:00+07:00', status: 'HELD' },
  { id: 'h2', roomId: 'r1', startAt: '2026-11-28T15:00:00+07:00', durationMinutes: 60, reservedEndAt: '2026-11-28T16:15:00+07:00', status: 'CONFIRMED' },
  { id: 'h3', roomId: 'r2', startAt: '2026-11-28T10:00:00+07:00', durationMinutes: 60, reservedEndAt: '2026-11-28T11:15:00+07:00', status: 'EXPIRED' },
];
const bookings = [
  { id: 'b2', roomId: 'r1', startAt: '2026-11-28T15:00:00+07:00', durationMinutes: 60, reservedEndAt: '2026-11-28T16:15:00+07:00', status: 'CONFIRMED', customerPhone: '+84900000000' },
  { id: 'b3', roomId: 'r2', startAt: '2026-11-28T20:00:00+07:00', durationMinutes: 60, status: 'CANCELLED' },
];

test('ghép không trùng: bỏ hold CONFIRMED, giữ booking tương ứng, sắp theo giờ', () => {
  const entries = mergeEntries(holds, bookings);
  assert.deepEqual(entries.map(entry => entry.key), ['hold:h3', 'booking:b2', 'hold:h1', 'booking:b3']);
  assert.equal(entries.find(entry => entry.key === 'booking:b3').reservedEnd, Date.parse('2026-11-28T21:00:00+07:00'));
});

test('mặc định ẩn hold hết hạn, đã hủy và no-show', () => {
  const entries = mergeEntries(holds, bookings);
  assert.deepEqual(visibleEntries(entries, false).map(entry => entry.key), ['booking:b2', 'hold:h1']);
  assert.equal(visibleEntries(entries, true).length, 4);
});

test('vị trí trên timeline, đuôi buffer và cắt ngoài cửa sổ', () => {
  const { startMs, endMs } = dayWindow('2026-11-28', 'Asia/Ho_Chi_Minh');
  const [h1] = mergeEntries([holds[0]], []);
  const place = placement(h1, startMs, endMs);
  assert.equal(Math.round(place.left * 24 / 100 * 100) / 100, 13); // 19:00 is 13h after 06:00
  assert.equal(Math.round(place.width * 24 / 100 * 100) / 100, 2);
  assert.equal(Math.round(place.bufferWidth * 24 * 60 / 100), 15);
  const late = mergeEntries([{ ...holds[0], id: 'late', startAt: '2026-11-29T05:00:00+07:00', reservedEndAt: '2026-11-29T07:15:00+07:00' }], [])[0];
  assert.equal(placement(late, startMs, endMs).clippedEnd, true);
  const outside = mergeEntries([{ ...holds[0], id: 'out', startAt: '2026-11-29T08:00:00+07:00', reservedEndAt: '2026-11-29T10:15:00+07:00' }], [])[0];
  assert.equal(placement(outside, startMs, endMs), null);
});
