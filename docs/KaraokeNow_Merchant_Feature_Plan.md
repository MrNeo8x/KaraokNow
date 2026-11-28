# KaraokeNow — Tài liệu tính năng và kế hoạch hợp tác Merchant

**Phiên bản đối tác:** 2.0  
**Cập nhật:** 28/11/2026  
**Địa bàn pilot đã chốt:** Hà Nội  
**Mô hình đã chốt:** Hybrid B2B SaaS + B2C Marketplace  
**Phạm vi tài liệu:** Một file độc lập, không dẫn liên kết ngoài

---

## 1. Tóm tắt dành cho Merchant

KaraokeNow giúp cơ sở karaoke quản lý tập trung chi nhánh, phòng, giá, lịch giữ phòng, booking, nhân sự và tiền mặt; đồng thời cung cấp web đặt phòng tối ưu cho điện thoại để khách tự chọn địa điểm, ngày giờ và phòng còn trống.

Sản phẩm hiện đã có luồng nghiệp vụ từ cấu hình Merchant đến vận hành booking:

- Quản lý nhiều Merchant, nhiều chi nhánh và phân quyền theo chi nhánh.
- Quản lý phòng, sức chứa, tiện nghi, ảnh phòng, logo và trạng thái bảo trì.
- Cấu hình thời lượng, buffer dọn phòng, bảng giá, quy tắc giá, ngày đặc biệt, cọc và điều khoản.
- Tìm phòng trống, báo giá, giữ phòng, xác nhận, check-in, check-out, hủy và no-show.
- Lịch lễ tân hợp nhất hold và booking theo phòng, khung giờ và trạng thái.
- Ghi cọc, tiền mặt, phụ thu, đảo bút toán, xử lý cọc hết hạn và báo cáo cuối ngày.
- Web khách hàng: chọn cơ sở, ngày giờ, phòng; xem giá và điều khoản; giữ phòng; nhận mã 6 ký tự; tra cứu trạng thái.
- Marketplace có kiểm duyệt: Merchant chủ động publish; Platform Admin duyệt, thu hồi hoặc tạm khóa Merchant.
- Audit log, bảo vệ tenant, giới hạn truy cập và kiểm soát booking trùng.

> **Trạng thái thương mại:** phần lớn chức năng lõi đã có code và kiểm thử tự động, đang ở giai đoạn nghiệm thu trình duyệt/UAT. Pilot chưa tích hợp thanh toán online và chưa bật Zalo/Messenger production.

---

## 2. Giá trị Merchant nhận được

| Bài toán vận hành | KaraokeNow giải quyết | Giá trị kỳ vọng |
|---|---|---|
| Lịch phòng nằm ở sổ, chat và trí nhớ nhân viên | Một lịch tập trung cho hold, booking, bảo trì và buffer dọn phòng | Giảm trùng phòng và thời gian kiểm tra phòng |
| Giá và chính sách không đồng nhất | Bảng giá, quy tắc theo ngày/giờ/phòng, ngày đặc biệt và snapshot giá | Báo giá nhất quán, truy vết được |
| Nhiều vai trò cùng thao tác | 4 vai trò và phạm vi theo chi nhánh | Đúng người, đúng chức năng, đúng dữ liệu |
| Khó đối soát tiền mặt cuối ngày | Tài khoản booking, phụ thu, đảo bút toán, báo cáo theo người ghi | Minh bạch phải thu, đã thu, hoàn và giữ lại |
| Khách phải gọi mới biết phòng trống | Web mobile-first cho khách tự chọn và giữ phòng | Giảm thao tác tư vấn lặp lại |
| Không biết ai đã sửa dữ liệu | Audit log cho thay đổi quan trọng | Dễ điều tra sai lệch và đào tạo nhân sự |

---

## 3. Vai trò sử dụng

| Vai trò | Phạm vi chính |
|---|---|
| **Owner** | Toàn Merchant: chi nhánh, phòng, giá, nhân sự, chính sách, publication, tiền và audit |
| **Branch Manager** | Chi nhánh được cấp: phòng, lịch, booking, chính sách vận hành, tiền và đối soát |
| **Receptionist** | Tìm phòng, tạo/tra hold, xác nhận, check-in/out, ghi nhận cuộc gọi và phụ thu theo quyền |
| **Cashier** | Tra hold/booking, ghi cọc và tiền mặt, xem lịch và báo cáo tiền mặt trong chi nhánh được cấp |
| **Platform Admin** | Tạo Merchant, duyệt Marketplace, xem giấy tờ, khóa/mở khóa Merchant |
| **Khách hàng** | Xem catalog công khai, chọn phòng, giữ chỗ và tra cứu bằng SĐT + mã đặt phòng |

---

## 4. Ma trận tính năng hiện tại

### 4.1. Đăng nhập, phiên và phân quyền

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Đăng nhập và bắt buộc đổi mật khẩu tạm | Đã có | Tài khoản Owner mới có thể phải đổi mật khẩu ở lần đầu |
| Phân quyền theo Merchant/chi nhánh | Đã có | Chống truy cập chéo tenant; Owner thấy toàn Merchant |
| Xoay phiên, đăng xuất, thu hồi và danh sách phiên | Đã có | Có khóa tài khoản khi đăng nhập sai nhiều lần |
| Giữ đăng nhập sau F5 bằng cookie HttpOnly | Backend đã có, FE đang nghiệm thu | Refresh token không lưu trong localStorage/sessionStorage |
| Chọn Merchant theo danh sách quyền | Backend đã có, FE đang nghiệm thu | Một Merchant được tự chọn; nhiều Merchant cho người dùng chọn theo tên |
| Quên mật khẩu qua Zalo Business Solution | Chưa bật | Chờ OA/App/quyền và mẫu tin được duyệt |

### 4.2. Chi nhánh, phòng và nội dung

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Tạo/sửa/trạng thái chi nhánh và phòng | Đã có | Có soft delete và audit |
| Sức chứa và tiện nghi | Đã có | Dùng cho màn Merchant và trang khách |
| Khóa phòng bảo trì | Đã có | Dùng chung cơ chế chống overlap với booking |
| Ảnh phòng | Sẵn sàng nghiệm thu | Tối đa 10 ảnh/phòng; FE nén ảnh, giảm EXIF/GPS trước khi gửi |
| Logo Merchant | Sẵn sàng nghiệm thu | Hiện ở sidebar và catalog khách |
| Giấy tờ PDF riêng tư | Sẵn sàng nghiệm thu | Owner quản lý; Platform Admin xem khi duyệt; nhân viên thường không thấy |
| Địa chỉ và SĐT chi nhánh có cấu trúc | Chưa có | Đang chờ chốt dữ liệu và phạm vi hiển thị công khai |

### 4.3. Giá, phòng trống và chính sách

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Thời lượng đặt phòng | Đã có | Merchant cấu hình bước thời lượng, tối thiểu và tối đa |
| Buffer dọn phòng | Đã có | Cộng sau giờ kết thúc; giữ chỗ kế tiếp không được chồng buffer |
| Bảng giá và quy tắc giá | Đã có | Theo ngày, giờ, loại ngày, phòng; từ chối xung đột cùng ưu tiên |
| Ngày đặc biệt | Đã có | Phục vụ lễ, sự kiện và giá đặc thù |
| Tìm phòng trống | Đã có | Loại phòng inactive, maintenance và đã bị chiếm dụng |
| Báo giá | Đã có | Tiền VND nguyên; chụp snapshot khi giữ phòng |
| Cọc theo kênh | Đã có | NONE, FIXED hoặc PERCENT; không ghi vượt số còn thiếu |
| Không cọc theo kênh | Đã có | Owner/Quản lý cấu hình theo kênh |
| Thời gian giữ phòng | Đã có | TTL cấu hình theo kênh, mặc định 15 phút |
| Điều khoản công khai và điều khoản hủy | Đã có | Hiển thị đúng phiên bản khách chấp nhận; snapshot khi xác nhận |
| Ân hạn trả phòng | Đã có | 0–60 phút; ghi nhận số phút trễ/quá giờ, chưa tự tính phí |

### 4.4. Lễ tân và vòng đời booking

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Tạo hold tại quầy hoặc từ cuộc gọi | Đã có | Có Idempotency-Key và chống tạo trùng khi gửi lại |
| Tra cứu hold | Đã có | Theo mã hold, trong đúng Merchant/chi nhánh |
| Xác nhận booking | Đã có | Xác nhận khi được miễn cọc hoặc đã đủ cọc |
| Lịch lễ tân hợp nhất | Sẵn sàng nghiệm thu | Ghép hold + booking, loại trùng, timeline theo phòng và chế độ danh sách |
| Check-in/check-out | Đã có | Check-out sớm mở phòng sớm sau buffer; check-out muộn ghi overtime |
| Hủy/no-show | Đã có | Nhân viên có quyền ghi kết quả, lý do và khoản hoàn tiền thủ công |
| Khóa Merchant | Đã có | Chặn hold mới và ẩn khỏi khách; booking hiện có vẫn xử lý được |

### 4.5. Cọc, tiền mặt và đối soát

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Ghi cọc trên hold | Đã có | CASH, có kiểm tra số còn thiếu |
| Thu tiền mặt trên booking | Đã có | Ghi theo người thực hiện và thời điểm |
| Tài khoản booking | Sẵn sàng nghiệm thu | Giá + phụ thu; đã thu; còn thiếu/thu dư; khoản giữ lại khi hủy |
| Phụ thu | Sẵn sàng nghiệm thu | Bốn vai trò có thể ghi, bắt buộc lý do |
| Đảo bút toán | Sẵn sàng nghiệm thu | Owner/Quản lý đảo toàn phần một lần; không sửa/xóa bản ghi gốc |
| Cọc hold hết hạn | Sẵn sàng nghiệm thu | Danh sách chờ xử lý; Owner/Quản lý ghi đã hoàn và phần giữ lại |
| Báo cáo cuối ngày | Sẵn sàng nghiệm thu | Theo chi nhánh, ngày địa phương và người ghi |
| Thanh toán online/tự động refund | Ngoài pilot | Chưa chọn payment provider/Merchant-of-Record |

### 4.6. Web khách hàng và Marketplace

| Tính năng | Trạng thái | Mô tả hiện tại |
|---|---|---|
| Catalog Merchant đã duyệt | Đã có | Chỉ Merchant active, published và Platform-approved mới hiển thị |
| Chọn địa điểm, ngày, giờ, thời lượng và phòng | Đã có | Web responsive, tối ưu điện thoại |
| Giá dự kiến, cọc và điều khoản | Đã có | Khách xem trước khi giữ phòng |
| Guest hold | Đã có | SĐT bắt buộc, email tùy chọn; retry an toàn khi mất mạng |
| Mã đặt phòng 6 ký tự | Sẵn sàng nghiệm thu | Bỏ 0/O/1/I; chấp nhận chữ thường, khoảng trắng và dấu gạch khi tra cứu |
| Tra cứu trạng thái | Đã có | Dùng SĐT + mã; có rate limit chống dò mã |
| Publish/duyệt/thu hồi listing | Đã có | Owner publish; Platform Admin duyệt hoặc thu hồi |
| Tạo và khóa/mở khóa Merchant | Đã có | Có lý do và audit |
| Discovery Marketplace nâng cao | Sau pilot | Tìm kiếm/xếp hạng/khuyến nghị chưa thuộc MVP pilot |

### 4.7. An toàn và vận hành

- Chống booking/hold chồng thời gian bằng ràng buộc PostgreSQL và khóa theo phòng.
- Mutation quan trọng chạy trong transaction và ghi audit cùng transaction.
- Dữ liệu tiền xử lý bằng số nguyên VND; không dùng số thực.
- API có error envelope, correlation ID, rate limit và ẩn lỗi nội bộ.
- Ảnh công khai và PDF riêng tư được tách kho; kiểm tra loại file bằng nội dung thực.
- Frontend và backend triển khai tách project; frontend không truy cập trực tiếp PostgreSQL.
- Production hiện dùng Vercel, PostgreSQL và Vercel Blob; các cổng production vẫn phải qua UAT Merchant.

---

## 5. Luồng nghiệp vụ chính

### 5.1. Khách tự đặt phòng trên web

`Chọn Merchant/chi nhánh → Chọn ngày giờ → Xem phòng trống → Chọn phòng → Xem giá/cọc/điều khoản → Nhập SĐT → Giữ phòng → Nhận mã 6 ký tự → Merchant xác nhận → Khách tra cứu trạng thái`

### 5.2. Nhân viên tiếp nhận qua điện thoại hoặc tại quầy

`Chọn chi nhánh → Tìm phòng trống → Báo giá → Tạo hold → Ghi cọc hoặc miễn cọc theo chính sách → Xác nhận booking → Check-in → Ghi phụ thu/tiền mặt → Check-out`

### 5.3. Hủy hoặc khách không đến

`Mở booking → Chọn loại kết quả → Nhập ghi chú bắt buộc → Nhập khoản đã hoàn nếu có → Giải phóng phòng → Tài khoản booking hiển thị khoản giữ lại`

### 5.4. Cuối ngày

`Chọn chi nhánh/ngày → Xem tổng cọc và tiền mặt → Kiểm tra khoản đảo/hoàn → Đối chiếu theo nhân viên → Xử lý cọc của hold hết hạn`

---

## 6. Mockup — Tổng quan Merchant

```text
┌────────────────────────────────────────────────────────────────────┐
│ KaraokeNow Business          Chi nhánh: Hoàn Kiếm      Nguyễn An  │
├───────────────┬────────────────────────────────────────────────────┤
│ Tổng quan     │ TỔNG QUAN HÔM NAY                                  │
│ Lịch & đặt    │ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ Tiền mặt      │ │ 8 phòng  │ │ 12 đơn   │ │ 4,8 tr ₫ │             │
│ Phòng hát     │ │ 6 active │ │ 3 đang hát│ │ tiền ròng│             │
│ Giá & CS      │ └──────────┘ └──────────┘ └──────────┘             │
│ Người dùng    │                                                    │
│ Marketplace   │ PHÒNG                                              │
│ Cài đặt       │ VIP 01  Trống    VIP 02  Đang dùng                 │
│               │ Standard 05  Bảo trì đến 18:30                    │
└───────────────┴────────────────────────────────────────────────────┘
```

## 7. Mockup — Lịch lễ tân hợp nhất

```text
┌ LỊCH & ĐẶT PHÒNG ─────────────────────  Hôm nay  06:00 → 06:00 ┐
│ [Timeline] [Danh sách]  ☑ Hold  ☑ Booking  ☐ Hết hạn  ☐ Hủy   │
├────────────┬────────┬────────┬────────┬────────┬────────┬────────┤
│            │ 18:00  │ 19:00  │ 20:00  │ 21:00  │ 22:00  │ 23:00  │
│ VIP 01     │  TRỐNG │ HOLD WEB ───────│ buffer │ TRỐNG           │
│ VIP 02     │ BOOKING CONFIRMED ───────│ CHECKED-IN ───────────  │
│ Standard 3 │ MAINTENANCE ─────────────│ TRỐNG                   │
├────────────┴───────────────────────────────────────────────────────┤
│ Chọn một mục để xem khách, giá snapshot, cọc và thao tác phù hợp  │
└────────────────────────────────────────────────────────────────────┘
```

## 8. Mockup — Đối soát tiền mặt

```text
┌ ĐỐI SOÁT TIỀN MẶT · 28/11 · Hoàn Kiếm ──────────────────────────┐
│ Cọc nhận       Tiền mặt booking     Đã đảo/hoàn       Tiền ròng │
│ 2.400.000 ₫    8.750.000 ₫          500.000 ₫         10.650.000 ₫│
├──────────────────────────────────────────────────────────────────┤
│ Theo người ghi                                                 │
│ Lan — Thu ngân        5.200.000 ₫                              │
│ Minh — Quản lý        3.450.000 ₫                              │
│ An — Lễ tân           2.000.000 ₫                              │
├──────────────────────────────────────────────────────────────────┤
│ Cọc chờ xử lý: 2 hold hết hạn                [Mở danh sách]     │
└──────────────────────────────────────────────────────────────────┘
```

## 9. Mockup — Web đặt phòng khách hàng trên điện thoại

```text
┌──────────────────────────┐
│       KaraokeNow         │
│ Tìm phòng cho buổi hát   │
│                          │
│ Địa điểm                 │
│ [ Karaoke Hoàn Kiếm  ▾ ] │
│                          │
│ Ngày                     │
│ [T6 27] [T7 28] [CN 29] │
│                          │
│ Giờ bắt đầu              │
│ [18:00] [19:00] [20:00] │
│ Thời lượng [2 giờ ▾]     │
│ Số khách   [8 người ▾]   │
│                          │
│ VIP 02 · tối đa 18       │
│ TV 85” · Sân khấu        │
│ 20:00–22:00              │
│            1.200.000 ₫   │
│                          │
│     [Chọn phòng này]     │
└──────────────────────────┘
```

```text
┌──────────────────────────┐
│ XÁC NHẬN GIỮ PHÒNG       │
│ VIP 02 · 20:00–22:00     │
│ Giá dự kiến 1.200.000 ₫  │
│ Cọc yêu cầu   360.000 ₫  │
│                          │
│ SĐT [0989 123 456]       │
│ Email [không bắt buộc]   │
│ ☑ Đồng ý điều khoản v3   │
│                          │
│ [Giữ phòng trong 15 phút]│
├──────────────────────────┤
│ ĐÃ GIỮ PHÒNG             │
│ Mã của bạn: K7M 4XQ      │
│ [Sao chép mã]            │
└──────────────────────────┘
```

## 10. Mockup định hướng — Zalo và Messenger WebView

> Đây là thiết kế định hướng. WebView dùng chung web đặt phòng mobile; tích hợp tin nhắn production còn chờ quyền nền tảng và adapter gửi tin.

```text
TIN NHẮN ZALO/MESSENGER              WEBVIEW TRONG ỨNG DỤNG
┌─────────────────────────┐          ┌──────────────────────────┐
│ KaraokeNow              │          │ Đặt phòng KaraokeNow     │
│ Đặt phòng nhanh ngay    │  MỞ →    │ [Địa điểm ▾]             │
│ trong ứng dụng.         │          │ [Ngày] [Giờ] [Thời lượng]│
│ [Mở trang đặt phòng]    │          │ [Chọn phòng còn trống]   │
└─────────────────────────┘          │ [Giữ phòng]              │
                                     └──────────────────────────┘

TIN NHẮN KẾT QUẢ
┌─────────────────────────┐
│ Đã giữ phòng thành công │
│ VIP 02 · 20:00–22:00    │
│ Mã: K7M 4XQ             │
│ [Xem trạng thái]        │
└─────────────────────────┘
```

---

## 11. Kế hoạch triển khai với Merchant

### Giai đoạn 0 — Fit-gap và xác nhận pilot · 1–2 ngày

- Chọn chi nhánh pilot tại Hà Nội.
- Chỉ định Owner nghiệp vụ và đầu mối hỗ trợ.
- Xác nhận quy trình hiện tại: đặt phòng, cọc, check-in/out, hủy và đối soát.
- Chốt KPI nền và điều kiện dừng/mở rộng.

**Đầu ra:** biên bản phạm vi pilot và danh sách dữ liệu cần chuẩn bị.

### Giai đoạn 1 — Chuẩn hóa dữ liệu và cấu hình · 2–4 ngày

- Tạo Merchant, Owner và tài khoản nhân sự.
- Nhập chi nhánh, phòng, sức chứa, tiện nghi và ảnh.
- Cấu hình thời lượng, buffer, bảng giá, ngày đặc biệt, cọc và điều khoản.
- Gán quyền theo chi nhánh.

**Cổng nghiệm thu:** Merchant ký nhận dữ liệu và quyền truy cập.

### Giai đoạn 2 — Đào tạo và UAT · 3–5 ngày

- UAT theo vai trò Owner, Branch Manager, Receptionist và Cashier.
- Chạy luồng khách → hold → cọc → booking → check-in/out.
- Chạy hủy/no-show, phụ thu, đảo bút toán và báo cáo cuối ngày.
- Kiểm thử trên điện thoại thực tế của Merchant.

**Cổng nghiệm thu:** không còn lỗi P1; các ca nghiệp vụ bắt buộc được ký nhận.

### Giai đoạn 3 — Pilot có kiểm soát · 2 tuần đề xuất

- Mở web khách cho phạm vi chi nhánh pilot.
- Theo dõi booking trùng, lỗi, thời gian xử lý và tỷ lệ nhân viên sử dụng.
- Họp ngắn hằng ngày trong những ngày đầu; tổng kết hằng tuần.
- Ghi nhận tiền thủ công; chưa dùng thanh toán online.

**Cổng nghiệm thu:** Merchant chấp nhận quy trình; dữ liệu và hỗ trợ vận hành ổn định.

### Giai đoạn 4 — Đánh giá mở rộng

- Mở thêm chi nhánh/Merchant khi KPI pilot đạt.
- Chỉ xem xét Zalo/Messenger sau khi có quyền nền tảng.
- Chỉ xem xét online payment, commission settlement và subscription billing sau pilot.

---

## 12. Trách nhiệm hai bên

| KaraokeNow | Merchant |
|---|---|
| Cấu hình tenant, môi trường và quyền | Cung cấp dữ liệu chi nhánh/phòng/giá đúng |
| Hướng dẫn dữ liệu, đào tạo và UAT | Chỉ định Owner nghiệp vụ và nhân sự UAT |
| Sửa lỗi trong phạm vi pilot đã thống nhất | Xác nhận điều khoản, cọc, hủy/no-show |
| Cung cấp audit và hỗ trợ điều tra | Đối chiếu tiền mặt và phản hồi sai lệch |
| Không bật tích hợp ngoài phạm vi đã duyệt | Không chia sẻ tài khoản; báo ngay sự cố quyền |

---

## 13. KPI và cổng thành công pilot

| Nhóm | Chỉ số/cổng đề xuất |
|---|---|
| Correctness | 0 booking/hold hiệu lực chồng cùng phòng và thời gian |
| Dữ liệu | 100% phòng pilot có trạng thái, sức chứa; ≥ 95% có tiện nghi/ảnh cần thiết |
| Vận hành | Thời gian kiểm tra phòng trống giảm so với baseline |
| Áp dụng | Tỷ lệ ca trực sử dụng hệ thống đạt mục tiêu Merchant chốt |
| Tiền mặt | Báo cáo cuối ngày khớp két hoặc mọi sai lệch có bút toán điều chỉnh |
| Ổn định | Không còn lỗi P1; lỗi P2 có owner và thời hạn xử lý |
| Trải nghiệm khách | Luồng mobile không cuộn ngang; khách giữ và tra cứu được bằng mã 6 ký tự |
| Nghiệm thu | Owner/đầu mối Merchant ký checklist UAT và chấp nhận quy trình pilot |

---

## 14. Giới hạn và phụ thuộc cần nói rõ

1. **Không thanh toán online trong pilot.** Cọc, tiền mặt, hoàn và đảo bút toán là ghi nhận thủ công.
2. **Zalo/Messenger chưa tích hợp production.** WebView và tin nhắn kết quả là định hướng; cần quyền nền tảng và adapter gửi tin.
3. **Password reset qua Zalo Business Solution chưa bật.** Chờ OA/App/quyền và template.
4. **Địa chỉ/SĐT chi nhánh chưa có mô hình dữ liệu hoàn chỉnh.** Cần chốt trước khi công khai trong catalog.
5. **Ảnh/logo/PDF và mã 6 ký tự cần UAT production bằng tài khoản Merchant.** Hạ tầng và code đã có.
6. **Phiên qua F5 và màn chọn Merchant đang được hoàn thiện ở frontend.** Backend và hợp đồng API đã sẵn sàng.
7. **Còn cổng QA:** bàn phím/screen reader, Safari/Firefox, mất mạng và refresh/logout đồng thời.
8. **Không tự động quyết định hoàn tiền, no-show hoặc phí overtime.** Nhân viên có quyền đánh giá và ghi nhận.
9. **Commission Marketplace chưa được thu/settle trong pilot.** Nếu có tính toán thì chỉ phục vụ báo cáo.

---

## 15. Checklist Merchant chuẩn bị

- [ ] Danh sách chi nhánh pilot và múi giờ.
- [ ] Danh sách phòng, mã phòng, sức chứa, tiện nghi và ảnh.
- [ ] Logo và giấy tờ PDF cần dùng khi duyệt.
- [ ] Danh sách nhân sự, email, vai trò và chi nhánh được cấp.
- [ ] Bộ giá mẫu theo ngày/giờ/phòng và ngày đặc biệt.
- [ ] Thời lượng, buffer dọn phòng và TTL giữ phòng.
- [ ] Chính sách cọc theo từng kênh.
- [ ] Điều khoản khách phải chấp nhận và quy trình hủy/no-show.
- [ ] Quy trình thu tiền, phụ thu, đảo bút toán và chốt két.
- [ ] Thiết bị điện thoại/máy tính dùng trong UAT.
- [ ] Owner nghiệp vụ có quyền ký nghiệm thu.

---

## 16. Bằng chứng trạng thái kỹ thuật tại thời điểm cập nhật

- Backend có hơn 70 đường dẫn API được quản lý bằng OpenAPI và kiểm tra drift.
- PostgreSQL E2E gần nhất đạt 47/47 sau phần cookie phiên và lưu file.
- Frontend gần nhất đạt 51/51 unit test; các bộ API/khách/lễ tân/Platform/vai trò đã chạy tự động.
- Lịch lễ tân hợp nhất đạt bộ E2E 142/142 tại thời điểm tích hợp.
- Đối soát tiền mặt đạt bộ E2E 157/157 tại thời điểm tích hợp.
- Booking concurrency đã kiểm thử nhiều yêu cầu cùng phòng và không tạo occupancy chồng lấn.
- Hạ tầng frontend, backend, PostgreSQL và Blob đã được tách theo đúng kiến trúc; production vẫn cần UAT Merchant trước khi coi là hoàn tất nghiệm thu.

---

## 17. Kết luận đề xuất

KaraokeNow đã vượt giai đoạn “mockup ý tưởng” và có đủ luồng lõi để tổ chức một pilot Merchant có kiểm soát tại Hà Nội. Bước tiếp theo không phải xây lại toàn bộ sản phẩm, mà là hoàn thiện các cổng frontend đang nghiệm thu, nhập dữ liệu thật, chạy UAT theo vai trò và đo kết quả vận hành trong phạm vi nhỏ trước khi mở rộng.

**Nguyên tắc pilot:** đúng dữ liệu, không trùng phòng, đúng quyền, tiền có thể đối soát và Merchant chủ động chấp nhận quy trình trước khi go-live.

