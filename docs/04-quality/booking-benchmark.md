# Benchmark hiệu năng và đồng thời cho booking (QA-002)

Ngày chạy: 2026-11-26. Script: `be/scripts/benchmark-booking.ts` (`npm run bench:booking`). Kết quả JSON của lần chạy 1: [`booking-benchmark-2026-11-26.json`](booking-benchmark-2026-11-26.json).

> Đây là bằng chứng trên **máy local**, không phải năng lực production. App và PostgreSQL chạy trên cùng một máy, một tiến trình Node, qua Docker Desktop; không có mạng thật, load balancer hay nhiều instance.

## Mục tiêu

Theo PRD và Master Plan (mục tiêu, chưa phải SLA đã ký):

- API thông thường: p95 < 500 ms (không tính thời gian provider bên ngoài).
- Tìm phòng trống: p95 < 1 s trên bộ dữ liệu benchmark đã thống nhất.
- Đúng đắn: không bao giờ có hai occupancy đang hoạt động chồng lấn trên cùng phòng; 100 yêu cầu giữ cùng phòng/khung giờ chỉ một yêu cầu thành công (TC-001).

**Bộ dữ liệu chưa được PO/BA thống nhất.** Bộ dưới đây là đề xuất của luồng BE; cần xác nhận hoặc thay bằng quy mô pilot thực tế.

## Cách chạy và tái lập

```bash
cd be
npm run bench:booking                                   # in báo cáo JSON ra màn hình
BENCH_OUTPUT=../docs/04-quality/<tên>.json npm run bench:booking
```

Script tự dựng PostgreSQL 17 bằng Testcontainers (cần Docker), chạy toàn bộ migration, nạp dữ liệu, khởi động app Nest thật trên cổng ngẫu nhiên và gọi qua HTTP (`fetch`). Log request của app vẫn được tạo như production nhưng bị ẩn khỏi màn hình. Script trả mã thoát khác 0 nếu bất kỳ kiểm tra đúng đắn nào thất bại.

## Môi trường

| Mục | Giá trị |
|---|---|
| Máy | Apple M1 Pro, 8 CPU, 16 GB RAM, macOS (Darwin 25.5.0) |
| Node | v26.5.0 |
| PostgreSQL | 17.11 (container `postgres:17-alpine`, cấu hình mặc định) |
| Pool `pg` của app | Mặc định (10 kết nối) |

## Bộ dữ liệu đề xuất

| Thành phần | Quy mô |
|---|---|
| Merchant | 1 |
| Chi nhánh × phòng | 5 × 20 = 100 phòng |
| Lịch sử booking | 30 ngày × 4 suất/phòng/ngày (2 giờ + buffer 15 phút) |
| Tuần tới | 50% phòng đã có booking khung tối cao điểm |
| Tổng `room_occupancy` | 12.350 dòng |
| Bảng giá | 1 quy tắc theo giờ 150.000 VND |

## Kịch bản

| Kịch bản | Số request | Đồng thời | Mô tả |
|---|---:|---:|---|
| `availability-search` | 600 | 20 | `GET /merchant/branches/{id}/availability` trên 7 ngày tới, nhiều khung giờ và thời lượng |
| `quote` | 600 | 20 | `POST /merchant/rooms/{id}/quote` |
| `hold-distinct-slots` | 600 | 20 | Giữ phòng trên khung giờ trống khác nhau — mọi request phải 201 |
| `hold-contention-100x10` | 1.000 | 100 | 10 vòng, mỗi vòng 100 request giữ **cùng** phòng/khung giờ — đúng 1 lần 201, 99 lần 409 |
| `staff-flow-*` | 100 luồng | 10 | Giữ phòng → gắn thông tin khách (báo giá) → xác minh cuộc gọi → xác nhận; đo từng bước |
| Kiểm tra cuối | — | — | SQL đếm cặp occupancy đang hoạt động chồng lấn |

## Kết quả (3 lần chạy sau khi sửa lỗi, đơn vị ms)

| Kịch bản | p50 | p95 | p99 | Thông lượng (req/s) | Mục tiêu p95 | Đạt |
|---|---|---|---|---|---:|---|
| availability-search | 20,7–21,1 | 30,6–35,9 | 47,0–54,6 | 884–915 | 1.000 | ✅ |
| quote | 17,7–18,2 | 21,8–34,2 | 24,9–53,5 | 982–1.115 | 500 | ✅ |
| hold-distinct-slots | 29,0–31,5 | 35,4–45,8 | 42,4–54,1 | 607–684 | 500 | ✅ |
| hold-contention-100x10 | 91,6–107,8 | 133,2–173,4 | 140,5–199,0 | 621–725 | 500 | ✅ |
| staff-flow-hold | 10,8–12,2 | 17,0–17,6 | 19,2–30,1 | — | 500 | ✅ |
| staff-flow-details | 10,9–12,2 | 28,9–30,2 | 42,7–46,1 | — | 500 | ✅ |
| staff-flow-verify | 6,2–7,1 | 8,8–11,4 | 10,6–19,7 | — | 500 | ✅ |
| staff-flow-confirm | 29,5–33,5 | 39,8–49,3 | 42,1–63,8 | — | 500 | ✅ |

Đúng đắn (cả 3 lần): **0** cặp occupancy chồng lấn; **10/10** vòng tranh chấp có đúng một người thắng; **100/100** luồng nhân viên xác nhận thành công; không có lỗi 5xx.

## Phát hiện và sửa lỗi: deadlock khi tranh chấp giữ phòng

Lần chạy thứ 3 trước khi sửa, kịch bản tranh chấp trả **198 lỗi 500** với độ trễ **72–91 giây**. Chạy lặp 30 vòng để chẩn đoán: 5/30 vòng gặp lỗi, mỗi vòng lỗi kéo dài 85–95 giây; lỗi gốc là PostgreSQL `40P01 deadlock detected`.

- **Nguyên nhân:** ràng buộc exclusion GiST trên `room_occupancy` không tuần tự hoá việc chèn như unique B-tree. Các transaction chèn khoảng chồng lấn cùng lúc đều ghi bản ghi trước rồi mới kiểm tra, thấy bản ghi chưa commit của nhau và chờ nhau. PostgreSQL chỉ phát hiện deadlock sau `deadlock_timeout` (1 s) cho mỗi chu trình, nên với 100 request các chu trình nối tiếp thành chuỗi gần 90 giây. Không có booking chồng lấn — ràng buộc vẫn đúng — nhưng khách/nhân viên chờ hơn một phút rồi nhận 500.
- **Lỗ hổng giám sát đi kèm:** `ApiExceptionFilter` không ghi log lỗi 500 nên lỗi này vô hình trong log.
- **Sửa** (`be/src/availability/occupancy-lock.ts`, `be/src/platform/http/api-exception.filter.ts`):
  1. Advisory lock theo phòng (`room-occupancy:<roomId>`) ngay trước mọi lệnh tạo hoặc nới rộng occupancy: staff hold, public hold, tạo/sửa khoá bảo trì. Request đến sau chờ ngắn, thấy bản ghi đã commit và trả 409 ngay. Rút ngắn khi check-out không cần khoá.
  2. Lỗi PostgreSQL `40P01`/`40001` còn sót được trả 409 "thử lại" thay vì 500.
  3. Lỗi 5xx (và 409 do tranh chấp) được ghi log JSON gồm `correlationId`, đường dẫn, mã lỗi PostgreSQL; không ghi message hay tham số vì có thể chứa dữ liệu khách.
- **Sau khi sửa:** 30/30 vòng chẩn đoán đúng một người thắng, vòng chậm nhất 231 ms, không còn deadlock; 3 lần benchmark đầy đủ không có lỗi 5xx.

## Chạy lại sau OPS-004 (2026-11-28)

Sau khi đặt giới hạn pool/timeout mặc định (pool 10, chờ kết nối 5 s, câu lệnh 15 s, chờ khoá 5 s), một lần chạy cho: tìm phòng p95 48 ms, báo giá 24 ms, giữ phòng 48 ms, tranh chấp 100×10 p95 132 ms, luồng nhân viên ≤ 42 ms; 0 chồng lấn, 10/10 vòng một người thắng, không 5xx. Script nay luôn dọn container/app trong `finally` và tự tạo thư mục output.

## Chạy lại sau BKG-011 (2026-11-28)

`lockRoomOccupancy` giờ giải phóng các giữ chỗ quá hạn của phòng trước khi ghi, và tìm phòng bỏ qua occupancy HELD của giữ chỗ quá hạn. Một lần chạy: tìm phòng p95 24,5 ms, báo giá 19,7 ms, giữ phòng 44,2 ms, tranh chấp 100×10 p95 175 ms, luồng nhân viên ≤ 35 ms; tất cả đạt, không 5xx.

## Giới hạn và việc tiếp theo

- Kết quả dao động theo tải máy: một lần chạy sau đó, khi máy đang chạy song song việc khác, cho tìm phòng p95 55 ms và tranh chấp p95 345 ms — vẫn dưới mục tiêu, đúng đắn vẫn đạt. Khi so sánh giữa các lần đo, chạy trên máy rảnh và lặp ít nhất 3 lần.

- Chưa đo trên hạ tầng giống production (DB tách máy, nhiều instance app, mạng thật, TLS). Cần chạy lại khi có môi trường staging.
- Chưa có kịch bản public hold có rate limit thật, tải kéo dài (soak) hoặc dữ liệu nhiều merchant lớn hơn.
- Pool kết nối, `statement_timeout`/`lock_timeout` đang để mặc định; nên đặt giới hạn rõ ràng trước production (đề xuất, chưa làm).
- Bộ dữ liệu cần PO/BA xác nhận theo quy mô pilot (số merchant, phòng, booking/ngày).
