# User Stories — KaraokeNow MVP

> Vai trò: BA · Phiên bản 1.0 · 22/11/2026  
> Story là backlog mục tiêu. DONE/partial chỉ dùng khi task board hoặc automated evidence chứng minh; story chưa làm không được hiểu là có trong sản phẩm.

## Epic IAM — Tenant và nhân sự

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-IAM-01 | Là nhân viên Merchant, tôi đăng nhập để truy cập chức năng đúng với tài khoản của mình. | P0 | DONE baseline |
| US-IAM-02 | Là Owner, tôi tạo/deactivate membership và cấp vai trò/branch grant để kiểm soát truy cập. | P0 | DONE baseline |
| US-IAM-03 | Là Owner, tôi xem audit log để truy vết thay đổi. | P0 | DONE baseline |
| US-IAM-04 | Là người dùng, tôi đổi mật khẩu tạm trước khi dùng API Merchant. | P0 | DONE |
| US-IAM-05 | Là người dùng, tôi xoay refresh token/logout và thu hồi session bị mất. | P0 | DONE |

## Epic VEN — Venue setup

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-VEN-01 | Là Owner, tôi tạo và quản lý nhiều chi nhánh với timezone riêng. | P0 | DONE API |
| US-VEN-02 | Là Owner/Branch Manager, tôi khai báo phòng, sức chứa và trạng thái. | P0 | DONE API |
| US-VEN-03 | Là quản lý, tôi gắn nhãn tiện nghi và metadata media để mô tả phòng. | P0 | DONE; file ảnh chưa upload |
| US-VEN-04 | Là quản lý chi nhánh, tôi khóa phòng trong thời gian bảo trì và release khi xong. | P0 | DONE API |

## Epic PRC/AVL — Giá và phòng trống

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-PRC-01 | Là Merchant, tôi cấu hình price plan/rule theo thời gian, ngày đặc biệt và đơn vị giá. | P0 | Schema/quote API DONE; UI thiếu |
| US-PRC-02 | Là khách, tôi xem quote xác định theo địa phương, duration và rule priority. | P0 | Quote API DONE; UI/snapshot thiếu |
| US-AVL-01 | Là khách/lễ tân, tôi xem phòng còn phù hợp sau khi loại maintenance/occupancy. | P0 | BLOCKED; availability query chưa có |
| US-AVL-02 | Là quản lý, tôi cấu hình buffer giữa lượt hát. | P0 | Implemented: default enabled/15 minutes; Owner/Branch Manager can edit, with audit |

## Epic BKG/REC — Booking và vận hành

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-BKG-01 | Là khách, tôi giữ phòng tạm thời để có thời gian hoàn tất yêu cầu. | P0 | BLOCKED; hold API/worker chưa có |
| US-BKG-02 | Là khách, tôi gửi yêu cầu guest booking bằng số điện thoại; email không bắt buộc. | P0 | BACKLOG |
| US-BKG-03 | Là lễ tân, tôi tạo booking walk-in và ghi nguồn booking. | P0 | BACKLOG |
| US-BKG-04 | Là Owner/Branch Manager, tôi chọn trường hợp cho phép không đặt cọc. | P0 | Rule approved; API/UI chưa có |
| US-BKG-05 | Là khách, tôi xem và chấp nhận snapshot điều khoản hủy của booking. | P0 | Policy approved; workflow chưa có |
| US-REC-01 | Là lễ tân, tôi xem lịch phòng theo chi nhánh và tạo booking tại quầy. | P0 | BLOCKED; API/frontend chưa có |
| US-REC-02 | Là lễ tân, tôi check-in/out và ghi nhận thời gian sử dụng thực tế. | P0 | BACKLOG |

## Epic PAY/NTF — Payment thủ công và thông báo

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-PAY-01 | Là cashier, tôi ghi nhận khoản tiền mặt/chuyển khoản như transaction độc lập để đối soát. | P0 | Pilot policy approved; feature chưa có |
| US-PAY-02 | Là hệ thống, tôi không xác nhận online payment trong pilot. | P0 | APPROVED; không có provider integration |
| US-NTF-01 | Là khách, tôi nhận kết quả booking qua kênh đã được cấu hình. | P0 | Outbox/port có; booking producer/provider live chưa có |

## Epic WEB/CHANNEL — Khách hàng

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-WEB-01 | Là khách dùng điện thoại, tôi tìm địa điểm/chi nhánh và chọn ngày, giờ, duration, số khách. | P0 | Chưa có frontend |
| US-WEB-02 | Là khách, tôi so sánh phòng, tiện nghi, giá và điều khoản trước khi gửi yêu cầu. | P0 | Chưa có frontend |
| US-WEB-03 | Là khách từ Zalo/Messenger, tôi mở cùng booking flow trong WebView và nhận kết quả qua chat nếu kênh được duyệt. | P1/conditional | Chưa tích hợp; không chặn web pilot |

## Epic OPS

| ID | User story | Ưu tiên | Trạng thái |
|---|---|---:|---|
| US-OPS-01 | Là Ops, tôi biết process live/readiness, request metrics và trace context. | P0 | DONE baseline |
| US-OPS-02 | Là Ops, tôi phục hồi dữ liệu theo RPO/RTO đã đo. | P0 | BACKLOG; chưa có recovery drill |
