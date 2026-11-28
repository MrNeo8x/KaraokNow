import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, imageTypeError, formatBytes, QUALITY_STEPS } from '../src/lib/image-compress.ts';

test('thu nhỏ theo cạnh dài, không phóng to', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(1080, 1920, 1600), { width: 900, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
});

test('kiểm tra loại ảnh và định dạng dung lượng', () => {
  assert.equal(imageTypeError({ type: 'image/png', size: 1000 }), null);
  assert.match(imageTypeError({ type: 'image/gif', size: 1000 }), /JPEG, PNG hoặc WebP/);
  assert.match(imageTypeError({ type: 'image/jpeg', size: 30 * 1024 * 1024 }), /quá lớn/);
  assert.equal(formatBytes(420 * 1024), '420 KB');
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3,5 MB');
  assert.ok(QUALITY_STEPS.every((value, index) => index === 0 || value < QUALITY_STEPS[index - 1]));
});
