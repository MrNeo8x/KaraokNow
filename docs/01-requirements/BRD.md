# BRD — Tài liệu yêu cầu nghiệp vụ KaraokeNow

> Vai trò biên soạn: Business Analyst (BA) · Phiên bản 1.0 · 22/11/2026  
> Trạng thái: baseline nghiệp vụ; phạm vi model, pilot và MVP được PO chốt tại PD-020–PD-022. Các mục chưa quyết định được ghi rõ bên dưới.

## 1. Mục đích

Mô tả nhu cầu kinh doanh, nhóm người dùng, phạm vi, kết quả kỳ vọng và cổng triển khai MVP/pilot. Tài liệu này không tuyên bố các tính năng trong phạm vi đã được triển khai.

## 2. Bối cảnh và vấn đề

Merchant quản lý nhiều chi nhánh và phòng; thông tin phòng, lịch sử dụng, đặt chỗ và bảo trì có thể phân tán giữa sổ, điện thoại và các kênh chat. Khách thường phải liên hệ để biết phòng, khung giờ, giá và điều kiện đặt.

KaraokeNow được định hướng theo mô hình Hybrid SaaS + Marketplace: dịch vụ SaaS giúp Merchant quản lý vận hành; marketplace là kênh khám phá và đặt phòng bổ sung. Hà Nội là địa bàn pilot đã được PO chốt. Quy mô Merchant và lịch pilot chưa được chốt.

## 3. Mục tiêu kinh doanh

- Chuẩn hóa dữ liệu Merchant, chi nhánh, phòng, tiện nghi, giá và trạng thái.
- Giảm kiểm tra thủ công và ngăn tạo booking chồng lấn cho cùng phòng.
- Tạo luồng thao tác nhất quán cho khách hàng và lễ tân.
- Truy vết thao tác nhân viên và nguồn booking.
- Kiểm chứng mức độ sử dụng và giá trị với Merchant pilot trước khi mở rộng.

North-star dự kiến: số booking hoàn tất qua hệ thống mỗi tháng. Chỉ tiêu số lượng, doanh thu, tỷ lệ chuyển đổi và thời hạn chưa được phê duyệt.

## 4. Các bên liên quan

| Bên liên quan | Nhu cầu / trách nhiệm |
|---|---|
| PO / Sponsor | Quyết định phạm vi, ưu tiên, chính sách và go/no-go |
| Merchant Owner | Quản lý Merchant, chi nhánh, nhân sự, quy tắc và nội dung |
| Branch Manager | Vận hành chi nhánh được giao, phòng, giá và lịch |
| Receptionist | Xử lý yêu cầu/booking, walk-in, check-in/out khi workflow sẵn sàng |
| Cashier | Ghi nhận và đối soát thanh toán thủ công theo quyền được cấp |
| Khách hàng | Tìm địa điểm, chọn phòng/giờ, gửi yêu cầu và nhận trạng thái |
| KaraokeNow Ops/Support | Onboard, theo dõi vận hành, xử lý sự cố và hỗ trợ pilot |

## 5. Phạm vi được PO chốt

MVP gồm tenant/RBAC, thiết lập chi nhánh/phòng, pricing/availability, booking và quy trình lễ tân, web đặt phòng khách hàng, ghi nhận thanh toán thủ công. Thanh toán online/provider/MoR không thuộc pilot. Zalo/Messenger WebView và gửi kết quả qua tin nhắn là hạng mục có điều kiện theo xác minh quyền nền tảng; không chặn pilot web. Chi tiết go/no-go nằm trong PD-022.

### Trong MVP

- Cấu hình Merchant, chi nhánh, phòng, nhân sự và phân quyền.
- Quy tắc giá, truy vấn phòng phù hợp, hold và chống booking chồng lấn.
- Booking khách và walk-in; workflow lễ tân cơ bản.
- Ghi nhận thanh toán thủ công, không xử lý tiền qua hệ thống.
- Web khách hàng ưu tiên điện thoại; Zalo/Messenger có thể mở cùng luồng qua WebView nếu được duyệt.
- Audit, logging, monitoring, hỗ trợ vận hành và UAT.

### Ngoài pilot mặc định

Thanh toán online, tự động refund/no-show, thu/settle commission, POS/inventory, IoT, loyalty/CRM đầy đủ, quảng cáo tài trợ, AI recommendations. Marketplace discovery và tích hợp kênh chỉ triển khai theo phase và cổng phụ thuộc tương ứng.

## 6. Kết quả và KPI

| Kết quả | Đo lường đề xuất | Trạng thái mục tiêu |
|---|---|---|
| Không booking trùng | Số overlap confirmed trong kiểm thử và pilot | Cổng bắt buộc: 0 |
| Dữ liệu sẵn sàng | Tỷ lệ phòng có thông tin bắt buộc | Đề xuất ≥95%; PO/Merchant xác nhận trước pilot |
| Áp dụng | Tỷ lệ ca trực ghi nhận booking trong hệ thống | Thiết lập baseline trước khi đặt mục tiêu |
| Hiệu quả | Thời gian kiểm tra phòng trống | So sánh median trước/sau pilot |
| Chất lượng | Lỗi nghiêm trọng, lỗi API, thời gian xử lý | Định nghĩa SLO/gate trước production |

## 7. Giả định và ràng buộc

- PostgreSQL là nguồn dữ liệu giao dịch; tenant phải được xác định rõ và kiểm tra quyền server-side.
- Pilot thanh toán thủ công; Merchant chịu trách nhiệm xác minh số điện thoại bằng cuộc gọi.
- Số điện thoại bắt buộc với booking khách; email tùy chọn; không bắt buộc tài khoản khách.
- Điều khoản hủy được lưu/hiển thị theo booking; staff xem xét outcome, không tự động hóa quyết định refund/no-show.
- Quyền Zalo/Meta, OA/App/template, lưu trữ ảnh và yêu cầu pháp lý cần xác minh riêng.

## 8. Cổng go/no-go pilot

1. Merchant ký nhận dữ liệu, quyền chi nhánh và quy trình.
2. Availability/booking correctness và concurrency đạt tiêu chí; không overlap hiệu lực.
3. Luồng khách hàng, lễ tân và thanh toán thủ công qua UAT.
4. Monitoring, hỗ trợ, escalation, backup/restore và vận hành được chuẩn bị.
5. Merchant pilot xác nhận sẵn sàng sử dụng.
6. Tích hợp Zalo/Messenger chỉ bật sau khi xác minh và duyệt quyền; không là điều kiện để chạy pilot web.

## 9. Rủi ro và quyết định mở

| Rủi ro / mở | Tác động | Cách xử lý |
|---|---|---|
| Hold/availability chưa hoàn thành | Không thể mở booking an toàn | Chặn pilot cho tới khi correctness/concurrency qua gate |
| PD-024 buffer boundary đã duyệt: cộng sau booking để cleanup | Availability search đã triển khai theo range `[start, booking end + buffer)` | Booking hold phải dùng cùng khoảng chiếm dụng; UAT/concurrency chưa thực hiện |
| Zalo/Meta permission chưa xác minh | Kênh không khả dụng | Web là luồng dự phòng, kiểm chứng nền tảng trước tích hợp |
| Online payment/MoR chưa chọn | Không thể thu tiền online/settle | Loại khỏi pilot |
| SLA, backup và privacy/legal chưa xác nhận | Rủi ro vận hành/tuân thủ | Owner kỹ thuật và chuyên gia xác nhận trước production |

## 10. Nguồn chuẩn

Quyết định: `docs/00-product/decision-log.md`; tiến độ: `docs/03-delivery/task-board.md`; truy vết: `docs/04-quality/requirement-traceability.md`; phạm vi tổng: `docs/KaraokeNow_Codex_Master_Plan.md`.
