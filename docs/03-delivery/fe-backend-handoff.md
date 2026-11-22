# Bàn giao backend cho frontend

Cập nhật: 2026-11-22. Hợp đồng chi tiết: [API reference](../02-architecture/api-reference.md). Đây là tài liệu trong repository để FE đọc; không có thông báo ngoài nào được gửi.

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
- Đã có GET/POST `/v1/merchant/booking/bookings/{id}/manual-payments` cho Owner, Branch Manager và Cashier; hiện chỉ ghi từng khoản `CASH` của booking đã xác nhận, dùng idempotency key. Chưa có đối soát, hoàn tiền hoặc xác nhận booking có cọc.
- Có catalog đọc công khai nền tảng: Owner yêu cầu công bố, nhưng chỉ merchant được duyệt platform riêng mới hiển thị. API duyệt platform, public quote/availability và đặt phòng công khai chưa có. Trang khách vẫn chưa thể hoàn tất đặt phòng thật.
- Cấu hình cọc và quyền xác nhận không cọc theo kênh đã có API; chưa tính số tiền cọc hoặc áp dụng điều kiện xác nhận booking.

## Ưu tiên tiếp theo

1. BE: hoàn thiện tính cọc/điều kiện theo trường hợp, xác nhận có cọc và kiểm thử cạnh tranh giữa xác nhận với expiry.
2. FE có thể tích hợp lịch booking và ghi nhận tiền mặt cơ bản; BE tiếp tục đối soát, check-in/check-out và xác nhận có cọc.
3. BE: hoàn thiện duyệt catalog và API công khai cho luồng guest theo các quyết định đã duyệt; FE tiếp tục prototype cho đến khi contract được kiểm chứng.
4. FE: kiểm thử refresh/logout, mất mạng, reload, quyền từng vai trò và tenant/chi nhánh với backend thật khi môi trường trình duyệt sẵn sàng.
