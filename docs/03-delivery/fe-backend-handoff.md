# Bàn giao backend cho frontend

Cập nhật: 2026-11-26. Hợp đồng chi tiết: [API reference](../02-architecture/api-reference.md). Đây là tài liệu phối hợp giữa các session BE/FE trong repository; OpenAPI là hợp đồng máy đọc.

## FE READY — public booking terms (2026-11-26)

Session Luồng FE có thể tiếp tục tích hợp ngay. Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E:

- Owner: `GET/PATCH /v1/merchant/catalog/public-booking-terms`; PATCH body `{ "terms": "..." }`.
- Khách: `GET /v1/public/branches/{branchId}/booking-terms`; chỉ trả khi merchant đã publish, được Platform duyệt và branch đang active.
- Response: `{ "configured": true, "terms": "...", "version": "1", "updatedAt": "..." }`.
- FE phải giữ nguyên `terms` và `version` khách đã xem; gửi `version` trong public hold. Nếu điều khoản đã đổi, backend trả 409 để FE tải và yêu cầu khách đọc/chấp nhận lại.

## FE READY — public hold and booking lookup (2026-11-26)

Session Luồng FE có thể nối tiếp luồng khách từ quote sang hold và tra cứu. Contract đã qua PostgreSQL Docker E2E:

- `POST /v1/public/booking/holds`, header `Idempotency-Key`, body `{roomId,startAt,durationMinutes,phone,email?,expectedTotalAmountVnd,termsVersion}`.
- Response 201: `{holdId,branchId,roomId,startAt,durationMinutes,reservedEndAt,expiresAt,status,totalAmountVnd,termsVersion,bookingCode}`.
- Giữ nguyên cùng idempotency key và body khi retry; backend trả lại cùng hold và booking code. Không tái sử dụng key cho body khác.
- `POST /v1/public/booking/lookup`, body `{phone,bookingCode}`; response có `holdId`, `bookingId|null`, branch/room/time, `status`, tổng tiền và terms version.
- Số điện thoại được chuẩn hoá trước khi tính idempotency, rate limit và lookup: `0912345678`, `84912345678`, `+84912345678` và `+840912345678` là cùng một số. Số quốc tế khác `+84` giữ nguyên.
- Lưu `bookingCode` cho khách ngay sau khi tạo hold. Sai phone hoặc code đều trả 404 chung; 429 là rate limit. Không tự retry 429 liên tục.
- Hold công khai chưa tự xác nhận. FE hiển thị trạng thái chờ nhân viên gọi xác minh; staff tiếp tục dùng API phone-verification và confirmation hiện có.

### FE INTEGRATED — 2026-11-26

- Merchant FE đã nối GET/PATCH điều khoản công khai và hiển thị version hiện tại.
- Customer FE đã nối catalog → availability → quote → đọc/chấp nhận điều khoản; snapshot `terms` và `version` được giữ nguyên trong state khi khách tick đồng ý.
- Build Next.js/TypeScript Node 26 đã qua. FE đã nối public hold/lookup theo marker FE READY WEB-004 (2026-11-26); chưa smoke test với backend thật.

## FE READY — cọc tiền mặt trên hold và xác nhận có cọc (PAY-006, 2026-11-26)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 35/35:

- Khi staff gắn thông tin khách (`POST .../holds/{id}/details`) hoặc khách tạo public hold, BE snapshot chính sách cọc của kênh cùng lúc với snapshot giá. Hold chi tiết trả `depositPolicySnapshot: {mode,fixedAmountVnd,percent,policyVersion,requiredAmountVnd}`; đổi chính sách sau đó không ảnh hưởng hold này.
- `GET /v1/merchant/booking/holds/{id}/deposits` (Owner, Branch Manager, Receptionist, Cashier): `{holdId,holdStatus,depositPolicySnapshot|null,requiredAmountVnd,totalRecordedVnd,remainingVnd,depositSatisfied,items[]}`.
- `POST /v1/merchant/booking/holds/{id}/deposits` (Owner, Branch Manager, Cashier), header `Idempotency-Key`, body `{method:"CASH",amountVnd,note?}`; 200 trả khoản cọc hoặc replay. 409 khi hold hết hạn/đã xác nhận, chưa có snapshot, không cần cọc, vượt số còn thiếu hoặc key dùng cho body khác.
- `POST .../holds/{id}/confirm`: snapshot NONE vẫn cần quyền không cọc theo kênh như cũ; snapshot FIXED/PERCENT cần cọc đủ, khi đó `confirmationPolicySnapshot` có `requiredDepositVnd` và `depositRecordedVnd`. Thiếu cọc trả 409.
- Public hold và lookup có thêm `depositRequiredVnd`; lookup có `depositRecordedVnd`. FE khách hiển thị số cọc cần đóng tại quầy, không có thanh toán online.
- Đã chốt (PD-033, 2026-11-28): FIXED lớn hơn tổng tiền thì cọc bằng tổng tiền; PERCENT làm tròn lên đến đồng; không cho ghi cọc vượt số còn thiếu. Hoàn cọc khi hold hết hạn chưa có API — xử lý ngoài hệ thống.

## FE READY — check-in, check-out và hủy/no-show (FR-009/010, CAN-002, 2026-11-26)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 36/36. Quyết định PO: PD-025…PD-028.

- Booking response có thêm `checkedInAt`, `checkedInBy`, `checkedOutAt`, `checkedOutBy`, `outcome: {type,note,refundAmountVnd,recordedBy,recordedAt}|null`; `status` ∈ `CONFIRMED|CHECKED_IN|COMPLETED|CANCELLED|NO_SHOW`. Lịch chi nhánh trả mọi trạng thái — FE tự lọc/hiển thị.
- `POST /v1/merchant/booking/bookings/{id}/check-in` (Owner, Branch Manager, Receptionist): CONFIRMED → CHECKED_IN, không giới hạn giờ. Gọi lại khi đã CHECKED_IN trả 200 như cũ; trạng thái khác 409.
- `POST .../check-out` (cùng quyền): CHECKED_IN → COMPLETED, ghi giờ thực tế. Về sớm: `reservedEndAt` rút về giờ check-out + buffer, phòng mở lại. Về muộn: chỉ ghi giờ, không tính overtime.
- `POST .../outcome` (Owner, Branch Manager), body `{type:"CUSTOMER_CANCELLED"|"MERCHANT_CANCELLED"|"NO_SHOW", note, refundAmountVnd?}`: chỉ từ CONFIRMED; phòng được giải phóng ngay. Mỗi booking một kết quả; gửi lại đúng body trả 200, body khác 409. `refundAmountVnd` là số tiền mặt nhân viên đã hoàn, không vượt tổng cọc trên hold + CASH đã ghi; hệ thống không tự tính.
- Public lookup có thêm `bookingStatus` để khách thấy booking đã check-in, hoàn tất, bị hủy hay no-show.

## FE READY — Platform Admin duyệt listing (PLT-001, 2026-11-26)

- Platform Admin là quyền toàn hệ thống, **không gửi `X-Tenant-ID`**. Chỉ cấp qua dữ liệu (`platform_admins`), không có API cấp quyền. UAT seed tạo `uat.platform@karaokenow.local`.
- `GET /v1/platform/catalog/listings?status=PENDING|APPROVED|ALL&limit&offset` (mặc định PENDING = merchant đã publish và chưa duyệt). Item: `{tenantId,merchantCode,merchantName,tenantStatus,published,platformApproved,platformDecidedBy,platformDecidedAt,activeBranchCount,termsConfigured,updatedAt,version}`.
- `POST /v1/platform/catalog/listings/{tenantId}/approve` body `{note?}`; `POST .../revoke` body `{reason}` bắt buộc. Gọi lại khi đã ở trạng thái đích trả 200 không đổi. 403 nếu không phải Platform Admin hoặc reviewer là thành viên của merchant đó; 409 nếu merchant chưa publish hoặc không active; 404 nếu merchant chưa có listing.
- Merchant Owner xem lịch sử duyệt qua audit log của tenant (`PLATFORM_LISTING_APPROVED`/`REVOKED`).

### FE INTEGRATED — PAY-006, check-in/out/outcome, PLT-001 (2026-11-26)

- `hold-details.tsx`: đọc/ghi cọc CASH trên hold, xác nhận theo snapshot cọc. `booking-operations.tsx`: check-in, check-out, kết quả hủy/no-show. `/platform`: duyệt/thu hồi listing. Khách thấy `depositRequiredVnd`, `bookingStatus` và cọc đã ghi.
- `tsc`, `next build` và FE unit test 27/27 qua. **Chưa smoke test với backend thật**: container `karaokenow-backend-1` local vẫn là bản cũ, trả 404 cho `/v1/public/booking/lookup` và `/v1/platform/catalog/listings`.

## Thay đổi BE ảnh hưởng FE (2026-11-26, QA-002/UAT-001)

- Lỗi tranh chấp đồng thời của PostgreSQL (deadlock/serialization) giờ trả **409** với message `The resource was changed concurrently; retry the request` thay vì 500. FE xử lý như 409 xung đột thông thường: tải lại dữ liệu và cho người dùng thử lại; không tự retry liên tục.
- Giữ phòng trùng phòng/khung giờ dưới tải cao giờ trả 409 trong vài trăm ms (trước có thể treo hơn một phút rồi 500).
- Seed UAT có thêm `uat.manager@…`, `uat.reception@…`, `uat.cashier@…` (merchant UAT) và `uat2.owner@…` (merchant UAT2, chờ duyệt); mật khẩu và dữ liệu mẫu ở `docs/04-quality/uat-checklist.md`. Có thể dùng cho kịch bản Playwright Branch Manager/Cashier (QA-003).

## FE READY — overtime và khoá merchant (BKG-007, PLT-003, 2026-11-26)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 40/40. Quyết định PO: PD-030, PD-031.

- `GET /v1/merchant/booking/overtime-policy` (mọi vai trò merchant) → `{configured,graceMinutes,version}`; chưa cấu hình trả `configured=false`, `graceMinutes=10`. `PATCH` (Owner, Branch Manager) body `{graceMinutes: 0–60}`.
- Booking có thêm `lateMinutes`, `overtimeMinutes`, `overtimeGraceMinutes` (null trước check-out). `overtimeMinutes` = `lateMinutes` khi vượt ân hạn, ngược lại 0. Chỉ để hiển thị/báo cáo — **không** có tiền overtime; tiền thu thêm (nếu có) ghi như CASH thường. Không có thao tác gia hạn giờ.
- `POST /v1/platform/merchants/{tenantId}/suspend` và `/reactivate`, body `{reason}` bắt buộc, không gửi `X-Tenant-ID`; trả summary merchant (`status` `INACTIVE`/`ACTIVE`). Gọi lại khi đã ở trạng thái đích trả 200 không đổi. 403 nếu không phải Platform Admin hoặc admin là thành viên merchant đó; 404 nếu không có merchant. Danh sách `GET /v1/platform/merchants?status=INACTIVE` lọc merchant đang khoá.
- Khi bị khoá: merchant biến khỏi catalog công khai (public hold trả 404); staff `POST /merchant/booking/holds` trả **409** "Merchant is suspended; new holds are not accepted"; các thao tác khác trên hold/booking đã có vẫn chạy. `GET /v1/merchant/catalog/publication` có thêm `tenantStatus` để Owner hiển thị cảnh báo.
- Phản hồi "Yêu cầu BE — triển khai": đã ghi nhận thành task **OPS-005** (image/target cho migration và worker, tắt Swagger theo môi trường); chưa triển khai.
- Lưu ý README: seed UAT nay **đã** tạo bảng giá, điều khoản và cọc WEB 30% cho merchant UAT (xem `docs/04-quality/uat-checklist.md`); câu "Seed UAT chưa tạo bảng giá" trong bản README đang sửa đã cũ.

## Phiên đăng nhập

- `POST /v1/auth/login` và `POST /v1/auth/refresh` trả `accessToken`, `expiresIn`, `refreshToken`, `refreshExpiresIn`, `mustChangePassword`; thời gian tính theo giây.
- Refresh xoay token. Dùng lại refresh token đã bị xoay được coi là reuse và thu hồi cả họ token. FE cần gom các lời gọi refresh đồng thời thành một yêu cầu và thay cặp token cùng lúc.
- `POST /v1/auth/logout` nhận `{ "refreshToken": "..." }`, trả 204; backend thu hồi cả họ của token, kể cả token được xoay đồng thời. E2E PostgreSQL kiểm tra refresh/logout chạy đồng thời và logout bằng token ngay trước lần xoay. FE vẫn phải ngăn response refresh đến muộn khôi phục trạng thái đã logout và kiểm thử trên trình duyệt.
- Nếu refresh thất bại do mất mạng, không thể biết server đã xoay token chưa. Không tự động gửi lại token cũ: nếu server đã xử lý, việc dùng lại có thể thu hồi họ token. Hướng người dùng đăng nhập lại khi không thể khôi phục an toàn. Logout thất bại do mạng không chứng minh server đã thu hồi phiên.
- FE hiện lưu phiên trong bộ nhớ; reload, race trong browser và lỗi mạng vẫn cần kiểm thử FE–BE thực tế. E2E backend không chứng minh browser integration.

## Booking, lễ tân và khách hàng

- Staff API hiện có quote/availability, tạo và đọc hold, danh sách hold theo chi nhánh, gắn số điện thoại/email cùng snapshot giá, và ghi nhận nhân viên gọi xác minh. API danh sách chỉ trả hold; nó không phải lịch booking đầy đủ. `holds:expire` cần chạy riêng.
- Đã có `POST /v1/merchant/booking/holds/{id}/confirm` cho nhân viên xác nhận **không cọc** khi hold còn hiệu lực, có liên hệ, snapshot giá và xác minh điện thoại, chính sách cọc là NONE và merchant đã cho phép xác nhận không cọc theo kênh. Body có `cancellationTerms` là điều khoản đã hiển thị cho khách; response 200 trả booking. Replay cùng điều khoản trả cùng booking; điều khoản khác hoặc không đủ điều kiện trả 409. `GET /v1/merchant/booking/bookings/{id}` đọc booking trong phạm vi tenant/chi nhánh.
- Đã có `GET /v1/merchant/branches/{branchId}/booking/bookings` lọc theo `from`/`to` có múi giờ và phân trang. Đây là danh sách booking; khi ghép với danh sách hold, loại hold `CONFIRMED` để tránh trùng. Trạng thái check-in/check-out/hủy/no-show đã có (xem marker FE READY phía trên).
- Đã có GET/POST `/v1/merchant/booking/bookings/{id}/manual-payments` cho Owner, Branch Manager và Cashier; hiện chỉ ghi từng khoản `CASH` của booking đã xác nhận, dùng idempotency key. `GET .../summary` trả tổng khoản đã ghi và số giao dịch chính xác. Đây chưa phải đối soát sổ quỹ: chưa có hoàn/void, điều chỉnh hay trạng thái phải thu/đã thu; chưa xác nhận booking có cọc.
- Catalog công khai chỉ trả merchant đã `published=true` và được duyệt riêng `platformApproved=true`. FE khách dùng public branches/rooms, availability và quote như mô tả trong OpenAPI. Public hold và lookup đã sẵn sàng ở marker FE READY phía trên; hold không tự xác nhận. API Platform Admin approval và xác nhận booking có cọc đã sẵn sàng ở các marker FE READY phía trên.
- Owner cấu hình một nội dung điều khoản UAT tại `GET/PATCH /v1/merchant/catalog/public-booking-terms`; khách đọc `GET /v1/public/branches/{branchId}/booking-terms`. Response `{configured,terms,version,updatedAt}`; FE phải giữ `version` cùng nội dung khách đã tick đồng ý để gửi vào public hold sau khi contract đó được cấp. Không tự dùng nội dung mới nếu version khách đã xem thay đổi.
- Cấu hình cọc và quyền xác nhận không cọc theo kênh đã có API; số cọc được tính khi snapshot giá và áp dụng khi xác nhận (xem PAY-006).

## FE READY — Platform Admin tạo merchant (PLT-002, 2026-11-26)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 37/37. Quyết định PO: PD-029.

- Không gửi `X-Tenant-ID`; cùng quyền Platform Admin như duyệt listing.
- `GET /v1/platform/merchants?status=ACTIVE|INACTIVE|ALL&limit&offset` (mặc định ALL, mới nhất trước). Item: `{tenantId,code,name,status,createdAt,ownerCount,activeBranchCount,published,platformApproved}`.
- `POST /v1/platform/merchants` body `{code,name,owner:{email,displayName,temporaryPassword}}`; `code` dạng `^[A-Z0-9][A-Z0-9_-]{0,49}$`, mật khẩu tạm ≥ 12 ký tự. 201 trả summary + `owner:{userId,email,membershipId,accountCreated}`. 409 khi trùng `code`.
- `accountCreated=false` nghĩa là email đã có tài khoản: mật khẩu tạm **không** được áp dụng, Owner đăng nhập bằng mật khẩu hiện có. FE phải hiển thị rõ điều này thay vì đưa mật khẩu tạm cho Owner.
- Tài khoản mới đăng nhập lần đầu nhận `mustChangePassword=true` và phải đổi mật khẩu trước khi dùng API merchant (luồng đổi mật khẩu FE đã có). Merchant mới chưa publish, chưa được duyệt.

## Màn FE còn thiếu cho quản trị (bàn giao 2026-11-26)

Backend đã có API cho tất cả mục dưới đây; FE chưa có màn. Đã loại trừ những phần FE đã nối (duyệt listing `/platform`, cọc trên hold, check-in/out, hủy/no-show).

| # | Màn | Ai dùng | API | Lưu ý |
|---:|---|---|---|---|
| 1 | Tạo và danh sách merchant | Platform Admin | `GET/POST /v1/platform/merchants` | Đặt trong `/platform` cạnh duyệt listing; xem marker PLT-002 phía trên. |
| 2 | Bật/tắt publish catalog | Owner | `GET/PATCH /v1/merchant/catalog/publication` body `{published}` | Hiển thị `platformApproved`: publish nhưng chưa duyệt thì khách chưa thấy — ghi rõ "đang chờ Platform duyệt". |
| 3 | Quản lý nhân viên | Owner | `GET/POST /v1/merchant/memberships`, `PATCH /v1/merchant/memberships/{id}` | POST `{email,displayName,temporaryPassword(≥12),roles[],branchIds[]}`; vai trò khác OWNER cần ít nhất 1 chi nhánh. PATCH `{status?,roles?,branchIds?}`; vô hiệu hoá bằng `status:"INACTIVE"`. 409 khi user đã là thành viên. Email đã có tài khoản thì mật khẩu tạm bị bỏ qua. |
| 4 | Nhật ký audit | Owner | `GET /v1/merchant/audit-logs?limit(≤200)&offset` | Trả **mảng** (không có `hasMore`): coi còn trang khi số phần tử = `limit`. Hiển thị `action`, `actorUserId`, `entityType/entityId`, `occurredAt`; `beforeData/afterData` là JSON tuỳ loại. |
| 5 | Phiên đăng nhập của tôi | Mọi user | `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}` | Thu hồi phiên hiện tại tương đương đăng xuất trên thiết bị đó. |
| 6 | Theo dõi vận hành | Owner | `GET /v1/merchant/booking/hold-expiry/backlog`, `GET /v1/merchant/notifications/outbox/backlog` | Số hold quá hạn chưa xử lý và hàng đợi thông báo; giá trị lớn nghĩa là worker không chạy. |

Chưa có API (không làm màn): quên/reset mật khẩu (IAM-004 chờ ZBS), sửa hồ sơ merchant, khoá merchant, cấp quyền Platform Admin (cố ý chỉ cấp bằng dữ liệu). FE nhận biết Platform Admin bằng cách gọi `GET /v1/platform/catalog/listings?limit=1` — 403 nghĩa là không có quyền.

**Smoke test:** container backend không tự chạy migration. Trong `be/`: `npm run db:migrate` (dùng `DATABASE_URL` tới Postgres compose ở cổng 5433), `npm run db:seed:uat` để có tài khoản Owner và `uat.platform@karaokenow.local`, rồi `docker compose up -d --build backend`. Bỏ qua bước nào thì API mới trả 404 hoặc 500.

### FE INTEGRATED — màn quản trị (2026-11-26)

- Cả 6 màn trong bảng trên đã có: `/platform` (merchant + duyệt listing + phiên), Owner (publication, nhân viên, audit, vận hành), phiên đăng nhập cho mọi user.
- Smoke test qua proxy FE 44/44 sau khi migrate, seed UAT và rebuild container (xem task board). Để luồng khách chạy được, đã tạo trên DB local: điều khoản công khai phiên bản 1, bảng giá `UAT_SMOKE` (150.000 ₫/giờ, mọi ngày) và cọc kênh WEB 30%. Seed UAT chưa có bảng giá nên khách không báo giá được nếu thiếu bước này.
- **Cần BE xem:** `GET /v1/public/branches/{id}/booking-terms` trả 404 khi chưa cấu hình, trong khi handoff/OpenAPI mô tả `{configured:false}` (endpoint Owner trả đúng `configured:false`). FE đã xử lý cả hai; nên thống nhất contract.

### FE BROWSER TEST — 2026-11-26

Chrome headless (Playwright) với container backend/frontend đã rebuild: luồng khách (mobile/desktop), lễ tân/Owner 19/19, Platform và phân quyền 14/14. Lỗi FE tìm ra và đã sửa:
- key React trùng trong `experience.tsx` làm khối tra cứu hold render hai lần;
- `pattern` độ lệch UTC không hợp lệ với cờ `v` của Chrome, nên validation bị bỏ qua;
- thiếu favicon;
- màn điều khoản công khai và audit vẫn hiện với vai trò không phải Owner.

**Yêu cầu BE (chặn lễ tân xác nhận hold online):** xác nhận hold kênh WEB yêu cầu `cancellationTerms` trùng khớp từng ký tự với `public_accepted_terms`, nhưng `GET /v1/merchant/booking/holds/{id}` không trả trường này. Lễ tân (không phải Owner) không đọc được điều khoản công khai, nên không thể xác nhận hold online. Đề xuất trả `publicAcceptedTerms` và `publicAcceptedTermsVersion` trong hold chi tiết. FE đã đọc sẵn `publicAcceptedTerms` nếu có. Hiện FE tạm điền điều khoản công khai hiện tại (chỉ Owner đọc được); cách này sai nếu Owner sửa điều khoản sau khi khách đặt.

### FE INTEGRATED — overtime và khoá merchant (FE-013, 2026-11-26)

- Ân hạn quá giờ ở mục Giá & chính sách; lịch booking hiển thị `lateMinutes`/`overtimeMinutes`/`overtimeGraceMinutes` sau check-out; `/platform` → Merchant khoá/mở khoá có lý do; Owner thấy cảnh báo khi `tenantStatus=INACTIVE`; 409 "merchant bị khoá" và "changed concurrently" được dịch sang tiếng Việt trong `fe/src/lib/api.ts`.
- `npm run e2e` (container rebuild): API 54/54, khách 20/20, lễ tân 21/21, Platform 16/16. README đã cập nhật: seed UAT có sẵn bảng giá/điều khoản/cọc.

### FE ROLE TEST — QA-003 (2026-11-26)

`fe/e2e/roles.mjs` (Chrome headless, tài khoản seed UAT) đạt 21/23. Lỗi FE tìm ra và đã sửa: lỗi ghi cọc bị xoá ngay khi màn tải lại số cọc (kể cả 409 vượt số còn thiếu); lịch booking của Lễ tân hiện banner lỗi vì không có quyền đọc tiền mặt (nay ẩn phần thu tiền với vai trò này); lỗi `Insufficient role` hiện tiếng Anh (nay dịch); ghi hủy/no-show bị 403 hiện kèm câu sai ngữ cảnh về tiền hoàn.

**Yêu cầu BE:**
1. **Quyền Thu ngân không khớp nghiệp vụ.** Thu ngân được `POST .../holds/{id}/deposits` và `POST .../bookings/{id}/manual-payments`, nhưng không được `GET /v1/merchant/booking/holds/{id}`, `GET /v1/merchant/branches/{branchId}/booking/holds` và `GET /v1/merchant/branches/{branchId}/booking/bookings`, nên trên FE không có đường nào tới form ghi cọc/tiền mặt. Đề xuất cho CASHIER quyền đọc ba endpoint trên (hoặc endpoint đọc tối giản riêng). Hai bước đỏ trong `roles.mjs` sẽ xanh khi sửa.
2. **API vai trò của người dùng hiện tại** (ví dụ `GET /v1/merchant/me` → `{roles, branchIds}`). FE hiện phải đoán quyền bằng cách thử gọi API và xử lý 403 sau khi người dùng bấm; có API này FE ẩn trước các nút không được phép (ghi cọc với Lễ tân, hủy/no-show với Lễ tân, lưu ân hạn với Lễ tân/Thu ngân).

### Yêu cầu BE — triển khai (2026-11-26)

Khi viết hướng dẫn triển khai trong `README.md`, phát hiện image runtime của backend (`be/Dockerfile`) chỉ chứa `dist/` và dependency production: thiếu `node-pg-migrate`, `ts-node`, `migrations/`, `scripts/`, nên không chạy được `db:migrate`, `holds:expire`, `outbox:work` từ image. Đề xuất thêm target/image cho migration và worker (hoặc biên dịch worker vào `dist/` và đưa `node-pg-migrate` + `migrations/` vào image). Ngoài ra Swagger `/docs` và `/v1/metrics` luôn bật; cân nhắc tắt `/docs` theo biến môi trường ở production.

## FE READY — phản hồi yêu cầu từ FE ROLE TEST và triển khai (2026-11-26)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 41/41.

1. **Xác nhận hold online:** `GET /v1/merchant/booking/holds/{id}` trả thêm `publicAcceptedTerms` và `publicAcceptedTermsVersion` (null với hold do nhân viên tạo). Lễ tân gửi đúng `publicAcceptedTerms` làm `cancellationTerms` khi xác nhận hold WEB; không dùng điều khoản công khai hiện tại. E2E: Lễ tân (không đọc được điều khoản công khai) xác nhận hold WEB thành công.
2. **Quyền Thu ngân:** CASHIER được đọc `GET /v1/merchant/booking/holds/{id}`, `GET /v1/merchant/branches/{branchId}/booking/holds`, `GET /v1/merchant/booking/bookings/{id}` và `GET /v1/merchant/branches/{branchId}/booking/bookings`, chỉ trong chi nhánh được cấp (chi nhánh khác 403). Thu ngân vẫn không tạo/xác nhận hold, không check-in/out, không hủy.
3. **`GET /v1/merchant/me`** (cần `X-Tenant-ID`, mọi vai trò) → `{userId,email,displayName,tenantId,tenantName,tenantStatus,membershipId,roles,branchIds,platformAdmin}`. Owner có `branchIds` rỗng nhưng thấy mọi chi nhánh. Chỉ để hiển thị; endpoint vẫn tự kiểm quyền. Không có membership trong tenant → 403.
4. **OPS-005 (triển khai):** `be/Dockerfile` có target `tools` (migration + worker) bên cạnh `runtime` (API). Compose: `docker compose --profile tools run --rm migrate`, `docker compose --profile workers up -d` (hai worker). `SWAGGER_ENABLED=false` tắt `/docs`; `/v1/metrics` vẫn bật — chặn ở reverse proxy. Phần "Giới hạn hiện tại" trong README cần cập nhật theo các lệnh này.

### FE INTEGRATED — API-003 và OPS-005 (2026-11-26)

- `GET /v1/merchant/me` dùng cho menu và thao tác theo vai trò (`fe/src/lib/permissions.ts` ánh xạ `@RequireRoles` của BE; chưa biết vai trò thì không ẩn gì). Sidebar hiện tên merchant, người dùng, vai trò; banner khi `tenantStatus=INACTIVE` cho mọi vai trò.
- Xác nhận hold WEB dùng `publicAcceptedTerms` (ô điều khoản khoá, đúng nguyên văn). Thu ngân tra hold/ghi cọc và xem lịch/thu tiền mặt được trên FE.
- README gốc cập nhật target `tools`, profile `tools`/`workers`, `SWAGGER_ENABLED`; đã chạy thử `docker compose --profile tools run --rm migrate`.
- **Lỗi FE tìm ra khi chạy lại sau 23:00 và đã sửa:** `/booking` được prerender lúc build nên ngày "Hôm nay", ngày/giờ mặc định và khung giờ bị khoá được tính theo giờ build; React không sửa thuộc tính `disabled`/`aria-pressed` khi hydrate nên UI giữ giá trị cũ (deploy hôm nay thì vài ngày sau vẫn hiện "Hôm nay" là ngày deploy). Nay chỉ tính trên trình duyệt sau khi mount, cập nhật mỗi phút (`fe/src/lib/booking-time.ts`, 3 unit test).
- Kết quả: `npm run e2e` 138/138; FE unit 38/38. Mỗi lượt e2e tạo khoảng 6 giữ chỗ công khai, giới hạn mặc định 20/IP/15 phút nên chạy liên tiếp quá 3 lượt sẽ gặp 429 (ghi trong `fe/e2e/README.md`).

### FE INTEGRATED — lịch lễ tân hợp nhất (REC-003, 2026-11-28)

- `fe/src/components/reception-calendar.tsx` dùng `GET /v1/merchant/branches/{branchId}/booking/holds` và `.../booking/bookings` với cùng `from`/`to` (06:00 → 06:00 hôm sau, offset lấy theo `timezone` chi nhánh), đọc mọi trang `limit=100`; bỏ hold `CONFIRMED`. Thu ngân xem được nhờ API-003. Không cần API mới.
- Kiểm thử: `staff.mjs` (booking đã xác nhận hiện trên timeline, hold chưa xác nhận hiện "Đang giữ chỗ", chế độ danh sách, booking đã hủy ẩn mặc định). `npm run e2e` 142/142.

## Thay đổi BE ảnh hưởng FE — giới hạn timeout database (OPS-004, 2026-11-28)

- Chờ khoá quá `PG_LOCK_TIMEOUT_MS` (mặc định 5 s, ví dụ giữ cùng phòng đang bị khoá lâu) trả **409** với message `The resource was changed concurrently; retry the request` — FE đã dịch message này.
- Câu lệnh quá `PG_STATEMENT_TIMEOUT_MS` (15 s) hoặc không lấy được kết nối trong `PG_CONNECTION_TIMEOUT_MS` (5 s) trả **503** `SERVICE_UNAVAILABLE` với message mới `The service is temporarily busy; retry shortly`. FE nên hiển thị "Hệ thống đang bận, vui lòng thử lại" và không tự retry liên tục.
- Không đổi contract endpoint nào.

## FE READY — OpenAPI đầy đủ response schema (API-004, 2026-11-28)

- Cả 102 operation trong `docs/02-architecture/openapi.json` (77 path) nay có response schema (trước đây thiếu 43: chi nhánh, phòng, tiện nghi, media, membership, audit, khoá bảo trì, buffer, bảng giá/quy tắc/ngày đặc biệt, phiên đăng nhập, health). `/v1/metrics` khai báo `text/plain`.
- **Sửa kiểu sai trong contract cũ** (24 property `string|null`/`number|null` từng bị sinh thành `object`): `HoldResponseDto.customerPhone/customerEmail/phoneVerifiedAt/phoneVerifiedBy`, `PublicBookingTermsResponseDto.updatedAt`, các trường tuỳ chọn của `Create/UpdatePriceRuleDto`, `Create/UpdatePricePlanDto`, `UpdateDepositPolicyDto`, `UpdateRoomMediaDto.altText`. Type FE viết tay theo kiểu cũ cần đối chiếu lại.
- E2E mới đối chiếu response thật với schema (thiếu trường, sai kiểu, sai enum/định dạng, **trường không khai báo**) cho toàn bộ nhóm trên và đường booking chính — FE-011 có thể sinh type từ file này.
- Không đổi hành vi endpoint.

## FE READY — đối soát tiền mặt (PAY-007, PD-036, 2026-11-28)

Contract đã qua build, OpenAPI drift check và PostgreSQL Docker E2E 44/44 (response đối chiếu với `openapi.json`).

- `GET /v1/merchant/booking/bookings/{id}/account` (mọi vai trò merchant, theo chi nhánh) → `{bookingStatus, priceTotalVnd, surchargesVnd, dueVnd, depositsVnd, cashVnd, refundsVnd, paidVnd, balanceVnd, settlement, retainedVnd, entries[]}`. `settlement` ∈ `UNPAID|PARTIAL|PAID|OVERPAID|CLOSED`; booking hủy/no-show: `dueVnd=0`, `settlement=CLOSED`, `retainedVnd` = số giữ lại. `entries[]`: `{kind: DEPOSIT|CASH|SURCHARGE|REVERSAL|REFUND, id, amountVnd (luôn dương), note, reversesType, reversesId, reversed, recordedBy, recordedAt}` — khoản bị đảo có `reversed=true` và không còn tính.
- `POST /v1/merchant/booking/bookings/{id}/surcharges` (Owner, Branch Manager, Receptionist, Cashier), header `Idempotency-Key`, body `{amountVnd, reason}` (lý do bắt buộc). 409 nếu booking đã hủy/no-show hoặc key dùng cho body khác.
- `POST /v1/merchant/booking/money-reversals` (Owner, Branch Manager) body `{entryType: HOLD_DEPOSIT|MANUAL_PAYMENT|SURCHARGE, entryId, reason}` — đảo **toàn bộ** khoản gốc. Gửi lại cùng lý do trả 200 như cũ; lý do khác → 409 "already reversed"; cọc của hold hết hạn đã xử lý → 409.
- `GET /v1/merchant/branches/{branchId}/booking/unresolved-deposits?limit&offset` (Owner, Branch Manager, Cashier): hold hết hạn còn cọc ròng chưa xử lý `{holdId, roomId, channel, startAt, expiresAt, customerPhone, netDepositVnd}`.
- `POST /v1/merchant/booking/holds/{id}/deposit-resolution` (Owner, Branch Manager) body `{refundAmountVnd (0 = giữ hết), reason}` → `{netDepositVnd, refundAmountVnd, retainedVnd, …}`. 409 nếu hold còn hiệu lực/đã xác nhận, không có cọc, hoàn vượt cọc, hoặc đã ghi khác.
- `GET /v1/merchant/branches/{branchId}/cash-report?date=YYYY-MM-DD` (Owner, Branch Manager, Cashier): ngày theo múi giờ chi nhánh; `totals` và `byRecorder[]` gồm `depositsVnd, bookingCashVnd, cashReversalsVnd, refundsVnd, netCashVnd, surchargesVnd`. Ngày không hợp lệ → 422.
- **Thay đổi hành vi hiện có:** `GET .../holds/{id}/deposits` mỗi khoản có thêm `reversed`, `totalRecordedVnd` là số ròng sau đảo; xác nhận có cọc và giới hạn tiền hoàn khi hủy đều tính theo số ròng. `GET .../manual-payments/summary` vẫn là tổng thô (chưa trừ đảo) — dùng `account` để hiển thị phải thu/đã thu.

## Chờ đo production — IP khách qua rewrite (OPS-007, 2026-11-28)

Chưa phải FE READY: chỉ cần FE làm nếu đo trên production cho thấy Vercel rewrite làm mất IP gốc của trình duyệt.

- BE đã hỗ trợ IP do proxy chuyển tiếp: header `X-KN-Client-IP: <ip trình duyệt>` + `X-KN-Proxy-Secret: <CLIENT_IP_PROXY_SECRET>` (≥ 16 ký tự, env bí mật ở cả FE và BE). Thiếu/sai secret thì BE bỏ qua header này, nên khách không giả mạo được.
- Nếu cần, FE thêm middleware Next.js cho `/v1/*` đặt hai header trên từ IP mà Vercel giao cho FE (`x-real-ip`/`x-forwarded-for` tại edge FE), không để lộ secret ra trình duyệt.
- Luồng BE sẽ ghi kết quả đo và cấu hình chọn vào đây khi có.

## Ưu tiên tiếp theo

Cập nhật 2026-11-26; chi tiết trong `work-log.md` và hàng đợi ở `task-board.md`.

1. FE: commit các màn đang làm (cọc, check-in/out/hủy, `/platform`, quản trị merchant) và smoke test với backend local đã rebuild (xem hướng dẫn smoke test phía trên).
2. FE: lịch lễ tân hợp nhất hold + booking, lọc trạng thái; kiểm thử refresh/logout, mất mạng, reload, quyền từng vai trò và tenant/chi nhánh trên trình duyệt.
3. BE: chờ PO về overtime và đối soát sổ quỹ; không có contract mới nào FE đang phải chờ.
