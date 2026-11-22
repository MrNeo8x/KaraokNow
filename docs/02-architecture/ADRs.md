# ADRs — Quyết định kiến trúc KaraokeNow

> Vai trò: SA · Phiên bản 1.0 · 22/11/2026  
> Status “Implemented baseline” chỉ xác nhận repository có hiện thực kỹ thuật; không tự thay thế phê duyệt PO/security/production.

## ADR-001 — NestJS modular monolith

- **Status:** Implemented baseline; technical approval pending.
- **Context:** MVP cần module boundary rõ nhưng team/ops chưa cần microservices.
- **Decision:** Node.js 24, TypeScript, NestJS modular monolith.
- **Consequences:** Một deployable backend; module dependency discipline; tách process worker khi cần nhưng dùng chung codebase.

## ADR-002 — PostgreSQL source of truth

- **Status:** Implemented baseline.
- **Decision:** PostgreSQL quản lý giao dịch, tenant data, pricing và occupancy.
- **Consequences:** Transaction, FK, check/exclusion constraints là hàng rào correctness; cache không được làm nguồn duy nhất cho hold.

## ADR-003 — Transactional outbox

- **Status:** Implemented foundation.
- **Decision:** Ghi event cùng transaction domain; worker giao event ngoài transaction và retry.
- **Consequences:** Có thể giao trễ/at-least-once; consumer/provider phải idempotent. Booking event producer chưa có.

## ADR-004 — Channel adapters

- **Status:** Accepted architectural direction; external integrations unverified.
- **Decision:** Cô lập Zalo, Meta và notification provider sau adapter; domain không phụ thuộc SDK/kênh.
- **Consequences:** Có thể chạy web pilot độc lập; không công bố channel live trước khi cấp quyền và xác minh.

## ADR-005 — Payment provider abstraction

- **Status:** Deferred beyond pilot.
- **Decision:** Không tích hợp online payment trong pilot; ghi nhận manual transactions. Provider/MoR chờ quyết định.
- **Consequences:** Không có checkout/webhook/settlement trong pilot; tránh lưu payment credentials.

## ADR-006 — Shared database multi-tenancy

- **Status:** Implemented baseline.
- **Decision:** Dùng shared PostgreSQL schema với `tenant_id` và kiểm tra membership/branch grants ở server.
- **Consequences:** Mọi query tenant-owned phải scoped; test cross-tenant là bắt buộc; không tin tenant ID body.

## ADR-007 — API-first OpenAPI

- **Status:** Implemented baseline.
- **Decision:** Versioned OpenAPI contract cho REST API.
- **Consequences:** CI drift check; frontend và QA dựa contract; contract update đi cùng code.

## ADR-008 — Idempotent webhook inbox

- **Status:** Proposed, deferred until payment provider selection.
- **Decision:** Khi bật online payment, verify signature và lưu provider event ID duy nhất trước khi xử lý.
- **Consequences:** Webhook duplicate/replay không được tạo transition/charge lần hai; chưa áp dụng vì pilot không có online payment.

## ADR-009 — Independent booking/payment/refund state machines

- **Status:** Approved design direction; implementation pending.
- **Decision:** Booking state không đồng nhất payment/refund state; late payment sau hold expiry không tự confirm.
- **Consequences:** Reconciliation path tách biệt; cần explicit transition authorization và audit.

## ADR-010 — Occupancy exclusion invariant

- **Status:** Implemented schema proof.
- **Decision:** PostgreSQL `tstzrange` và GiST exclusion bảo vệ room khỏi overlapping active occupancy.
- **Consequences:** Tất cả maintenance/hold/booking ghi vào invariant chung; range semantics là `[start,end)`. Approved PD-024 extends the candidate/booking occupancy interval after the requested booking end by the configured cleanup buffer; no pre-start extension.

## ADR-011 — Customer WebView/channel boundary

- **Status:** Target design, not implemented.
- **Decision:** Tin nhắn Zalo/Messenger là entry/result surface; lựa chọn và submit booking chạy trên mobile-first web trong WebView hoặc browser.
- **Consequences:** Booking web phải dùng được độc lập; channel adapter deep-link/callback/result message là conditional, permission verification required, không chặn web pilot (PD-022).

## ADR-012 — Frontend tách khỏi backend

- **Status:** Approved by PO 2026-11-22 (architecture boundary); implementation pending.
- **Context:** MVP cần Merchant Reception/Admin và customer booking web; khách cũng có thể mở customer web trong Zalo/Messenger WebView. Repository hiện tại là backend NestJS-only.
- **Decision:** Frontend là ứng dụng web riêng, có source code, build artifact và release/deployment riêng; frontend gọi NestJS qua HTTPS API được mô tả bằng OpenAPI. NestJS backend chỉ cung cấp API/domain services, không render hoặc bundle UI.
- **Organization:** Có thể dùng repository riêng hoặc workspace/monorepo với package và pipeline tách biệt. Cách tổ chức code chưa được quyết định và không làm thay đổi ranh giới runtime.
- **Consequences:** API contract/versioning, CORS/session/token handling, frontend environment config và independent CI/CD phải được thiết kế. Zalo/Messenger WebView mở customer frontend; chat adapter chỉ tạo entry/result message. Frontend không truy cập PostgreSQL trực tiếp.

## ADR governance

Khi quyết định thay đổi, ghi context, lựa chọn, status, ngày, owner và consequence; cập nhật ADR liên quan, Decision Log nếu là policy PO, Master Plan/task board và API/ERD nếu bị ảnh hưởng.
