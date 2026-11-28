# Đặc tả API cho frontend

Phiên bản contract: 0.1.0. File được tạo từ `docs/02-architecture/openapi.json`; chạy `npm run api:docs` trong `be/` sau khi cập nhật OpenAPI.

Base URL phát triển: `http://localhost:3000`. Mọi đường dẫn bên dưới đã bao gồm tiền tố `/v1`.

API merchant yêu cầu `Authorization: Bearer <access_token>` và `X-Tenant-ID: <tenant-uuid>` khi endpoint khai báo. Quyền truy cập cụ thể do backend kiểm tra; không suy ra quyền từ việc hiển thị giao diện. Đăng nhập và refresh dùng endpoint trong nhóm auth.

Body dùng `application/json` khi được khai báo. Các trường có dấu `?` trong JSON Schema là tùy chọn nếu không nằm trong `required`. Với PATCH price plan, special date và price rule, body thay toàn bộ trường có thể sửa; selector tùy chọn bị bỏ qua sẽ được xóa.

Lỗi HTTP có dạng `{ "timestamp": "...", "path": "...", "correlationId": "...", "error": { "code": "...", "message": "...", "details": [] } }`; `details` chỉ có khi có nhiều lỗi. Không hiển thị thông tin lỗi 500 nội bộ.

**Giới hạn contract:** nhiều endpoint chưa khai báo schema response trong OpenAPI; các mã trả về và schema bên dưới chỉ phản ánh phần đã khai báo, không chứng minh response rỗng. Hold và xác nhận booking hiện chỉ dành cho nhân viên; xác nhận chỉ hỗ trợ trường hợp không cọc đủ điều kiện. Worker hết hạn phải chạy riêng.

## Luồng hold cho nhân viên

Gọi `POST /v1/merchant/booking/holds` với `Idempotency-Key` gồm 1–100 ký tự ASCII nhìn thấy được. Key được phân theo tenant và người dùng. Gửi lại cùng key và dữ liệu tương đương trả lại hold cũ; đổi dữ liệu với cùng key trả 409. Sau khi hold hết hạn, replay trả `EXPIRED`; muốn tạo lại dùng key mới.

Ví dụ body:

```json
{
  "roomId": "00000000-0000-4000-8000-000000000001",
  "startAt": "2036-01-01T18:00:00+07:00",
  "durationMinutes": 60,
  "channel": "WALK_IN"
}
```

Ví dụ response HTTP 201 (các giá trị chỉ để minh họa):

```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "branchId": "00000000-0000-4000-8000-000000000003",
  "roomId": "00000000-0000-4000-8000-000000000001",
  "channel": "WALK_IN",
  "startAt": "2036-01-01T11:00:00.000Z",
  "durationMinutes": 60,
  "bufferMinutes": 15,
  "reservedEndAt": "2036-01-01T12:15:00.000Z",
  "expiresAt": "2035-12-31T11:15:00.000Z",
  "status": "HELD"
}
```

`reservedEndAt` bao gồm buffer dọn phòng; `expiresAt` là hạn giữ phòng, không phải giờ kết thúc sử dụng phòng. HTTP 409 có thể là xung đột lịch hoặc key; đọc `error.message`. Worker `npm run holds:expire` cần chạy riêng; khi worker dừng, hold quá hạn vẫn có thể chiếm phòng đến khi được xử lý.

Sau khi hiển thị quote và tạo hold, gọi `POST /v1/merchant/booking/holds/{id}/details` với `{ "phone": "0912345678", "email": "guest@example.com", "expectedTotalAmountVnd": "150000" }`; email tùy chọn, tổng tiền là chuỗi `priceSnapshot.totalAmountVnd` từ quote đã hiển thị. Backend tính lại giá và trả 409 nếu tổng tiền khác hoặc hold hết hạn; khi giá đổi cần báo giá lại. Thông tin và snapshot được ghi một lần, gửi lại cùng dữ liệu trả kết quả đã lưu.

Sau khi nhân viên thực sự gọi và xác minh số điện thoại, gọi `POST /v1/merchant/booking/holds/{id}/phone-verification` (không cần body). Response trả `phoneVerifiedAt` và `phoneVerifiedBy`; gọi lại khi hold còn hiệu lực trả cùng kết quả. Chưa có số điện thoại hoặc hold quá hạn trả 409. Đây là ghi nhận của nhân viên, không phải xác minh tự động và không xác nhận booking.

Xác nhận không cọc cho nhân viên: `POST /v1/merchant/booking/holds/{id}/confirm` với `{ "cancellationTerms": "Điều khoản hủy đã hiển thị cho khách" }`. Cần hold còn hiệu lực, đã lưu liên hệ và snapshot giá, đã ghi nhận xác minh điện thoại, chế độ cọc của kênh là NONE và cấu hình cho phép xác nhận không cọc là `allowed: true`. Response 200 chứa booking `CONFIRMED`, ID, snapshot giá, điều khoản và snapshot chính sách. Gửi lại cùng hold và cùng điều khoản trả cùng booking; điều khoản khác trả 409. Lưu booking ID và đọc lại tại `GET /v1/merchant/booking/bookings/{id}`. API chưa hỗ trợ trường hợp có cọc, check-in/out, thanh toán hoặc đặt phòng công khai.

Danh sách lễ tân: `GET /v1/merchant/branches/{branchId}/booking/holds?from=2036-01-01T00%3A00%3A00%2B07%3A00&to=2036-01-02T00%3A00%3A00%2B07%3A00&limit=50&offset=0`. `from`/`to` bắt buộc có múi giờ; lọc theo khoảng sử dụng phòng `[startAt, startAt + durationMinutes)` giao với `[from,to)`, không tính buffer. Response gồm `items`, `limit`, `offset`, `hasMore`. Danh sách chỉ bao gồm hold, không có booking đã xác nhận. Hold quá hạn được hiển thị `EXPIRED` theo giờ database; thao tác này không giải phóng occupancy. Phân trang offset có thể thay đổi khi có dữ liệu mới.

Lịch booking: `GET /v1/merchant/branches/{branchId}/booking/bookings?from=...&to=...&limit=50&offset=0` trả booking theo khoảng sử dụng giao với `[from,to)`, không bao gồm buffer; response `{items,limit,offset,hasMore}`. Danh sách hold riêng có thể chứa hold đã `CONFIRMED`; FE nên loại bản ghi này khi ghép hai danh sách để tránh hiển thị hai lần.

Ghi nhận tiền mặt: `POST /v1/merchant/booking/bookings/{id}/manual-payments` với `Idempotency-Key` và body `{ "method": "CASH", "amountVnd": "30000" }`, `note` tùy chọn. Gửi lại cùng key cùng body trả cùng giao dịch; thay đổi body trả 409. Owner, Branch Manager, Cashier thuộc chi nhánh có thể đọc danh sách và ghi. `GET` cùng đường dẫn có `limit`/`offset`; `GET .../{id}/manual-payments/summary` trả `{ "totalRecordedVnd": "120000", "paymentCount": 2 }` với số nguyên VND dạng chuỗi chính xác. Đây là tổng khoản đã ghi nhận, không tự xác nhận đã thu đủ, không có hoàn tiền/đảo giao dịch hoặc đối soát sổ quỹ.

Catalog khách: Owner dùng `GET/PATCH /v1/merchant/catalog/publication` để yêu cầu công bố toàn bộ chi nhánh/phòng hoạt động của merchant; `platformApproved` là trạng thái duyệt độc lập, Owner không thể sửa. Chỉ merchant vừa yêu cầu công bố vừa được platform duyệt mới xuất hiện tại `GET /v1/public/branches` và `GET /v1/public/branches/{id}/rooms`. Khách có thể tìm phòng trống bằng `GET /v1/public/branches/{id}/availability?startAt=...&durationMinutes=...` và báo giá bằng `POST /v1/public/rooms/{id}/quote`; hai API dùng đúng duration, buffer, occupancy và price rule của merchant. API duyệt platform và guest hold/booking chưa có; availability/quote không giữ phòng.

Điều khoản UAT công khai: Owner dùng `GET/PATCH /v1/merchant/catalog/public-booking-terms` để lưu đúng một nội dung tối đa 5.000 ký tự; mỗi lần cập nhật tăng `version` và được audit nhưng audit không sao chép nội dung. Khách đọc tại `GET /v1/public/branches/{branchId}/booking-terms` chỉ khi branch thuộc merchant đã publish và được platform duyệt. FE phải gửi lại đúng version trong public hold.

Public hold UAT: `POST /v1/public/booking/holds` cần `Idempotency-Key` và body `{roomId,startAt,durationMinutes,phone,email?,expectedTotalAmountVnd,termsVersion}`. Backend yêu cầu room thuộc merchant published/platform-approved, tính lại giá, đối chiếu version điều khoản, chiếm phòng nguyên tử với buffer và dùng TTL kênh `WEB`. Response trả `holdId`, thời gian, `status`, tổng tiền, terms version và `bookingCode` 128-bit. Replay cùng key/body trả cùng hold/code; đổi body, giá/terms cũ hoặc trùng lịch trả 409. Rate limit theo IP/phone có cấu hình; không CAPTCHA/OTP.

Khách tra cứu bằng `POST /v1/public/booking/lookup` với `{phone,bookingCode}`. Sai một trong hai trả cùng lỗi 404 để tránh dò số điện thoại; đúng trả trạng thái `HELD`, `EXPIRED` hoặc `CONFIRMED`, booking ID nếu đã xác nhận và dữ liệu lịch tối thiểu. Booking code và khóa rate-limit chỉ lưu hash; body/PII không đi vào request log/audit. Public hold chưa tự xác nhận: nhân viên vẫn phải gọi, ghi nhận xác minh và xác nhận theo policy cọc.

Cấu hình xác nhận không cọc theo kênh: Owner/Branch Manager dùng `GET` và `PATCH /v1/merchant/booking/no-deposit-confirmation/{channel}`. PATCH nhận `{ "allowed": true }` hoặc `false`. Khi chưa cấu hình, GET trả `{ "channel": "WEB", "configured": false, "allowed": null }`; frontend hiển thị chưa cấu hình thay vì suy đoán bật/tắt. Cấu hình này chưa xác nhận booking và chưa thay thế cấu hình loại tiền cọc hoặc quy tắc theo trường hợp.

Cấu hình phương thức cọc theo kênh: Owner/Branch Manager dùng `GET` và `PATCH /v1/merchant/booking/deposit-policy/{channel}`. PATCH nhận `{ "mode": "NONE" }`, `{ "mode": "FIXED", "fixedAmountVnd": "150000" }` hoặc `{ "mode": "PERCENT", "percent": "25.5" }`. Tiền là số nguyên VND dạng chuỗi; tỷ lệ là chuỗi từ trên 0 đến 100, tối đa bốn chữ số thập phân. Kênh chưa cấu hình trả `configured: false`, `mode: "NONE"` theo mặc định. API chỉ lưu cấu hình, chưa tính số tiền cọc, chưa nhận thanh toán và chưa xác nhận booking; cấu hình theo trường hợp chưa có.

Danh sách cấu hình: `GET /v1/merchant/booking/deposit-policy`, `GET /v1/merchant/booking/no-deposit-confirmation` và `GET /v1/merchant/booking/hold-ttl` chỉ trả kênh đã lưu cấu hình. Cả ba nhận `limit` (1–100, mặc định 50) và `offset` (0–10000, mặc định 0), trả `{items,limit,offset,hasMore}`, sắp xếp theo tên kênh. Muốn xem mặc định của kênh chưa lưu, gọi GET `/{channel}` tương ứng. Offset có thể dịch chuyển khi dữ liệu thay đổi giữa các lần gọi.

Theo dõi worker: Owner có thể gọi `GET /v1/merchant/booking/hold-expiry/backlog` để xem `overdueCount` (chuỗi số nguyên) và `oldestOverdueSeconds` (số hoặc `null`) của tenant. Chỉ số này không xác nhận worker đang chạy; API không tự hết hạn hoặc giải phóng hold.

Theo dõi thông báo: Owner gọi `GET /v1/merchant/notifications/outbox/backlog` để xem số `pendingCount`, `processingCount`, `deadCount` dưới dạng chuỗi và `oldestReadySeconds` là số hoặc `null`. Số liệu chỉ thuộc tenant, không chứa nội dung/người nhận; đây không phải heartbeat và không chứng minh gửi thông báo thành công.

## Endpoint

### GET /v1/health/live

Nhóm: operations · Check whether the process is alive

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Process is alive | {"$ref":"#/components/schemas/HealthLiveDto"} |

### GET /v1/health/ready

Nhóm: operations · Check whether the service can use PostgreSQL

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Service and database are ready | {"$ref":"#/components/schemas/HealthReadyDto"} |
| 503 | Database is unavailable | Chưa khai báo schema |

### GET /v1/metrics

Nhóm: operations · Expose process-local HTTP metrics in Prometheus text format

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Prometheus text exposition | Chưa khai báo schema |

### POST /v1/auth/login

Nhóm: authentication

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/LoginDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/TokenPairResponseDto"} |

### POST /v1/auth/refresh

Nhóm: authentication

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RefreshTokenDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/TokenPairResponseDto"} |
| 401 | Invalid, expired or reused token; reuse revokes the family | Chưa khai báo schema |

### POST /v1/auth/logout

Nhóm: authentication

Revokes the refresh-token family, including any token rotated concurrently. Unknown tokens still return 204.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RefreshTokenDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Logout processed | Chưa khai báo schema |

### POST /v1/auth/password/change

Nhóm: authentication

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/ChangePasswordDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/auth/sessions

Nhóm: authentication

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/SessionResponseDto"}} |

### DELETE /v1/auth/sessions/{id}

Nhóm: authentication

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/memberships

Nhóm: memberships

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/MembershipResponseDto"}} |

### POST /v1/merchant/memberships

Nhóm: memberships

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateMembershipDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/MembershipResponseDto"} |

### PATCH /v1/merchant/memberships/{id}

Nhóm: memberships

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateMembershipDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/MembershipResponseDto"} |

### GET /v1/merchant/me

Nhóm: memberships

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/MerchantMeDto"} |
| 403 | No active membership in X-Tenant-ID | Chưa khai báo schema |

### GET /v1/merchant/documents

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/MerchantDocumentDto"}} |

### POST /v1/merchant/documents

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`multipart/form-data`

```json
{
  "$ref": "#/components/schemas/UploadMerchantDocumentDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | PDF stored in the private Blob store | {"$ref":"#/components/schemas/MerchantDocumentDto"} |
| 409 | Merchant already has 10 documents | Chưa khai báo schema |
| 413 | File larger than 4 MB | Chưa khai báo schema |
| 422 | Not a PDF | Chưa khai báo schema |

### GET /v1/merchant/documents/{id}/file

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | PDF bytes | Chưa khai báo schema |

### DELETE /v1/merchant/documents/{id}

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Document and its file deleted | Chưa khai báo schema |

### GET /v1/platform/merchants/{tenantId}/documents

Nhóm: platform merchants

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Documents of any merchant, for listing review | {"type":"array","items":{"$ref":"#/components/schemas/MerchantDocumentDto"}} |

### GET /v1/platform/merchants/{tenantId}/documents/{id}/file

Nhóm: platform merchants

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | PDF bytes | Chưa khai báo schema |

### POST /v1/merchant/branches

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateBranchDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/BranchResponseDto"} |

### GET /v1/merchant/branches

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/BranchResponseDto"}} |

### GET /v1/merchant/branches/{id}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BranchResponseDto"} |

### PATCH /v1/merchant/branches/{id}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateBranchDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BranchResponseDto"} |

### PATCH /v1/merchant/branches/{id}/status

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/BranchStatusDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BranchResponseDto"} |

### POST /v1/merchant/rooms

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateRoomDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/RoomResponseDto"} |

### GET /v1/merchant/branches/{branchId}/rooms

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/RoomResponseDto"}} |

### GET /v1/merchant/rooms/{id}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomResponseDto"} |

### PATCH /v1/merchant/rooms/{id}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateRoomDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomResponseDto"} |

### PATCH /v1/merchant/rooms/{id}/status

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RoomStatusDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomResponseDto"} |

### GET /v1/merchant/rooms/{id}/amenities

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/RoomAmenityResponseDto"}} |

### POST /v1/merchant/rooms/{id}/amenities

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateRoomAmenityDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/RoomAmenityResponseDto"} |

### PATCH /v1/merchant/rooms/{id}/amenities/{amenityId}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| path | `amenityId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateRoomAmenityDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomAmenityResponseDto"} |

### DELETE /v1/merchant/rooms/{id}/amenities/{amenityId}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| path | `amenityId` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/rooms/{id}/media

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/RoomMediaResponseDto"}} |

### POST /v1/merchant/rooms/{id}/media

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateRoomMediaDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/RoomMediaResponseDto"} |

### POST /v1/merchant/rooms/{id}/media/upload

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`multipart/form-data`

```json
{
  "$ref": "#/components/schemas/UploadRoomMediaDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Photo stored in the public Blob store and added to the room (PD-037) | {"$ref":"#/components/schemas/RoomMediaResponseDto"} |
| 409 | Room already has 10 media entries | Chưa khai báo schema |
| 413 | File larger than 4 MB | Chưa khai báo schema |
| 422 | Not a JPEG, PNG or WebP image | Chưa khai báo schema |

### PATCH /v1/merchant/rooms/{id}/media/{mediaId}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| path | `mediaId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateRoomMediaDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomMediaResponseDto"} |

### DELETE /v1/merchant/rooms/{id}/media/{mediaId}

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| path | `mediaId` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/audit-logs

Nhóm: audit

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| query | `limit` | Có | number |
| query | `offset` | Có | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/AuditLogResponseDto"}} |

### GET /v1/merchant/branches/{branchId}/availability

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |
| query | `startAt` | Có | string — ISO-8601 timestamp with explicit offset |
| query | `durationMinutes` | Có | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/AvailabilityResponseDto"} |

### POST /v1/merchant/room-blocks

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateRoomBlockDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/RoomBlockResponseDto"} |

### GET /v1/merchant/branches/{branchId}/room-blocks

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/RoomBlockResponseDto"}} |

### GET /v1/merchant/room-blocks/{id}

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomBlockResponseDto"} |

### PATCH /v1/merchant/room-blocks/{id}

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateRoomBlockDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomBlockResponseDto"} |

### POST /v1/merchant/room-blocks/{id}/release

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/RoomBlockResponseDto"} |

### GET /v1/merchant/availability/buffer-policy

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/AvailabilityPolicyResponseDto"} |

### PATCH /v1/merchant/availability/buffer-policy

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateAvailabilityPolicyDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/AvailabilityPolicyResponseDto"} |

### GET /v1/merchant/notifications/outbox/backlog

Nhóm: notification operations

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Tenant-scoped outbox counts; no payloads or recipients | {"$ref":"#/components/schemas/OutboxBacklogDto"} |

### GET /v1/merchant/pricing/plans/{id}/rules

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/PriceRuleResponseDto"}} |

### GET /v1/merchant/pricing/rules/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PriceRuleResponseDto"} |

### PATCH /v1/merchant/pricing/rules/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdatePriceRuleDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PriceRuleResponseDto"} |

### POST /v1/merchant/pricing/rules

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreatePriceRuleDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/PriceRuleResponseDto"} |

### GET /v1/merchant/pricing/special-dates

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/SpecialDateResponseDto"}} |

### POST /v1/merchant/pricing/special-dates

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateSpecialDateDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/SpecialDateResponseDto"} |

### GET /v1/merchant/pricing/special-dates/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/SpecialDateResponseDto"} |

### PATCH /v1/merchant/pricing/special-dates/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateSpecialDateDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/SpecialDateResponseDto"} |

### GET /v1/merchant/pricing/plans

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"type":"array","items":{"$ref":"#/components/schemas/PricePlanResponseDto"}} |

### POST /v1/merchant/pricing/plans

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreatePricePlanDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/PricePlanResponseDto"} |

### GET /v1/merchant/pricing/plans/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PricePlanResponseDto"} |

### PATCH /v1/merchant/pricing/plans/{id}

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdatePricePlanDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PricePlanResponseDto"} |

### GET /v1/merchant/pricing/duration-policy

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BookingDurationPolicyResponseDto"} |

### PATCH /v1/merchant/pricing/duration-policy

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateBookingDurationPolicyDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BookingDurationPolicyResponseDto"} |

### POST /v1/merchant/rooms/{roomId}/quote

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `roomId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/QuoteRequestDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/QuoteResponseDto"} |

### GET /v1/merchant/booking/hold-ttl

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Explicitly configured channels only | {"$ref":"#/components/schemas/HoldTtlListDto"} |

### GET /v1/merchant/booking/hold-ttl/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/HoldTtlResponseDto"} |

### PATCH /v1/merchant/booking/hold-ttl/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateHoldTtlDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/HoldTtlResponseDto"} |

### GET /v1/merchant/booking/holds/{id}

Nhóm: booking holds

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Current hold status; an overdue hold is expired before returning | {"$ref":"#/components/schemas/HoldResponseDto"} |

### POST /v1/merchant/booking/holds/{id}/details

Nhóm: booking holds

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/AttachHoldDetailsDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Customer contact and server-calculated price snapshot recorded or replayed | {"$ref":"#/components/schemas/HoldResponseDto"} |
| 409 | Expired hold, conflicting existing details or concurrent change | Chưa khai báo schema |
| 422 | No price rule matches or current duration policy rejects the hold | Chưa khai báo schema |

### POST /v1/merchant/booking/holds/{id}/phone-verification

Nhóm: booking holds

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Staff-recorded successful verification call, or previously recorded result | {"$ref":"#/components/schemas/HoldResponseDto"} |
| 409 | Hold has expired or customer phone is not recorded | Chưa khai báo schema |

### POST /v1/merchant/booking/holds

Nhóm: booking holds

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| header | `idempotency-key` | Có | string |
| header | `Idempotency-Key` | Có | string — Visible ASCII, 1–100 characters; scoped to tenant and user |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateHoldDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Created hold or current state of an idempotent replay | {"$ref":"#/components/schemas/HoldResponseDto"} |
| 409 | Occupancy conflict or idempotency key reused with different input | Chưa khai báo schema |

### GET /v1/merchant/branches/{branchId}/booking/holds

Nhóm: booking holds

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |
| query | `from` | Có | string — Start of search interval, inclusive, with explicit timezone |
| query | `to` | Có | string — End of search interval, exclusive, with explicit timezone |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Holds whose booking intervals overlap [from,to); overdue holds are reported as EXPIRED without releasing occupancy | {"$ref":"#/components/schemas/HoldListResponseDto"} |

### GET /v1/merchant/booking/no-deposit-confirmation

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Explicitly configured channels only | {"$ref":"#/components/schemas/NoDepositPolicyListDto"} |

### GET /v1/merchant/booking/no-deposit-confirmation/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/NoDepositPolicyResponseDto"} |

### PATCH /v1/merchant/booking/no-deposit-confirmation/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateNoDepositPolicyDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/NoDepositPolicyResponseDto"} |

### GET /v1/merchant/booking/deposit-policy

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Explicitly configured channels only | {"$ref":"#/components/schemas/DepositPolicyListDto"} |

### GET /v1/merchant/booking/deposit-policy/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/DepositPolicyResponseDto"} |

### PATCH /v1/merchant/booking/deposit-policy/{channel}

Nhóm: booking settings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `channel` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateDepositPolicyDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/DepositPolicyResponseDto"} |

### GET /v1/merchant/booking/hold-expiry/backlog

Nhóm: booking operations

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Tenant-scoped overdue holds; this endpoint does not expire them | {"$ref":"#/components/schemas/HoldExpiryBacklogDto"} |

### POST /v1/merchant/booking/holds/{id}/confirm

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/ConfirmHoldDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Confirmed booking (no-deposit, or deposit fully recorded on the hold) or replay with the same terms | {"$ref":"#/components/schemas/BookingResponseDto"} |
| 409 | Expired or incomplete hold, no-deposit not enabled, required deposit not fully recorded, or conflicting replay | Chưa khai báo schema |

### GET /v1/merchant/booking/bookings/{id}

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/BookingResponseDto"} |

### GET /v1/merchant/branches/{branchId}/booking/bookings

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |
| query | `from` | Có | string — Start of search interval, inclusive, with explicit timezone |
| query | `to` | Có | string — End of search interval, exclusive, with explicit timezone |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Bookings whose scheduled intervals overlap [from,to), excluding the cleanup buffer | {"$ref":"#/components/schemas/BookingListResponseDto"} |

### GET /v1/merchant/booking/bookings/{id}/manual-payments/summary

Nhóm: manual payments

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/ManualPaymentSummaryDto"} |

### GET /v1/merchant/booking/bookings/{id}/manual-payments

Nhóm: manual payments

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/ManualPaymentListDto"} |

### POST /v1/merchant/booking/bookings/{id}/manual-payments

Nhóm: manual payments

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| header | `idempotency-key` | Có | string |
| header | `Idempotency-Key` | Có | string — Visible ASCII 1–100 characters; scoped to tenant and user |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RecordManualPaymentDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Recorded payment or matching replay | {"$ref":"#/components/schemas/ManualPaymentResponseDto"} |
| 409 | Idempotency key reused with different payment details | Chưa khai báo schema |

### POST /v1/public/booking/holds

Nhóm: public booking

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `idempotency-key` | Có | string |
| header | `Idempotency-Key` | Có | string — Visible ASCII 1–100 characters; scoped to published merchant and normalized phone (0…, 84…, +84… are the same number) |

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreatePublicHoldDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/PublicHoldResponseDto"} |
| 409 | Occupancy, price, terms version or idempotency conflict | Chưa khai báo schema |
| 429 | IP or phone rate limit exceeded | Chưa khai báo schema |

### POST /v1/public/booking/lookup

Nhóm: public booking

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/PublicBookingLookupDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicBookingStatusDto"} |
| 404 | Generic response for an invalid phone/code pair | Chưa khai báo schema |
| 429 | IP or phone rate limit exceeded | Chưa khai báo schema |

### GET /v1/merchant/booking/holds/{id}/deposits

Nhóm: hold deposits

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Snapshotted deposit requirement, recorded CASH entries and remaining amount | {"$ref":"#/components/schemas/HoldDepositStatusDto"} |

### POST /v1/merchant/booking/holds/{id}/deposits

Nhóm: hold deposits

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| header | `idempotency-key` | Có | string |
| header | `Idempotency-Key` | Có | string — Visible ASCII 1–100 characters; scoped to tenant and user |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RecordHoldDepositDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Recorded deposit or matching replay | {"$ref":"#/components/schemas/HoldDepositEntryDto"} |
| 409 | Hold inactive, no snapshot, no deposit required, amount above remaining, or idempotency conflict | Chưa khai báo schema |

### POST /v1/merchant/booking/bookings/{id}/check-in

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | CONFIRMED -> CHECKED_IN, or replay when already checked in. No time window is enforced | {"$ref":"#/components/schemas/BookingResponseDto"} |
| 409 | Booking is not CONFIRMED | Chưa khai báo schema |

### POST /v1/merchant/booking/bookings/{id}/check-out

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | CHECKED_IN -> COMPLETED with actual end time, or replay. Early check-out shortens the reservation to actual end + cleanup buffer | {"$ref":"#/components/schemas/BookingResponseDto"} |
| 409 | Booking is not CHECKED_IN | Chưa khai báo schema |

### POST /v1/merchant/booking/bookings/{id}/outcome

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RecordBookingOutcomeDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | CONFIRMED -> CANCELLED or NO_SHOW with the staff-reviewed outcome; room is released. Same body replays | {"$ref":"#/components/schemas/BookingResponseDto"} |
| 409 | Booking not CONFIRMED, a different outcome already recorded, or refund above recorded deposits plus payments | Chưa khai báo schema |

### GET /v1/merchant/booking/overtime-policy

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/OvertimePolicyDto"} |

### PATCH /v1/merchant/booking/overtime-policy

Nhóm: bookings

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdateOvertimePolicyDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/OvertimePolicyDto"} |

### GET /v1/merchant/booking/bookings/{id}/account

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Amount due vs paid with every money entry for the booking | {"$ref":"#/components/schemas/BookingAccountDto"} |

### POST /v1/merchant/booking/bookings/{id}/surcharges

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |
| header | `idempotency-key` | Có | string |
| header | `Idempotency-Key` | Có | string — Visible ASCII 1–100 characters; scoped to tenant and user |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/AddSurchargeDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Recorded surcharge or matching replay | {"$ref":"#/components/schemas/SurchargeResponseDto"} |
| 409 | Booking is cancelled/no-show, or idempotency key reused with a different body | Chưa khai báo schema |

### POST /v1/merchant/booking/money-reversals

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateReversalDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Full reversal of a deposit, CASH payment or surcharge; replay with the same reason returns it | {"$ref":"#/components/schemas/ReversalResponseDto"} |
| 409 | Entry already reversed with another reason, or expired-hold deposit already resolved | Chưa khai báo schema |

### GET /v1/merchant/branches/{branchId}/booking/unresolved-deposits

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Expired holds that still have a net deposit and no resolution | {"$ref":"#/components/schemas/UnresolvedDepositListDto"} |

### POST /v1/merchant/booking/holds/{id}/deposit-resolution

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `id` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/ResolveDepositDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Recorded refund/retention for an expired hold deposit, or matching replay | {"$ref":"#/components/schemas/DepositResolutionDto"} |
| 409 | Hold active or confirmed, no deposit, refund above net deposit, or a different resolution exists | Chưa khai báo schema |

### GET /v1/merchant/branches/{branchId}/cash-report

Nhóm: cash reconciliation

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |
| path | `branchId` | Có | string |
| query | `date` | Có | string — Local date in the branch timezone |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Cash totals for one local day in the branch timezone, overall and per recorder | {"$ref":"#/components/schemas/CashReportDto"} |

### GET /v1/merchant/catalog/publication

Nhóm: merchant catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicationResponseDto"} |

### PATCH /v1/merchant/catalog/publication

Nhóm: merchant catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdatePublicationDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicationResponseDto"} |

### GET /v1/merchant/catalog/public-booking-terms

Nhóm: merchant catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicBookingTermsResponseDto"} |

### PATCH /v1/merchant/catalog/public-booking-terms

Nhóm: merchant catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/UpdatePublicBookingTermsDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicBookingTermsResponseDto"} |

### GET /v1/public/branches

Nhóm: public catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicBranchListDto"} |

### GET /v1/public/branches/{id}/rooms

Nhóm: public catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `id` | Có | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicRoomListDto"} |

### GET /v1/public/branches/{id}/availability

Nhóm: public catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `id` | Có | string |
| query | `startAt` | Có | string — ISO-8601 timestamp with explicit offset |
| query | `durationMinutes` | Có | number |

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicAvailabilityResponseDto"} |

### POST /v1/public/rooms/{id}/quote

Nhóm: public catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `id` | Có | string |

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/QuoteRequestDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Chưa mô tả | {"$ref":"#/components/schemas/PublicQuoteResponseDto"} |

### GET /v1/public/branches/{id}/booking-terms

Nhóm: public catalog

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `id` | Có | string |

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/PublicBookingTermsResponseDto"} |

### GET /v1/merchant/catalog/logo

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/MerchantLogoDto"} |

### PUT /v1/merchant/catalog/logo

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`multipart/form-data`

```json
{
  "$ref": "#/components/schemas/UploadLogoDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Replaces the logo; the previous file is deleted | {"$ref":"#/components/schemas/MerchantLogoDto"} |
| 413 | File larger than 4 MB | Chưa khai báo schema |
| 422 | Not a JPEG, PNG or WebP image | Chưa khai báo schema |

### DELETE /v1/merchant/catalog/logo

Nhóm: merchant files

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 204 | Logo removed (no-op when none) | Chưa khai báo schema |

### GET /v1/platform/catalog/listings

Nhóm: platform listing approval

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| query | `status` | Không | string — PENDING = published by merchant and not approved |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/ListingListDto"} |
| 403 | Caller is not a Platform Admin | Chưa khai báo schema |

### POST /v1/platform/catalog/listings/{tenantId}/approve

Nhóm: platform listing approval

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/ListingDecisionDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Approved listing, or unchanged state when already approved | {"$ref":"#/components/schemas/ListingResponseDto"} |
| 403 | Not a Platform Admin, or reviewer belongs to the merchant | Chưa khai báo schema |
| 409 | Merchant is inactive or has not published its catalog | Chưa khai báo schema |

### POST /v1/platform/catalog/listings/{tenantId}/revoke

Nhóm: platform listing approval

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/RevokeListingDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Revoked listing, or unchanged state when not approved | {"$ref":"#/components/schemas/ListingResponseDto"} |
| 403 | Not a Platform Admin, or reviewer belongs to the merchant | Chưa khai báo schema |

### GET /v1/platform/merchants

Nhóm: platform merchants

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| query | `status` | Không | string |
| query | `limit` | Không | number |
| query | `offset` | Không | number |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | {"$ref":"#/components/schemas/MerchantListDto"} |
| 403 | Caller is not a Platform Admin | Chưa khai báo schema |

### POST /v1/platform/merchants

Nhóm: platform merchants

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/CreateMerchantDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 201 | Active merchant with its first Owner. Catalog starts unpublished and unapproved | {"$ref":"#/components/schemas/CreatedMerchantDto"} |
| 403 | Caller is not a Platform Admin | Chưa khai báo schema |
| 409 | Merchant code already in use | Chưa khai báo schema |

### POST /v1/platform/merchants/{tenantId}/suspend

Nhóm: platform merchants

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/MerchantStatusChangeDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Merchant INACTIVE: hidden from customers, no new holds; staff still operate existing holds/bookings (PD-031). Idempotent | {"$ref":"#/components/schemas/MerchantSummaryDto"} |
| 403 | Not a Platform Admin, or the admin belongs to the merchant | Chưa khai báo schema |

### POST /v1/platform/merchants/{tenantId}/reactivate

Nhóm: platform merchants

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| path | `tenantId` | Có | string |

Xác thực OpenAPI: bearer.

Body bắt buộc:

`application/json`

```json
{
  "$ref": "#/components/schemas/MerchantStatusChangeDto"
}
```

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Merchant ACTIVE again; listing reappears if still published and approved. Idempotent | {"$ref":"#/components/schemas/MerchantSummaryDto"} |
| 403 | Not a Platform Admin, or the admin belongs to the merchant | Chưa khai báo schema |

## Các schema request và response

Tham chiếu `$ref` trỏ tới tên schema trong danh sách sau. `required` là các trường bắt buộc.

### HealthLiveDto

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    }
  },
  "required": [
    "status"
  ]
}
```

### HealthDependenciesDto

```json
{
  "type": "object",
  "properties": {
    "database": {
      "type": "string",
      "enum": [
        "ok"
      ]
    }
  },
  "required": [
    "database"
  ]
}
```

### HealthReadyDto

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ok"
      ]
    },
    "dependencies": {
      "$ref": "#/components/schemas/HealthDependenciesDto"
    }
  },
  "required": [
    "status",
    "dependencies"
  ]
}
```

### LoginDto

```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  },
  "required": [
    "email",
    "password"
  ]
}
```

### TokenPairResponseDto

```json
{
  "type": "object",
  "properties": {
    "accessToken": {
      "type": "string"
    },
    "expiresIn": {
      "type": "number",
      "description": "Access token lifetime in seconds"
    },
    "refreshToken": {
      "type": "string"
    },
    "refreshExpiresIn": {
      "type": "number",
      "description": "Refresh token lifetime in seconds"
    },
    "mustChangePassword": {
      "type": "boolean"
    }
  },
  "required": [
    "accessToken",
    "expiresIn",
    "refreshToken",
    "refreshExpiresIn",
    "mustChangePassword"
  ]
}
```

### RefreshTokenDto

```json
{
  "type": "object",
  "properties": {
    "refreshToken": {
      "type": "string"
    }
  },
  "required": [
    "refreshToken"
  ]
}
```

### ChangePasswordDto

```json
{
  "type": "object",
  "properties": {
    "currentPassword": {
      "type": "string"
    },
    "newPassword": {
      "type": "string",
      "minLength": 12
    }
  },
  "required": [
    "currentPassword",
    "newPassword"
  ]
}
```

### SessionResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "lastUsedAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "revoked": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "createdAt",
    "lastUsedAt",
    "expiresAt",
    "revoked"
  ]
}
```

### MembershipResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "userId": {
      "type": "string",
      "format": "uuid"
    },
    "email": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER"
        ]
      }
    },
    "branchIds": {
      "description": "Granted branch UUIDs",
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "id",
    "userId",
    "email",
    "displayName",
    "status",
    "roles",
    "branchIds"
  ]
}
```

### CreateMembershipDto

```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "temporaryPassword": {
      "type": "string",
      "minLength": 12
    },
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER"
        ]
      }
    },
    "branchIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "email",
    "displayName",
    "temporaryPassword",
    "roles"
  ]
}
```

### UpdateMembershipDto

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER"
        ]
      }
    },
    "branchIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

### MerchantMeDto

```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "format": "uuid"
    },
    "email": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "tenantName": {
      "type": "string"
    },
    "tenantStatus": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ],
      "description": "INACTIVE = suspended by Platform Admin (PD-031)"
    },
    "membershipId": {
      "type": "string",
      "format": "uuid"
    },
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "OWNER",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
          "CASHIER"
        ]
      }
    },
    "branchIds": {
      "description": "Granted branches; Owner sees every branch regardless of this list",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "platformAdmin": {
      "type": "boolean",
      "description": "True when the user also holds the global Platform Admin grant"
    }
  },
  "required": [
    "userId",
    "email",
    "displayName",
    "tenantId",
    "tenantName",
    "tenantStatus",
    "membershipId",
    "roles",
    "branchIds",
    "platformAdmin"
  ]
}
```

### MerchantDocumentDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "title": {
      "type": "string"
    },
    "contentType": {
      "type": "string",
      "enum": [
        "application/pdf"
      ]
    },
    "sizeBytes": {
      "type": "number"
    },
    "uploadedBy": {
      "type": "string",
      "format": "uuid"
    },
    "uploadedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "tenantId",
    "title",
    "contentType",
    "sizeBytes",
    "uploadedBy",
    "uploadedAt"
  ]
}
```

### UploadMerchantDocumentDto

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "format": "binary",
      "description": "PDF, at most 4 MB"
    },
    "title": {
      "type": "string",
      "maxLength": 200,
      "description": "What the document is (business licence, fire safety…)"
    }
  },
  "required": [
    "file",
    "title"
  ]
}
```

### CreateBranchDto

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "timezone": {
      "type": "string",
      "example": "Asia/Ho_Chi_Minh"
    }
  },
  "required": [
    "code",
    "name",
    "timezone"
  ]
}
```

### BranchResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "timezone": {
      "type": "string",
      "example": "Asia/Ho_Chi_Minh",
      "description": "IANA timezone"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "id",
    "code",
    "name",
    "timezone",
    "status"
  ]
}
```

### UpdateBranchDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "timezone": {
      "type": "string"
    }
  }
}
```

### BranchStatusDto

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "status"
  ]
}
```

### CreateRoomDto

```json
{
  "type": "object",
  "properties": {
    "branchId": {
      "type": "string"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    }
  },
  "required": [
    "branchId",
    "code",
    "name",
    "capacity"
  ]
}
```

### RoomResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "id",
    "branchId",
    "code",
    "name",
    "capacity",
    "status"
  ]
}
```

### UpdateRoomDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    }
  }
}
```

### RoomStatusDto

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "MAINTENANCE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "status"
  ]
}
```

### RoomAmenityResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "label": {
      "type": "string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "roomId",
    "label",
    "createdAt"
  ]
}
```

### CreateRoomAmenityDto

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "maxLength": 80,
      "description": "Free-form amenity label; no catalog is imposed"
    }
  },
  "required": [
    "label"
  ]
}
```

### UpdateRoomAmenityDto

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "maxLength": 80
    }
  },
  "required": [
    "label"
  ]
}
```

### RoomMediaResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "assetRef": {
      "type": "string",
      "description": "Storage reference only; binary upload/fetch is out of scope"
    },
    "altText": {
      "type": "string",
      "nullable": true
    },
    "displayOrder": {
      "type": "number"
    },
    "url": {
      "type": "string",
      "nullable": true,
      "description": "Public URL of an uploaded photo (PD-037); null for metadata-only entries"
    },
    "contentType": {
      "type": "string",
      "nullable": true,
      "enum": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ]
    },
    "sizeBytes": {
      "type": "number",
      "nullable": true
    }
  },
  "required": [
    "id",
    "roomId",
    "assetRef",
    "altText",
    "displayOrder",
    "url",
    "contentType",
    "sizeBytes"
  ]
}
```

### CreateRoomMediaDto

```json
{
  "type": "object",
  "properties": {
    "assetRef": {
      "type": "string",
      "maxLength": 500,
      "description": "Opaque asset reference, not a URL; this API does not upload or fetch the asset"
    },
    "altText": {
      "type": "string",
      "maxLength": 200,
      "description": "Optional accessible text metadata"
    },
    "displayOrder": {
      "type": "number",
      "minimum": 0,
      "maximum": 10000,
      "default": 0
    }
  },
  "required": [
    "assetRef"
  ]
}
```

### UploadRoomMediaDto

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "format": "binary",
      "description": "JPEG, PNG or WebP, at most 4 MB; compress on the client (PD-037)"
    },
    "altText": {
      "type": "string",
      "maxLength": 200
    },
    "displayOrder": {
      "type": "number",
      "minimum": 0,
      "maximum": 10000,
      "description": "Defaults to the number of existing media entries"
    }
  },
  "required": [
    "file"
  ]
}
```

### UpdateRoomMediaDto

```json
{
  "type": "object",
  "properties": {
    "assetRef": {
      "type": "string",
      "maxLength": 500,
      "description": "Opaque asset reference, not a URL; this API does not upload or fetch the asset"
    },
    "altText": {
      "type": "string",
      "maxLength": 200,
      "nullable": true,
      "description": "Pass null to clear this metadata"
    },
    "displayOrder": {
      "type": "number",
      "minimum": 0,
      "maximum": 10000
    }
  }
}
```

### AuditLogResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "actorUserId": {
      "type": "string",
      "nullable": true,
      "format": "uuid",
      "description": "Null for system actions (workers, public requests)"
    },
    "action": {
      "type": "string"
    },
    "entityType": {
      "type": "string"
    },
    "entityId": {
      "type": "string",
      "format": "uuid"
    },
    "beforeData": {
      "type": "object",
      "nullable": true,
      "additionalProperties": true,
      "description": "Structure depends on action; never contains customer PII or free-text notes"
    },
    "afterData": {
      "type": "object",
      "nullable": true,
      "additionalProperties": true
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "actorUserId",
    "action",
    "entityType",
    "entityId",
    "beforeData",
    "afterData",
    "occurredAt"
  ]
}
```

### AvailableRoomResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    }
  },
  "required": [
    "id",
    "code",
    "name",
    "capacity"
  ]
}
```

### AvailabilityResponseDto

```json
{
  "type": "object",
  "properties": {
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "requestedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "bufferEnabled": {
      "type": "boolean"
    },
    "bufferMinutes": {
      "type": "number"
    },
    "appliedBufferMinutes": {
      "type": "number"
    },
    "reservedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "rooms": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/AvailableRoomResponseDto"
      }
    }
  },
  "required": [
    "branchId",
    "startAt",
    "requestedEndAt",
    "durationMinutes",
    "bufferEnabled",
    "bufferMinutes",
    "appliedBufferMinutes",
    "reservedEndAt",
    "rooms"
  ]
}
```

### CreateRoomBlockDto

```json
{
  "type": "object",
  "properties": {
    "roomId": {
      "type": "string"
    },
    "startAt": {
      "type": "string"
    },
    "endAt": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    }
  },
  "required": [
    "roomId",
    "startAt",
    "endAt",
    "reason"
  ]
}
```

### RoomBlockResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "reason": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "RELEASED"
      ]
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "endAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "branchId",
    "roomId",
    "reason",
    "status",
    "startAt",
    "endAt"
  ]
}
```

### UpdateRoomBlockDto

```json
{
  "type": "object",
  "properties": {
    "startAt": {
      "type": "string"
    },
    "endAt": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    }
  }
}
```

### AvailabilityPolicyResponseDto

```json
{
  "type": "object",
  "properties": {
    "bufferEnabled": {
      "type": "boolean"
    },
    "bufferMinutes": {
      "type": "number",
      "description": "Cleanup minutes added after each booking end (PD-024)"
    },
    "version": {
      "type": "string",
      "description": "Absent until the merchant saves a value (defaults apply)"
    }
  },
  "required": [
    "bufferEnabled",
    "bufferMinutes"
  ]
}
```

### UpdateAvailabilityPolicyDto

```json
{
  "type": "object",
  "properties": {
    "bufferEnabled": {
      "type": "boolean",
      "default": true
    },
    "bufferMinutes": {
      "type": "number",
      "minimum": 0,
      "maximum": 1440,
      "default": 15
    }
  },
  "required": [
    "bufferEnabled",
    "bufferMinutes"
  ]
}
```

### OutboxBacklogDto

```json
{
  "type": "object",
  "properties": {
    "pendingCount": {
      "type": "string",
      "description": "PENDING events, including delayed retries; decimal string"
    },
    "processingCount": {
      "type": "string",
      "description": "Currently PROCESSING events; decimal string"
    },
    "deadCount": {
      "type": "string",
      "description": "DEAD events; decimal string"
    },
    "oldestReadySeconds": {
      "type": "number",
      "nullable": true,
      "description": "Seconds since the oldest ready PENDING event was created, or null"
    }
  },
  "required": [
    "pendingCount",
    "processingCount",
    "deadCount",
    "oldestReadySeconds"
  ]
}
```

### PriceRuleResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "pricePlanId": {
      "type": "string",
      "format": "uuid"
    },
    "specialDateId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "priority": {
      "type": "number",
      "description": "Higher wins; ties are rejected at quote time"
    },
    "weekdays": {
      "description": "0 = Sunday … 6 = Saturday; empty = every day",
      "type": "array",
      "items": {
        "type": "number"
      }
    },
    "startTime": {
      "type": "string",
      "nullable": true,
      "example": "18:00:00"
    },
    "endTime": {
      "type": "string",
      "nullable": true,
      "example": "23:00:00"
    },
    "minDurationMinutes": {
      "type": "number",
      "nullable": true
    },
    "maxDurationMinutes": {
      "type": "number",
      "nullable": true
    },
    "amountVnd": {
      "type": "string",
      "description": "Integer VND as decimal string"
    },
    "amountUnit": {
      "type": "string",
      "nullable": true,
      "enum": [
        "PER_HOUR",
        "PER_BOOKING"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "version": {
      "type": "string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "pricePlanId",
    "specialDateId",
    "roomId",
    "code",
    "name",
    "priority",
    "weekdays",
    "startTime",
    "endTime",
    "minDurationMinutes",
    "maxDurationMinutes",
    "amountVnd",
    "amountUnit",
    "status",
    "version",
    "createdAt",
    "updatedAt"
  ]
}
```

### CreatePriceRuleDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "priority": {
      "type": "number",
      "minimum": -2147483648,
      "maximum": 2147483647
    },
    "amountUnit": {
      "type": "string",
      "enum": [
        "PER_HOUR",
        "PER_BOOKING"
      ]
    },
    "amountVnd": {
      "type": "string",
      "example": "150000",
      "description": "Non-negative integer VND as a decimal string"
    },
    "weekdays": {
      "example": [
        0,
        6
      ],
      "type": "array",
      "items": {
        "type": "number"
      }
    },
    "roomId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "specialDateId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "startTime": {
      "type": "string",
      "nullable": true,
      "example": "18:00:00"
    },
    "endTime": {
      "type": "string",
      "nullable": true,
      "example": "02:00:00"
    },
    "minDurationMinutes": {
      "type": "number",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "maxDurationMinutes": {
      "type": "number",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "code": {
      "type": "string"
    },
    "pricePlanId": {
      "type": "string"
    }
  },
  "required": [
    "name",
    "priority",
    "amountUnit",
    "amountVnd",
    "code",
    "pricePlanId"
  ]
}
```

### UpdatePriceRuleDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "priority": {
      "type": "number",
      "minimum": -2147483648,
      "maximum": 2147483647
    },
    "amountUnit": {
      "type": "string",
      "enum": [
        "PER_HOUR",
        "PER_BOOKING"
      ]
    },
    "amountVnd": {
      "type": "string",
      "example": "150000",
      "description": "Non-negative integer VND as a decimal string"
    },
    "weekdays": {
      "example": [
        0,
        6
      ],
      "type": "array",
      "items": {
        "type": "number"
      }
    },
    "roomId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "specialDateId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "startTime": {
      "type": "string",
      "nullable": true,
      "example": "18:00:00"
    },
    "endTime": {
      "type": "string",
      "nullable": true,
      "example": "02:00:00"
    },
    "minDurationMinutes": {
      "type": "number",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "maxDurationMinutes": {
      "type": "number",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "name",
    "priority",
    "amountUnit",
    "amountVnd",
    "status"
  ]
}
```

### SpecialDateResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "startDate": {
      "type": "string",
      "format": "date"
    },
    "endDate": {
      "type": "string",
      "format": "date"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "code",
    "name",
    "startDate",
    "endDate",
    "status",
    "createdAt",
    "updatedAt"
  ]
}
```

### CreateSpecialDateDto

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "startDate": {
      "type": "string",
      "example": "2030-01-01"
    },
    "endDate": {
      "type": "string",
      "example": "2030-01-02"
    }
  },
  "required": [
    "code",
    "name",
    "startDate",
    "endDate"
  ]
}
```

### UpdateSpecialDateDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "startDate": {
      "type": "string",
      "example": "2030-01-01"
    },
    "endDate": {
      "type": "string",
      "example": "2030-01-02"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    }
  },
  "required": [
    "name",
    "startDate",
    "endDate",
    "status"
  ]
}
```

### PricePlanResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "DRAFT",
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "effectiveFrom": {
      "type": "string",
      "nullable": true,
      "format": "date"
    },
    "effectiveTo": {
      "type": "string",
      "nullable": true,
      "format": "date"
    },
    "version": {
      "type": "string",
      "description": "Optimistic version as decimal string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "code",
    "name",
    "status",
    "effectiveFrom",
    "effectiveTo",
    "version",
    "createdAt",
    "updatedAt"
  ]
}
```

### CreatePricePlanDto

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "effectiveFrom": {
      "type": "string",
      "nullable": true,
      "format": "date",
      "example": "2030-01-01"
    },
    "effectiveTo": {
      "type": "string",
      "nullable": true,
      "format": "date",
      "example": "2030-12-31"
    }
  },
  "required": [
    "code",
    "name"
  ]
}
```

### UpdatePricePlanDto

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "DRAFT",
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "effectiveFrom": {
      "type": "string",
      "nullable": true,
      "format": "date",
      "example": "2030-01-01"
    },
    "effectiveTo": {
      "type": "string",
      "nullable": true,
      "format": "date",
      "example": "2030-12-31"
    }
  },
  "required": [
    "name",
    "status"
  ]
}
```

### BookingDurationPolicyResponseDto

```json
{
  "type": "object",
  "properties": {
    "durationStepMinutes": {
      "type": "number"
    },
    "minDurationMinutes": {
      "type": "number"
    },
    "maxDurationMinutes": {
      "type": "number"
    },
    "version": {
      "type": "string",
      "description": "Present when a policy has been persisted"
    }
  },
  "required": [
    "durationStepMinutes",
    "minDurationMinutes",
    "maxDurationMinutes"
  ]
}
```

### UpdateBookingDurationPolicyDto

```json
{
  "type": "object",
  "properties": {
    "durationStepMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440,
      "example": 30
    },
    "minDurationMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440,
      "example": 60
    },
    "maxDurationMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440,
      "example": 480
    }
  },
  "required": [
    "durationStepMinutes",
    "minDurationMinutes",
    "maxDurationMinutes"
  ]
}
```

### QuoteRequestDto

```json
{
  "type": "object",
  "properties": {
    "startAt": {
      "type": "string",
      "example": "2030-04-10T22:30:00+07:00",
      "description": "ISO-8601 timestamp with explicit offset"
    },
    "durationMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440,
      "example": 120
    }
  },
  "required": [
    "startAt",
    "durationMinutes"
  ]
}
```

### QuoteLocalStartDto

```json
{
  "type": "object",
  "properties": {
    "date": {
      "type": "string",
      "example": "2030-04-10"
    },
    "time": {
      "type": "string",
      "example": "22:30:00"
    },
    "weekday": {
      "type": "number",
      "minimum": 0,
      "maximum": 6,
      "description": "Sunday=0 through Saturday=6"
    }
  },
  "required": [
    "date",
    "time",
    "weekday"
  ]
}
```

### QuoteSpecialDateDto

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string"
    },
    "startDate": {
      "type": "string",
      "format": "date"
    },
    "endDate": {
      "type": "string",
      "format": "date"
    }
  },
  "required": [
    "code",
    "startDate",
    "endDate"
  ]
}
```

### QuoteCalculationDto

```json
{
  "type": "object",
  "properties": {
    "pricePlanId": {
      "type": "string",
      "format": "uuid"
    },
    "pricePlanCode": {
      "type": "string"
    },
    "pricePlanVersion": {
      "type": "string"
    },
    "priceRuleId": {
      "type": "string",
      "format": "uuid"
    },
    "priceRuleCode": {
      "type": "string"
    },
    "priceRuleVersion": {
      "type": "string"
    },
    "priority": {
      "type": "number"
    },
    "amountUnit": {
      "type": "string",
      "enum": [
        "PER_HOUR",
        "PER_BOOKING"
      ]
    },
    "configuredAmountVnd": {
      "type": "string",
      "description": "Configured integer VND, encoded as a decimal string"
    },
    "matchedOnLocalStart": {
      "$ref": "#/components/schemas/QuoteLocalStartDto"
    },
    "specialDate": {
      "nullable": true,
      "type": "object",
      "allOf": [
        {
          "$ref": "#/components/schemas/QuoteSpecialDateDto"
        }
      ]
    },
    "rounding": {
      "type": "string",
      "example": "nearest 1 VND, half up"
    }
  },
  "required": [
    "pricePlanId",
    "pricePlanCode",
    "pricePlanVersion",
    "priceRuleId",
    "priceRuleCode",
    "priceRuleVersion",
    "priority",
    "amountUnit",
    "configuredAmountVnd",
    "matchedOnLocalStart",
    "specialDate",
    "rounding"
  ]
}
```

### PriceSnapshotDto

```json
{
  "type": "object",
  "properties": {
    "schemaVersion": {
      "type": "number",
      "example": 1
    },
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "timezone": {
      "type": "string",
      "example": "Asia/Ho_Chi_Minh"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "endAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "currency": {
      "type": "string",
      "enum": [
        "VND"
      ]
    },
    "totalAmountVnd": {
      "type": "string",
      "description": "Final amount as an integer VND decimal string"
    },
    "calculation": {
      "$ref": "#/components/schemas/QuoteCalculationDto"
    },
    "bookingDurationPolicy": {
      "$ref": "#/components/schemas/BookingDurationPolicyResponseDto"
    }
  },
  "required": [
    "schemaVersion",
    "tenantId",
    "branchId",
    "roomId",
    "timezone",
    "startAt",
    "endAt",
    "durationMinutes",
    "currency",
    "totalAmountVnd",
    "calculation",
    "bookingDurationPolicy"
  ]
}
```

### QuoteResponseDto

```json
{
  "type": "object",
  "properties": {
    "priceSnapshot": {
      "$ref": "#/components/schemas/PriceSnapshotDto"
    }
  },
  "required": [
    "priceSnapshot"
  ]
}
```

### HoldTtlResponseDto

```json
{
  "type": "object",
  "properties": {
    "channel": {
      "type": "string"
    },
    "ttlMinutes": {
      "type": "number"
    },
    "version": {
      "type": "string"
    }
  },
  "required": [
    "channel",
    "ttlMinutes"
  ]
}
```

### HoldTtlListDto

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/HoldTtlResponseDto"
      }
    }
  },
  "required": [
    "limit",
    "offset",
    "hasMore",
    "items"
  ]
}
```

### UpdateHoldTtlDto

```json
{
  "type": "object",
  "properties": {
    "ttlMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440,
      "example": 15
    }
  },
  "required": [
    "ttlMinutes"
  ]
}
```

### DepositPolicySnapshotDto

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "NONE",
        "FIXED",
        "PERCENT"
      ]
    },
    "fixedAmountVnd": {
      "type": "string",
      "nullable": true
    },
    "percent": {
      "type": "string",
      "nullable": true,
      "example": "30.0000"
    },
    "policyVersion": {
      "type": "string",
      "nullable": true,
      "description": "Channel deposit-policy version at snapshot time; null when the channel was unconfigured (NONE default)"
    },
    "requiredAmountVnd": {
      "type": "string",
      "description": "Required deposit for the snapshotted quote total. FIXED is capped at the total; PERCENT rounds up to whole VND"
    }
  },
  "required": [
    "mode",
    "fixedAmountVnd",
    "percent",
    "policyVersion",
    "requiredAmountVnd"
  ]
}
```

### HoldResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "channel": {
      "type": "string"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "bufferMinutes": {
      "type": "number"
    },
    "reservedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "status": {
      "type": "string",
      "enum": [
        "HELD",
        "EXPIRED",
        "CONFIRMED"
      ]
    },
    "customerPhone": {
      "type": "string",
      "nullable": true,
      "description": "Only present in individual hold responses"
    },
    "customerEmail": {
      "type": "string",
      "nullable": true,
      "description": "Only present in individual hold responses"
    },
    "priceSnapshot": {
      "nullable": true,
      "description": "Immutable server-calculated quote snapshot, only present in individual hold responses",
      "type": "object",
      "allOf": [
        {
          "$ref": "#/components/schemas/PriceSnapshotDto"
        }
      ]
    },
    "phoneVerifiedAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time",
      "description": "Time staff recorded a successful verification call; individual responses only"
    },
    "phoneVerifiedBy": {
      "type": "string",
      "nullable": true,
      "format": "uuid",
      "description": "Staff user who recorded the verification call; individual responses only"
    },
    "depositPolicySnapshot": {
      "nullable": true,
      "description": "Deposit policy frozen with the price snapshot; individual responses only",
      "type": "object",
      "allOf": [
        {
          "$ref": "#/components/schemas/DepositPolicySnapshotDto"
        }
      ]
    },
    "publicAcceptedTerms": {
      "type": "string",
      "nullable": true,
      "description": "WEB holds: exact public terms the customer accepted. Confirmation must send this text as cancellationTerms. Null for staff holds; individual responses only"
    },
    "publicAcceptedTermsVersion": {
      "type": "string",
      "nullable": true,
      "description": "Version of publicAcceptedTerms; individual responses only"
    }
  },
  "required": [
    "id",
    "branchId",
    "roomId",
    "channel",
    "startAt",
    "durationMinutes",
    "bufferMinutes",
    "reservedEndAt",
    "expiresAt",
    "status"
  ]
}
```

### AttachHoldDetailsDto

```json
{
  "type": "object",
  "properties": {
    "phone": {
      "type": "string",
      "example": "0912345678",
      "description": "Phone number for manual verification; digits with optional leading +",
      "maxLength": 16
    },
    "email": {
      "type": "string",
      "example": "guest@example.com",
      "maxLength": 254
    },
    "expectedTotalAmountVnd": {
      "type": "string",
      "example": "150000",
      "description": "Total VND shown by the quote API, as a decimal string"
    }
  },
  "required": [
    "phone",
    "expectedTotalAmountVnd"
  ]
}
```

### CreateHoldDto

```json
{
  "type": "object",
  "properties": {
    "roomId": {
      "type": "string"
    },
    "startAt": {
      "type": "string",
      "example": "2035-01-01T18:00:00+07:00"
    },
    "durationMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440
    },
    "channel": {
      "type": "string",
      "example": "WALK_IN"
    }
  },
  "required": [
    "roomId",
    "startAt",
    "durationMinutes",
    "channel"
  ]
}
```

### HoldListResponseDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/HoldResponseDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### NoDepositPolicyResponseDto

```json
{
  "type": "object",
  "properties": {
    "channel": {
      "type": "string"
    },
    "configured": {
      "type": "boolean"
    },
    "allowed": {
      "type": "boolean",
      "nullable": true,
      "description": "null when no merchant configuration exists"
    },
    "version": {
      "type": "string",
      "description": "Configuration version; absent when unconfigured"
    }
  },
  "required": [
    "channel",
    "configured",
    "allowed"
  ]
}
```

### NoDepositPolicyListDto

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/NoDepositPolicyResponseDto"
      }
    }
  },
  "required": [
    "limit",
    "offset",
    "hasMore",
    "items"
  ]
}
```

### UpdateNoDepositPolicyDto

```json
{
  "type": "object",
  "properties": {
    "allowed": {
      "type": "boolean",
      "description": "Whether no-deposit confirmation is enabled for this merchant and channel"
    }
  },
  "required": [
    "allowed"
  ]
}
```

### DepositPolicyResponseDto

```json
{
  "type": "object",
  "properties": {
    "channel": {
      "type": "string"
    },
    "configured": {
      "type": "boolean"
    },
    "mode": {
      "type": "string",
      "enum": [
        "NONE",
        "FIXED",
        "PERCENT"
      ]
    },
    "fixedAmountVnd": {
      "type": "string",
      "nullable": true
    },
    "percent": {
      "type": "string",
      "nullable": true
    },
    "version": {
      "type": "string"
    }
  },
  "required": [
    "channel",
    "configured",
    "mode",
    "fixedAmountVnd",
    "percent"
  ]
}
```

### DepositPolicyListDto

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DepositPolicyResponseDto"
      }
    }
  },
  "required": [
    "limit",
    "offset",
    "hasMore",
    "items"
  ]
}
```

### UpdateDepositPolicyDto

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "NONE",
        "FIXED",
        "PERCENT"
      ]
    },
    "fixedAmountVnd": {
      "type": "string",
      "nullable": true,
      "example": "150000",
      "description": "VND integer string; required only for FIXED"
    },
    "percent": {
      "type": "string",
      "nullable": true,
      "example": "25.0000",
      "description": "Percentage as decimal string with up to four fractional digits; required only for PERCENT"
    }
  },
  "required": [
    "mode"
  ]
}
```

### HoldExpiryBacklogDto

```json
{
  "type": "object",
  "properties": {
    "overdueCount": {
      "type": "string",
      "description": "Number of overdue holds still awaiting expiration, as a decimal string"
    },
    "oldestOverdueSeconds": {
      "type": "number",
      "nullable": true,
      "description": "Age in seconds of the oldest overdue hold; null if none"
    }
  },
  "required": [
    "overdueCount",
    "oldestOverdueSeconds"
  ]
}
```

### ConfirmHoldDto

```json
{
  "type": "object",
  "properties": {
    "cancellationTerms": {
      "type": "string",
      "maxLength": 5000,
      "description": "Exact cancellation terms shown and agreed for this booking"
    }
  },
  "required": [
    "cancellationTerms"
  ]
}
```

### ConfirmationPolicySnapshotDto

```json
{
  "type": "object",
  "properties": {
    "depositMode": {
      "type": "string",
      "enum": [
        "NONE",
        "FIXED",
        "PERCENT"
      ]
    },
    "depositPolicyVersion": {
      "type": "string",
      "nullable": true
    },
    "noDepositAllowed": {
      "type": "boolean",
      "description": "True for the no-deposit path; false when a deposit was required and covered"
    },
    "noDepositPolicyVersion": {
      "type": "string",
      "nullable": true
    },
    "requiredDepositVnd": {
      "type": "string",
      "description": "Deposit-required path only"
    },
    "depositRecordedVnd": {
      "type": "string",
      "description": "Deposit-required path only: hold deposits recorded at confirmation"
    }
  },
  "required": [
    "depositMode",
    "depositPolicyVersion",
    "noDepositAllowed",
    "noDepositPolicyVersion"
  ]
}
```

### BookingOutcomeDto

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "CUSTOMER_CANCELLED",
        "MERCHANT_CANCELLED",
        "NO_SHOW"
      ]
    },
    "note": {
      "type": "string"
    },
    "refundAmountVnd": {
      "type": "string",
      "description": "CASH refund recorded by staff; \"0\" when none"
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "type",
    "note",
    "refundAmountVnd",
    "recordedBy",
    "recordedAt"
  ]
}
```

### BookingResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "channel": {
      "type": "string"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "bufferMinutes": {
      "type": "number"
    },
    "reservedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "customerPhone": {
      "type": "string"
    },
    "customerEmail": {
      "type": "string",
      "nullable": true
    },
    "phoneVerifiedAt": {
      "type": "string",
      "format": "date-time"
    },
    "phoneVerifiedBy": {
      "type": "string",
      "format": "uuid"
    },
    "priceSnapshot": {
      "$ref": "#/components/schemas/PriceSnapshotDto"
    },
    "cancellationTerms": {
      "type": "string"
    },
    "confirmationPolicySnapshot": {
      "$ref": "#/components/schemas/ConfirmationPolicySnapshotDto"
    },
    "status": {
      "type": "string",
      "enum": [
        "CONFIRMED",
        "CHECKED_IN",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW"
      ]
    },
    "confirmedBy": {
      "type": "string",
      "format": "uuid"
    },
    "confirmedAt": {
      "type": "string",
      "format": "date-time"
    },
    "checkedInAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time"
    },
    "checkedInBy": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "checkedOutAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time",
      "description": "Actual end of use; may be before or after the scheduled end"
    },
    "checkedOutBy": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "lateMinutes": {
      "type": "number",
      "nullable": true,
      "description": "Whole minutes after the scheduled end at check-out (0 when on time or early); null before check-out"
    },
    "overtimeMinutes": {
      "type": "number",
      "nullable": true,
      "description": "PD-030: equals lateMinutes when it exceeds the grace snapshot, otherwise 0. Recorded only; not charged"
    },
    "overtimeGraceMinutes": {
      "type": "number",
      "nullable": true,
      "description": "Merchant grace minutes applied at check-out"
    },
    "outcome": {
      "nullable": true,
      "description": "Staff-recorded cancellation/no-show outcome",
      "type": "object",
      "allOf": [
        {
          "$ref": "#/components/schemas/BookingOutcomeDto"
        }
      ]
    }
  },
  "required": [
    "id",
    "holdId",
    "branchId",
    "roomId",
    "channel",
    "startAt",
    "durationMinutes",
    "bufferMinutes",
    "reservedEndAt",
    "customerPhone",
    "customerEmail",
    "phoneVerifiedAt",
    "phoneVerifiedBy",
    "priceSnapshot",
    "cancellationTerms",
    "confirmationPolicySnapshot",
    "status",
    "confirmedBy",
    "confirmedAt",
    "checkedInAt",
    "checkedInBy",
    "checkedOutAt",
    "checkedOutBy",
    "lateMinutes",
    "overtimeMinutes",
    "overtimeGraceMinutes",
    "outcome"
  ]
}
```

### BookingListResponseDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/BookingResponseDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### ManualPaymentSummaryDto

```json
{
  "type": "object",
  "properties": {
    "totalRecordedVnd": {
      "type": "string",
      "description": "Sum of recorded payments in VND; decimal string to preserve integer precision"
    },
    "paymentCount": {
      "type": "number",
      "description": "Number of recorded manual payment entries"
    }
  },
  "required": [
    "totalRecordedVnd",
    "paymentCount"
  ]
}
```

### ManualPaymentResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "bookingId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "method": {
      "type": "string",
      "enum": [
        "CASH"
      ]
    },
    "amountVnd": {
      "type": "string"
    },
    "note": {
      "type": "string",
      "nullable": true
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "bookingId",
    "branchId",
    "method",
    "amountVnd",
    "note",
    "recordedBy",
    "recordedAt"
  ]
}
```

### ManualPaymentListDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/ManualPaymentResponseDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### RecordManualPaymentDto

```json
{
  "type": "object",
  "properties": {
    "method": {
      "type": "string",
      "enum": [
        "CASH"
      ]
    },
    "amountVnd": {
      "type": "string",
      "description": "Positive integer VND as a decimal string",
      "example": "150000"
    },
    "note": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": [
    "method",
    "amountVnd"
  ]
}
```

### CreatePublicHoldDto

```json
{
  "type": "object",
  "properties": {
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "startAt": {
      "type": "string",
      "example": "2035-01-01T18:00:00+07:00"
    },
    "durationMinutes": {
      "type": "number",
      "minimum": 1,
      "maximum": 1440
    },
    "phone": {
      "type": "string",
      "example": "0912345678"
    },
    "email": {
      "type": "string",
      "maxLength": 254
    },
    "expectedTotalAmountVnd": {
      "type": "string",
      "example": "180000"
    },
    "termsVersion": {
      "type": "string",
      "example": "1",
      "description": "Version returned by the public booking-terms endpoint"
    }
  },
  "required": [
    "roomId",
    "startAt",
    "durationMinutes",
    "phone",
    "expectedTotalAmountVnd",
    "termsVersion"
  ]
}
```

### PublicHoldResponseDto

```json
{
  "type": "object",
  "properties": {
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "reservedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "status": {
      "type": "string",
      "enum": [
        "HELD",
        "EXPIRED",
        "CONFIRMED"
      ]
    },
    "totalAmountVnd": {
      "type": "string"
    },
    "termsVersion": {
      "type": "string"
    },
    "depositRequiredVnd": {
      "type": "string",
      "description": "Deposit the merchant requires before staff can confirm (snapshotted at hold time); \"0\" when none is required. Paid in person; no online payment"
    },
    "bookingCode": {
      "type": "string",
      "description": "128-bit lookup code. Store securely; returned again only for matching idempotent replay."
    }
  },
  "required": [
    "holdId",
    "branchId",
    "roomId",
    "startAt",
    "durationMinutes",
    "reservedEndAt",
    "expiresAt",
    "status",
    "totalAmountVnd",
    "termsVersion",
    "depositRequiredVnd",
    "bookingCode"
  ]
}
```

### PublicBookingLookupDto

```json
{
  "type": "object",
  "properties": {
    "phone": {
      "type": "string"
    },
    "bookingCode": {
      "type": "string",
      "minLength": 32,
      "maxLength": 32
    }
  },
  "required": [
    "phone",
    "bookingCode"
  ]
}
```

### PublicBookingStatusDto

```json
{
  "type": "object",
  "properties": {
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "bookingId": {
      "type": "string",
      "nullable": true,
      "format": "uuid"
    },
    "bookingStatus": {
      "type": "string",
      "nullable": true,
      "enum": [
        "CONFIRMED",
        "CHECKED_IN",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW"
      ],
      "description": "Booking status once staff confirmed the hold"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "status": {
      "type": "string",
      "enum": [
        "HELD",
        "EXPIRED",
        "CONFIRMED"
      ]
    },
    "totalAmountVnd": {
      "type": "string"
    },
    "termsVersion": {
      "type": "string"
    },
    "depositRequiredVnd": {
      "type": "string",
      "description": "Deposit required before confirmation; \"0\" when none is required"
    },
    "depositRecordedVnd": {
      "type": "string",
      "description": "Deposit recorded by staff so far"
    }
  },
  "required": [
    "holdId",
    "bookingId",
    "bookingStatus",
    "branchId",
    "roomId",
    "startAt",
    "durationMinutes",
    "status",
    "totalAmountVnd",
    "termsVersion",
    "depositRequiredVnd",
    "depositRecordedVnd"
  ]
}
```

### HoldDepositEntryDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "method": {
      "type": "string",
      "enum": [
        "CASH"
      ]
    },
    "amountVnd": {
      "type": "string"
    },
    "note": {
      "type": "string",
      "nullable": true
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    },
    "reversed": {
      "type": "boolean",
      "description": "True when an Owner/Branch Manager reversed this entry (PAY-007); reversed entries do not count"
    }
  },
  "required": [
    "id",
    "holdId",
    "branchId",
    "method",
    "amountVnd",
    "note",
    "recordedBy",
    "recordedAt",
    "reversed"
  ]
}
```

### HoldDepositStatusDto

```json
{
  "type": "object",
  "properties": {
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "holdStatus": {
      "type": "string",
      "enum": [
        "HELD",
        "EXPIRED",
        "CONFIRMED"
      ]
    },
    "depositPolicySnapshot": {
      "nullable": true,
      "description": "Null until customer details and the price snapshot are recorded",
      "type": "object",
      "allOf": [
        {
          "$ref": "#/components/schemas/DepositPolicySnapshotDto"
        }
      ]
    },
    "requiredAmountVnd": {
      "type": "string"
    },
    "totalRecordedVnd": {
      "type": "string",
      "description": "Recorded deposits net of reversals"
    },
    "remainingVnd": {
      "type": "string"
    },
    "depositSatisfied": {
      "type": "boolean",
      "description": "True when the snapshot requires a deposit and the recorded total covers it"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/HoldDepositEntryDto"
      }
    }
  },
  "required": [
    "holdId",
    "holdStatus",
    "depositPolicySnapshot",
    "requiredAmountVnd",
    "totalRecordedVnd",
    "remainingVnd",
    "depositSatisfied",
    "items"
  ]
}
```

### RecordHoldDepositDto

```json
{
  "type": "object",
  "properties": {
    "method": {
      "type": "string",
      "enum": [
        "CASH"
      ]
    },
    "amountVnd": {
      "type": "string",
      "description": "Positive integer VND as a decimal string; must not exceed the remaining required deposit",
      "example": "50000"
    },
    "note": {
      "type": "string",
      "maxLength": 500
    }
  },
  "required": [
    "method",
    "amountVnd"
  ]
}
```

### RecordBookingOutcomeDto

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "CUSTOMER_CANCELLED",
        "MERCHANT_CANCELLED",
        "NO_SHOW"
      ]
    },
    "note": {
      "type": "string",
      "maxLength": 1000,
      "description": "Staff review note, required (PD-015)"
    },
    "refundAmountVnd": {
      "type": "string",
      "description": "CASH refund already handed back, decimal VND; must not exceed recorded deposits plus payments. Staff decides; never computed",
      "example": "0"
    }
  },
  "required": [
    "type",
    "note"
  ]
}
```

### OvertimePolicyDto

```json
{
  "type": "object",
  "properties": {
    "configured": {
      "type": "boolean",
      "description": "False when the merchant has not saved a value and the default applies"
    },
    "graceMinutes": {
      "type": "number",
      "description": "Late check-out within this many minutes after the scheduled end is not overtime"
    },
    "version": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "configured",
    "graceMinutes",
    "version"
  ]
}
```

### UpdateOvertimePolicyDto

```json
{
  "type": "object",
  "properties": {
    "graceMinutes": {
      "type": "number",
      "minimum": 0,
      "maximum": 60,
      "default": 10
    }
  },
  "required": [
    "graceMinutes"
  ]
}
```

### LedgerEntryDto

```json
{
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "DEPOSIT",
        "CASH",
        "SURCHARGE",
        "REVERSAL",
        "REFUND"
      ]
    },
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "amountVnd": {
      "type": "string",
      "description": "Always positive; the kind tells whether it adds to due, adds to paid or subtracts"
    },
    "note": {
      "type": "string",
      "nullable": true,
      "description": "Payment note, surcharge/reversal reason or outcome note"
    },
    "reversesType": {
      "type": "string",
      "nullable": true,
      "enum": [
        "HOLD_DEPOSIT",
        "MANUAL_PAYMENT",
        "SURCHARGE"
      ],
      "description": "REVERSAL only: type of the reversed entry"
    },
    "reversesId": {
      "type": "string",
      "nullable": true,
      "format": "uuid",
      "description": "REVERSAL only: ID of the reversed entry"
    },
    "reversed": {
      "type": "boolean",
      "description": "True for DEPOSIT/CASH/SURCHARGE entries that have been reversed"
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "kind",
    "id",
    "amountVnd",
    "note",
    "reversesType",
    "reversesId",
    "reversed",
    "recordedBy",
    "recordedAt"
  ]
}
```

### BookingAccountDto

```json
{
  "type": "object",
  "properties": {
    "bookingId": {
      "type": "string",
      "format": "uuid"
    },
    "bookingStatus": {
      "type": "string",
      "enum": [
        "CONFIRMED",
        "CHECKED_IN",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW"
      ]
    },
    "priceTotalVnd": {
      "type": "string",
      "description": "Total from the price snapshot"
    },
    "surchargesVnd": {
      "type": "string",
      "description": "Surcharges net of reversals"
    },
    "dueVnd": {
      "type": "string",
      "description": "priceTotalVnd + surchargesVnd; 0 for CANCELLED/NO_SHOW (PD-036)"
    },
    "depositsVnd": {
      "type": "string",
      "description": "Hold deposits net of reversals"
    },
    "cashVnd": {
      "type": "string",
      "description": "Booking CASH payments net of reversals"
    },
    "refundsVnd": {
      "type": "string",
      "description": "Refund recorded with the cancellation/no-show outcome"
    },
    "paidVnd": {
      "type": "string",
      "description": "depositsVnd + cashVnd − refundsVnd"
    },
    "balanceVnd": {
      "type": "string",
      "description": "dueVnd − paidVnd; negative means collected more than due"
    },
    "settlement": {
      "type": "string",
      "enum": [
        "UNPAID",
        "PARTIAL",
        "PAID",
        "OVERPAID",
        "CLOSED"
      ],
      "description": "CLOSED for CANCELLED/NO_SHOW"
    },
    "retainedVnd": {
      "type": "string",
      "nullable": true,
      "description": "CANCELLED/NO_SHOW only: amount the merchant keeps (= paidVnd)"
    },
    "entries": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/LedgerEntryDto"
      }
    }
  },
  "required": [
    "bookingId",
    "bookingStatus",
    "priceTotalVnd",
    "surchargesVnd",
    "dueVnd",
    "depositsVnd",
    "cashVnd",
    "refundsVnd",
    "paidVnd",
    "balanceVnd",
    "settlement",
    "retainedVnd",
    "entries"
  ]
}
```

### AddSurchargeDto

```json
{
  "type": "object",
  "properties": {
    "amountVnd": {
      "type": "string",
      "description": "Positive integer VND as a decimal string",
      "example": "50000"
    },
    "reason": {
      "type": "string",
      "maxLength": 500,
      "description": "What the surcharge is for (drinks, service…), required"
    }
  },
  "required": [
    "amountVnd",
    "reason"
  ]
}
```

### SurchargeResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "bookingId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "amountVnd": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "bookingId",
    "branchId",
    "amountVnd",
    "reason",
    "recordedBy",
    "recordedAt"
  ]
}
```

### CreateReversalDto

```json
{
  "type": "object",
  "properties": {
    "entryType": {
      "type": "string",
      "enum": [
        "HOLD_DEPOSIT",
        "MANUAL_PAYMENT",
        "SURCHARGE"
      ]
    },
    "entryId": {
      "type": "string",
      "format": "uuid",
      "description": "ID of the hold deposit, manual payment or surcharge being reversed"
    },
    "reason": {
      "type": "string",
      "maxLength": 500,
      "description": "Why the original entry is wrong; required"
    }
  },
  "required": [
    "entryType",
    "entryId",
    "reason"
  ]
}
```

### ReversalResponseDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "entryType": {
      "type": "string",
      "enum": [
        "HOLD_DEPOSIT",
        "MANUAL_PAYMENT",
        "SURCHARGE"
      ]
    },
    "entryId": {
      "type": "string",
      "format": "uuid"
    },
    "amountVnd": {
      "type": "string",
      "description": "Full amount of the reversed entry"
    },
    "reason": {
      "type": "string"
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "branchId",
    "entryType",
    "entryId",
    "amountVnd",
    "reason",
    "recordedBy",
    "recordedAt"
  ]
}
```

### UnresolvedDepositDto

```json
{
  "type": "object",
  "properties": {
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "channel": {
      "type": "string"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "customerPhone": {
      "type": "string",
      "nullable": true
    },
    "netDepositVnd": {
      "type": "string"
    }
  },
  "required": [
    "holdId",
    "branchId",
    "roomId",
    "channel",
    "startAt",
    "expiresAt",
    "customerPhone",
    "netDepositVnd"
  ]
}
```

### UnresolvedDepositListDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/UnresolvedDepositDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### ResolveDepositDto

```json
{
  "type": "object",
  "properties": {
    "refundAmountVnd": {
      "type": "string",
      "description": "CASH handed back, integer VND (0 = keep everything); at most the net deposit",
      "example": "0"
    },
    "reason": {
      "type": "string",
      "maxLength": 500,
      "description": "Why the deposit was refunded or kept; required"
    }
  },
  "required": [
    "refundAmountVnd",
    "reason"
  ]
}
```

### DepositResolutionDto

```json
{
  "type": "object",
  "properties": {
    "holdId": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "netDepositVnd": {
      "type": "string",
      "description": "Net deposit on the hold when resolved"
    },
    "refundAmountVnd": {
      "type": "string"
    },
    "retainedVnd": {
      "type": "string",
      "description": "netDepositVnd − refundAmountVnd"
    },
    "reason": {
      "type": "string"
    },
    "recordedBy": {
      "type": "string",
      "format": "uuid"
    },
    "recordedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "holdId",
    "branchId",
    "netDepositVnd",
    "refundAmountVnd",
    "retainedVnd",
    "reason",
    "recordedBy",
    "recordedAt"
  ]
}
```

### CashTotalsDto

```json
{
  "type": "object",
  "properties": {
    "depositsVnd": {
      "type": "string",
      "description": "Hold deposits recorded"
    },
    "bookingCashVnd": {
      "type": "string",
      "description": "Booking CASH recorded"
    },
    "cashReversalsVnd": {
      "type": "string",
      "description": "Reversals of deposits and CASH recorded (reduce cash)"
    },
    "refundsVnd": {
      "type": "string",
      "description": "Cancellation/no-show refunds plus expired-hold deposit refunds"
    },
    "netCashVnd": {
      "type": "string",
      "description": "depositsVnd + bookingCashVnd − cashReversalsVnd − refundsVnd: expected change in the till"
    },
    "surchargesVnd": {
      "type": "string",
      "description": "Surcharges added net of surcharge reversals (amount due, not cash)"
    }
  },
  "required": [
    "depositsVnd",
    "bookingCashVnd",
    "cashReversalsVnd",
    "refundsVnd",
    "netCashVnd",
    "surchargesVnd"
  ]
}
```

### CashRecorderTotalsDto

```json
{
  "type": "object",
  "properties": {
    "depositsVnd": {
      "type": "string",
      "description": "Hold deposits recorded"
    },
    "bookingCashVnd": {
      "type": "string",
      "description": "Booking CASH recorded"
    },
    "cashReversalsVnd": {
      "type": "string",
      "description": "Reversals of deposits and CASH recorded (reduce cash)"
    },
    "refundsVnd": {
      "type": "string",
      "description": "Cancellation/no-show refunds plus expired-hold deposit refunds"
    },
    "netCashVnd": {
      "type": "string",
      "description": "depositsVnd + bookingCashVnd − cashReversalsVnd − refundsVnd: expected change in the till"
    },
    "surchargesVnd": {
      "type": "string",
      "description": "Surcharges added net of surcharge reversals (amount due, not cash)"
    },
    "userId": {
      "type": "string",
      "format": "uuid"
    },
    "displayName": {
      "type": "string"
    }
  },
  "required": [
    "depositsVnd",
    "bookingCashVnd",
    "cashReversalsVnd",
    "refundsVnd",
    "netCashVnd",
    "surchargesVnd",
    "userId",
    "displayName"
  ]
}
```

### CashReportDto

```json
{
  "type": "object",
  "properties": {
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "date": {
      "type": "string",
      "format": "date"
    },
    "timezone": {
      "type": "string"
    },
    "from": {
      "type": "string",
      "format": "date-time",
      "description": "Inclusive start of the local day"
    },
    "to": {
      "type": "string",
      "format": "date-time",
      "description": "Exclusive end of the local day"
    },
    "totals": {
      "$ref": "#/components/schemas/CashTotalsDto"
    },
    "byRecorder": {
      "description": "Same totals per staff member who recorded the entries",
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/CashRecorderTotalsDto"
      }
    }
  },
  "required": [
    "branchId",
    "date",
    "timezone",
    "from",
    "to",
    "totals",
    "byRecorder"
  ]
}
```

### PublicationResponseDto

```json
{
  "type": "object",
  "properties": {
    "published": {
      "type": "boolean"
    },
    "platformApproved": {
      "type": "boolean",
      "description": "Separate platform approval; cannot be changed through the merchant API"
    },
    "version": {
      "type": "string"
    },
    "tenantStatus": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ],
      "description": "GET only. INACTIVE = suspended by Platform Admin (PD-031): hidden from customers and no new holds"
    }
  },
  "required": [
    "published",
    "platformApproved"
  ]
}
```

### UpdatePublicationDto

```json
{
  "type": "object",
  "properties": {
    "published": {
      "type": "boolean",
      "description": "Request publication of all active branches and rooms; separate platform approval is required before they appear publicly"
    }
  },
  "required": [
    "published"
  ]
}
```

### PublicBookingTermsResponseDto

```json
{
  "type": "object",
  "properties": {
    "configured": {
      "type": "boolean"
    },
    "terms": {
      "type": "string",
      "nullable": true
    },
    "version": {
      "type": "string",
      "nullable": true,
      "description": "Opaque version that must be submitted when accepting these terms"
    },
    "updatedAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time"
    }
  },
  "required": [
    "configured",
    "terms",
    "version"
  ]
}
```

### UpdatePublicBookingTermsDto

```json
{
  "type": "object",
  "properties": {
    "terms": {
      "type": "string",
      "maxLength": 5000,
      "description": "Single public cancellation/booking terms text shown before guest submission"
    }
  },
  "required": [
    "terms"
  ]
}
```

### PublicBranchDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "merchantId": {
      "type": "string",
      "format": "uuid"
    },
    "merchantName": {
      "type": "string"
    },
    "merchantLogoUrl": {
      "type": "string",
      "nullable": true,
      "description": "Public logo URL (PD-037); null when the merchant has none"
    },
    "name": {
      "type": "string"
    },
    "timezone": {
      "type": "string"
    }
  },
  "required": [
    "id",
    "merchantId",
    "merchantName",
    "merchantLogoUrl",
    "name",
    "timezone"
  ]
}
```

### PublicBranchListDto

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/PublicBranchDto"
      }
    }
  },
  "required": [
    "limit",
    "offset",
    "hasMore",
    "items"
  ]
}
```

### PublicRoomDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    }
  },
  "required": [
    "id",
    "branchId",
    "name",
    "capacity"
  ]
}
```

### PublicRoomListDto

```json
{
  "type": "object",
  "properties": {
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    },
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/PublicRoomDto"
      }
    }
  },
  "required": [
    "limit",
    "offset",
    "hasMore",
    "items"
  ]
}
```

### PublicAvailableRoomDto

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "capacity": {
      "type": "number"
    }
  },
  "required": [
    "id",
    "name",
    "capacity"
  ]
}
```

### PublicAvailabilityResponseDto

```json
{
  "type": "object",
  "properties": {
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "requestedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "bufferEnabled": {
      "type": "boolean"
    },
    "bufferMinutes": {
      "type": "number"
    },
    "appliedBufferMinutes": {
      "type": "number"
    },
    "reservedEndAt": {
      "type": "string",
      "format": "date-time"
    },
    "rooms": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/PublicAvailableRoomDto"
      }
    }
  },
  "required": [
    "branchId",
    "startAt",
    "requestedEndAt",
    "durationMinutes",
    "bufferEnabled",
    "bufferMinutes",
    "appliedBufferMinutes",
    "reservedEndAt",
    "rooms"
  ]
}
```

### PublicBookingDurationPolicyDto

```json
{
  "type": "object",
  "properties": {
    "durationStepMinutes": {
      "type": "number"
    },
    "minDurationMinutes": {
      "type": "number"
    },
    "maxDurationMinutes": {
      "type": "number"
    }
  },
  "required": [
    "durationStepMinutes",
    "minDurationMinutes",
    "maxDurationMinutes"
  ]
}
```

### PublicQuoteResponseDto

```json
{
  "type": "object",
  "properties": {
    "branchId": {
      "type": "string",
      "format": "uuid"
    },
    "roomId": {
      "type": "string",
      "format": "uuid"
    },
    "timezone": {
      "type": "string"
    },
    "startAt": {
      "type": "string",
      "format": "date-time"
    },
    "endAt": {
      "type": "string",
      "format": "date-time"
    },
    "durationMinutes": {
      "type": "number"
    },
    "currency": {
      "type": "string",
      "enum": [
        "VND"
      ]
    },
    "totalAmountVnd": {
      "type": "string",
      "description": "Final integer VND amount encoded as a decimal string"
    },
    "bookingDurationPolicy": {
      "$ref": "#/components/schemas/PublicBookingDurationPolicyDto"
    }
  },
  "required": [
    "branchId",
    "roomId",
    "timezone",
    "startAt",
    "endAt",
    "durationMinutes",
    "currency",
    "totalAmountVnd",
    "bookingDurationPolicy"
  ]
}
```

### MerchantLogoDto

```json
{
  "type": "object",
  "properties": {
    "configured": {
      "type": "boolean"
    },
    "url": {
      "type": "string",
      "nullable": true,
      "description": "Public Blob URL shown in the customer catalog"
    },
    "contentType": {
      "type": "string",
      "nullable": true,
      "enum": [
        "image/jpeg",
        "image/png",
        "image/webp"
      ]
    },
    "sizeBytes": {
      "type": "number",
      "nullable": true
    },
    "updatedAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time"
    }
  },
  "required": [
    "configured",
    "url",
    "contentType",
    "sizeBytes",
    "updatedAt"
  ]
}
```

### UploadLogoDto

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "format": "binary",
      "description": "JPEG, PNG or WebP, at most 4 MB (PD-037)"
    }
  },
  "required": [
    "file"
  ]
}
```

### ListingResponseDto

```json
{
  "type": "object",
  "properties": {
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "merchantCode": {
      "type": "string"
    },
    "merchantName": {
      "type": "string"
    },
    "tenantStatus": {
      "type": "string"
    },
    "published": {
      "type": "boolean"
    },
    "platformApproved": {
      "type": "boolean"
    },
    "platformDecidedBy": {
      "type": "string",
      "nullable": true,
      "format": "uuid",
      "description": "Platform Admin who made the latest approve/revoke decision"
    },
    "platformDecidedAt": {
      "type": "string",
      "nullable": true,
      "format": "date-time"
    },
    "activeBranchCount": {
      "type": "number",
      "description": "Active branches that would become publicly visible"
    },
    "termsConfigured": {
      "type": "boolean",
      "description": "Public booking terms configured"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "version": {
      "type": "string"
    }
  },
  "required": [
    "tenantId",
    "merchantCode",
    "merchantName",
    "tenantStatus",
    "published",
    "platformApproved",
    "platformDecidedBy",
    "platformDecidedAt",
    "activeBranchCount",
    "termsConfigured",
    "updatedAt",
    "version"
  ]
}
```

### ListingListDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/ListingResponseDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### ListingDecisionDto

```json
{
  "type": "object",
  "properties": {
    "note": {
      "type": "string",
      "maxLength": 500,
      "description": "Reviewer note stored in the audit record"
    }
  }
}
```

### RevokeListingDto

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Reason stored in the audit record"
    }
  },
  "required": [
    "reason"
  ]
}
```

### MerchantSummaryDto

```json
{
  "type": "object",
  "properties": {
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "ownerCount": {
      "type": "number",
      "description": "Active memberships holding the OWNER role"
    },
    "activeBranchCount": {
      "type": "number"
    },
    "published": {
      "type": "boolean"
    },
    "platformApproved": {
      "type": "boolean"
    }
  },
  "required": [
    "tenantId",
    "code",
    "name",
    "status",
    "createdAt",
    "ownerCount",
    "activeBranchCount",
    "published",
    "platformApproved"
  ]
}
```

### MerchantListDto

```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/MerchantSummaryDto"
      }
    },
    "limit": {
      "type": "number"
    },
    "offset": {
      "type": "number"
    },
    "hasMore": {
      "type": "boolean"
    }
  },
  "required": [
    "items",
    "limit",
    "offset",
    "hasMore"
  ]
}
```

### MerchantOwnerInputDto

```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "displayName": {
      "type": "string",
      "maxLength": 200
    },
    "temporaryPassword": {
      "type": "string",
      "minLength": 12,
      "description": "Used only when the email has no account yet; the owner must change it at first login. Share it out of band"
    }
  },
  "required": [
    "email",
    "displayName",
    "temporaryPassword"
  ]
}
```

### CreateMerchantDto

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "example": "KARAOKE_HCM",
      "description": "Unique merchant code: uppercase letters, digits, \"_\" or \"-\""
    },
    "name": {
      "type": "string",
      "maxLength": 200
    },
    "owner": {
      "$ref": "#/components/schemas/MerchantOwnerInputDto"
    }
  },
  "required": [
    "code",
    "name",
    "owner"
  ]
}
```

### MerchantOwnerDto

```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string",
      "format": "uuid"
    },
    "email": {
      "type": "string"
    },
    "membershipId": {
      "type": "string",
      "format": "uuid"
    },
    "accountCreated": {
      "type": "boolean",
      "description": "False when the email already had an account; the supplied temporary password was not applied"
    }
  },
  "required": [
    "userId",
    "email",
    "membershipId",
    "accountCreated"
  ]
}
```

### CreatedMerchantDto

```json
{
  "type": "object",
  "properties": {
    "tenantId": {
      "type": "string",
      "format": "uuid"
    },
    "code": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "INACTIVE"
      ]
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "ownerCount": {
      "type": "number",
      "description": "Active memberships holding the OWNER role"
    },
    "activeBranchCount": {
      "type": "number"
    },
    "published": {
      "type": "boolean"
    },
    "platformApproved": {
      "type": "boolean"
    },
    "owner": {
      "$ref": "#/components/schemas/MerchantOwnerDto"
    }
  },
  "required": [
    "tenantId",
    "code",
    "name",
    "status",
    "createdAt",
    "ownerCount",
    "activeBranchCount",
    "published",
    "platformApproved",
    "owner"
  ]
}
```

### MerchantStatusChangeDto

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500,
      "description": "Reason stored in the audit record"
    }
  },
  "required": [
    "reason"
  ]
}
```
