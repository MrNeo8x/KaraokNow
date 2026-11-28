import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipError, temporaryPasswordError, merchantCodeError, auditHasMore, currentSessionId, formatAge } from '../src/lib/admin.ts';

test('vai trò theo chi nhánh cần chi nhánh trừ khi có OWNER', () => {
  assert.match(membershipError({ roles: [], branchIds: [] }), /vai trò/);
  assert.match(membershipError({ roles: ['RECEPTIONIST'], branchIds: [] }), /chi nhánh/);
  assert.equal(membershipError({ roles: ['RECEPTIONIST'], branchIds: ['b'] }), null);
  assert.equal(membershipError({ roles: ['OWNER', 'CASHIER'], branchIds: [] }), null);
});

test('mật khẩu tạm và mã merchant theo quy tắc backend', () => {
  assert.match(temporaryPasswordError('short'), /12/);
  assert.equal(temporaryPasswordError('123456789012'), null);
  assert.equal(merchantCodeError('KARAOKE_HCM-1'), null);
  assert.ok(merchantCodeError('karaoke'));
  assert.ok(merchantCodeError('_ABC'));
  assert.ok(merchantCodeError('A'.repeat(51)));
});

test('audit còn trang khi trang hiện tại đầy', () => {
  assert.equal(auditHasMore(50, 50), true);
  assert.equal(auditHasMore(49, 50), false);
});

test('đọc sid từ access token, token hỏng trả null', () => {
  const token = `h.${btoa(JSON.stringify({ sub: 'u', sid: 's-1' })).replace(/=+$/, '')}.sig`;
  assert.equal(currentSessionId(token), 's-1');
  assert.equal(currentSessionId('broken'), null);
});

test('định dạng tuổi backlog', () => {
  assert.equal(formatAge(null), 'không có');
  assert.equal(formatAge(42), '42 giây');
  assert.equal(formatAge(3720), '1 giờ 2 phút');
  assert.equal(formatAge(200000), '2 ngày');
});

test('id user hiện tại từ token và kiểm tra lý do', async () => {
  const { currentUserId, reasonError } = await import('../src/lib/admin.ts');
  const token = `h.${btoa(JSON.stringify({ sub: 'user-1', sid: 's' })).replace(/=+$/, '')}.sig`;
  assert.equal(currentUserId(token), 'user-1');
  assert.equal(currentUserId('broken'), null);
  assert.match(reasonError('   '), /lý do/);
  assert.match(reasonError('x'.repeat(501)), /500/);
  assert.equal(reasonError('Khách yêu cầu khoá'), null);
});
