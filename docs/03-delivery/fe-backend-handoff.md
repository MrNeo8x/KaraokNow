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
- Build Next.js/TypeScript Node 26 đã qua. FE chưa gọi public hold/lookup vì các endpoint WEB-004 chưa xuất hiện trong OpenAPI; cần marker FE READY mới trước khi nối.

## Phiên đăng nhập

- `POST /v1/auth/login` và `POST /v1/auth/refresh` trả `accessToken`, `expiresIn`, `refreshToken`, `refreshExpiresIn`, `mustChangePassword`; thời gian tính theo giây.
- Refresh xoay token. Dùng lại refresh token đã bị xoay được coi là reuse và thu hồi cả họ token. FE cần gom các lời gọi refresh đồng thời thành một yêu cầu và thay cặp token cùng lúc.
- `POST /v1/auth/logout` nhận `{ "refreshToken": "..." }`, trả 204; backend thu hồi cả họ của token, kể cả token được xoay đồng thời. E2E PostgreSQL kiểm tra refresh/logout chạy đồng thời và logout bằng token ngay trước lần xoay. FE vẫn phải ngăn response refresh đến muộn khôi phục trạng thái đã logout và kiểm thử trên trình duyệt.
- Nếu refresh thất bại do mất mạng, không thể biết server đã xoay token chưa. Không tự động gửi lại token cũ: nếu server đã xử lý, việc dùng lại có thể thu hồi họ token. Hướng người dùng đăng nhập lại khi không thể khôi phục an toàn. Logout thất bại do mạng không chứng minh server đã thu hồi phiên.
- FE hiện lưu phiên trong bộ nhớ; reload, race trong browser và lỗi mạng vẫn cần kiểm thử FE–BE thực tế. E2E backend không chứng minh browser integration.

## Booking, lễ tân và khách hàng

- Staff API hiện có quote/availability, tạo và đọc hold, danh sách hold theo chi nhánh, gắn số điện thoại/email cùng snapshot giá, và ghi nhận nhân viên gọi xác minh. API danh sách chỉ trả hold; nó không phải lịch booking đầy đủ. `holds:expire` cần chạy riêng.
- Đã có `POST /v1/merchant/booking/holds/{id}/confirm` cho nhân viên xác nhận **không cọc** khi hold còn hiệu lực, có liên hệ, snapshot giá và xác minh điện thoại, chính sách cọc là NONE và merchant đã cho phép xác nhận không cọc theo kênh. Body có `cancellationTerms` là điều khoản đã hiển thị cho khách; response 200 trả booking. Replay cùng điều khoản trả cùng booking; điều khoản khác hoặc không đủ điều kiện trả 409. `GET /v1/merchant/booking/bookings/{id}` đọc booking trong phạm vi tenant/chi nhánh.
- Đã có `GET /v1/merchant/branches/{branchId}/booking/bookings` lọc theo `from`/`to` có múi giờ và phân trang. Đây là danh sách booking; khi ghép với danh sách hold, loại hold `CONFIRMED` để tránh trùng. Các trạng thái check-in/check-out chưa có.
- Đã có GET/POST `/v1/merchant/booking/bookings/{id}/manual-payments` cho Owner, Branch Manager và Cashier; hiện chỉ ghi từng khoản `CASH` của booking đã xác nhận, dùng idempotency key. `GET .../summary` trả tổng khoản đã ghi và số giao dịch chính xác. Đây chưa phải đối soát sổ quỹ: chưa có hoàn/void, điều chỉnh hay trạng thái phải thu/đã thu; chưa xác nhận booking có cọc.
- Catalog công khai chỉ trả merchant đã `published=true` và được duyệt riêng `platformApproved=true`. FE khách dùng public branches/rooms, availability và quote như mô tả trong OpenAPI. Public hold và lookup đã sẵn sàng ở marker FE READY phía trên; hold không tự xác nhận. API Platform Admin approval và xác nhận booking có cọc vẫn đang được BE triển khai.
- Owner cấu hình một nội dung điều khoản UAT tại `GET/PATCH /v1/merchant/catalog/public-booking-terms`; khách đọc `GET /v1/public/branches/{branchId}/booking-terms`. Response `{configured,terms,version,updatedAt}`; FE phải giữ `version` cùng nội dung khách đã tick đồng ý để gửi vào public hold sau khi contract đó được cấp. Không tự dùng nội dung mới nếu version khách đã xem thay đổi.
- Cấu hình cọc và quyền xác nhận không cọc theo kênh đã có API; chưa tính số tiền cọc hoặc áp dụng điều kiện xác nhận booking.

## Ưu tiên tiếp theo

1. BE: hoàn thiện tính cọc/điều kiện theo trường hợp, xác nhận có cọc và kiểm thử cạnh tranh giữa xác nhận với expiry.
2. FE có thể tích hợp lịch booking, hiển thị tổng tiền mặt đã ghi nhận và ghi tiền mặt cơ bản; BE tiếp tục trạng thái check-in/check-out và xác nhận có cọc sau quyết định chính sách.
3. FE có thể nối public catalog → availability → quote → terms → hold → lookup theo OpenAPI. BE tiếp tục Platform Admin approval và ghi nhận cọc trên hold trước xác nhận.
4. FE: kiểm thử refresh/logout, mất mạng, reload, quyền từng vai trò và tenant/chi nhánh với backend thật khi môi trường trình duyệt sẵn sàng.
