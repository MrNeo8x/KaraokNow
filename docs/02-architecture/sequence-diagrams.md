# Sequence Diagrams — KaraokeNow

> Vai trò: SA · Phiên bản 1.0 · 22/11/2026  
> Sơ đồ tách luồng đã có bằng chứng khỏi luồng mục tiêu chưa triển khai.

## 1. Merchant request hiện có: tenant + branch authorization

```mermaid
sequenceDiagram
  actor Staff
  participant API as NestJS API
  participant Auth as AuthGuard
  participant Tenant as TenantGuard
  participant Role as RolesGuard
  participant Service as VenueService
  participant DB as PostgreSQL
  Staff->>API: Bearer JWT + X-Tenant-ID + request
  API->>Auth: Xác minh token/session
  Auth-->>API: actor hoặc 401
  API->>Tenant: Kiểm tra membership active
  Tenant-->>API: tenant context hoặc 403
  API->>Role: Kiểm tra role và branch grant
  Role-->>API: cho phép hoặc 403
  API->>Service: DTO đã validate + actor scope
  Service->>DB: SQL có tenant_id/branch scope
  DB-->>Service: dữ liệu / constraint error
  Service->>DB: ghi audit cùng transaction nếu mutation
  Service-->>API: kết quả domain
  API-->>Staff: response + correlation ID
```

Trạng thái: pattern này được dùng ở auth, membership, venue, room blocks và audit APIs.

## 2. Quote giá hiện có

```mermaid
sequenceDiagram
  actor Caller as Merchant caller
  participant API as Pricing API
  participant Guard as Auth/Tenant/Roles
  participant Pricing as PricingService
  participant DB as PostgreSQL
  Caller->>API: POST room quote + local start/duration
  API->>Guard: bearer + tenant + branch authorization
  Guard-->>API: authorized actor
  API->>Pricing: validate room scope and request
  Pricing->>DB: load applicable plan/rules/special dates
  DB-->>Pricing: rule candidates
  Pricing->>Pricing: match local start, priority, amount unit, rounding
  alt tied highest priority
    Pricing-->>API: ambiguity error
  else unique matching rule
    Pricing-->>API: quote response
  end
  API-->>Caller: quote / error envelope
```

Quote API đã có. Persist snapshot vào booking là bước chưa triển khai.

## 3. Target customer booking từ Web/WebView

```mermaid
sequenceDiagram
  actor Customer
  participant Chat as Zalo/Messenger message
  participant Web as Mobile web / WebView
  participant API as Public booking API (planned)
  participant DB as PostgreSQL
  participant Worker as Outbox worker
  participant Channel as Channel adapter (conditional)
  Customer->>Chat: mở lời mời đặt phòng
  Chat-->>Customer: nút mở WebView
  Customer->>Web: chọn địa điểm/branch/date/time/duration/guests
  Web->>API: truy vấn availability và quote
  API->>DB: scoped public listing + rules + occupancy
  DB-->>API: kết quả phù hợp
  API-->>Web: phòng, giá, chính sách
  Customer->>Web: chọn phòng, nhập phone, gửi yêu cầu
  Web->>API: create hold/booking với idempotency key
  API->>DB: transaction + overlap constraint + snapshots
  DB-->>API: booking reference + state
  API-->>Web: kết quả và trạng thái
  API->>DB: commit outbox event cùng transaction
  Worker->>DB: claim/retry event
  Worker->>Channel: gửi tin nhắn kết quả nếu được cấu hình
  Channel-->>Customer: booking reference/state
```

Luồng target; customer WebView, booking API, overlap lifecycle và channel adapter chưa được triển khai.

## 4. Target staff walk-in/manual payment

```mermaid
sequenceDiagram
  actor Reception
  actor Cashier
  participant UI as Reception UI (planned)
  participant API as Booking API (planned)
  participant DB as PostgreSQL
  Reception->>UI: chọn branch/room/time, tạo WALK_IN
  UI->>API: create booking
  API->>DB: validate scope, availability, insert occupancy+booking
  DB-->>API: booking reference
  API-->>UI: booking created
  Cashier->>UI: ghi nhận khoản thanh toán thủ công
  UI->>API: create payment transaction (method/amount)
  API->>DB: append payment record + audit
  DB-->>API: record result
  API-->>UI: trạng thái đối soát
```

Chính sách walk-in/manual payment đã approved; UI/API chưa triển khai. Không có payment provider trong pilot.

## 5. Target outbox reliability

```mermaid
sequenceDiagram
  participant Domain as Domain service
  participant DB as PostgreSQL
  participant Worker as Outbox worker
  participant Adapter as Notification adapter
  Domain->>DB: BEGIN: domain mutation + outbox row
  Domain->>DB: COMMIT
  Worker->>DB: claim event with SKIP LOCKED
  Worker->>Adapter: deliver
  alt success
    Adapter-->>Worker: accepted
    Worker->>DB: mark delivered
  else transient failure
    Adapter-->>Worker: error
    Worker->>DB: increment attempts + backoff
  end
```

Outbox worker/retry nền tảng đã có; booking producer và live channel provider chưa có.
