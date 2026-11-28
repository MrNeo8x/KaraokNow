import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countMax, niceMax, ticks, labelIndices, heatLevel, compactVnd, percent, defaultRange, periodLabel } from '../src/lib/chart-math.ts';

test('trục: làm tròn giá trị lớn nhất và chia mốc', () => {
  assert.equal(niceMax([0, 3, 7]), 10); assert.equal(niceMax([140]), 200); assert.equal(niceMax([0]), 1); assert.equal(niceMax([4800000]), 5000000);
  assert.equal(countMax([0]), 4); assert.equal(countMax([0, 3, 7]), 12); assert.equal(countMax([140]), 200);
  assert.deepEqual(ticks(200, 4), [0, 50, 100, 150, 200]);
});

test('nhãn trục X: giữ đầu và cuối, không quá số nhãn', () => {
  assert.deepEqual(labelIndices(5, 8), [0, 1, 2, 3, 4]);
  const picked = labelIndices(30, 7); assert.equal(picked[0], 0); assert.equal(picked.at(-1), 29); assert.ok(picked.length <= 8);
});

test('heatmap: 0 là không có booking, giá trị lớn nhất là mức đậm nhất', () => {
  assert.equal(heatLevel(0, 10), 0); assert.equal(heatLevel(10, 10), 4); assert.equal(heatLevel(1, 10), 1);
});

test('định dạng tiền rút gọn, phần trăm, khoảng ngày và nhãn kỳ', () => {
  assert.equal(compactVnd(1250000), '1,25 tr'); assert.equal(compactVnd(12000), '12 k'); assert.equal(compactVnd(800), '800');
  assert.equal(percent(0.4567), '45,7%');
  assert.deepEqual(defaultRange(Date.parse('2026-11-28T10:00:00+07:00')), { from: '2026-10-30', to: '2026-11-28' });
  assert.equal(periodLabel('2026-11-24', 'week'), 'Tuần 24/11'); assert.equal(periodLabel('2026-11-01', 'month'), '11/2026');
});
