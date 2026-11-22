# PRD — KaraokeNow MVP

> Vai trò biên soạn: BA / Product · Phiên bản 1.0 · 22/11/2026  
> Product model, Hanoi pilot, MVP scope và pilot gates đã được PO chốt tại PD-020–PD-022. Đây là PRD mục tiêu; trạng thái code thực tế được nêu trong từng module.

## 1. Tóm tắt sản phẩm

KaraokeNow cung cấp SaaS vận hành cho Merchant và mở rộng thành marketplace khám phá/đặt phòng. MVP tập trung vào dữ liệu venue, giá/availability, booking, lễ tân và web booking; pilot ghi nhận thanh toán thủ công. Zalo/Messenger là kênh mở WebView và gửi kết quả nếu quyền được xác minh.

## 2. Personas và quyền

| Persona | Mục tiêu | Quyền nền tảng hiện tại |
|---|---|---|
| Owner | Quản lý Merchant và nhân sự | Toàn tenant; branches, rooms, memberships, audit |
| Branch Manager | Quản lý chi nhánh được giao | CRUD venue/block trong branch grant |
| Receptionist | Đọc thông tin và phục vụ khách | Read-only venue/block hiện có; booking UI chưa có |
| Cashier | Theo dõi nghiệp vụ tiền | Read-only venue hiện có; payment workflow chưa có |
| Khách guest | Tìm và gửi yêu cầu đặt | Chưa có customer API/frontend |

## 2.1 Ranh giới frontend/backend

Frontend Merchant và frontend customer là ứng dụng riêng, build/release độc lập và giao tiếp với NestJS backend qua HTTPS API/OpenAPI. NestJS không render trang UI và frontend không truy cập PostgreSQL. Customer web có thể chạy độc lập trên trình duyệt hoặc được mở trong WebView Zalo/Messenger; WebView chỉ là lớp host cho cùng frontend customer. Repository hiện tại chỉ có backend; cấu trúc repo riêng hay monorepo/workspace chưa chốt (ADR-012).

## 3. Mục tiêu và ngoài mục tiêu

### Mục tiêu

- Tenant isolation và branch authorization ở mọi API.
- Quản lý branch/room/amenity và maintenance block.
- Giá tính xác định, availability không trả phòng bị chiếm dụng.
- Giữ/confirm booking an toàn, hỗ trợ walk-in và thao tác lễ tân.
- Mobile-first web booking, có thể nhúng/mở trong WebView.
- Audit, thông báo qua outbox boundary và khả năng vận hành.

### Ngoài mục tiêu pilot

Online checkout, payment provider/MoR, tự động refund, thu commission, bắt buộc customer account/OTP, full POS/inventory/IoT, AI và tích hợp native Zalo/Meta khi chưa có quyền.

## 4. Luồng sản phẩm

### 4.1 Merchant setup

Đăng nhập → chọn tenant → tạo/cập nhật chi nhánh → khai báo phòng/sức chứa/tiện nghi → phân quyền nhân sự → cấu hình giá và điều khoản → kiểm tra danh mục.

### 4.2 Khách đặt phòng

Tin nhắn/kênh web → mở mobile web/WebView → chọn khu vực/chi nhánh → chọn ngày, giờ, thời lượng, số khách → xem phòng phù hợp và giá/chính sách → nhập số điện thoại → hold/gửi yêu cầu → hiển thị trạng thái trên web và gửi tin nhắn nếu kênh đã được tích hợp.

### 4.3 Lễ tân

Chọn branch → xem lịch → tạo booking/walk-in → ghi nhận payment thủ công riêng → check-in/out → xử lý hủy theo điều khoản và staff review.

## 5. Yêu cầu chức năng và trạng thái

| Nhóm | Yêu cầu mục tiêu | Trạng thái code hiện tại |
|---|---|---|
| IAM | Login/session, roles, tenant and branch scope | Đã có baseline; reset-code live bị chặn bởi ZBS setup |
| Venue | Branch/room CRUD/status, amenities/media metadata | Đã có; không có binary media upload |
| Availability | Room blocks, settings, query phòng trống | Block CRUD, audited buffer settings và query đã có; query áp dụng buffer cleanup sau booking theo PD-024. Atomic hold còn thiếu |
| Pricing | Rule, priority, quote | Schema và quote endpoint có; snapshot booking chưa có |
| Booking | Hold, confirm, cancel, check-in/out | Chưa có lifecycle hoàn chỉnh |
| Payment | Manual record pilot | Chính sách đã chốt; feature chưa có |
| Customer | Mobile web/WebView, guest info | Chưa có frontend/API |
| Channels | Zalo/Messenger entry + result message | Chưa tích hợp; phụ thuộc permission |
| Ops | Audit, outbox, health, metrics, traces | Nền tảng đã có; provider live/backup drill chưa xác minh |

## 6. Yêu cầu phi chức năng

- Zero overlapping active occupancy; dùng DB constraint làm hàng rào correctness.
- Tenant/branch authorization server-side; fail closed khi context/quyền không hợp lệ.
- Standard API p95 <500 ms và availability search p95 <1s là mục tiêu cần benchmark, chưa phải kết quả đã đo.
- 99.9% uptime, RPO 15 phút/RTO 4 giờ và 100 merchant/3,000 rooms là target chưa được xác nhận.
- Mobile-first, accessible forms, clear loading/empty/error states.
- Không log password, bearer token hoặc raw PII; audit mutation nhạy cảm.

## 7. UX yêu cầu WebView

- Tin nhắn chứa hành động mở booking WebView; không thu thập toàn bộ form trong chat.
- WebView và web độc lập dùng cùng booking flow, responsive từ màn hình điện thoại.
- Chọn địa điểm/chi nhánh; ngày, giờ, thời lượng, số khách; sau đó chọn phòng.
- Hiển thị giá, tình trạng còn phòng, tiện nghi, điều khoản trước khi gửi.
- Số điện thoại bắt buộc, email tùy chọn; không tuyên bố OTP tự động.
- Sau khi gửi, hiển thị booking/request reference và trạng thái trên web; kênh nhắn gửi kết quả nếu tích hợp được duyệt.
- Có trạng thái hết hold, phòng vừa hết, lỗi kết nối, gửi lại an toàn, và tiếp tục từ thông tin đã chọn khi phù hợp.

## 8. MVP release gates

Tuân theo PD-022 và BRD: dữ liệu/quyền Merchant ký nhận; API pricing/availability; hold/concurrency và lifecycle pass; UAT receptionist/customer; monitoring/support sẵn sàng; Merchant pilot chấp thuận. Online payment ngoài phạm vi. Kênh nhắn không chặn web pilot.

## 9. Open items

Chọn hạ tầng web/customer identity/session; content approval của Merchant; privacy retention/legal review; channel permissions; backup/restore và production SLO. Online payment/MoR và commission settlement để sau pilot.
