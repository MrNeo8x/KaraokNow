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
- Giả định chờ PO xác nhận: FIXED lớn hơn tổng tiền thì cọc bằng tổng tiền; PERCENT làm tròn lên đến đồng; không cho ghi cọc vượt số còn thiếu. Hoàn cọc khi hold hết hạn chưa có API — xử lý ngoài hệ thống.

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

## Ưu tiên tiếp theo

Cập nhật 2026-11-26; chi tiết trong `work-log.md` và hàng đợi ở `task-board.md`.

1. FE: commit các màn đang làm (cọc, check-in/out/hủy, `/platform`, quản trị merchant) và smoke test với backend local đã rebuild (xem hướng dẫn smoke test phía trên).
2. FE: lịch lễ tân hợp nhất hold + booking, lọc trạng thái; kiểm thử refresh/logout, mất mạng, reload, quyền từng vai trò và tenant/chi nhánh trên trình duyệt.
3. BE: chờ PO về overtime và đối soát sổ quỹ; không có contract mới nào FE đang phải chờ.
