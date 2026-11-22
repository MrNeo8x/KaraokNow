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

Ghi nhận tiền mặt: `POST /v1/merchant/booking/bookings/{id}/manual-payments` với `Idempotency-Key` và body `{ "method": "CASH", "amountVnd": "30000" }`, `note` tùy chọn. Gửi lại cùng key cùng body trả cùng giao dịch; thay đổi body trả 409. Owner, Branch Manager, Cashier thuộc chi nhánh có thể đọc danh sách và ghi; API ghi nhận, không tự xác nhận đã thu đủ, không đối soát hoặc hoàn tiền. `GET` cùng đường dẫn có `limit`/`offset` để đọc danh sách.

Catalog khách: Owner dùng `GET/PATCH /v1/merchant/catalog/publication` để yêu cầu công bố toàn bộ chi nhánh/phòng hoạt động của merchant; `platformApproved` là trạng thái duyệt độc lập, Owner không thể sửa. Chỉ merchant vừa yêu cầu công bố vừa được platform duyệt mới xuất hiện tại `GET /v1/public/branches` và `GET /v1/public/branches/{id}/rooms`. API duyệt platform, public quote, availability và guest booking chưa có; chưa dùng catalog làm luồng đặt phòng thật.

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
| 200 | Process is alive | Chưa khai báo schema |

### GET /v1/health/ready

Nhóm: operations · Check whether the service can use PostgreSQL

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Service and database are ready | Chưa khai báo schema |
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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/branches

Nhóm: merchant venues

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/availability/buffer-policy

Nhóm: availability

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/pricing/special-dates

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

### GET /v1/merchant/pricing/plans

Nhóm: pricing

| Vị trí | Tên | Bắt buộc | Kiểu / mô tả |
|---|---|---|---|
| header | `X-Tenant-ID` | Có | string |

Xác thực OpenAPI: bearer.

Response được khai báo:

| HTTP | Mô tả | Schema |
|---|---|---|
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Confirmed no-deposit booking or replay with the same terms | {"$ref":"#/components/schemas/BookingResponseDto"} |
| 409 | Expired or incomplete hold, ineligible deposit policy, or conflicting replay | Chưa khai báo schema |

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

## Các schema request và response

Tham chiếu `$ref` trỏ tới tên schema trong danh sách sau. `required` là các trường bắt buộc.

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
      "type": "object",
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
      "type": "object",
      "nullable": true
    },
    "specialDateId": {
      "type": "object",
      "nullable": true
    },
    "startTime": {
      "type": "object",
      "nullable": true,
      "example": "18:00:00"
    },
    "endTime": {
      "type": "object",
      "nullable": true,
      "example": "02:00:00"
    },
    "minDurationMinutes": {
      "type": "object",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "maxDurationMinutes": {
      "type": "object",
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
      "type": "object",
      "nullable": true
    },
    "specialDateId": {
      "type": "object",
      "nullable": true
    },
    "startTime": {
      "type": "object",
      "nullable": true,
      "example": "18:00:00"
    },
    "endTime": {
      "type": "object",
      "nullable": true,
      "example": "02:00:00"
    },
    "minDurationMinutes": {
      "type": "object",
      "nullable": true,
      "minimum": 1,
      "maximum": 1440
    },
    "maxDurationMinutes": {
      "type": "object",
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
      "type": "object",
      "nullable": true,
      "example": "2030-01-01"
    },
    "effectiveTo": {
      "type": "object",
      "nullable": true,
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
      "type": "object",
      "nullable": true,
      "example": "2030-01-01"
    },
    "effectiveTo": {
      "type": "object",
      "nullable": true,
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
      "type": "object",
      "nullable": true,
      "description": "Only present in individual hold responses"
    },
    "customerEmail": {
      "type": "object",
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
      "type": "object",
      "nullable": true,
      "format": "date-time",
      "description": "Time staff recorded a successful verification call; individual responses only"
    },
    "phoneVerifiedBy": {
      "type": "object",
      "nullable": true,
      "format": "uuid",
      "description": "Staff user who recorded the verification call; individual responses only"
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
      "type": "object",
      "nullable": true,
      "example": "150000",
      "description": "VND integer string; required only for FIXED"
    },
    "percent": {
      "type": "object",
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
        "NONE"
      ]
    },
    "depositPolicyVersion": {
      "type": "string",
      "nullable": true
    },
    "noDepositAllowed": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "noDepositPolicyVersion": {
      "type": "string"
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
        "CONFIRMED"
      ]
    },
    "confirmedBy": {
      "type": "string",
      "format": "uuid"
    },
    "confirmedAt": {
      "type": "string",
      "format": "date-time"
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
    "confirmedAt"
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
