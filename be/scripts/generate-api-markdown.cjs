const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'docs/02-architecture/openapi.json');
const output = path.join(root, 'docs/02-architecture/api-reference.md');
const api = JSON.parse(fs.readFileSync(source, 'utf8'));
const lines = [
  '# Đặc tả API cho frontend', '',
  `Phiên bản contract: ${api.info.version}. File được tạo từ \`docs/02-architecture/openapi.json\`; chạy \`npm run api:docs\` trong \`be/\` sau khi cập nhật OpenAPI.`, '',
  'Base URL phát triển: `http://localhost:3000`. Mọi đường dẫn bên dưới đã bao gồm tiền tố `/v1`.', '',
  'API merchant yêu cầu `Authorization: Bearer <access_token>` và `X-Tenant-ID: <tenant-uuid>` khi endpoint khai báo. Quyền truy cập cụ thể do backend kiểm tra; không suy ra quyền từ việc hiển thị giao diện. Đăng nhập và refresh dùng endpoint trong nhóm auth.', '',
  'Body dùng `application/json` khi được khai báo. Các trường có dấu `?` trong JSON Schema là tùy chọn nếu không nằm trong `required`. Với PATCH price plan, special date và price rule, body thay toàn bộ trường có thể sửa; selector tùy chọn bị bỏ qua sẽ được xóa.', '',
  'Lỗi HTTP có dạng `{ "timestamp": "...", "path": "...", "correlationId": "...", "error": { "code": "...", "message": "...", "details": [] } }`; `details` chỉ có khi có nhiều lỗi. Không hiển thị thông tin lỗi 500 nội bộ.', '',
  '**Giới hạn contract:** nhiều endpoint chưa khai báo schema response trong OpenAPI; các mã trả về và schema bên dưới chỉ phản ánh phần đã khai báo, không chứng minh response rỗng. Kiểm tra backend hoặc chạy thử trước khi phụ thuộc vào trường response chưa được mô tả. Hold hiện chỉ dành cho nhân viên, chưa xác nhận booking, chưa lưu khách hàng hoặc snapshot giá; worker hết hạn phải chạy riêng.', '',
  '## Luồng hold cho nhân viên', '',
  'Gọi `POST /v1/merchant/booking/holds` với `Idempotency-Key` gồm 1–100 ký tự ASCII nhìn thấy được. Key được phân theo tenant và người dùng. Gửi lại cùng key và dữ liệu tương đương trả lại hold cũ; đổi dữ liệu với cùng key trả 409. Sau khi hold hết hạn, replay trả `EXPIRED`; muốn tạo lại dùng key mới.', '',
  'Ví dụ body:', '', '```json', JSON.stringify({roomId:'00000000-0000-4000-8000-000000000001',startAt:'2036-01-01T18:00:00+07:00',durationMinutes:60,channel:'WALK_IN'},null,2), '```', '',
  'Ví dụ response HTTP 201 (các giá trị chỉ để minh họa):', '', '```json', JSON.stringify({id:'00000000-0000-4000-8000-000000000002',branchId:'00000000-0000-4000-8000-000000000003',roomId:'00000000-0000-4000-8000-000000000001',channel:'WALK_IN',startAt:'2036-01-01T11:00:00.000Z',durationMinutes:60,bufferMinutes:15,reservedEndAt:'2036-01-01T12:15:00.000Z',expiresAt:'2035-12-31T11:15:00.000Z',status:'HELD'},null,2), '```', '',
  '`reservedEndAt` bao gồm buffer dọn phòng; `expiresAt` là hạn giữ phòng, không phải giờ kết thúc sử dụng phòng. HTTP 409 có thể là xung đột lịch hoặc key; đọc `error.message`. Worker `npm run holds:expire` cần chạy riêng; khi worker dừng, hold quá hạn vẫn có thể chiếm phòng đến khi được xử lý.', '',
  'Danh sách lễ tân: `GET /v1/merchant/branches/{branchId}/booking/holds?from=2036-01-01T00%3A00%3A00%2B07%3A00&to=2036-01-02T00%3A00%3A00%2B07%3A00&limit=50&offset=0`. `from`/`to` bắt buộc có múi giờ; lọc theo khoảng sử dụng phòng `[startAt, startAt + durationMinutes)` giao với `[from,to)`, không tính buffer. Response gồm `items`, `limit`, `offset`, `hasMore`. Danh sách chỉ bao gồm hold, không có booking đã xác nhận. Hold quá hạn được hiển thị `EXPIRED` theo giờ database; thao tác này không giải phóng occupancy. Phân trang offset có thể thay đổi khi có dữ liệu mới.', '',
  '## Endpoint', ''
];
for (const [url, methods] of Object.entries(api.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!['get','post','put','patch','delete'].includes(method)) continue;
    lines.push(`### ${method.toUpperCase()} ${url}`, '', `Nhóm: ${(op.tags || []).join(', ') || 'khác'}${op.summary ? ` · ${op.summary}` : ''}`, '');
    if (op.description) lines.push(op.description, '');
    const params = op.parameters || [];
    if (params.length) {
      lines.push('| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |', '|---|---|---|---|');
      for (const p of params) {
        const type = p.schema?.type || (p.schema?.$ref || '').split('/').pop() || 'string';
        lines.push(`| ${p.in} | \`${p.name}\` | ${p.required ? 'Có' : 'Không'} | ${type}${p.description ? ' — '+p.description.replace(/\|/g, '\\|').replace(/\n/g, ' ') : ''} |`);
      }
      lines.push('');
    }
    if (op.security?.length) lines.push(`Xác thực OpenAPI: ${op.security.map(s => Object.keys(s).join(' + ')).join(' hoặc ')}.`, '');
    if (op.requestBody) {
      lines.push(`Body ${op.requestBody.required ? 'bắt buộc' : 'tùy chọn'}:`, '');
      for (const [mime, content] of Object.entries(op.requestBody.content || {})) {
        lines.push(`\`${mime}\``, '', '```json', JSON.stringify(content.schema || {}, null, 2), '```', '');
      }
    }
    lines.push('Response được khai báo:', '', '| HTTP | Mô tả | Schema |', '|---|---|---|');
    for (const [status, response] of Object.entries(op.responses || {})) {
      const schema = response.content?.['application/json']?.schema;
      const schemaText = schema ? JSON.stringify(schema).replace(/\|/g, '\\|') : 'Chưa khai báo schema';
      lines.push(`| ${status} | ${(response.description || 'Chưa mô tả').replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${schemaText} |`);
    }
    lines.push('');
  }
}
lines.push('## Các schema request và response', '', 'Tham chiếu `$ref` trỏ tới tên schema trong danh sách sau. `required` là các trường bắt buộc.', '');
for (const [name, schema] of Object.entries(api.components?.schemas || {})) lines.push(`### ${name}`, '', '```json', JSON.stringify(schema, null, 2), '```', '');
const content = lines.join('\n');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) { console.error('API Markdown is stale. Run npm run api:docs.'); process.exitCode = 1; }
  else console.log('API Markdown is up to date.');
} else { fs.writeFileSync(output, content); console.log(`Wrote ${output}`); }
