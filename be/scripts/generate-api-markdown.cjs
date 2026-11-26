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
  '**Giới hạn contract:** nhiều endpoint chưa khai báo schema response trong OpenAPI; các mã trả về và schema bên dưới chỉ phản ánh phần đã khai báo, không chứng minh response rỗng. Hold và xác nhận booking hiện chỉ dành cho nhân viên; xác nhận chỉ hỗ trợ trường hợp không cọc đủ điều kiện. Worker hết hạn phải chạy riêng.', '',
  '## Luồng hold cho nhân viên', '',
  'Gọi `POST /v1/merchant/booking/holds` với `Idempotency-Key` gồm 1–100 ký tự ASCII nhìn thấy được. Key được phân theo tenant và người dùng. Gửi lại cùng key và dữ liệu tương đương trả lại hold cũ; đổi dữ liệu với cùng key trả 409. Sau khi hold hết hạn, replay trả `EXPIRED`; muốn tạo lại dùng key mới.', '',
  'Ví dụ body:', '', '```json', JSON.stringify({roomId:'00000000-0000-4000-8000-000000000001',startAt:'2036-01-01T18:00:00+07:00',durationMinutes:60,channel:'WALK_IN'},null,2), '```', '',
  'Ví dụ response HTTP 201 (các giá trị chỉ để minh họa):', '', '```json', JSON.stringify({id:'00000000-0000-4000-8000-000000000002',branchId:'00000000-0000-4000-8000-000000000003',roomId:'00000000-0000-4000-8000-000000000001',channel:'WALK_IN',startAt:'2036-01-01T11:00:00.000Z',durationMinutes:60,bufferMinutes:15,reservedEndAt:'2036-01-01T12:15:00.000Z',expiresAt:'2035-12-31T11:15:00.000Z',status:'HELD'},null,2), '```', '',
  '`reservedEndAt` bao gồm buffer dọn phòng; `expiresAt` là hạn giữ phòng, không phải giờ kết thúc sử dụng phòng. HTTP 409 có thể là xung đột lịch hoặc key; đọc `error.message`. Worker `npm run holds:expire` cần chạy riêng; khi worker dừng, hold quá hạn vẫn có thể chiếm phòng đến khi được xử lý.', '',
  'Sau khi hiển thị quote và tạo hold, gọi `POST /v1/merchant/booking/holds/{id}/details` với `{ "phone": "0912345678", "email": "guest@example.com", "expectedTotalAmountVnd": "150000" }`; email tùy chọn, tổng tiền là chuỗi `priceSnapshot.totalAmountVnd` từ quote đã hiển thị. Backend tính lại giá và trả 409 nếu tổng tiền khác hoặc hold hết hạn; khi giá đổi cần báo giá lại. Thông tin và snapshot được ghi một lần, gửi lại cùng dữ liệu trả kết quả đã lưu.', '',
  'Sau khi nhân viên thực sự gọi và xác minh số điện thoại, gọi `POST /v1/merchant/booking/holds/{id}/phone-verification` (không cần body). Response trả `phoneVerifiedAt` và `phoneVerifiedBy`; gọi lại khi hold còn hiệu lực trả cùng kết quả. Chưa có số điện thoại hoặc hold quá hạn trả 409. Đây là ghi nhận của nhân viên, không phải xác minh tự động và không xác nhận booking.', '',
  'Xác nhận không cọc cho nhân viên: `POST /v1/merchant/booking/holds/{id}/confirm` với `{ "cancellationTerms": "Điều khoản hủy đã hiển thị cho khách" }`. Cần hold còn hiệu lực, đã lưu liên hệ và snapshot giá, đã ghi nhận xác minh điện thoại, chế độ cọc của kênh là NONE và cấu hình cho phép xác nhận không cọc là `allowed: true`. Response 200 chứa booking `CONFIRMED`, ID, snapshot giá, điều khoản và snapshot chính sách. Gửi lại cùng hold và cùng điều khoản trả cùng booking; điều khoản khác trả 409. Lưu booking ID và đọc lại tại `GET /v1/merchant/booking/bookings/{id}`. API chưa hỗ trợ trường hợp có cọc, check-in/out, thanh toán hoặc đặt phòng công khai.', '',
  'Danh sách lễ tân: `GET /v1/merchant/branches/{branchId}/booking/holds?from=2036-01-01T00%3A00%3A00%2B07%3A00&to=2036-01-02T00%3A00%3A00%2B07%3A00&limit=50&offset=0`. `from`/`to` bắt buộc có múi giờ; lọc theo khoảng sử dụng phòng `[startAt, startAt + durationMinutes)` giao với `[from,to)`, không tính buffer. Response gồm `items`, `limit`, `offset`, `hasMore`. Danh sách chỉ bao gồm hold, không có booking đã xác nhận. Hold quá hạn được hiển thị `EXPIRED` theo giờ database; thao tác này không giải phóng occupancy. Phân trang offset có thể thay đổi khi có dữ liệu mới.', '',
  'Lịch booking: `GET /v1/merchant/branches/{branchId}/booking/bookings?from=...&to=...&limit=50&offset=0` trả booking theo khoảng sử dụng giao với `[from,to)`, không bao gồm buffer; response `{items,limit,offset,hasMore}`. Danh sách hold riêng có thể chứa hold đã `CONFIRMED`; FE nên loại bản ghi này khi ghép hai danh sách để tránh hiển thị hai lần.', '',
  'Ghi nhận tiền mặt: `POST /v1/merchant/booking/bookings/{id}/manual-payments` với `Idempotency-Key` và body `{ "method": "CASH", "amountVnd": "30000" }`, `note` tùy chọn. Gửi lại cùng key cùng body trả cùng giao dịch; thay đổi body trả 409. Owner, Branch Manager, Cashier thuộc chi nhánh có thể đọc danh sách và ghi. `GET` cùng đường dẫn có `limit`/`offset`; `GET .../{id}/manual-payments/summary` trả `{ "totalRecordedVnd": "120000", "paymentCount": 2 }` với số nguyên VND dạng chuỗi chính xác. Đây là tổng khoản đã ghi nhận, không tự xác nhận đã thu đủ, không có hoàn tiền/đảo giao dịch hoặc đối soát sổ quỹ.', '',
  'Catalog khách: Owner dùng `GET/PATCH /v1/merchant/catalog/publication` để yêu cầu công bố toàn bộ chi nhánh/phòng hoạt động của merchant; `platformApproved` là trạng thái duyệt độc lập, Owner không thể sửa. Chỉ merchant vừa yêu cầu công bố vừa được platform duyệt mới xuất hiện tại `GET /v1/public/branches` và `GET /v1/public/branches/{id}/rooms`. Khách có thể tìm phòng trống bằng `GET /v1/public/branches/{id}/availability?startAt=...&durationMinutes=...` và báo giá bằng `POST /v1/public/rooms/{id}/quote`; hai API dùng đúng duration, buffer, occupancy và price rule của merchant. API duyệt platform và guest hold/booking chưa có; availability/quote không giữ phòng.', '',
  'Điều khoản UAT công khai: Owner dùng `GET/PATCH /v1/merchant/catalog/public-booking-terms` để lưu đúng một nội dung tối đa 5.000 ký tự; mỗi lần cập nhật tăng `version` và được audit nhưng audit không sao chép nội dung. Khách đọc tại `GET /v1/public/branches/{branchId}/booking-terms` chỉ khi branch thuộc merchant đã publish và được platform duyệt. FE phải gửi lại đúng version trong public hold.', '',
  'Public hold UAT: `POST /v1/public/booking/holds` cần `Idempotency-Key` và body `{roomId,startAt,durationMinutes,phone,email?,expectedTotalAmountVnd,termsVersion}`. Backend yêu cầu room thuộc merchant published/platform-approved, tính lại giá, đối chiếu version điều khoản, chiếm phòng nguyên tử với buffer và dùng TTL kênh `WEB`. Response trả `holdId`, thời gian, `status`, tổng tiền, terms version và `bookingCode` 128-bit. Replay cùng key/body trả cùng hold/code; đổi body, giá/terms cũ hoặc trùng lịch trả 409. Rate limit theo IP/phone có cấu hình; không CAPTCHA/OTP.', '',
  'Khách tra cứu bằng `POST /v1/public/booking/lookup` với `{phone,bookingCode}`. Sai một trong hai trả cùng lỗi 404 để tránh dò số điện thoại; đúng trả trạng thái `HELD`, `EXPIRED` hoặc `CONFIRMED`, booking ID nếu đã xác nhận và dữ liệu lịch tối thiểu. Booking code và khóa rate-limit chỉ lưu hash; body/PII không đi vào request log/audit. Public hold chưa tự xác nhận: nhân viên vẫn phải gọi, ghi nhận xác minh và xác nhận theo policy cọc.', '',
  'Cấu hình xác nhận không cọc theo kênh: Owner/Branch Manager dùng `GET` và `PATCH /v1/merchant/booking/no-deposit-confirmation/{channel}`. PATCH nhận `{ "allowed": true }` hoặc `false`. Khi chưa cấu hình, GET trả `{ "channel": "WEB", "configured": false, "allowed": null }`; frontend hiển thị chưa cấu hình thay vì suy đoán bật/tắt. Cấu hình này chưa xác nhận booking và chưa thay thế cấu hình loại tiền cọc hoặc quy tắc theo trường hợp.', '',
  'Cấu hình phương thức cọc theo kênh: Owner/Branch Manager dùng `GET` và `PATCH /v1/merchant/booking/deposit-policy/{channel}`. PATCH nhận `{ "mode": "NONE" }`, `{ "mode": "FIXED", "fixedAmountVnd": "150000" }` hoặc `{ "mode": "PERCENT", "percent": "25.5" }`. Tiền là số nguyên VND dạng chuỗi; tỷ lệ là chuỗi từ trên 0 đến 100, tối đa bốn chữ số thập phân. Kênh chưa cấu hình trả `configured: false`, `mode: "NONE"` theo mặc định. API chỉ lưu cấu hình, chưa tính số tiền cọc, chưa nhận thanh toán và chưa xác nhận booking; cấu hình theo trường hợp chưa có.', '',
  'Danh sách cấu hình: `GET /v1/merchant/booking/deposit-policy`, `GET /v1/merchant/booking/no-deposit-confirmation` và `GET /v1/merchant/booking/hold-ttl` chỉ trả kênh đã lưu cấu hình. Cả ba nhận `limit` (1–100, mặc định 50) và `offset` (0–10000, mặc định 0), trả `{items,limit,offset,hasMore}`, sắp xếp theo tên kênh. Muốn xem mặc định của kênh chưa lưu, gọi GET `/{channel}` tương ứng. Offset có thể dịch chuyển khi dữ liệu thay đổi giữa các lần gọi.', '',
  'Theo dõi worker: Owner có thể gọi `GET /v1/merchant/booking/hold-expiry/backlog` để xem `overdueCount` (chuỗi số nguyên) và `oldestOverdueSeconds` (số hoặc `null`) của tenant. Chỉ số này không xác nhận worker đang chạy; API không tự hết hạn hoặc giải phóng hold.', '',
  'Theo dõi thông báo: Owner gọi `GET /v1/merchant/notifications/outbox/backlog` để xem số `pendingCount`, `processingCount`, `deadCount` dưới dạng chuỗi và `oldestReadySeconds` là số hoặc `null`. Số liệu chỉ thuộc tenant, không chứa nội dung/người nhận; đây không phải heartbeat và không chứng minh gửi thông báo thành công.', '',
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
