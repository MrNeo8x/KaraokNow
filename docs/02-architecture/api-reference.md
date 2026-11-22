# Đặc tả API cho frontend

Phiên bản contract: 0.1.0. File được tạo từ `docs/02-architecture/openapi.json`; chạy `npm run api:docs` trong `be/` sau khi cập nhật OpenAPI.

Base URL phát triển: `http://localhost:3000`. Mọi đường dẫn bên dưới đã bao gồm tiền tố `/v1`.

API merchant yêu cầu `Authorization: Bearer <access_token>` và `X-Tenant-ID: <tenant-uuid>` khi endpoint khai báo. Quyền truy cập cụ thể do backend kiểm tra; không suy ra quyền từ việc hiển thị giao diện. Đăng nhập và refresh dùng endpoint trong nhóm auth.

Body dùng `application/json` khi được khai báo. Các trường có dấu `?` trong JSON Schema là tùy chọn nếu không nằm trong `required`. Với PATCH price plan, special date và price rule, body thay toàn bộ trường có thể sửa; selector tùy chọn bị bỏ qua sẽ được xóa.

Lỗi HTTP có dạng `{ "timestamp": "...", "path": "...", "correlationId": "...", "error": { "code": "...", "message": "...", "details": [] } }`; `details` chỉ có khi có nhiều lỗi. Không hiển thị thông tin lỗi 500 nội bộ.

**Giới hạn contract:** nhiều endpoint chưa khai báo schema response trong OpenAPI; các mã trả về và schema bên dưới chỉ phản ánh phần đã khai báo, không chứng minh response rỗng. Kiểm tra backend hoặc chạy thử trước khi phụ thuộc vào trường response chưa được mô tả. Hold hiện chỉ dành cho nhân viên, chưa xác nhận booking, chưa lưu khách hàng hoặc snapshot giá; worker hết hạn phải chạy riêng.

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

Danh sách lễ tân: `GET /v1/merchant/branches/{branchId}/booking/holds?from=2036-01-01T00%3A00%3A00%2B07%3A00&to=2036-01-02T00%3A00%3A00%2B07%3A00&limit=50&offset=0`. `from`/`to` bắt buộc có múi giờ; lọc theo khoảng sử dụng phòng `[startAt, startAt + durationMinutes)` giao với `[from,to)`, không tính buffer. Response gồm `items`, `limit`, `offset`, `hasMore`. Danh sách chỉ bao gồm hold, không có booking đã xác nhận. Hold quá hạn được hiển thị `EXPIRED` theo giờ database; thao tác này không giải phóng occupancy. Phân trang offset có thể thay đổi khi có dữ liệu mới.

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

### POST /v1/auth/logout

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
| 204 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 201 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
| 200 | Chưa mô tả | Chưa khai báo schema |

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
        "EXPIRED"
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
      "type": "object",
      "nullable": true,
      "additionalProperties": true,
      "description": "Immutable server-calculated quote snapshot, only present in individual hold responses"
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
