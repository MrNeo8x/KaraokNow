import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../src/lib/api.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('gửi đúng bearer, tenant và idempotency key với Headers', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/v1/merchant/booking/holds');
    assert.equal(options.headers.get('authorization'), 'Bearer token-example');
    assert.equal(options.headers.get('x-tenant-id'), 'tenant-example');
    assert.equal(options.headers.get('idempotency-key'), 'attempt-1');
    assert.equal(options.headers.get('content-type'), 'application/json');
    return Response.json({ id: 'hold-1', status: 'HELD' }, { status: 201 });
  };
  assert.deepEqual(await request('/merchant/booking/holds', { method: 'POST', headers: new Headers({ 'Idempotency-Key': 'attempt-1' }), body: '{}' }, 'token-example', 'tenant-example'), { id: 'hold-1', status: 'HELD' });
});

test('xử lý response 204 không có JSON', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await request('/auth/logout', { method: 'POST' }), undefined);
});

test('hiển thị validation details và correlation ID an toàn', async () => {
  globalThis.fetch = async () => Response.json({ correlationId: 'req-123', error: { code: 'BAD_REQUEST', message: 'name is required', details: ['name is required', 'code is invalid'] } }, { status: 400 });
  await assert.rejects(request('/merchant/branches'), error => {
    assert.equal(error.message, 'name is required · code is invalid · Mã tra cứu lỗi: req-123');
    return true;
  });
});

test('giữ nội dung conflict 409 và lấy correlation ID từ header', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'CONFLICT', message: 'Room is unavailable' } }, { status: 409, headers: { 'X-Correlation-ID': 'request-409' } });
  await assert.rejects(request('/merchant/booking/holds'), /Room is unavailable · Mã tra cứu lỗi: request-409/);
});

for (const [status, message] of [[401, 'Unauthorized'], [403, 'Forbidden'], [422, 'Invalid duration']]) {
  test(`truyền thông báo an toàn HTTP ${status}`, async () => {
    globalThis.fetch = async () => Response.json({ error: { message } }, { status });
    await assert.rejects(request('/merchant/branches'), error => error.message === message);
  });
}

test('không hiển thị thông tin lỗi 5xx và correlation ID không an toàn', async () => {
  globalThis.fetch = async () => Response.json({ correlationId: '<unsafe>', error: { message: 'secret SQL', details: ['secret stack'] } }, { status: 500 });
  await assert.rejects(request('/merchant/branches'), error => {
    assert.equal(error.message, 'Hệ thống tạm thời không thể xử lý yêu cầu. Vui lòng thử lại sau.');
    return true;
  });
});

test('không che lỗi mạng và hủy yêu cầu', async () => {
  const failure = new TypeError('network unavailable');
  globalThis.fetch = async () => { throw failure; };
  await assert.rejects(request('/merchant/branches'), error => error === failure);
  const aborted = new DOMException('aborted', 'AbortError');
  globalThis.fetch = async () => { throw aborted; };
  await assert.rejects(request('/merchant/branches', { signal: AbortSignal.abort() }), error => error === aborted);
});

test('lỗi API mang theo HTTP status để phân biệt 409/429', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many public booking requests' } }, { status: 429 });
  await assert.rejects(request('/public/booking/lookup', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.status, 429);
    assert.equal(error.name, 'ApiError');
    return true;
  });
});

test('dịch thông báo tranh chấp đồng thời và merchant bị khoá', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'CONFLICT', message: 'The resource was changed concurrently; retry the request' } }, { status: 409 });
  await assert.rejects(request('/merchant/booking/holds', { method: 'POST', body: '{}' }), error => { assert.match(error.message, /thay đổi đồng thời/); assert.equal(error.status, 409); return true; });
  globalThis.fetch = async () => Response.json({ error: { code: 'CONFLICT', message: 'Merchant is suspended; new holds are not accepted' } }, { status: 409 });
  await assert.rejects(request('/merchant/booking/holds', { method: 'POST', body: '{}' }), /bị Platform khoá/);
});

test('FormData không bị gắn Content-Type JSON; 413 báo vượt 4 MB', async () => {
  const { request: req } = await import('../src/lib/api.ts');
  globalThis.fetch = async (url, options) => { assert.equal(options.headers.has('content-type'), false); assert.ok(options.body instanceof FormData); return Response.json({ id: 'm1' }, { status: 201 }); };
  const form = new FormData(); form.append('file', new Blob(['x'], { type: 'image/png' }), 'a.png');
  assert.deepEqual(await req('/merchant/rooms/r/media/upload', { method: 'POST', body: form }, 't', 'x'), { id: 'm1' });
  globalThis.fetch = async () => new Response('Payload Too Large', { status: 413 });
  await assert.rejects(req('/merchant/catalog/logo', { method: 'PUT', body: form }), error => { assert.match(error.message, /4 MB/); assert.equal(error.status, 413); return true; });
});

test('requestBlob trả Blob và gửi kèm token', async () => {
  const { requestBlob } = await import('../src/lib/api.ts');
  globalThis.fetch = async (url, options) => { assert.equal(options.headers.get('authorization'), 'Bearer t'); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'content-type': 'application/pdf' } }); };
  const blob = await requestBlob('/merchant/documents/d/file', 't', 'x');
  assert.equal(blob.type, 'application/pdf'); assert.equal(blob.size, 4);
});

test('dịch thông báo quản lý user của Platform (PD-040)', async () => {
  const { friendlyMessage } = await import('../src/lib/api.ts');
  assert.equal(friendlyMessage('The merchant must keep at least one active Owner'), 'Merchant phải còn ít nhất một Owner đang hoạt động.');
  assert.match(friendlyMessage('Platform Admin cannot perform this action on their own account'), /chính tài khoản/);
  assert.match(friendlyMessage('Enable the user before issuing a temporary password'), /mở khoá/);
  assert.equal(friendlyMessage('Something else'), 'Something else');
});
