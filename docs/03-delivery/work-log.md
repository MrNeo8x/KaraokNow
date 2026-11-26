# Work log — KaraokeNow

Nhật ký theo phiên để agent sau (Codex/Claude Code, luồng BE hoặc FE) tiếp tục mà không phải đọc lại lịch sử chat. Mục **"Trạng thái hiện tại"** luôn đứng đầu và được **viết lại** ở cuối mỗi phiên (commit, kiểm chứng, môi trường, việc dở, việc tiếp theo). Nhật ký từng phiên ghi ngay bên dưới, mới nhất trước: phạm vi, commit, kiểm chứng thực tế, quyết định mới, việc dở dang, cảnh báo. Trạng thái task chi tiết vẫn nằm ở `task-board.md`.

## Trạng thái hiện tại (cập nhật 2026-11-26, 23:15)

Đọc mục này trước; các mục nhật ký bên dưới là lịch sử.

**Code trên `main`** (chưa push lên remote, CI GitHub chưa có kết quả). Gần nhất: BE `da2eb69` overtime (PD-030) + khoá merchant (PD-031), FE `c6663d7` thiết kế tím/admin shell/booking kiểu app, BE `7796a6d` benchmark + sửa deadlock + UAT, FE `221c6d8` cọc/check-in/out/`/platform`/Playwright.

**Kiểm chứng gần nhất:** BE `npm run verify` 42/42 unit, `npm run test:e2e` 40/40, migration mới up → down → up; benchmark đạt mục tiêu (`docs/04-quality/booking-benchmark.md`). FE (theo task board): unit và Playwright đạt.

**Môi trường local** (`be/compose.yaml`): Postgres `:5433`, backend `:3000`, frontend `:3100`; đã seed UAT, đã áp mọi migration (mới nhất `20261124030000_overtime_recording`) và backend chạy code `da2eb69` (smoke: overtime-policy mặc định 10 phút, publication có `tenantStatus`, khoá thiếu lý do → 400). Frontend container là bản build lúc 22:17, chưa có màn FE-013. Worker `holds:expire`/`outbox:work` không chạy trong compose.

**Đang dở (working tree, chưa commit):** Luồng FE làm FE-013 (`fe/src/components/overtime-settings.tsx` mới; sửa `platform-merchants.tsx`, `catalog-publication.tsx`, `booking-operations.tsx`, `experience.tsx`, `lib/api.ts`, `fe/e2e/*`), viết lại `README.md` (tiếng Việt, mục triển khai) và mục "Yêu cầu BE — triển khai" trong handoff (đã ghi nhận thành OPS-005). Luồng BE không có việc dở.

**Trạng thái task:** `IN_PROGRESS` 0 · `VERIFY` 23 · `READY` 3 (REC-003, QA-003, FE-013) · `BLOCKED` 9 · `BACKLOG` 6 · `DONE` 46. Chi tiết ở `task-board.md`.

**Việc tiếp theo**

- *Người dùng / PO:* chạy UAT theo `docs/04-quality/uat-checklist.md` (đã thêm A8–A9 khoá merchant, E3/E5 overtime) và ký nhận; trả lời PAY-007 (đối soát sổ quỹ, hoàn cọc khi hold hết hạn), BKG-008 (không cọc theo trường hợp); xác nhận các giả định: cọc FIXED tối đa bằng tổng, PERCENT làm tròn lên, không ghi vượt; giữ duyệt khi publish lại; **overtime quá ân hạn tính toàn bộ phút trễ**; quy mô bộ dữ liệu benchmark.
- *Luồng FE:* hoàn tất và commit FE-013 (cấu hình ân hạn, hiển thị phút trễ/overtime, khoá/mở khoá merchant ở `/platform`, cảnh báo Owner khi `tenantStatus=INACTIVE`); REC-003; QA-003 (Branch Manager/Cashier, bàn phím, 429, mất mạng); sửa câu "seed chưa tạo bảng giá" trong README; sau khi commit, rebuild frontend container (`docker compose up -d --build frontend` trong `be/`).
- *Luồng BE:* OPS-005 (image migration/worker, tắt Swagger theo môi trường — yêu cầu từ FE); chờ PO cho PAY-007/BKG-008; OPS-004 (pool/timeout) và OPS-002/OPS-003 khi có thiết kế production; IAM-004 khi có ZBS; tuỳ chọn có quyết định: reset mật khẩu Owner, `GET /platform/me`, bổ sung response schema OpenAPI cho FE-011.

**Không làm khi chưa có quyết định:** thanh toán online, tính tiền overtime hoặc gia hạn giờ, tự động hoàn tiền/no-show, Zalo/Messenger.

---

## 2026-11-26 (23:15) — Luồng BE: rebuild backend local sau overtime/khoá merchant

- `npm run db:migrate` áp `20261124030000_overtime_recording`; `docker compose up -d --build backend` tạo lại container (healthy); frontend và PostgreSQL giữ nguyên.
- Smoke trên container: `GET /merchant/booking/overtime-policy` → `{configured:false, graceMinutes:10}`; `GET /merchant/catalog/publication` có `tenantStatus: ACTIVE`; `POST /platform/merchants/{UAT2}/suspend` không lý do → 400. Không khoá thật để giữ nguyên dữ liệu UAT (UAT2 vẫn ACTIVE).
- Các ca UAT A8–A9, E3/E5 chạy được qua API/Swagger; màn FE tương ứng (FE-013) đang được Luồng FE làm.

---

## 2026-11-26 (23:00) — Luồng BE: overtime (BKG-007) và khoá merchant (PLT-003)

- Quyết định PO mới: **PD-030** overtime chỉ ghi phút lúc check-out, không tính tiền, không gia hạn; ân hạn merchant cấu hình 0–60 phút, mặc định 10. **PD-031** khoá merchant: ẩn khỏi khách, chặn hold mới (public + staff), nhân viên vẫn xử lý việc đã có; lý do bắt buộc.
- Migration `20261124030000_overtime_recording` (`tenant_overtime_policies`; `bookings.late_minutes/overtime_minutes/overtime_grace_minutes`). API `GET/PATCH /v1/merchant/booking/overtime-policy` (`be/src/booking/overtime-policy.ts`); check-out tính phút trễ trong cùng câu UPDATE với một mốc thời gian.
- API `POST /v1/platform/merchants/{tenantId}/suspend|reactivate`; staff hold kiểm tra `tenants.status` dưới `FOR SHARE` (tuần tự với khoá); publication trả `tenantStatus`.
- E2E +2 (overtime: trễ quá/trong ân hạn, về sớm, ân hạn 0, quyền, audit; khoá: ẩn công khai, public hold 404, staff hold 409, booking cũ vẫn xác nhận được, mở khoá hiện lại, chặn admin là thành viên, audit). Test check-out cũ đổi sang `toMatchObject` vì audit có thêm trường overtime. Kết quả: unit 42/42, E2E 40/40.
- Ghi nhận yêu cầu của Luồng FE về triển khai thành OPS-005.

---

## 2026-11-26 (22:15) — Luồng BE: rebuild backend local

- `npm run db:migrate`: không có migration mới. `docker compose up -d --build backend`: image trùng bản đang chạy (container đã được tạo lại lúc 22:10, nhiều khả năng bởi Luồng FE) nên không tạo lại.
- Kiểm trực tiếp container: có `dist/availability/occupancy-lock.js`, log khởi động không còn `LegacyRouteConverter`; 100 request giữ cùng phòng/khung giờ → 1×201, 99×409, 470 ms, không 5xx.
- Bài kiểm để lại 1 hold WALK_IN ngày 2045-09-11 (phòng Gia Đình 01, merchant UAT), tự hết hạn sau 15 phút.

---

## 2026-11-26 (tối) — Luồng BE: QA-002 benchmark và UAT-001

### Đã làm

- **QA-002 → DONE.** `npm run bench:booking` (`be/scripts/benchmark-booking.ts`, đã có trong commit `154eeab` của người dùng): Testcontainers PostgreSQL 17, 100 phòng, 12.350 occupancy, app thật qua HTTP. Mọi mục tiêu p95 đạt trên máy local (tìm phòng ~31–36 ms, tranh chấp 100×10 ~133–173 ms). Báo cáo: `docs/04-quality/booking-benchmark.md`, JSON: `docs/04-quality/booking-benchmark-2026-11-26.json`.
- **Lỗi thật phát hiện qua benchmark:** deadlock (`40P01`) của ràng buộc exclusion GiST khi nhiều request giữ cùng phòng/khung giờ → 500 sau 72–91 s (không có booking chồng). Sửa bằng `lockRoomOccupancy` (`be/src/availability/occupancy-lock.ts`) ở staff hold, public hold, tạo/sửa khoá bảo trì; `ApiExceptionFilter` trả 409 cho `40P01`/`40001` và **ghi log lỗi 5xx** (trước đây không ghi gì). E2E hồi quy có kiểm tra khoá tất định (đã xác nhận test fail khi gỡ khoá).
- Sửa cảnh báo khởi động `LegacyRouteConverter`: middleware dùng `forRoutes('{*splat}')`.
- **UAT-001 → VERIFY.** Checklist 45 ca tiếng Việt `docs/04-quality/uat-checklist.md`. Seed UAT mở rộng: merchant UAT có bảng giá (VIP 150.000 đ/giờ, Gia Đình 100.000 đ/giờ), điều khoản, cọc WEB 30%, PHONE/WALK_IN không cọc, tài khoản Branch Manager/Receptionist/Cashier; merchant UAT2 đã publish **chờ duyệt**, WEB không cọc. Đã kiểm luồng khách → cọc → xác nhận và duyệt UAT2 trên database tạm, rồi seed vào database local đang dùng.
- QA-003 chuyển `READY`: FE đã có Playwright (`fe/e2e`, commit `221c6d8`); còn thiếu Branch Manager/Cashier và các kiểm thử bàn phím/429/mất mạng. Thêm OPS-004 (pool/timeout PostgreSQL).

### Kiểm chứng

`npm run verify` 42/42 unit; E2E 38/38; benchmark 3 lần sau khi sửa: 0 chồng lấn, 10/10 vòng một người thắng, không 5xx.

### Lưu ý cho phiên sau

- Database local còn quy tắc giá `UAT_SMOKE/UAT_ALL_DAY` (ưu tiên 1) do FE tạo; quy tắc seed ưu tiên 100/101 thắng nên giá đúng như checklist.
- Bộ dữ liệu benchmark là đề xuất của BE, cần PO/BA xác nhận quy mô pilot.

---

## 2026-11-26 — Luồng BE (Claude Code), tiếp nối phiên Codex bị ngắt

### Bối cảnh

Phiên Codex BE (`~/.codex/sessions/2026/11/22/rollout-2026-11-22T09-07-45-…jsonl`) hết usage limit lúc 20:24 (giờ VN) khi đang hoàn tất WEB-004: code và E2E đã xong, nhưng phần kiểm tra env `TRUST_PROXY_HOPS`/`PUBLIC_*` thêm sau lần verify cuối chưa có test. Người dùng đã commit hộ ở `81fd70b`.

### Commit của luồng BE

| Commit | Nội dung |
|---|---|
| `9aaded3` | WEB-004 hoàn tất: unit test env validation; **chuẩn hoá SĐT** cho idempotency, rate limit và lookup public (`0…`/`84…`/`+840…` → `+84…`, theo UAT-PD-004) |
| `c4829bb` | **PAY-006** cọc CASH trên hold (snapshot chính sách cọc cùng snapshot giá, `GET/POST /merchant/booking/holds/{id}/deposits`, xác nhận khi đủ cọc). **PLT-001** Platform Admin duyệt/thu hồi listing (`platform_admins`, `/platform/catalog/listings`) |
| `c1095c4` | **FR-009/010** check-in/check-out, **CAN-002** hủy/no-show do nhân viên ghi nhận (`/merchant/booking/bookings/{id}/check-in|check-out|outcome`) |
| `aaae642` | **PLT-002** Platform Admin tạo merchant + Owner đầu tiên (`GET/POST /platform/merchants`); bảng màn quản trị FE còn thiếu trong handoff |

Migration mới: `20261124000000_hold_deposits`, `20261124010000_platform_listing_approval`, `20261124020000_booking_lifecycle` — đã kiểm up → down 3 → up.

### Kiểm chứng (Node 26)

- `npm run verify`: 10/10 unit suites, 40/40 test; OpenAPI 73 path và API Markdown khớp.
- `npm run test:e2e`: 37/37 PostgreSQL Docker E2E.
- Stack Docker local: migration đủ, seed UAT chạy, smoke test bằng tài khoản UAT thật — Platform Admin đọc merchants/listings 200, Owner gọi API platform 403, publication/calendar 200, public catalog 200, frontend `:3100` 200.

### Quyết định PO mới (đã ghi decision log)

- **PD-025** check-out sớm rút occupancy về giờ thực tế + buffer; trả muộn chỉ ghi giờ, không kéo dài.
- **PD-026** check-in không giới hạn khung giờ.
- **PD-027** kết quả hủy/no-show: loại + ghi chú bắt buộc + tiền hoàn CASH tuỳ chọn (≤ cọc + tiền đã ghi); giải phóng phòng ngay.
- **PD-028** check-in/out: Owner/Branch Manager/Receptionist; hủy/no-show: Owner/Branch Manager.
- **PD-029** Platform Admin tạo merchant thủ công (mở rộng UAT-PD-009/010); không có tự đăng ký, khoá merchant, reset mật khẩu Owner.

### Giả định đang chờ PO xác nhận

- Cọc FIXED lớn hơn tổng tiền → bằng tổng tiền; PERCENT làm tròn lên đến đồng; không cho ghi cọc vượt số còn thiếu.
- Merchant tự gỡ publish rồi publish lại vẫn giữ trạng thái đã duyệt.
- No-show ghi được cả trước giờ bắt đầu (nhân viên tự quyết, theo PD-015).

### Trạng thái luồng FE tại thời điểm ghi (đã cũ — xem "Trạng thái hiện tại")

- Đã commit (`c56fea1`): guest hold/lookup ở `/booking`, `fe/src/lib/public-booking.ts`, test.
- **Chưa commit** trong working tree (session FE đang làm): `/platform` (`platform-listings.tsx`, `platform-merchants.tsx`), cọc trên hold (`hold-details.tsx`), check-in/out/hủy (`booking-operations.tsx`, `lib/booking-lifecycle.ts`), và các màn quản trị merchant `catalog-publication.tsx`, `memberships.tsx`, `audit-log.tsx`, `my-sessions.tsx`, `ops-backlog.tsx`, `lib/admin.ts` cùng test. FE ghi nhận unit test 27/27 ở lượt trước; chưa có browser/FE–BE role test.

### Việc tiếp theo

**BE**

1. Chờ PO: BKG-007 overtime khi trả muộn, PAY-007 đối soát sổ quỹ (phải thu/đã thu, sửa/đảo giao dịch, hoàn cọc khi hold hết hạn, xác nhận các giả định ở trên), BKG-008 điều kiện không cọc theo trường hợp.
2. IAM-004 reset mật khẩu qua ZBS — bị chặn đến khi có OA/App/template.
3. QA/vận hành: QA-002 benchmark booking/đồng thời (READY), OPS-003 giám sát worker `holds:expire`/`outbox:work`, OPS-002 backup/restore.
4. Có thể cần (chưa có quyết định): khoá merchant, reset mật khẩu Owner bởi Platform Admin, `GET /platform/me` thay cho cách dò quyền bằng 403.

**FE**

1. Commit các màn đang làm dở; smoke test với backend local đã rebuild bằng `uat.owner@karaokenow.local` và `uat.platform@karaokenow.local`.
2. REC-003 lịch hợp nhất hold + booking, lọc trạng thái hủy/no-show.
3. QA-003 kiểm thử trình duyệt/mobile/accessibility và FE–BE theo vai trò (Owner, Branch Manager, Receptionist, Cashier, Platform Admin) — cần môi trường trình duyệt tự động.

### Chỉnh task board (cuối phiên)

Task board viết lại bằng tiếng Việt và thêm trạng thái `VERIFY` (code + test tự động xong, chỉ chờ kiểm thử trình duyệt/UAT). `IN_PROGRESS` chỉ còn FE-005, FE-009, FE-010 (code FE chưa commit). Tách việc dở thành task mới: BKG-007 overtime, BKG-008 không cọc theo trường hợp, PAY-007 đối soát sổ quỹ (cả ba `BLOCKED` chờ PO), OPS-003 giám sát worker, REC-003 lịch hợp nhất (`READY`), QA-003 kiểm thử trình duyệt theo vai trò (`BLOCKED` chờ môi trường), FE-011 sinh type từ OpenAPI, FE-012 giữ phiên/chọn tenant (`BACKLOG`). BKG-003, BKG-005, PAY-005 chuyển `DONE` cho phạm vi pilot; QA-002, UAT-001 chuyển `READY`.

### Cảnh báo

- Database local có 6 merchant `SMOKE_…` (chưa publish) do smoke test FE tạo; chưa có API xoá merchant.
- Container backend không tự migrate; worker hết hạn hold không chạy trong compose.
- Chưa push lên remote; CI GitHub chưa có kết quả.
