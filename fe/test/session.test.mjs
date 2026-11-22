import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, refreshDelay } from '../src/lib/session.ts';

test('chấp nhận token và thời hạn hợp lệ, lên lịch làm mới trước 60 giây', () => {
  const session = parseSession({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, mustChangePassword: false });
  assert.equal(refreshDelay(session.expiresIn), 840000);
  assert.equal(refreshDelay(30), 1000);
});

test('từ chối phản hồi thiếu token, trạng thái hoặc thời hạn bất thường', () => {
  const valid = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, mustChangePassword: false };
  for (const value of [null, {}, { ...valid, refreshToken: '' }, { ...valid, expiresIn: 0 }, { ...valid, expiresIn: NaN }, { ...valid, expiresIn: 90000 }, { ...valid, mustChangePassword: 'false' }]) assert.throws(() => parseSession(value));
});
