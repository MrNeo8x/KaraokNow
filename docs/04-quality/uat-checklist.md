# Checklist UAT nhiều merchant (UAT-001)

Phiên bản: 2026-11-26. Phạm vi theo quyết định `UAT-PD-001`…`UAT-PD-012` và `PD-025`…`PD-048` trong [`decision-log.md`](../00-product/decision-log.md). Ma trận yêu cầu: [`requirement-traceability.md`](requirement-traceability.md).

## 1. Phạm vi

**Trong phạm vi:** Platform Admin tạo merchant và duyệt listing; Owner cấu hình merchant; khách đặt chỗ trên web không cần tài khoản; nhân viên gọi xác minh, ghi cọc tiền mặt, xác nhận, check-in/out, ghi hủy/no-show; phân quyền theo vai trò; tách dữ liệu giữa các merchant.

**Ngoài phạm vi:** thanh toán online (PD-007), tin nhắn tự động ZNS/SMS/email (UAT-PD-007), quên mật khẩu (IAM-004), khách tự hủy (UAT-PD-008), tính tiền overtime hoặc gia hạn giờ (PD-030 chỉ ghi phút), mở/đóng ca thu ngân, Zalo/Messenger.

## 2. Chuẩn bị môi trường

```bash
cd be
docker compose up -d postgres
npm run db:migrate
npm run db:seed:uat            # chạy lại bất cứ lúc nào để đưa cấu hình mẫu về ban đầu
docker compose up -d --build   # backend :3000, frontend :3100
npm run holds:expire           # terminal riêng — cần cho ca D5 (hold tự hết hạn)
```

- Khách: `http://localhost:3100/booking` · Merchant: `http://localhost:3100/merchant` · Platform Admin: `http://localhost:3100/platform`.
- Nên dùng hai trình duyệt (hoặc một cửa sổ ẩn danh) để đóng vai khách và nhân viên cùng lúc.
- Seed **không xoá** dữ liệu UAT đã tạo; nó chỉ đặt lại cấu hình mẫu. Riêng trạng thái duyệt của UAT2 chỉ đặt "chờ duyệt" ở lần seed đầu — muốn kiểm lại ca A2 thì thu hồi duyệt trước (ca A3).

### Tài khoản (chỉ dùng local)

| Vai trò | Email | Mật khẩu | Merchant |
|---|---|---|---|
| Platform Admin | `uat.platform@karaokenow.local` | `Uat-platform-password-2026!` | — |
| Owner | `uat.owner@karaokenow.local` | `Uat-owner-password-2026!` | UAT |
| Branch Manager | `uat.manager@karaokenow.local` | `Uat-manager-password-2026!` | UAT (chi nhánh Hồ Chí Minh) |
| Receptionist | `uat.reception@karaokenow.local` | `Uat-reception-password-2026!` | UAT (chi nhánh Hồ Chí Minh) |
| Cashier | `uat.cashier@karaokenow.local` | `Uat-cashier-password-2026!` | UAT (chi nhánh Hồ Chí Minh) |
| Owner | `uat2.owner@karaokenow.local` | `Uat2-owner-password-2026!` | UAT2 |

Tenant ID: UAT `10000000-0000-4000-8000-000000000001`, UAT2 `10000000-0000-4000-8000-000000000101`.

### Dữ liệu mẫu

| Merchant | Trạng thái listing | Phòng và giá | Cọc / không cọc | Điều khoản |
|---|---|---|---|---|
| UAT | Đã publish, đã duyệt | VIP 01 — 150.000 đ/giờ; Gia Đình 01 — 100.000 đ/giờ | WEB cọc 30%; PHONE, WALK_IN cho xác nhận không cọc | Version 1 |
| UAT2 | Đã publish, **chờ duyệt** | Tiêu Chuẩn 01 — 120.000 đ/giờ | WEB không cọc, cho xác nhận không cọc | Version 1 |

Thời lượng mặc định: tối thiểu 60 phút, bước 30 phút, tối đa 8 giờ; buffer dọn phòng 15 phút; hold giữ 15 phút; ân hạn overtime 10 phút.

## 3. Cách ghi kết quả

Cột **Kết quả**: `Đạt` / `Không đạt` / `Bị chặn` (không thực hiện được do lỗi khác). Ca `Không đạt` phải ghi lỗi vào mục 5 kèm ảnh chụp, thời điểm và `correlationId` (có trong thông báo lỗi hoặc header `X-Correlation-ID`).

Mức độ lỗi: **Nghiêm trọng** (sai tiền, booking chồng, lộ dữ liệu merchant khác, mất dữ liệu), **Cao** (chặn luồng chính), **Trung bình** (có cách vòng), **Thấp** (giao diện/chữ).

## 4. Kịch bản

### A. Platform Admin

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| A1 | Platform Admin | Đăng nhập, mở `/platform`, xem danh sách listing "Chờ duyệt" | Thấy UAT2 (chưa có UAT vì đã duyệt); có số chi nhánh và trạng thái điều khoản | UAT-PD-009 | | |
| A2 | Platform Admin, Khách | Duyệt UAT2 (ghi chú tuỳ chọn); khách tải lại `/booking` | UAT2 chuyển "Đã duyệt"; khách thấy chi nhánh UAT Hà Nội | UAT-PD-009/010 | | |
| A3 | Platform Admin, Khách | Thu hồi UAT2: thử bỏ trống lý do, rồi nhập lý do | Bỏ trống bị chặn; có lý do thì thu hồi được; khách không còn thấy UAT2 | UAT-PD-009 | | |
| A4 | Platform Admin | Tạo merchant mới (mã chữ in hoa, tên, email Owner chưa có tài khoản, mật khẩu tạm ≥ 12 ký tự); thử tạo lại cùng mã | Tạo thành công, merchant chưa publish/chưa duyệt; trùng mã báo lỗi | PD-029 | | |
| A5 | Owner mới | Đăng nhập bằng mật khẩu tạm ở A4 | Bắt buộc đổi mật khẩu trước khi dùng; sau khi đổi thấy merchant trống, tạo được chi nhánh | PD-029 | | |
| A6 | Platform Admin | Tạo merchant mới với email Owner **đã có** tài khoản (ví dụ `uat2.owner@…`) | Báo rõ mật khẩu tạm không được áp dụng; Owner dùng mật khẩu cũ và thấy thêm merchant mới | PD-029 | | |
| A7 | Owner UAT | Mở `/platform` | Không có quyền (403), không thấy dữ liệu | UAT-PD-009 | | |
| A8 | Platform Admin, Khách, Owner UAT2 | Khoá UAT2 (thử bỏ trống lý do, rồi nhập lý do); khách tải `/booking`; Owner UAT2 đăng nhập, thử tạo hold mới và xử lý hold/booking đã có | Bỏ trống lý do bị chặn; khách không thấy UAT2 và không giữ chỗ được; Owner vẫn vào được, thấy báo merchant đang bị khoá, không tạo được hold mới nhưng vẫn xác nhận/check-in booking đã có | PD-031 | | Cần UAT2 đã được duyệt (A2) |
| A9 | Platform Admin, Khách | Mở khoá UAT2 (nhập lý do) | UAT2 hiện lại cho khách mà không phải duyệt lại; nhật ký UAT2 có sự kiện khoá và mở khoá kèm lý do | PD-031 | | |

### B. Owner cấu hình merchant (UAT)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| B1 | Owner | Ngừng publish; khách tải lại; publish lại | Khi ngừng, khách không thấy UAT; publish lại thấy ngay (vẫn đã duyệt) | UAT-PD-009 | | Đã chốt PD-035: publish lại giữ trạng thái duyệt |
| B2 | Owner, Khách | Khách mở điều khoản (version 1) nhưng chưa giữ chỗ; Owner sửa điều khoản; khách bấm giữ chỗ | Owner thấy version 2; khách bị báo điều khoản đã thay đổi, phải đọc và đồng ý lại | UAT-PD-005 | | |
| B3 | Owner | Đổi giá quy tắc VIP; báo giá lại trên web | Báo giá mới theo giá mới | PD-011/019 | | Trả lại 150.000 đ sau khi thử |
| B4 | Owner | Xem cấu hình cọc, không cọc, thời gian giữ theo kênh | Đúng dữ liệu mẫu; sửa được và có trong nhật ký | PD-003/004/005 | | |
| B5 | Owner | Thêm nhân viên Receptionist cho chi nhánh; đăng nhập bằng tài khoản đó; Owner vô hiệu hoá; thử lại | Nhân viên mới phải đổi mật khẩu tạm; sau khi vô hiệu hoá không vào được merchant | IAM-003 | | |
| B6 | Owner UAT, Owner UAT2 | Owner UAT mở nhật ký audit; Owner UAT2 mở nhật ký audit | UAT thấy các thao tác ở B1–B5; UAT2 thấy sự kiện duyệt/thu hồi ở A2/A3 (ghi trên tenant được duyệt). Không thấy SĐT, email khách hay ghi chú tự do | AUD-001 | | |
| B7 | Owner | Mở "Phiên đăng nhập", thu hồi phiên ở trình duyệt khác | Trình duyệt kia bị đăng xuất ở lần thao tác tiếp theo | IAM-005 | | |

### C. Khách đặt chỗ trên web

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| C1 | Khách | Mở `/booking` | Chỉ thấy merchant đã publish **và** đã duyệt | UAT-PD-010 | | |
| C2 | Khách | Chọn UAT, ngày giờ, 2 giờ; xem phòng trống và giá | VIP 300.000 đ, Gia Đình 200.000 đ; phòng đã có người giữ không hiện | FR-004/005 | | |
| C3 | Khách | Giữ chỗ khi chưa tick đồng ý điều khoản | Không cho gửi | UAT-PD-005 | | |
| C4 | Khách | Giữ chỗ không nhập SĐT; rồi nhập SĐT, để trống email | Thiếu SĐT bị chặn; có SĐT, không email vẫn giữ được | UAT-PD-003 | | |
| C5 | Khách | Giữ chỗ VIP 2 giờ tại UAT | Hiện booking code (sao chép được), trạng thái chờ nhân viên gọi xác minh, số cọc cần đóng tại quầy **90.000 đ**; không có thanh toán online | UAT-PD-001/002/007 | | Lưu booking code cho C8, D2 |
| C6 | Khách | Ngắt mạng ngay khi bấm giữ chỗ, bật lại và gửi lại | Không tạo hai hold; nhận cùng booking code | UAT-PD-004 | | |
| C7 | Hai khách | Hai trình duyệt cùng chọn một phòng/khung giờ và giữ chỗ gần như đồng thời | Một người giữ được; người còn lại được báo phòng vừa có người giữ và chọn lại; không tự đổi sang phòng khác | UAT-PD-012 | | |
| C8 | Khách | Tra cứu bằng SĐT + booking code; thử SĐT dạng `+84…`; thử sai mã | Đúng thì thấy trạng thái, tổng tiền, cọc cần/đã ghi; `+84…` vẫn tra được; sai mã chỉ báo chung "thông tin không đúng" | UAT-PD-006 | | |
| C9 | Khách | Tra cứu sai liên tục nhiều lần | Bị tạm chặn với thông báo chờ; không lộ SĐT có tồn tại hay không | UAT-PD-004 | | Ngưỡng mặc định: 10 lần/SĐT, 60 lần/IP trong 15 phút |
| C10 | Khách | Tìm nút tự xác nhận hoặc tự hủy | Không có; khách liên hệ chi nhánh | UAT-PD-001/008 | | |
| C11 | Khách | Giữ chỗ tại UAT2 (sau khi duyệt ở A2) | Không yêu cầu cọc (0 đ) | UAT-PD-002 | | |

### D. Lễ tân và thu ngân (UAT)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| D1 | Receptionist | Mở danh sách hold, mở hold ở C5, ghi nhận đã gọi xác minh | Thấy SĐT khách, giá đã chốt, điều khoản khách đã đồng ý; ghi nhận xác minh thành công | UAT-PD-001 | | |
| D2 | Receptionist, Cashier | Receptionist thử xác nhận khi chưa có cọc; Cashier ghi cọc 100.000 đ; ghi 50.000 đ rồi 40.000 đ; Receptionist xác nhận | Chưa đủ cọc: không xác nhận được; 100.000 đ bị chặn vì vượt số còn thiếu; sau 90.000 đ xác nhận thành công | UAT-PD-002 | | Đã chốt PD-033: không cho ghi vượt |
| D3 | Receptionist | Tạo hold kênh PHONE, nhập SĐT, xác minh, xác nhận | Xác nhận được không cần cọc | PD-005 | | |
| D4 | Owner, Receptionist | Có một hold WEB đã nhập thông tin (cọc 30%); Owner đổi cọc WEB thành không cọc; mở lại hold | Hold cũ vẫn yêu cầu cọc 30% (đã chụp lúc tạo); hold mới mới áp dụng cấu hình mới | UAT-PD-002 | | Trả lại cọc 30% sau khi thử |
| D5 | Receptionist | Tạo hold, đợi quá 15 phút (worker `holds:expire` đang chạy), thử xác nhận | Hold chuyển hết hạn, không xác nhận được, phòng trống lại | UAT-PD-011 | | |
| D6 | Receptionist | Xem lịch booking chi nhánh trong ngày | Thấy booking vừa xác nhận với đúng phòng, giờ, trạng thái | REC-001 | | |
| D7 | Cashier | Ghi tiền mặt cho booking đã xác nhận; bấm ghi hai lần (mạng chậm) | Chỉ ghi một khoản; tổng đã ghi đúng | PAY-005 | | |

### E. Check-in, check-out

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| E1 | Receptionist | Check-in một booking của ngày mai | Cho phép (không giới hạn khung giờ) | PD-026 | | |
| E2 | Receptionist, Khách | Tạo booking PHONE có giờ bắt đầu đã qua (ví dụ đầu giờ hiện tại, 2 giờ), check-in rồi check-out ngay; khách tìm phòng ở khung giờ còn lại | Ghi giờ trả phòng thực tế; phòng mở lại sau giờ trả + 15 phút dọn phòng | PD-025 | | Check-out trước giờ bắt đầu không rút ngắn thời gian giữ phòng |
| E3 | Receptionist | Check-out một booking đã quá giờ kết thúc hơn 10 phút; check-out một booking khác trễ dưới 10 phút | Cả hai ghi giờ thực tế và số phút trễ; booking trễ quá ân hạn có overtime = toàn bộ số phút trễ, booking trong ân hạn có overtime 0; không tính tiền, không kéo dài giờ giữ phòng | PD-025, PD-030 | | Đã chốt PD-034: quá ân hạn thì tính toàn bộ phút trễ |
| E4 | Receptionist | Thử check-out booking chưa check-in; check-in booking đã hoàn tất | Đều bị chặn | FR-009/010 | | |
| E5 | Owner, Cashier | Owner đổi thời gian ân hạn overtime (ví dụ 0 hoặc 30 phút); Cashier thử đổi | Owner/Branch Manager đổi được và có trong nhật ký; Cashier chỉ xem; check-out sau đó dùng ân hạn mới, booking đã check-out giữ ân hạn cũ | PD-030 | | |

### F. Hủy và no-show

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| F1 | Receptionist | Tìm thao tác hủy/no-show | Không có quyền | PD-028 | | |
| F2 | Branch Manager | Hủy booking ở D2 (đã thu 90.000 đ cọc) với ghi chú; thử tiền hoàn 100.000 đ rồi 50.000 đ | Thiếu ghi chú bị chặn; 100.000 đ bị chặn vì vượt số đã thu; 50.000 đ thành công; booking "Đã hủy" | PD-027 | | |
| F3 | Khách, Receptionist | Khách tra cứu booking ở F2; Receptionist tìm phòng ở khung giờ đó | Khách thấy "Đã hủy"; khung giờ trống lại | PD-027, UAT-PD-008 | | |
| F4 | Branch Manager | Ghi no-show cho một booking đã xác nhận, không hoàn tiền | Booking "No-show", phòng trống lại | PD-027 | | |
| F5 | Branch Manager | Thử hủy một booking đang check-in | Bị chặn | PD-027 | | |

### H. Đối soát tiền mặt (PAY-007, PD-036)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| H1 | Receptionist, Cashier | Mở "tài khoản" của booking đã xác nhận có cọc; Lễ tân thêm phụ thu 30.000 đ (đồ uống); Thu ngân ghi tiền mặt phần còn lại | Phải thu = giá + phụ thu; đã thu = cọc + tiền mặt; trạng thái chuyển Còn thiếu → Đủ; mọi khoản hiện trong danh sách | PD-036 | | |
| H2 | Cashier, Branch Manager | Thu ngân ghi trùng một phiếu tiền mặt; thử tự đảo; Quản lý đảo với lý do | Thu ngân không đảo được; Quản lý đảo được, khoản gốc vẫn hiện nhưng gạch "đã đảo", số đã thu giảm đúng; đảo lần hai báo đã đảo | PD-036 | | |
| H3 | Branch Manager | Đảo khoản cọc của một hold chưa xác nhận, rồi thử xác nhận | Cọc không còn tính; không xác nhận được cho tới khi ghi cọc lại | PD-033, PD-036 | | |
| H4 | Cashier, Branch Manager | Để một hold đã thu cọc hết hạn; mở danh sách "cọc chờ xử lý"; Quản lý ghi hoàn một phần với lý do | Hold hiện trong danh sách; hoàn vượt cọc bị chặn; sau khi ghi, hold biến khỏi danh sách và báo số giữ lại | PD-036 | | |
| H5 | Branch Manager | Hủy một booking đã thu tiền với tiền hoàn; xem tài khoản | Phải thu = 0, trạng thái "Đã đóng", báo số giữ lại = đã thu − đã hoàn | PD-027, PD-036 | | |
| H6 | Cashier | Cuối ngày mở báo cáo tiền mặt của chi nhánh | Tổng cọc, tiền mặt, đảo, hoàn và tiền mặt ròng khớp két; có tách theo từng nhân viên | PD-036 | | |

### Q. Hỗ trợ merchant và kiêm nhiệm (PD-045, PD-046)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| Q1 | Super Admin, Owner | Mở phiên hỗ trợ vào một merchant với lý do; xem lịch, booking, báo cáo, nhân viên | Xem được như Owner; SĐT/email bị che; không có nút sửa (hoặc sửa bị từ chối); Owner thấy dòng audit "SUPPORT_SESSION_STARTED" | PD-045 | | |
| Q2 | Super Admin | Kết thúc phiên; chờ quá 60 phút với phiên khác | Không còn xem được merchant | PD-045 | | |
| Q3 | Platform Admin thường | Thử mở phiên hỗ trợ | Bị từ chối | PD-045 | | |
| Q4 | Platform Admin, Owner | Owner mời một Platform Admin làm Owner; admin đăng nhập, chọn merchant, làm việc như Owner; thử khoá/duyệt merchant đó trong khu Platform | Làm việc bình thường trong merchant; thao tác Platform lên chính merchant đó bị chặn | PD-046 | | |

### P. Báo cáo và thống kê (PD-044)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| P1 | Owner | Xem báo cáo booking & doanh thu tuần này, theo ngày và theo tháng | Số booking theo trạng thái và tiền thực thu khớp báo cáo tiền mặt từng ngày | PD-044 | | |
| P2 | Owner, Branch Manager | Xem công suất phòng và giờ cao điểm; Branch Manager chọn chi nhánh không được giao | Tỷ lệ lấp đầy theo phòng; Branch Manager bị chặn | PD-044 | | |
| P3 | Owner | Xem kênh & chuyển đổi; tải CSV và mở bằng Excel | Tiếng Việt hiển thị đúng; không có SĐT khách | PD-044 | | |
| P4 | Platform Admin | Xem tổng quan nền tảng và bảng theo merchant; tải CSV | Merchant mới, booking theo kỳ, merchant chờ duyệt đúng | PD-044 | | |

### O. Giờ lẻ và giờ mở cửa (PD-043)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| O1 | Owner | Đặt giờ mở cửa 18:00–02:00 cho chi nhánh | Lưu được; trang khách hiện giờ mở cửa | PD-043 | | |
| O2 | Khách | Chọn giờ lẻ 19:45, 00:30; thử 01:30 với 1 giờ | 19:45 và 00:30 tìm phòng được; 01:30 bị báo vượt giờ đóng cửa | PD-043 | | |
| O3 | Khách | Đổi thời lượng | Chỉ chọn được các mức theo chính sách merchant (tối thiểu/bước/tối đa) | PD-043 | | |
| O4 | Lễ tân | Tạo giữ chỗ qua điện thoại lúc 15:10 (ngoài giờ mở cửa) | Vẫn tạo được | PD-043 | | |

### N. Địa chỉ và chỉ đường (PD-042)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| N1 | Owner | Mở Google Maps trên điện thoại, chọn đúng quán, Chia sẻ → dán link vào chi nhánh; nhập địa chỉ và SĐT | Lưu được; xem trước đúng vị trí | PD-042 | | |
| N2 | Owner | Dán link không phải Google Maps hoặc link chỉ có tên quán | Báo lỗi rõ, hướng dẫn dán link có toạ độ | PD-042 | | |
| N3 | Khách | Xem danh sách chi nhánh, giữ chỗ, xem biên nhận; bấm "Chỉ đường" và SĐT | Google Maps mở đúng điểm đến; điện thoại gọi đúng số | PD-042 | | |

### M. Giữ chỗ quá hạn và giám sát (BKG-011, PD-041)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| M1 | Khách | Giữ chỗ trên web rồi bỏ đi; chờ quá thời gian giữ (15 phút); khách khác tìm cùng khung giờ | Phòng hiện trống và giữ chỗ được, không phải chờ tới hôm sau | BKG-011 | | |
| M2 | Người dùng | Mở `/v1/health/jobs` trên production; kiểm tra email cảnh báo của dịch vụ uptime | 200 `status: ok` khi bình thường; dịch vụ uptime báo khi 503 | PD-041 | | |

### L. Quản lý user của Platform (PD-040)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| L1 | Platform Admin | Tìm user theo email/tên | Thấy trạng thái, merchant và vai trò, lần đăng nhập gần nhất | PD-040 | | |
| L2 | Platform Admin, Lễ tân | Khoá tài khoản Lễ tân đang đăng nhập (ghi lý do); mở lại | Lễ tân bị đẩy ra ngay, không đăng nhập được; mở lại thì đăng nhập được | PD-040 | | |
| L3 | Platform Admin, Owner | Cấp mật khẩu tạm cho Owner quên mật khẩu | Mật khẩu hiện một lần; Owner đăng nhập bằng nó và bị bắt đổi mật khẩu; mật khẩu cũ hết dùng | PD-040, PD-014 | | |
| L4 | Platform Admin | Cấp quyền Platform Admin cho user khác rồi thu hồi; thử tự khoá/tự thu hồi chính mình | Cấp/thu hồi có hiệu lực; tự thao tác lên mình bị từ chối | PD-040 | | |
| L5 | Platform Admin | Thêm Owner mới cho merchant, sau đó vô hiệu Owner cũ; thử vô hiệu Owner cuối cùng | Owner mới vào được merchant; không cho merchant mất hết Owner | PD-040 | | |

### K. Phiên đăng nhập (PD-039)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| K1 | Mọi vai trò | Đăng nhập, bấm F5; mở thêm một tab | Vẫn đăng nhập, không phải nhập lại; merchant đã chọn được giữ | PD-039 | | |
| K2 | Owner của 1 merchant | Đăng nhập | Vào thẳng merchant, không phải nhập Tenant ID | PD-039 | | |
| K3 | User thuộc ≥ 2 merchant | Đăng nhập, chọn merchant theo tên; đổi merchant | Danh sách đúng tên các merchant đang hoạt động của mình | PD-039 | | |
| K4 | Mọi vai trò | Đăng xuất, bấm Back hoặc F5 | Về màn đăng nhập; tab khác cũng mất phiên khi làm mới | PD-039 | | |

### J. Mã đặt phòng (PD-038)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| J1 | Khách | Giữ chỗ trên điện thoại, đọc mã cho người khác gõ lại | Mã 6 ký tự chữ in hoa và số, không có 0/O/1/I; gõ chữ thường hoặc có khoảng trắng vẫn tra cứu được | PD-038 | | |
| J2 | Khách | Tra cứu bằng mã đúng nhưng SĐT khác | Không thấy đơn | PD-038 | | |

### R. Thư viện ảnh merchant và chi nhánh (PD-048)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| R1 | Owner, Khách | Tải 3 ảnh merchant và 3 ảnh chi nhánh từ điện thoại, sắp xếp lại | Khách thấy hai thư viện trên trang đặt phòng theo đúng thứ tự | PD-048 | | |
| R2 | Owner | Tải ảnh thứ 11 cho merchant / cho một chi nhánh | Bị từ chối, báo tối đa 10 ảnh | PD-048 | | |
| R3 | Branch Manager | Tải ảnh cho chi nhánh được giao và cho chi nhánh khác; thử sửa ảnh merchant | Chỉ chi nhánh được giao làm được | PD-048 | | |

### I. Ảnh và giấy tờ (PD-037)

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| I1 | Owner, Khách | Tải ảnh phòng từ điện thoại (ảnh gốc > 4 MB) | FE nén trước khi gửi; ảnh hiện trong danh sách phòng của merchant và trang khách | PD-037 | | |
| I2 | Owner | Tải file PDF hoặc SVG đặt tên `.jpg`; tải ảnh thứ 11 cho một phòng | Bị từ chối với thông báo rõ; phòng không vượt 10 ảnh | PD-037 | | |
| I3 | Owner | Xoá một ảnh đã tải | Ảnh biến khỏi danh sách và không còn mở được bằng URL cũ (có thể trễ tới 60 giây do CDN) | PD-037 | | |
| I4 | Owner, Khách | Tải logo; thay logo khác | Logo hiện trên danh sách chi nhánh của khách; logo cũ không còn | PD-037 | | |
| I5 | Owner, Lễ tân | Owner tải giấy phép kinh doanh (PDF); Lễ tân thử mở mục giấy tờ | Owner xem/tải lại được; Lễ tân không thấy | PD-037 | | |
| I6 | Platform Admin | Mở giấy tờ của merchant khi duyệt listing | Xem được PDF; merchant khác không lẫn | PD-037 | | |

### G. Phân quyền và tách merchant

| ID | Vai trò | Bước | Kết quả mong đợi | Căn cứ | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|
| G1 | Cashier | Đăng nhập, tìm màn cấu hình giá/cọc/nhân viên | Không thấy hoặc bị từ chối | RBAC | | |
| G2 | Receptionist | Tìm thao tác ghi cọc | Không có quyền | RBAC | | |
| G3 | Owner UAT2 | Đăng nhập; thử nhập tenant ID của UAT | Chỉ thấy dữ liệu UAT2; tenant UAT bị từ chối | UAT-PD-010 | | |
| G4 | Owner UAT | Tìm cách tự duyệt listing | Không có | UAT-PD-009 | | |

## 5. Nhật ký lỗi

| # | Ca | Mức độ | Mô tả | Bước tái hiện | correlationId / ảnh | Người báo | Trạng thái |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 6. Tiêu chí kết thúc

- 100% ca nhóm C, D, F, G, H, I, J, K và L đạt; không còn lỗi **Nghiêm trọng** hay **Cao** đang mở.
- Lỗi Trung bình/Thấp còn mở có hướng xử lý và được PO chấp nhận bằng văn bản.
- Các giả định trước đây (B1, D2, E3) đã được PO chốt ngày 2026-11-28 (PD-033…PD-035); nếu UAT cho thấy cần đổi, ghi thành yêu cầu sửa và quyết định mới.
- Kết quả, người thực hiện và ngày được ghi vào bảng; task board cập nhật UAT-001 và các task `VERIFY` liên quan.

| Vai trò ký nhận | Họ tên | Ngày | Kết luận |
|---|---|---|---|
| PO | | | |
| Merchant pilot | | | |
| QA | | | |
