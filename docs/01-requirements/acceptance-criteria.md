# Acceptance Criteria — KaraokeNow MVP

> Vai trò: BA/QA · Phiên bản 1.0 · 22/11/2026  
> Given/When/Then bên dưới là tiêu chí nghiệm thu mục tiêu. Trạng thái tự động hóa/UAT được phân biệt; “đề xuất” không có nghĩa đã chạy.

## Definition of Ready

- Story có actor, mục tiêu, scope và dependency.
- Business rule đã được PO quyết định hoặc story ghi rõ blocker.
- API/data contract và authorization được mô tả.
- Có acceptance criteria kiểm thử được.

## Definition of Done

- Code review, migration/API docs và relevant unit/integration tests hoàn thành.
- Auth, tenant/branch isolation, audit và error handling được xét.
- Không có secret/PII leakage qua log.
- OpenAPI đồng bộ; UAT được Merchant/PO chấp nhận khi user-facing.
- External integrations/performance/recovery chỉ được DONE khi có bằng chứng thực thi.

## AC theo requirement

| ID | Tiêu chí nghiệm thu | Hiện trạng bằng chứng |
|---|---|---|
| AC-001 Branch | Given Owner có quyền tenant, when tạo branch với timezone hợp lệ, then branch xuất hiện trong danh sách và mutation có audit. | API/E2E hiện có |
| AC-002 Room | Given manager có branch grant, when tạo phòng với dữ liệu hợp lệ, then phòng gắn đúng branch; ID ngoài tenant/branch không bị lộ. | API/E2E cơ bản; duplicate room code chưa được assert trực tiếp |
| AC-003 Amenities/media | Given room thuộc tenant, when Owner/Manager tạo metadata hợp lệ, then metadata lưu và audit; child ID của room khác trả not found. | E2E hiện có; binary upload ngoài scope |
| AC-004 Room block | Given branch-authorized manager, when tạo block không conflict, then block được lưu; overlap invalid bị từ chối; authorized release bỏ occupancy. | E2E hiện có |
| AC-005 Price quote | Given một rule duy nhất match, when quote được yêu cầu, then áp dụng timezone local, duration/unit, priority và rounding; tied priority trả lỗi ambiguity. | Quote API/E2E hiện có; booking snapshot chưa có |
| AC-006 Availability | Given inactive, maintenance hoặc occupied rooms, when a scoped user searches a valid interval, then those rooms are excluded and the configured cleanup buffer is applied after booking end. | Search API implemented; PostgreSQL E2E covers inactive/maintenance/occupancy, cleanup buffer and half-open adjacency; pilot UAT pending |
| AC-007 Hold concurrency | Given 100 yêu cầu đồng thời cùng room/range, when hold được tạo, then tối đa một hold active thành công; retry idempotency không tạo hold thứ hai. | Chưa triển khai; gate pilot |
| AC-008 Hold expiry | Given hold quá TTL, when worker xử lý, then hold được release; late payment (nếu sau pilot) không tự chiếm lại phòng. | Chưa triển khai |
| AC-009 Booking confirm | Given valid hold và rule no-deposit/deposit phù hợp, when xác nhận, then transition hợp lệ, snapshot price/policy lưu, audit và outbox commit atomically. | Chưa triển khai |
| AC-010 Manual payment | Given cashier authorized, when ghi nhận tiền mặt/chuyển khoản, then transaction riêng liên kết booking và có actor/time/amount/method; không gọi payment provider. | Policy approved; feature chưa triển khai |
| AC-011 Cancel/refund | Given cancellation request, when authorized staff review, then lưu outcome và căn cứ theo policy snapshot; hệ thống không tự quyết định refund/no-show trong pilot. | Chưa triển khai |
| AC-012 Tenant isolation | Given Tenant B hoặc branch không được grant, when đọc/sửa tài nguyên Tenant A, then request bị deny/not-found theo contract và không rò dữ liệu. | Có test trên membership/venue; booking scope chờ booking API |
| AC-013 Audit | Given mutation thuộc nhóm audited, when commit thành công, then audit record commit cùng transaction; rollback không để lại audit thành công giả. | Có trên module hiện tại |
| AC-014 Notification reliability | Given outbox event được commit, when adapter lỗi, then domain transaction vẫn commit và event được retry/recovery. | Outbox E2E hiện có; booking producer chưa có |
| AC-015 Mobile web | Given khách truy cập màn 320px–430px, when chọn location/date/time/duration/room, then nội dung không tràn ngang, controls dùng được, giá/policy dễ đọc, có loading/empty/error state. | Frontend chưa có; cần browser UAT |
| AC-016 Channel WebView | Given permission/kênh đã cấu hình, when khách mở từ tin nhắn, then WebView cùng booking flow; khi submit, trạng thái hiện tại WebView và message result có booking reference. | Mockup only; chưa tích hợp |
| AC-017 Readiness | Given DB unavailable, when readiness probe chạy, then trả 503; liveness không phụ thuộc DB. | E2E hiện có |

## UAT pilot scenarios

1. Owner tạo Merchant staff và branch grants; kiểm tra cross-tenant denied.
2. Merchant xác nhận room catalog, price examples, timezone, duration, buffer và policy.
3. Lễ tân khóa maintenance và xác nhận phòng bị loại khỏi search sau khi API tồn tại.
4. 100 concurrent hold test cùng room/time; xác nhận chỉ một kết quả active.
5. Khách đặt guest booking từ mobile web; kiểm tra phone required/email optional.
6. Lễ tân xử lý walk-in và cashier ghi payment thủ công.
7. Hủy booking; staff ghi quyết định theo policy snapshot.
8. Notification provider outage; booking không rollback, retry quan sát được.
9. Merchant ký xác nhận UAT và go/no-go pilot.

## Evidence status

Tự động hóa hiện có đối chiếu ở `docs/04-quality/requirement-traceability.md` và `docs/03-delivery/task-board.md`. UAT scenarios trên chưa chạy với Merchant. NFR targets cần benchmark và recovery drill riêng.
