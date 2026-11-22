# KaraokeNow MVP Task Board

Last updated: 2026-11-22. This file is the repository source of truth for implementation work. Product decisions remain in `docs/00-product/decision-log.md`.

## Workflow

Statuses:

- `DONE`: implementation and required automated evidence exist.
- `IN_PROGRESS`: actively being implemented; one task at a time unless work is independent.
- `READY`: refined enough to start and has no unresolved dependency.
- `BLOCKED`: cannot be implemented without an explicit decision or external prerequisite.
- `BACKLOG`: valid work, not yet ready or prioritized.

A task moves to `DONE` only when code review, build, relevant tests, migration/API documentation, authorization and audit requirements are satisfied. A passing unit test alone is not sufficient for database or concurrency behavior.

## Current delivery snapshot

Backend package, migrations and tests run from `be/`. On 2026-11-22, `npm run verify` passed with Node 26 and PostgreSQL Docker E2E passed 18/18, including pricing management.

### Frontend workstream — delivered increment and next work

**Rà soát ngày 22/11/2026:** frontend nằm ở `fe/`, tách build/deploy khỏi `be/`. Build Next.js/Webpack và TypeScript thành công; 9 kiểm thử API client đã chạy thành công với Node 26. Workflow frontend CI đã được thêm nhưng chưa có kết quả chạy trên GitHub. Chưa có bằng chứng kiểm thử trình duyệt, tích hợp FE–BE, kiểm tra phân quyền frontend hay UAT Merchant; không chuyển task sang `DONE` chỉ dựa trên build và unit test.

| ID | Công việc | Trạng thái | Đã có và bằng chứng trong code | Còn lại để nghiệm thu |
|---|---|---|---|---|
| FE-001 | Nền Next.js/React, landing và routes | IN_PROGRESS | `fe/src/app/page.tsx`, `merchant/page.tsx`, `booking/page.tsx`; Tailwind và cấu hình shadcn/ui có sẵn, giao diện hiện vẫn dùng CSS riêng. Build đã qua; `.github/workflows/frontend-ci.yml` chạy npm ci/test/build. | Kiểm thử trình duyệt/mobile/accessibility; xác nhận CI trên GitHub; hoàn thiện design system/component khi cần. |
| FE-002 | Đăng nhập, tenant và quản lý chi nhánh/phòng | IN_PROGRESS | `experience.tsx`, `venue-actions.tsx`: login, đổi mật khẩu tạm, logout, nhập tenant UUID, đọc/tạo/sửa chi nhánh/phòng, đổi trạng thái phòng qua API. | Kiểm thử FE–BE với Owner/Branch Manager/Receptionist/Cashier và tenant/branch sai; refresh phiên, chọn tenant thuận tiện, đổi trạng thái chi nhánh. Phiên hiện giữ trong bộ nhớ. |
| FE-003 | Tiện nghi phòng | IN_PROGRESS | `room-amenities.tsx`: xem/thêm/sửa/xóa theo phòng, có xác nhận xóa và xử lý lỗi API. | Kiểm thử trình duyệt với backend, phân quyền và dữ liệu rỗng/lỗi; UAT. Media chỉ là metadata ở backend, chưa có UI upload. |
| FE-004 | Tìm phòng trống và báo giá Merchant | IN_PROGRESS | `availability-quote.tsx`: query theo chi nhánh/thời gian, hiển thị buffer và quote theo phòng. Có chú thích search không giữ phòng. | Kiểm thử múi giờ, dữ liệu rỗng, giá không khớp/đụng độ rule, quyền và backend thực tế. |
| FE-004A | Cấu hình thời lượng và buffer | IN_PROGRESS | `pricing-settings.tsx`: đọc/cập nhật duration và buffer qua API. | Kiểm thử policy, validation và quyền thực tế; UAT. |
| FE-004B | Bảng giá | IN_PROGRESS | `pricing-settings.tsx`: xem/tạo và cập nhật tên, trạng thái, hiệu lực bảng giá qua API Owner. | Kiểm thử tích hợp, quyền, dữ liệu lỗi và UAT. |
| FE-004C | Quy tắc giá | IN_PROGRESS | `price-rules.tsx`: xem/tạo/sửa, đổi trạng thái; điều kiện phòng, ngày trong tuần, giờ, thời lượng và ngày đặc biệt. | Chọn phòng/ngày đặc biệt đang nhập UUID; cần danh sách chọn và UI quản lý ngày đặc biệt. Kiểm thử không làm mất selector khi sửa, phân quyền, timezone và UAT. |
| FE-005 | Lễ tân: giữ phòng | IN_PROGRESS | `availability-quote.tsx`, `hold-lookup.tsx`, `branch-holds.tsx`: tạo hold `WALK_IN`, retry cùng idempotency key, đọc hold theo UUID và liệt kê theo chi nhánh/khoảng thời gian có phân trang qua BKG-006. Build qua; đây chỉ là hold. | Key retry chỉ trong bộ nhớ; cần phục hồi sau reload, FE–BE/role/concurrency E2E. Xác nhận booking, thông tin khách và lịch lễ tân còn phụ thuộc BKG-003/BKG-005/REC-001. |
| FE-006 | Web đặt phòng khách | IN_PROGRESS | `/booking` là prototype responsive, dữ liệu và giá được gắn nhãn minh họa; chưa gửi booking. | Cần public catalog/availability/booking API phù hợp, policy, trạng thái lỗi/hold và UAT trước khi phục vụ khách thật. API hold hiện tại chỉ dành cho nhân viên. |
| FE-007 | WebView Zalo/Messenger và tin nhắn kết quả | BLOCKED | Có định hướng cùng customer web trong tài liệu, chưa có tích hợp kênh. | Quyền nền tảng, adapter/message delivery và booking API khách hàng; không chặn pilot web. |
| FE-008 | API client và hợp đồng lỗi | IN_PROGRESS | `fe/src/lib/api.ts`: bearer/tenant headers, error envelope, validation details, correlation ID và thông báo 5xx an toàn. `fe/test/api.test.mjs`: 9 test pass cho headers/idempotency, 204, 400/401/403/409/422/500, network và abort. | Sinh/kiểm tra types từ OpenAPI; test refresh, contract drift và tích hợp HTTP với backend thật. |

**Thứ tự gối đầu tiếp theo:** (1) bổ sung kiểm thử browser/CI và chạy FE–BE cho FE-002–FE-005; (2) xử lý phục hồi hold chưa rõ kết quả sau reload và session refresh; (3) làm danh sách chọn phòng/ngày đặc biệt và quản lý ngày đặc biệt; (4) nối confirmation/calendar và FE-006 khi backend có contract tương ứng. Các phần này có thể chuẩn bị song song với BKG-003. Pilot không tích hợp thanh toán online.

Nguồn hợp đồng FE: `docs/02-architecture/api-reference.md`, `docs/02-architecture/api-error-contract.md`, `docs/02-architecture/openapi.json`. Nhiều response schema trong OpenAPI chưa khai báo; type FE hiện được viết thủ công và cần đối chiếu khi contract thay đổi.

| ID | Task | Module | Sprint | Priority | Status | Dependencies | Completion evidence |
|---|---|---|---:|---|---|---|---|
| FND-001 | Node.js/NestJS modular monolith foundation | Platform | 0 | P0 | DONE | — | `npm run build` passes |
| FND-002 | PostgreSQL migrations and isolated integration harness | Platform | 0 | P0 | DONE | FND-001 | Testcontainers migration tests pass |
| FND-003 | Backend CI build, unit and E2E workflow | Platform | 0 | P0 | DONE | FND-001, FND-002 | `.github/workflows/backend-ci.yml` |
| IAM-001 | Password login and signed JWT identity | Identity | 1 | P0 | DONE | FND-002 | Valid/invalid login E2E tests |
| IAM-002 | Tenant membership, roles and branch grants | Identity | 1 | P0 | DONE | IAM-001 | Cross-tenant and branch-scope E2E tests |
| IAM-003 | Owner membership management API | Identity | 1 | P0 | DONE | IAM-002 | Create/deactivate membership E2E tests |
| VEN-001 | Branch CRUD/status with soft delete | Venue | 1 | P0 | DONE | IAM-002 | PostgreSQL HTTP tests and audit records |
| VEN-002 | Room CRUD/status with soft delete | Venue | 1 | P0 | DONE | VEN-001 | PostgreSQL HTTP tests and audit records |
| AUD-001 | Transactional audit log and Owner read API | Platform | 1 | P0 | DONE | IAM-002 | Mutation and audit-query E2E tests |
| SEC-001 | Dependency vulnerability triage | Security | 1 | P0 | DONE | — | 0 production advisories; dev-tool findings and disposition in `docs/04-quality/dependency-security-audit.md` |
| IAM-004 | Password change, reset-code workflow and forced temporary-password change | Identity | 1 | P0 | BLOCKED | IAM-001; create/configure ZBS OA, App, account permissions and eligible approved OTP template in parallel | Forced change and session revocation pass; reset-code/fallback rules and OA-to-merchant cardinality approved; no OA/ZBS account exists yet, so live delivery remains incomplete; email is deferred |
| IAM-005 | Refresh token rotation, logout/revocation and session inventory | Identity | 1 | P0 | DONE | IAM-001 | Rotation, family reuse detection, logout and inactive-session E2E tests pass |
| IAM-006 | Login rate limit and lockout protection | Identity | 1 | P0 | DONE | IAM-001 | PostgreSQL-backed fifth-failure lockout and security-event E2E tests pass |
| API-001 | Standard API error envelope and correlation ID | Platform | 1 | P0 | DONE | FND-001 | Unit/E2E tests cover validation, auth, conflict, internal redaction and correlation propagation |
| API-002 | Export and version OpenAPI contract | Platform | 1 | P0 | DONE | API-001 | 42-path `openapi.json` and generated `api-reference.md`, bearer/tenant schemes and CI drift checks pass; many response schemas remain undocumented |
| VEN-003 | Room amenities and media metadata | Venue | 1–2 | P0 | DONE | VEN-002 | Tenant-scoped amenity/media metadata CRUD, validation, parent-scope and audit E2E tests pass; no binary upload or fetch |
| OBS-001 | Structured logs with secret/PII redaction | Platform | 1 | P0 | DONE | API-001 | Allowlist logger excludes body, query, Authorization and password; redaction unit test passes |
| PRC-001 | Approve duration increment and min/max duration | Product | 2 | P0 | DONE | — | PO approved merchant-configurable limits with 30-minute / 1-hour / 8-hour defaults in `docs/00-product/decision-log.md` (2026-11-22) |
| PRC-002 | Approve pricing precedence and rounding | Product | 2 | P0 | DONE | — | PO approved merchant-set priority, reject tied/ambiguous matches and round final VND total to 1 VND (`PD-011`, 2026-11-22) |
| PRC-003 | Price plan/rule/special-date schema | Pricing | 2 | P0 | DONE | PRC-001, PRC-002 | Pricing catalog, amount-unit and booking-duration migrations; PostgreSQL E2E verifies tenant constraints/default policy; tests cover priority, tie rejection and amount arithmetic |
| PRC-004 | Deterministic quote API and versioned snapshot response contract | Pricing | 2 | P0 | DONE | PRC-003; PD-019; PD-023 | `POST /v1/merchant/rooms/{roomId}/quote`; PostgreSQL E2E covers local-start matching across date/time boundary, priority, hourly/per-booking price, duration validation and tie rejection. Response snapshot is not yet stored by booking workflow |
| PRC-005 | Price plan/rule/special-date merchant management APIs | Pricing | 2 | P0 | DONE | PRC-003 | Owner-only tenant-scoped create/list/read/update/status APIs and transactional audit. PostgreSQL E2E covers validation, tenant isolation, Branch Manager denial and rule-to-quote behavior; no physical deletion |
| AVL-001 | Approve booking buffer calculation | Product | 2 | P0 | DONE | — | PO approved merchant enable/disable and editable duration; default enabled at 15 minutes in `docs/00-product/decision-log.md` (2026-11-22) |
| AVL-002 | Maintenance room-block CRUD | Availability | 2 | P0 | DONE | VEN-002 | Audited create/read/update/release with assigned-branch and overlap E2E tests |
| AVL-003 | Availability query excluding inactive/maintenance/occupied rooms | Availability | 3 | P0 | DONE | AVL-001, PRC-003, AVL-004, PD-024 | `GET /v1/merchant/branches/{branchId}/availability`; PostgreSQL E2E covers tenant duration policy, inactive branch/room, maintenance/active occupancy, cleanup buffer and half-open adjacency. Query is not an atomic hold; booking occupancy must extend through cleanup buffer end |
| AVL-004 | Persist and audit merchant buffer settings | Availability | 3 | P0 | DONE | AVL-001 | `GET/PATCH /v1/merchant/availability/buffer-policy`; defaults enabled at 15 minutes; Owner/Branch Manager updates are audited; PostgreSQL E2E passes |
| BKG-001 | Approve hold TTL by channel | Product | 3 | P0 | DONE | — | PO approved merchant-configurable TTL by channel, default 15 minutes in `docs/00-product/decision-log.md` (2026-11-22) |
| BKG-002 | Occupancy schema with `tstzrange` and GiST exclusion constraint | Booking | 3 | P0 | DONE | FND-002 | Shared maintenance/booking occupancy; adjacent/overlap/release PostgreSQL tests pass |
| BKG-003 | Atomic idempotent hold API and expiry worker | Booking | 3 | P0 | IN_PROGRESS | BKG-001, BKG-002, AVL-003 | Staff hold create/read, scoped idempotency, cleanup-buffer occupancy, TTL snapshot and expiry batch/worker implemented; E2E covers tenant/branch access, concurrent replay and expiration. Customer identity, price snapshot integration and deployed worker verification remain |
| BKG-006 | Branch hold listing for reception UI | Booking | 3 | P0 | DONE | BKG-003 | `GET /v1/merchant/branches/{branchId}/booking/holds` supports overlapping booking time window and bounded pagination; PostgreSQL E2E covers paging, expiry display and branch authorization. This lists holds only, not confirmed bookings |
| BKG-004 | 100-concurrent-request hold correctness test | Booking | 3 | P0 | DONE | BKG-003 | PostgreSQL HTTP E2E: 100 distinct keys for one room/interval produce one 201 and 99 conflicts; broader load/performance benchmarks remain QA-002 |
| BKG-005 | Booking state machine and transition authorization | Booking | 4 | P0 | BLOCKED | BKG-003 | PD-005 no-deposit authorization and PD-008 walk-in/cash treatment approved; hold workflow remains prerequisite |
| REC-001 | Reception calendar API | Reception | 4 | P0 | BLOCKED | BKG-005 | Branch-scoped listing and pagination tests |
| REC-002 | Reception web application foundation | Frontend | 4 | P0 | BACKLOG | API-002, REC-001 | Accessible loading/error/empty states and E2E smoke test |
| PAY-001 | Approve pilot payment/MoR approach | Product | 5 | P0 | DONE | — | PO approved deferring online payments during pilot; manual payment recording only. Provider/MoR selection deferred beyond pilot (`PD-007`, 2026-11-22) |
| PAY-002 | Payment provider port and sandbox adapter | Payment | 5 | P0 | BLOCKED | Post-pilot provider/MoR decision | Online payments are outside pilot scope; no provider or sandbox integration is selected |
| PAY-003 | Webhook inbox, signature verification and idempotency | Payment | 5 | P0 | BLOCKED | PAY-002 | Same webhook five times causes one effective transition |
| PAY-004 | Late-payment reconciliation path | Payment | 5 | P0 | BLOCKED | PAY-003, BKG-005 | Expired hold is never automatically confirmed |
| WEB-001 | Customer booking web foundation | Frontend | 5 | P0 | BACKLOG | API-002, AVL-003, PRC-004 | Mobile-first accessible browse-to-hold flow |
| CAN-001 | Approve cancellation/refund/no-show policy | Product | 6 | P0 | DONE | — | PO approved free-form terms per booking plus staff review/recording; no automated refund/no-show decision (`PD-006`, `PD-015`, 2026-11-22) |
| CAN-002 | Cancellation terms snapshot and staff-reviewed outcome workflow | Booking/Payment | 6 | P0 | BLOCKED | BKG-005 | Snapshot terms and record authorized staff outcomes; automatic refund decision is out of scope. Booking state machine is prerequisite |
| EVT-001 | Transactional outbox schema and dispatcher | Platform | 7 | P0 | DONE | FND-002 | Migration applies on existing DB; E2E covers rollback, committed event, retry and stale-claim recovery |
| NTF-001 | Notification port and non-live test adapter | Notification | 7 | P0 | DONE | EVT-001 | Explicitly unconfigured production adapter plus recording test adapter; provider failure leaves committed domain transaction intact |
| OPS-001 | Health/readiness, metrics and OpenTelemetry baseline | Operations | 7 | P0 | DONE | FND-001 | Liveness/readiness failure behavior, Prometheus metrics and W3C traceparent round-trip E2E pass; OTLP export is configurable, collector delivery not environment-tested |
| QA-001 | FR → API → automated test → UAT traceability matrix | Quality | 7 | P0 | DONE | API-002 | `docs/04-quality/requirement-traceability.md` maps FR-001 through FR-015 and labels missing APIs, planned tests and unexecuted UAT honestly |
| QA-002 | Booking performance and concurrency suite | Quality | 8 | P0 | BLOCKED | BKG-004 | Documented benchmark and reproducible results |
| OPS-002 | Backup/restore and recovery drill | Operations | 8 | P0 | BACKLOG | Production environment design | Measured RPO/RTO drill report |
| UAT-001 | Merchant pilot workflow and UAT checklist | Quality/Ops | 8 | P0 | BACKLOG | REC-002, WEB-001, PAY-003 | Five merchants validate approved workflows |
| ZAL-001 | Verify Zalo Mini App permissions and current SDK compatibility | Channel | Pilot | P1 | BLOCKED | External platform approval | Written verification; no integration claim before approval |
| META-001 | Verify Meta permissions and web/deep-link approach | Channel | Pilot | P1 | BLOCKED | External platform approval | Written verification; no integration claim before approval |

## Recommended execution queue

Work in this order under the approved pilot decisions:

1. **FE-005 can integrate now:** use hold create/read and branch hold listing (`BKG-006`); retain the same idempotency key for retries and label the list as holds. FE verifies branch roles and expired/empty/error states.
2. **BKG-003:** implement required guest phone, optional email and durable price snapshot in the booking workflow; expose and document the contract and tests before FE connects customer details. Verify supervised expiry worker operation.
3. **BKG-005 / REC-001:** implement authorized confirmation and booking transitions, then the full branch reception calendar; FE integrates confirmed booking, check-in/out and calendar as each contract becomes available.
4. **Manual payment / CAN-002:** add auditable manual payment entries and staff-reviewed cancellation outcomes after booking transitions; expose contracts for FE integration.
5. **Customer booking API:** implement public discovery and guest flow with appropriate access controls; FE-006 remains a prototype until connected and verified.
6. **IAM-004:** create/configure ZBS OA, App, account and approved OTP template in parallel, then verify live reset delivery. Email is deferred.
7. **QA/operations:** complete booking benchmarks, worker supervision, monitoring and backup/restore; online payment and settlement remain post-pilot.

## External setup and post-pilot decision queue

Approved pilot decisions are recorded in [`docs/00-product/decision-log.md`](../00-product/decision-log.md). Pricing decisions PD-019 and PD-023 and buffer placement PD-024 are approved. Remaining delivery blockers are external ZBS setup and explicitly deferred post-pilot choices; these are not implied approvals.

| Order | Decision | Needed by | Related task |
|---:|---|---|---|
| 1 | Configure ZBS Template Message for reset codes; fallback PD-014 approved; email temporarily deferred | Sprint 1 | IAM-004 / PD-012 / PD-014; Vietnam-specific provider notes in `docs/00-product/notification-provider-shortlist.md` |
| 2 | Post-pilot payment provider/MoR and commission settlement selection (pilot commission is reporting only) | Post-pilot | PAY-002 / PD-016 |

## Update protocol

When changing a task:

1. Update its status and dependencies in this file.
2. Add links to migrations, APIs and tests in “Completion evidence” when marking `DONE`.
3. Record product approvals in the decision log, not only in this board.
4. Update the repository audit when a module changes from missing to implemented.
5. Never mark external providers, performance targets or release gates complete without executed evidence.

