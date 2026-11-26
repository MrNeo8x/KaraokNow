# Bảng công việc MVP KaraokeNow

Cập nhật: 2026-11-26. Đây là nguồn sự thật trong repository về trạng thái triển khai. Quyết định sản phẩm nằm ở `docs/00-product/decision-log.md`; nhật ký từng phiên nằm ở [`work-log.md`](work-log.md).

## Quy trình

Trạng thái (giữ mã tiếng Anh để tìm kiếm):

| Mã | Ý nghĩa | Khi nào dùng |
|---|---|---|
| `DONE` | Hoàn thành | Code, migration, tài liệu API, phân quyền, audit và test tự động bắt buộc đều có; phạm vi task không còn việc gì. |
| `VERIFY` | Chờ nghiệm thu | Code đã merge và test tự động (unit/E2E/smoke) đã qua; chỉ còn kiểm thử trên trình duyệt, kiểm thử FE–BE theo vai trò hoặc UAT. Không còn việc lập trình đã biết. |
| `IN_PROGRESS` | Đang làm | Đang được lập trình thật sự, hoặc code còn nằm trong working tree chưa commit. Giữ số lượng ít. |
| `READY` | Sẵn sàng | Đã đủ rõ và không còn phụ thuộc chưa giải quyết; có thể bắt đầu ngay. |
| `BLOCKED` | Bị chặn | Cần quyết định của PO hoặc điều kiện bên ngoài (tài khoản, môi trường, công cụ) trước khi làm. |
| `BACKLOG` | Tồn đọng | Việc hợp lệ nhưng chưa được ưu tiên hoặc chưa đủ rõ. |

Một task chỉ chuyển `DONE` khi đã có review, build, test liên quan, tài liệu migration/API, kiểm tra phân quyền và audit. Unit test đơn lẻ không đủ cho hành vi database hoặc tranh chấp đồng thời. Task `VERIFY` chuyển `DONE` khi QA-003 (kiểm thử trình duyệt theo vai trò) và phần UAT liên quan (UAT-001) đạt.

Khi còn việc dở trong một task gần xong, **tách việc dở thành task mới** với trạng thái đúng thực tế thay vì giữ task cũ ở `IN_PROGRESS`.

## Tóm tắt hiện trạng

- **Backend** (chạy từ `be/`, Node 26, 2026-11-26): `npm run verify` đạt — build, 10/10 unit suite (40/40 test, gồm kiểm tra env `TRUST_PROXY_HOPS`/rate limit public, chuẩn hoá SĐT và tính cọc), kiểm tra drift OpenAPI (73 path) và API Markdown. PostgreSQL Docker E2E đạt 37/37: tạo merchant bởi Platform Admin, duyệt listing, check-in/out, hủy/no-show, cọc trên hold và xác nhận khi đủ cọc, lịch booking, catalog công khai, CASH thủ công (idempotency/tổng), phạm vi vai trò/tenant. Migration mới đã kiểm up → down → up.
- **Frontend** (`fe/`, session Luồng FE): FE unit test 32/32 (2026-11-26). Smoke test API qua proxy FE (`localhost:3100`, container backend/frontend đã rebuild, migrate + seed UAT) đạt 44/44: trang `/booking`, `/merchant`, `/platform`; PLT-001/002, publication, memberships, audit, backlog, sessions; luồng khách hold → cọc PERCENT → xác minh → xác nhận → check-in/out → tra cứu `COMPLETED`.
- **Chưa có:** kiểm thử trên trình duyệt thật, kiểm thử FE–BE theo vai trò (QA-003), UAT (UAT-001), kết quả CI trên GitHub.

Số lượng theo trạng thái: `IN_PROGRESS` 3 (FE-005, FE-009, FE-010 — code chưa commit), `VERIFY` 19, `READY` 3, `BLOCKED` 11, `BACKLOG` 4, `DONE` 43.

## Luồng Frontend

Frontend nằm ở `fe/`, build/deploy tách khỏi `be/` và được phát triển song song trong session Luồng FE. Luồng BE không sửa file trong `fe/`.

Nguồn hợp đồng FE: `docs/02-architecture/api-reference.md`, `docs/02-architecture/api-error-contract.md`, `docs/02-architecture/openapi.json` và [`fe-backend-handoff.md`](fe-backend-handoff.md). Nhiều response schema cũ trong OpenAPI chưa khai báo; type FE đang viết tay (xem FE-011).

| ID | Công việc | Trạng thái | Đã có và bằng chứng trong code | Còn lại để nghiệm thu |
|---|---|---|---|---|
| FE-001 | Nền Next.js/React, landing và routes | VERIFY | `fe/src/app/page.tsx`, `merchant/page.tsx`, `booking/page.tsx`, `platform/`; có sẵn Tailwind và cấu hình shadcn/ui, giao diện hiện dùng CSS riêng. Build qua; `.github/workflows/frontend-ci.yml` chạy npm ci/test/build. | Kiểm thử trình duyệt/mobile/accessibility (QA-003); xác nhận CI trên GitHub. Hoàn thiện design system khi cần. |
| FE-002 | Đăng nhập, tenant và quản lý chi nhánh/phòng | VERIFY | `experience.tsx`, `venue-actions.tsx`: đăng nhập, đổi mật khẩu tạm, đăng xuất, làm mới phiên trong bộ nhớ, nhập tenant UUID, đọc/tạo/sửa chi nhánh/phòng, đổi trạng thái. Unit test cho response phiên/lịch refresh; build qua. | QA-003 với Owner/Branch Manager/Receptionist/Cashier, tenant/chi nhánh sai, xoay token, đăng xuất đồng thời refresh, lỗi mạng. Giữ phiên qua reload và chọn tenant tách sang FE-012. |
| FE-003 | Tiện nghi và hình ảnh phòng | VERIFY | `room-amenities.tsx`, `room-media.tsx`: xem/thêm/sửa/xoá metadata theo phòng. Thẻ phòng merchant/khách hiển thị ba ảnh minh hoạ SVG cố định, luân phiên theo danh sách phòng; không phụ thuộc `assetRef`. | QA-003 (phân quyền, mobile, dữ liệu rỗng/lỗi) và UAT. Upload file/object storage để giai đoạn sau, không chặn pilot. |
| FE-003A | Khoảng bảo trì phòng | VERIFY | `room-blocks.tsx`: danh sách theo chi nhánh, tạo, sửa thời gian/lý do, giải phóng; xử lý lỗi/xung đột từ API. Build qua. | QA-003: múi giờ, chồng lấn, phân quyền. |
| FE-004 | Tìm phòng trống và báo giá Merchant | VERIFY | `availability-quote.tsx`: truy vấn theo chi nhánh/thời gian, hiển thị buffer và báo giá theo phòng; ghi chú tìm kiếm không giữ phòng. | QA-003: múi giờ, dữ liệu rỗng, giá không khớp/đụng độ quy tắc, quyền. |
| FE-004A | Cấu hình thời lượng và buffer | VERIFY | `pricing-settings.tsx`: đọc/cập nhật thời lượng và buffer qua API. | QA-003: validation và quyền; UAT. |
| FE-004B | Bảng giá | VERIFY | `pricing-settings.tsx`: xem/tạo, cập nhật tên, trạng thái, hiệu lực bảng giá (Owner). | QA-003: quyền, dữ liệu lỗi; UAT. |
| FE-004C | Quy tắc giá và ngày đặc biệt | VERIFY | `price-rules.tsx`, `rule-room-select.tsx`, `special-dates.tsx`: xem/tạo/sửa quy tắc, chọn phòng theo chi nhánh được cấp quyền, ngày đặc biệt (Owner tạo/sửa). Giữ giá trị phòng cũ ngoài danh sách; không cho lưu quy tắc khi không tải được ngày đặc biệt. Build qua. | QA-003: bảo toàn selector khi đổi chi nhánh/lỗi tải, quyền, múi giờ; UAT. |
| FE-004D | Thời gian giữ phòng theo kênh | VERIFY | `hold-ttl-settings.tsx`: Owner/Branch Manager xem/cập nhật TTL theo kênh, mặc định backend 15 phút; build qua. | QA-003: theo vai trò, validation, TTL snapshot của hold mới; UAT. |
| FE-004E | Cấu hình không đặt cọc theo kênh | VERIFY | `no-deposit-settings.tsx`: GET/PATCH theo kênh, hiển thị rõ `configured=false`/`allowed=null` là chưa cấu hình, không mặc định false. Build qua. | QA-003: theo vai trò, dữ liệu chưa cấu hình; UAT. |
| FE-004F | Cấu hình tiền cọc theo kênh | VERIFY | `deposit-settings.tsx`: GET/PATCH NONE/FIXED/PERCENT; phân biệt chưa cấu hình với NONE; validation số nguyên VND/tỷ lệ có 3 unit test. | QA-003: theo vai trò, dữ liệu lỗi; UAT. |
| FE-005 | Lễ tân: giữ phòng, cọc, check-in/out, hủy | IN_PROGRESS | Đã commit: tạo/tra hold, retry cùng Idempotency-Key, lưu phone/email và snapshot giá, ghi nhận cuộc gọi, xác nhận không cọc, lịch booking, CASH. **Chưa commit** (working tree): `hold-details.tsx` đọc `GET .../holds/{id}/deposits`, ghi cọc CASH, chặn vượt số còn thiếu, nút xác nhận theo snapshot; `booking-operations.tsx` lịch mọi trạng thái, check-in, check-out có xác nhận, hủy/no-show với ghi chú bắt buộc và tiền hoàn tuỳ chọn; `fe/src/lib/booking-lifecycle.ts` (4 unit test). `tsc`, `next build` qua; API cọc/xác nhận/check-in/out đã smoke test qua proxy FE, hủy/no-show mới thử trường hợp 409. | Commit; smoke test hủy/no-show thành công; sau đó chuyển `VERIFY`. Lịch hợp nhất hold + booking tách sang REC-003. Khôi phục hold chỉ trong sessionStorage. |
| FE-006 | Web đặt phòng khách | VERIFY | `/booking`: catalog → phòng trống → báo giá → điều khoản có version → guest hold → tra cứu SĐT + booking code. `fe/src/lib/public-booking.ts`: làm sạch SĐT/mã theo regex BE, giữ Idempotency-Key cho body giống hệt, lưu attempt/receipt trong sessionStorage để gửi lại sau lỗi mạng/5xx/429/reload. `customer-booking.tsx`: 409 tải lại điều khoản/báo giá, 429 khoá nút 60 giây, 404 tra cứu là thông báo chung, hiện booking code một lần kèm sao chép, `depositRequiredVnd`, `bookingStatus` và cọc đã ghi. Điều khoản công khai chưa cấu hình (404) coi là `configured=false`. Smoke test hold/lookup/replay/409/404 qua proxy FE. | QA-003 (browser/mobile/accessibility, chưa thử 429) và UAT. Booking code mất khi đóng tab. |
| FE-007 | WebView Zalo/Messenger và tin nhắn kết quả | BLOCKED | Có định hướng dùng chung web khách trong tài liệu; chưa tích hợp kênh. | Chờ quyền nền tảng (ZAL-001, META-001), adapter gửi tin; không chặn pilot web. |
| FE-008 | API client và hợp đồng lỗi | VERIFY | `fe/src/lib/api.ts`: header bearer/tenant, error envelope, chi tiết validation, correlation ID, thông báo 5xx an toàn, `ApiError` mang HTTP status. `fe/test/api.test.mjs`: test headers/idempotency, 204, 400/401/403/409/422/500, mạng, huỷ. | QA-003 với backend thật. Sinh type từ OpenAPI tách sang FE-011. |
| FE-009 | Platform Admin duyệt listing | IN_PROGRESS | **Chưa commit**: route `/platform`, `platform-listings.tsx`: lọc PENDING/APPROVED/ALL, phân trang, duyệt (ghi chú tuỳ chọn), thu hồi (lý do bắt buộc, có xác nhận); không gửi `X-Tenant-ID`; 403 hiển thị không có quyền, 409 giải thích chưa publish/không active; cảnh báo listing chưa có chi nhánh hoặc điều khoản. Build qua; smoke test với `uat.platform@karaokenow.local`. | Commit rồi chuyển `VERIFY`; QA-003/UAT. |
| FE-010 | Màn quản trị merchant và tài khoản | IN_PROGRESS | **Chưa commit**: `platform-merchants.tsx` tạo merchant + Owner đầu tiên (kiểm tra mã/mật khẩu tạm như BE, sinh mật khẩu ngẫu nhiên, báo rõ `accountCreated=false`) và danh sách lọc/phân trang. Owner: `catalog-publication.tsx` (publish/ngừng, phân biệt chờ Platform duyệt), `memberships.tsx` (thêm, sửa vai trò/chi nhánh, vô hiệu hoá/kích hoạt lại), `audit-log.tsx` (phân trang khi trang đầy, xem JSON trước/sau), `ops-backlog.tsx` (hold quá hạn, outbox, cảnh báo tồn đọng > 5 phút). Mọi user: `my-sessions.tsx` (thu hồi phiên hiện tại = đăng xuất). Màn Owner ẩn khi nhận 403. `fe/src/lib/admin.ts` có 5 unit test. | Commit rồi chuyển `VERIFY`; QA-003/UAT theo vai trò. |
| FE-011 | Sinh type FE từ OpenAPI và kiểm tra drift | BACKLOG | Type FE hiện viết tay theo handoff. | Chọn công cụ sinh type, thêm bước kiểm tra drift vào FE CI. Cần bổ sung response schema còn thiếu ở BE trước. |
| FE-012 | Giữ phiên qua reload và chọn tenant thuận tiện | BACKLOG | Phiên chỉ nằm trong bộ nhớ; tenant nhập bằng UUID. | Cần quyết định lưu trữ phiên an toàn (không đưa refresh token vào localStorage) và API/cách liệt kê tenant của user. |

## Danh sách task

| ID | Công việc | Module | Sprint | Ưu tiên | Trạng thái | Phụ thuộc | Bằng chứng hoàn thành / còn lại |
|---|---|---|---:|---|---|---|---|
| FND-001 | Nền tảng NestJS modular monolith | Platform | 0 | P0 | DONE | — | `npm run build` qua |
| FND-002 | Migration PostgreSQL và môi trường test tích hợp cô lập | Platform | 0 | P0 | DONE | FND-001 | Test migration bằng Testcontainers qua |
| FND-003 | CI backend: build, unit, E2E | Platform | 0 | P0 | DONE | FND-001, FND-002 | `.github/workflows/backend-ci.yml` (chưa có kết quả chạy trên GitHub) |
| IAM-001 | Đăng nhập mật khẩu và JWT có chữ ký | Identity | 1 | P0 | DONE | FND-002 | E2E đăng nhập đúng/sai |
| IAM-002 | Membership tenant, vai trò và quyền theo chi nhánh | Identity | 1 | P0 | DONE | IAM-001 | E2E chặn chéo tenant và phạm vi chi nhánh |
| IAM-003 | API quản lý membership cho Owner | Identity | 1 | P0 | DONE | IAM-002 | E2E tạo/vô hiệu hoá membership |
| IAM-004 | Đổi mật khẩu, mã reset và bắt buộc đổi mật khẩu tạm | Identity | 1 | P0 | BLOCKED | IAM-001; tạo/cấu hình ZBS OA, App, quyền tài khoản và mẫu OTP đã duyệt | Bắt buộc đổi mật khẩu và thu hồi phiên đã có; quy tắc mã reset/dự phòng và quan hệ OA–merchant đã duyệt. Chưa có tài khoản OA/ZBS nên chưa gửi thật; email hoãn |
| IAM-005 | Xoay refresh token, đăng xuất/thu hồi và danh sách phiên | Identity | 1 | P0 | DONE | IAM-001 | Xoay token, phát hiện dùng lại, đăng xuất cả họ token được tuần tự hoá với refresh; E2E refresh/logout đồng thời. Test race/mạng trên trình duyệt thuộc FE |
| IAM-006 | Giới hạn đăng nhập và khoá tài khoản | Identity | 1 | P0 | DONE | IAM-001 | E2E khoá sau lần sai thứ 5 và ghi sự kiện bảo mật (PostgreSQL) |
| API-001 | Error envelope chuẩn và correlation ID | Platform | 1 | P0 | DONE | FND-001 | Unit/E2E cho validation, auth, conflict, ẩn lỗi nội bộ, truyền correlation ID |
| API-002 | Xuất và version hợp đồng OpenAPI | Platform | 1 | P0 | DONE | API-001 | `openapi.json` có version (73 path) và `api-reference.md` sinh tự động, kiểm tra drift trong CI; một số response schema cũ chưa khai báo (xem FE-011) |
| VEN-001 | CRUD/trạng thái chi nhánh, xoá mềm | Venue | 1 | P0 | DONE | IAM-002 | Test HTTP PostgreSQL và bản ghi audit |
| VEN-002 | CRUD/trạng thái phòng, xoá mềm | Venue | 1 | P0 | DONE | VEN-001 | Test HTTP PostgreSQL và bản ghi audit |
| VEN-003 | Metadata tiện nghi và hình ảnh phòng | Venue | 1–2 | P0 | DONE | VEN-002 | CRUD metadata theo tenant/phòng, validation, audit E2E; không upload/tải file nhị phân |
| AUD-001 | Audit log trong transaction và API đọc cho Owner | Platform | 1 | P0 | DONE | IAM-002 | E2E mutation và truy vấn audit |
| SEC-001 | Rà soát lỗ hổng dependency | Security | 1 | P0 | DONE | — | 0 cảnh báo production; phát hiện ở công cụ dev và cách xử lý trong `docs/04-quality/dependency-security-audit.md` |
| OBS-001 | Log có cấu trúc, che secret/PII | Platform | 1 | P0 | DONE | API-001 | Logger allowlist bỏ body, query, Authorization, password; unit test che dữ liệu |
| PRC-001 | Duyệt bước thời lượng và min/max | Product | 2 | P0 | DONE | — | PO duyệt giới hạn merchant tự cấu hình, mặc định 30 phút / 1 giờ / 8 giờ (2026-11-22) |
| PRC-002 | Duyệt thứ tự ưu tiên giá và làm tròn | Product | 2 | P0 | DONE | — | Ưu tiên do merchant đặt, từ chối trùng ưu tiên, làm tròn tổng đến 1 VND (`PD-011`) |
| PRC-003 | Schema bảng giá/quy tắc/ngày đặc biệt | Pricing | 2 | P0 | DONE | PRC-001, PRC-002 | Migration catalog giá, đơn vị tiền, chính sách thời lượng; E2E ràng buộc tenant/mặc định; test ưu tiên, từ chối trùng, phép tính |
| PRC-004 | API báo giá tất định và snapshot có version | Pricing | 2 | P0 | DONE | PRC-003; PD-019; PD-023 | API báo giá có version tính toán; snapshot lưu trên hold khi gắn thông tin khách và sao chép sang booking khi xác nhận |
| PRC-005 | API quản lý bảng giá/quy tắc/ngày đặc biệt | Pricing | 2 | P0 | DONE | PRC-003 | API Owner theo tenant, audit trong transaction; E2E validation, cô lập tenant, chặn Branch Manager, quy tắc → báo giá; không xoá vật lý |
| AVL-001 | Duyệt cách tính buffer | Product | 2 | P0 | DONE | — | Merchant bật/tắt và chỉnh thời lượng; mặc định bật 15 phút (2026-11-22) |
| AVL-002 | CRUD khoá phòng bảo trì | Availability | 2 | P0 | DONE | VEN-002 | Tạo/đọc/sửa/giải phóng có audit; E2E phạm vi chi nhánh và chồng lấn |
| AVL-003 | Tìm phòng trống loại trừ phòng không hoạt động/bảo trì/đã chiếm | Availability | 3 | P0 | DONE | AVL-001, PRC-003, AVL-004, PD-024 | `GET /v1/merchant/branches/{branchId}/availability`; E2E chính sách thời lượng, chi nhánh/phòng không hoạt động, bảo trì/chiếm phòng, buffer dọn phòng, khoảng nửa mở. Tìm kiếm không phải giữ phòng nguyên tử |
| AVL-004 | Lưu và audit cấu hình buffer của merchant | Availability | 3 | P0 | DONE | AVL-001 | `GET/PATCH /v1/merchant/availability/buffer-policy`; mặc định bật 15 phút; Owner/Branch Manager cập nhật có audit |
| BKG-001 | Duyệt TTL giữ phòng theo kênh | Product | 3 | P0 | DONE | — | Merchant cấu hình TTL theo kênh, mặc định 15 phút (2026-11-22) |
| BKG-002 | Schema occupancy với `tstzrange` và ràng buộc loại trừ GiST | Booking | 3 | P0 | DONE | FND-002 | Occupancy dùng chung cho bảo trì/booking; test liền kề/chồng lấn/giải phóng |
| BKG-003 | API giữ phòng nguyên tử, idempotent và worker hết hạn | Booking | 3 | P0 | DONE | BKG-001, BKG-002, AVL-003 | Hold staff/public, hết hạn, liên hệ, snapshot giá + cọc, xác minh cuộc gọi; worker retry lỗi, backlog cho Owner, E2E tắt tiến trình con; tích hợp xác nhận xong. Giám sát/cảnh báo production tách sang OPS-003 |
| BKG-004 | Test đúng đắn với 100 yêu cầu giữ phòng đồng thời | Booking | 3 | P0 | DONE | BKG-003 | E2E: 100 key khác nhau cho một phòng/khung giờ → 1 lần 201, 99 xung đột. Benchmark rộng hơn là QA-002 |
| BKG-005 | Máy trạng thái booking và phân quyền chuyển trạng thái | Booking | 4 | P0 | DONE | BKG-003 | Xác nhận (không cọc / đủ cọc), check-in, check-out, hủy/no-show; khoá dòng, replay idempotent, audit, kiểm tra chi nhánh/vai trò (`booking-lifecycle.service.ts`, migration `20261124020000_booking_lifecycle`); E2E xác nhận/check-in/kết quả đồng thời, race hết hạn, đủ cọc. Overtime tách sang BKG-007, điều kiện theo trường hợp sang BKG-008 |
| BKG-006 | Danh sách hold theo chi nhánh cho lễ tân | Booking | 3 | P0 | DONE | BKG-003 | `GET /v1/merchant/branches/{branchId}/booking/holds` theo khung giờ chồng lấn, phân trang có giới hạn; E2E phân trang, hiển thị hết hạn, quyền chi nhánh. Chỉ liệt kê hold |
| BKG-007 | Xử lý overtime khi trả phòng muộn | Booking | 6 | P0 | BLOCKED | BKG-005, PD-025 | PD-025 hiện chỉ ghi giờ trả muộn, không kéo dài occupancy hay tính thêm tiền. Chờ PO quyết định cách tính/kéo dài và xử lý khi đụng booking kế tiếp |
| BKG-008 | Điều kiện xác nhận không cọc theo trường hợp | Booking | 6 | P1 | BLOCKED | BKG-005, PD-005 | PD-005 cho phép bật không cọc theo kênh/trường hợp; hiện mới theo kênh. Chờ PO định nghĩa "trường hợp" (ví dụ khách quen, khung giờ, giá trị booking) |
| REC-001 | API lịch lễ tân | Reception | 4 | P0 | VERIFY | BKG-005 | `GET /v1/merchant/branches/{branchId}/booking/bookings` theo chi nhánh, chồng lấn khung giờ, phân trang; booking mang trạng thái `CONFIRMED/CHECKED_IN/COMPLETED/CANCELLED/NO_SHOW`, giờ check-in/out và kết quả hủy; trả mọi trạng thái. Còn QA-003 |
| REC-002 | Nền ứng dụng lễ tân | Frontend | 4 | P0 | VERIFY | API-002, REC-001 | FE có hold, cọc CASH, xác nhận không cọc/đủ cọc, lịch booking mọi trạng thái, check-in/out, hủy/no-show, CASH với trạng thái loading/lỗi/rỗng (phần mới đang chờ commit ở FE-005). Còn QA-003 và UAT |
| REC-003 | Lịch lễ tân hợp nhất hold và booking | Frontend | 4 | P0 | READY | REC-001, BKG-006 | Ghép danh sách hold và booking không trùng (bỏ hold `CONFIRMED`), lọc theo trạng thái (ẩn/hiện hủy, no-show), hiển thị theo phòng/khung giờ. API đã đủ |
| PAY-001 | Duyệt cách thanh toán/MoR cho pilot | Product | 5 | P0 | DONE | — | Hoãn thanh toán online trong pilot, chỉ ghi nhận thủ công; chọn provider/MoR sau pilot (`PD-007`) |
| PAY-002 | Cổng provider thanh toán và adapter sandbox | Payment | 5 | P0 | BLOCKED | Quyết định provider/MoR sau pilot | Thanh toán online ngoài phạm vi pilot |
| PAY-003 | Webhook inbox, xác minh chữ ký, idempotency | Payment | 5 | P0 | BLOCKED | PAY-002 | Cùng webhook gửi 5 lần chỉ tạo một chuyển trạng thái |
| PAY-004 | Xử lý thanh toán đến muộn | Payment | 5 | P0 | BLOCKED | PAY-003, BKG-005 | Hold đã hết hạn không bao giờ tự xác nhận |
| PAY-005 | Ghi nhận thanh toán thủ công | Payment | 5 | P0 | DONE | BKG-005 | CASH chỉ ghi thêm, có audit, tạo idempotent, đọc phân trang, `totalRecordedVnd`/`paymentCount` chính xác theo booking; E2E đồng thời, idempotency, phạm vi, tổng. Đối soát/sửa giao dịch tách sang PAY-007 |
| PAY-006 | Cọc tiền mặt trên hold trước khi xác nhận | Payment | 5 | P0 | DONE | WEB-004, UAT-PD-002 | Migration `20261124000000_hold_deposits`; chính sách cọc snapshot trong `booking_holds.deposit_policy_snapshot` cùng lúc snapshot giá; `be/src/booking/deposit-snapshot.ts` (FIXED tối đa bằng tổng, PERCENT làm tròn lên, có unit test); `GET/POST /v1/merchant/booking/holds/{id}/deposits` chỉ ghi thêm, audit, idempotent, chặn vượt số còn thiếu/hold không hoạt động/chưa snapshot; xác nhận cần đủ cọc. E2E idempotency, cọc đồng thời, snapshot bất biến, vai trò, hết hạn, xác nhận |
| PAY-007 | Đối soát sổ quỹ: phải thu/đã thu, sửa/đảo giao dịch, hoàn cọc khi hold hết hạn | Payment | 6 | P0 | BLOCKED | PAY-005, PAY-006, CAN-002 | Chờ PO quyết định: cách tính phải thu, quyền sửa/đảo giao dịch, hoàn cọc khi hold hết hạn, tiền hoàn ở CAN-002 có thành bút toán sổ quỹ hay không. Đồng thời xác nhận giả định làm tròn cọc và không cho ghi vượt (xem `work-log.md`) |
| WEB-001 | Nền web đặt phòng cho khách | Frontend | 5 | P0 | VERIFY | API-002, AVL-003, PRC-004 | Catalog, phòng trống, báo giá, điều khoản có version, guest hold/tra cứu (xem FE-006). Còn QA-003 (accessibility) và UAT |
| WEB-002 | API catalog công khai và đặt phòng cho khách | Booking/Web | 5 | P0 | VERIFY | AVL-003, PRC-004 | Publication của Owner, catalog/phòng trống/báo giá/điều khoản công khai, guest hold nguyên tử, rate limit, tra cứu SĐT + mã, chỉ hiển thị khi `published` và `platform_approved`; hold/lookup trả `depositRequiredVnd`, lookup trả `bookingStatus`. Còn QA-003/UAT |
| WEB-003 | Điều khoản đặt phòng công khai có version | Booking/Web | 5 | P0 | DONE | WEB-002, UAT-PD-005 | Owner lưu một nội dung, tăng version, audit không chép nội dung, đọc công khai có kiểm soát; E2E qua. FE nối ở FE-006 |
| WEB-004 | Guest hold công khai, rate limit và tra cứu booking | Booking/Web | 5 | P0 | DONE | WEB-003, UAT-PD-001/003/004/006/012 | Hold bắt buộc SĐT, rate limit theo IP và SĐT đã chuẩn hoá (`0…`/`84…`/`+840…` → `+84…`, `be/src/booking/phone.ts`), replay idempotent, booking code 128 bit lưu dạng hash, tra cứu không lộ dữ liệu, kiểm tra lại giá/điều khoản, xung đột occupancy rõ ràng, không CAPTCHA/OTP. FE nối ở FE-006 |
| PLT-001 | Platform Admin duyệt listing | Platform | 5 | P0 | VERIFY | IAM-002, WEB-002, UAT-PD-009/010 | Migration `20261124010000_platform_listing_approval` (quyền `platform_admins` toàn hệ thống, không có API cấp quyền), `GET /v1/platform/catalog/listings`, `POST .../{tenantId}/approve|revoke` có audit, khoá catalog, chặn tự duyệt, yêu cầu đã publish/active; seed UAT tạo Platform Admin không thuộc merchant nào. E2E 401/403, nhiều merchant, đồng thời, lý do thu hồi, quyền đã thu hồi. Màn FE ở FE-009 (chưa commit). Còn QA-003/UAT |
| PLT-002 | Platform Admin tạo merchant thủ công | Platform | 5 | P0 | VERIFY | PLT-001, PD-029 | `GET/POST /v1/platform/merchants` tạo tenant ACTIVE + Owner đầu tiên (tài khoản mới: mật khẩu tạm do admin nhập, bắt buộc đổi; tài khoản có sẵn: giữ mật khẩu), mã duy nhất dưới advisory lock, audit `MERCHANT_CREATED`. E2E 401/403, validation, trùng/đồng thời mã, đổi mật khẩu lần đầu, Owner có sẵn tài khoản, lọc danh sách. Màn FE ở FE-010 (chưa commit). Khoá merchant và reset mật khẩu Owner ngoài phạm vi |
| CAN-001 | Duyệt chính sách hủy/hoàn tiền/no-show | Product | 6 | P0 | DONE | — | Điều khoản tự do theo booking, nhân viên xem xét và ghi nhận; không tự quyết hoàn tiền/no-show (`PD-006`, `PD-015`) |
| CAN-002 | Snapshot điều khoản hủy và quy trình kết quả do nhân viên ghi nhận | Booking/Payment | 6 | P0 | DONE | BKG-005, PD-027, PD-028 | Điều khoản snapshot khi xác nhận. `POST /v1/merchant/booking/bookings/{id}/outcome` (Owner/Branch Manager) ghi một kết quả mỗi booking: loại, ghi chú bắt buộc, tiền hoàn CASH tuỳ chọn ≤ cọc + tiền đã ghi; CONFIRMED → CANCELLED/NO_SHOW, giải phóng phòng, audit không chứa ghi chú. E2E validation, giới hạn hoàn, đồng thời/replay, kết quả xung đột, phân quyền, đặt lại khung giờ đã giải phóng. Tiền hoàn là bản ghi, chưa phải bút toán sổ quỹ (PAY-007) |
| EVT-001 | Schema và dispatcher transactional outbox | Platform | 7 | P0 | DONE | FND-002 | E2E rollback, retry, thu hồi claim cũ có fencing, tắt tiến trình, adapter chưa cấu hình. Dừng worker cũ trước migration claim-token |
| EVT-002 | Theo dõi backlog outbox và phục hồi worker | Platform | 7 | P0 | DONE | EVT-001 | Backlog outbox theo tenant cho Owner; retry/backoff có che dữ liệu, tắt êm; unit và E2E qua. Giám sát production ở OPS-003 |
| NTF-001 | Cổng notification và adapter test không gửi thật | Notification | 7 | P0 | DONE | EVT-001 | Adapter production báo chưa cấu hình, adapter test ghi lại; lỗi provider không rollback giao dịch đã commit |
| OPS-001 | Health/readiness, metrics và nền OpenTelemetry | Operations | 7 | P0 | DONE | FND-001 | E2E lỗi readiness, metrics Prometheus, traceparent W3C; export OTLP cấu hình được, chưa thử với collector thật |
| OPS-002 | Backup/restore và diễn tập phục hồi | Operations | 8 | P0 | BACKLOG | Thiết kế môi trường production | Báo cáo diễn tập có đo RPO/RTO |
| OPS-003 | Giám sát và cảnh báo worker `holds:expire`, `outbox:work` | Operations | 8 | P0 | BACKLOG | BKG-003, EVT-002, thiết kế môi trường production | Supervisor tự khởi động lại, ngưỡng cảnh báo backlog/heartbeat. Lưu ý: compose local không chạy hai worker này |
| QA-001 | Ma trận truy vết FR → API → test tự động → UAT | Quality | 7 | P0 | DONE | API-002 | `docs/04-quality/requirement-traceability.md` FR-001 → FR-015 |
| QA-002 | Bộ test hiệu năng và đồng thời cho booking | Quality | 8 | P0 | READY | BKG-004 | Benchmark có tài liệu và kết quả tái lập được |
| QA-003 | Kiểm thử FE–BE theo vai trò trên trình duyệt | Quality | 8 | P0 | BLOCKED | Môi trường có trình duyệt tự động (ví dụ Playwright) | Kịch bản cho Owner, Branch Manager, Receptionist, Cashier, Platform Admin và khách: phân quyền, tenant/chi nhánh sai, xoay token/đăng xuất đồng thời, lỗi mạng, mobile/accessibility. Đạt thì các task `VERIFY` liên quan chuyển `DONE` (cùng UAT-001) |
| UAT-001 | Quy trình và checklist UAT nhiều merchant | Quality/Ops | 8 | P0 | READY | REC-002, WEB-001, PAY-005 | Phạm vi đã chốt `UAT-PD-001`–`012` (+ PD-025…029). Viết checklist có thể bắt đầu ngay; chạy UAT sau QA-003 |
| ZAL-001 | Xác minh quyền Zalo Mini App và tương thích SDK | Channel | Pilot | P1 | BLOCKED | Phê duyệt nền tảng bên ngoài | Văn bản xác minh; không tuyên bố tích hợp trước khi được duyệt |
| META-001 | Xác minh quyền Meta và cách dùng web/deep-link | Channel | Pilot | P1 | BLOCKED | Phê duyệt nền tảng bên ngoài | Văn bản xác minh; không tuyên bố tích hợp trước khi được duyệt |

## Hàng đợi thực hiện

Cập nhật 2026-11-26. Lịch sử phiên và giả định đang chờ: [`work-log.md`](work-log.md).

**Luồng FE**

1. Commit FE-005, FE-009, FE-010 (cọc, check-in/out/hủy, `/platform`, các màn quản trị merchant) rồi chuyển sang `VERIFY`; smoke test luồng hủy/no-show thành công với `uat.owner@karaokenow.local`.
2. REC-003: lịch lễ tân hợp nhất hold + booking, lọc trạng thái.
3. QA-003 khi có môi trường trình duyệt; sau đó FE-011, FE-012 theo ưu tiên.

**Luồng BE**

1. Hỏi PO rồi làm: BKG-007 (overtime), PAY-007 (đối soát sổ quỹ, hoàn cọc khi hết hạn, xác nhận giả định cọc), BKG-008 (điều kiện không cọc theo trường hợp).
2. QA-002 benchmark booking/đồng thời (sẵn sàng làm ngay).
3. IAM-004 khi có ZBS OA/App/mẫu tin; OPS-002/OPS-003 khi có thiết kế môi trường production.
4. Tuỳ chọn, cần quyết định: khoá merchant, Platform Admin reset mật khẩu Owner, `GET /platform/me`; bổ sung response schema OpenAPI còn thiếu (hỗ trợ FE-011).

**Chung:** UAT-001 viết checklist ngay; chạy sau QA-003.

## Thiết lập bên ngoài và quyết định sau pilot

Quyết định pilot đã duyệt nằm ở [`docs/00-product/decision-log.md`](../00-product/decision-log.md). Các việc dưới đây chưa được ngầm duyệt.

| Thứ tự | Quyết định / thiết lập | Cần trước | Task liên quan |
|---:|---|---|---|
| 1 | Cấu hình ZBS Template Message cho mã reset; dự phòng PD-014 đã duyệt; email tạm hoãn | Sprint 1 | IAM-004 / PD-012 / PD-014; ghi chú provider tại `docs/00-product/notification-provider-shortlist.md` |
| 2 | Overtime, đối soát sổ quỹ, điều kiện không cọc theo trường hợp | Trước UAT tiền mặt đầy đủ | BKG-007, PAY-007, BKG-008 |
| 3 | Môi trường trình duyệt tự động cho kiểm thử FE–BE | Trước nghiệm thu `VERIFY` | QA-003 |
| 4 | Provider thanh toán/MoR và đối soát commission sau pilot (pilot chỉ báo cáo commission) | Sau pilot | PAY-002 / PD-016 |

## Quy tắc cập nhật

Khi thay đổi một task:

1. Cập nhật trạng thái và phụ thuộc trong file này; nếu còn việc dở, tách task mới thay vì giữ `IN_PROGRESS`.
2. Khi chuyển `DONE` hoặc `VERIFY`, ghi link migration, API và test vào cột bằng chứng.
3. Ghi phê duyệt của PO vào decision log, không chỉ ghi ở bảng này.
4. Cập nhật repository audit khi một module chuyển từ chưa có sang đã có.
5. Không đánh dấu hoàn thành provider bên ngoài, mục tiêu hiệu năng hay release gate khi chưa có bằng chứng đã chạy.
6. Thêm mục vào `work-log.md` ở cuối mỗi phiên.
