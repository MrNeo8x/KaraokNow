# Work log — KaraokeNow

Nhật ký theo phiên để agent sau (Codex/Claude Code, luồng BE hoặc FE) tiếp tục mà không phải đọc lại lịch sử chat. Mục **"Trạng thái hiện tại"** luôn đứng đầu và được **viết lại** ở cuối mỗi phiên (commit, kiểm chứng, môi trường, việc dở, việc tiếp theo). Nhật ký từng phiên ghi ngay bên dưới, mới nhất trước: phạm vi, commit, kiểm chứng thực tế, quyết định mới, việc dở dang, cảnh báo. Trạng thái task chi tiết vẫn nằm ở `task-board.md`.

## Trạng thái hiện tại (cập nhật 2026-11-28, Luồng FE — sau FE-019/FE-020)

Đọc mục này trước; các mục nhật ký bên dưới là lịch sử.

**Code trên `main`:** `origin/main` = `45a14e2` (đã deploy production: IAM-008/FE-017, BKG-011/AUD-002, OPS-003, FE-012, IAM-007, BKG-010/FE-016, FILE-001/FE-015). **Chưa push** (theo thứ tự; mới nhất: commit IAM-009/IAM-010 Super Admin + kiêm nhiệm, **migration `20261124090000`**, và `ad5fe44` điều khoản công khai): `b558901` BE VEN-004 vị trí chi nhánh (**migration `20261124070000`**), `e23d5ca` FE-011 type từ OpenAPI, `faf337e` FE sinh lại type, `98920cf` BE VEN-005 giờ mở cửa + giờ lẻ 15 phút (**migration `20261124080000`**), `3a677bf` FE-018 địa chỉ/chỉ đường, `5620f76` BE RPT-001 báo cáo, `01b91dd` tài liệu, `a8c42c5` BE RPT-002 rà soát phân quyền dữ liệu báo cáo (không đổi OpenAPI), và commit tài liệu này.

**Kiểm chứng gần nhất:** BE (sau RPT-002) `npm run verify` 71/71 unit + drift OpenAPI/Markdown, `npm run test:e2e` **57/57** (sau IAM-009); migration `20261124070000`, `20261124080000` up → down → up trên Postgres 17 tạm; benchmark sau BKG-011 đạt (tìm phòng p95 24,5 ms, tranh chấp 175 ms). FE (sau FE-018) unit 58/58, `next build`, `npm run e2e` 206/206 (trên backend có VEN-004, chưa có VEN-005/RPT-001/RPT-002).

**Môi trường local** (`be/compose.yaml`): Postgres `:5433` **30 migration** (đến `20261124080000_branch_opening_hours`); backend `:3000` chạy `a8c42c5`, `AUTH_COOKIE_SECURE=false`; file upload ở `/app/.storage` trong container (mất khi rebuild); `/v1/health/jobs` local 503 vì worker tắt (bình thường). Đã seed UAT; `uat.owner` thuộc >30 merchant thử do e2e tạo.

**Production (Vercel):** `45a14e2`; **28 migration** (đến `20261124060000_platform_user_management`); Blob đã gắn (OPS-008 `VERIFY`); env BE `CLIENT_IP_HEADER=x-real-ip`, `BLOB_PUBLIC_READ_WRITE_TOKEN`, `BLOB_PRIVATE_READ_WRITE_TOKEN`; `/v1/health/jobs` 200. **Lần push tới: áp trước lên Prisma `20261124070000_branch_location` rồi `20261124080000_branch_opening_hours`** (cột nullable + CHECK, tương thích ngược). Push BE cùng các commit FE đã sinh lại type (FE `types:check` trong CI). Sau deploy: smoke `GET /v1/public/branches` có `address`, `openingTime`, `bookingPolicy`; `GET /v1/merchant/reports/bookings` (Owner) 200, Branch Manager với chi nhánh không được giao 403; Owner MAJESTIC nhập địa chỉ/SĐT/link Google Maps/giờ mở cửa cho `LA_KHE`, `THANH_HA` qua giao diện (không seed). Quy trình: `docs/03-delivery/deploy-vercel.md`.

**Đang dở (working tree):** Luồng BE không có. Luồng FE: không có (FE-019, FE-020 đã commit, `VERIFY`; FE-019 phải deploy sau migration `20261124080000` của VEN-005 trên production). Session triển khai: `deploy-vercel.md`, dòng OPS-008, mục nhật ký deploy chưa commit. `docs/KaraokeNow_Merchant_Feature_Plan.md/.html` không phải của Luồng BE. Không commit hộ.

**Việc tiếp theo**

- *Người dùng / PO:* đăng ký uptime monitor (OPS-009, `deploy-vercel.md` §6a); UAT theo `docs/04-quality/uat-checklist.md` nhóm I–P; xem lại định nghĩa số liệu báo cáo (PD-044); trả lời BKG-008; quyết định có làm sạch email/lý do trong audit cũ trên production (AUD-002/RPT-002 chỉ sửa từ nay).
- *Session triển khai:* migrate `20261124070000` + `20261124080000` + `20261124090000` → push → đặt Super Admin đầu tiên theo chỉ định của người dùng → smoke như trên.
- *Luồng FE:* không còn task FE `READY`. Theo dõi hai bước e2e không ổn định (`staff.mjs` hold trên lịch, `session.mjs` đổi merchant); QA-003/UAT cho màn báo cáo với dữ liệu nhiều kỳ và mobile.
- *Luồng BE:* BKG-008 khi có PO; OPS-002 (cần quyền Prisma production); IAM-004 khi có ZBS; Redis `redis-byzantium-mirror` chỉ khi có số đo cần cache (ứng viên: báo cáo nếu chậm).

**Không làm khi chưa có quyết định:** thanh toán online, tính tiền overtime hoặc gia hạn giờ, tự động hoàn tiền/no-show, Zalo/Messenger, video/tệp khác ngoài ảnh và PDF, bản đồ nhúng hoặc chọn ghim (cần API key), danh mục tỉnh/phường.

---

## 2026-11-28 — Session triển khai: deploy VEN-004/005, FE-011/018/019/020, RPT-001/002

- Áp lên Prisma **trước** push: `20261124070000_branch_location`, `20261124080000_branch_opening_hours` (cột nullable + CHECK chấp nhận NULL — tương thích ngược); `20261124060000` đã có từ lần trước. Production 30 migration (local cũng 30).
- Kiểm tra worktree sạch tại `d76ad76` (HEAD đổi nhiều lần trong lúc kiểm — luôn kiểm lại commit mới trước push): BE verify 71/71, E2E 55/55; FE 67/67, `types:check` khớp, `tsc`, `build`. Ở `98920cf` FE `types:check` từng lệch (CI sẽ đỏ) — `3a677bf` của Luồng FE đã sửa trước khi push.
- Người dùng push 11 commit `b558901`…`d76ad76`; hai project READY `d76ad76`. Smoke: trang/health 200, `/docs` + cron 404, `/v1/health/jobs` 200, báo cáo `merchant/reports/{bookings,occupancy,channels}` và `platform/reports/{overview,merchants}` không auth → 401.
- Chưa: kiểm màn báo cáo/giờ mở cửa/địa chỉ bằng tài khoản thật trên trình duyệt; nhập địa chỉ/SĐT/giờ mở cửa cho 2 chi nhánh Majestic (dữ liệu trong VEN-004). `20261124090000_support_sessions` đang dở chưa commit — phải áp lên production trước lần push chứa nó.

---

## 2026-11-28 — Session triển khai: deploy BKG-011, OPS-003, FE-017/IAM-008

- Theo `deploy-vercel.md`: worktree sạch tại `45a14e2` — BE verify 67/67, E2E 50/50; FE 56/56, `tsc`, `build`. Biến mới `JOB_*_MAX_LAG_MINUTES` tuỳ chọn (mặc định 1560) → không đặt trên Vercel.
- Áp `20261124060000_platform_user_management` lên Prisma **trước** push (bảng `platform_audit_logs`, cột nullable `users.disabled_*`, `platform_admins.granted_by/revoked_by` — tương thích ngược). Production: 28 migration.
- Người dùng push `f5849dc`, `8d420c3`, `45a14e2`; hai project READY `45a14e2`. Smoke: trang/health 200, `/docs` + cron 404, `GET /v1/health/jobs` 200 `status: ok` (hold quá hạn 0, outbox 0, ngưỡng 1560 phút), `/v1/platform/users` không auth → 401; kiểm tra read-only DB: đủ cột/bảng mới.
- Chưa kiểm màn Người dùng bằng tài khoản Platform Admin trên trình duyệt (agent không giữ mật khẩu admin).

---

## 2026-11-28 — Session triển khai: Vercel Blob trên production (OPS-008)

- Gắn hai store Blob vào `vn-karaoke-now-api` (`--prefix BLOB_PUBLIC|BLOB_PRIVATE --auth token --add-rw-token`, production + preview) → `BLOB_PUBLIC_READ_WRITE_TOKEN`, `BLOB_PRIVATE_READ_WRITE_TOKEN` đúng tên code đọc. Thử thật bằng `ObjectStorageService` + token production: ghi/đọc/xoá cả public và private, public qua CDN 200; không để lại file.
- Kiểm tra trên worktree sạch (BE và FE đều có việc dở chưa commit): lần đầu E2E 46 fail và `openapi:check` thoát 1 vì worktree thiếu `be/.env` (gitignore) — copy `.env` local thì pass. Session BE thêm `8029594` (BKG-010, không migration/dependency) giữa chừng → chạy lại BE tại `8029594`: verify 65/65, E2E 46/46.
- Áp `20261124050000_file_storage` lên Prisma trước push (bảng mới, tương thích ngược). Người dùng push 8 commit `560e3e9`…`8029594`; hai project READY. Smoke: trang/health 200, `/docs` + cron 404, route upload ảnh phòng/logo/documents (merchant + platform) không auth → 401, catalog công khai 200.
- Còn lại (OPS-008 → VERIFY): Owner thử upload/xoá ảnh phòng, logo, PDF trên giao diện production. Hai store Blob vẫn gắn cả vào project FE (không dùng).

---

## 2026-11-28 — Luồng BE: Super Admin hỗ trợ merchant (IAM-009, PD-045) và Platform Admin kiêm Owner (IAM-010, PD-046)

- Người dùng: admin cao nhất của Platform xem được tính năng của merchant để hỗ trợ khi lỗi; và Platform Admin có thể kiêm Owner merchant nếu được phân/mời. PO chọn: cấp Super Admin riêng, chỉ xem, lý do + 60 phút + audit hai phía, che một phần SĐT/email → PD-045. Kiêm nhiệm → PD-046 (đã hỗ trợ sẵn, bổ sung E2E).
- Code: migration `20261124090000_support_sessions`; `support-sessions.ts`, `super-admin.guard.ts`, `support-sessions.module.ts`; `TenantGuard` (nhánh phiên hỗ trợ khi không có membership, chặn mọi method khác GET/HEAD); `SupportMaskInterceptor` (APP_INTERCEPTOR); `Actor.support`; `/merchant/me` thêm `readOnly`, `support`; `PlatformUserDto.superAdmin`; cấp/thu hồi Super Admin; Platform sửa thành viên kiểm tra xung đột trước validate. Seed UAT: Platform Admin local là Super Admin.
- Kiểm chứng: unit 73/73, E2E 57/57, migration up → down → up. OPS-002 (backup/diễn tập) tạm dừng để làm yêu cầu này — chưa có file nào.
- Production: migrate trước push; người dùng chỉ định Super Admin đầu tiên. FE-021 `READY`.

---

## 2026-11-28 — Luồng FE: giờ lẻ/giờ mở cửa (FE-019) và màn báo cáo (FE-020)

- Người dùng: "Tiếp FE-019 và các phần khác BE đã xong". Sinh lại `api-types.gen.ts` cho VEN-005, RPT-001 và contract điều khoản công khai (`ad5fe44`).
- FE-019: form chi nhánh có giờ mở/đóng cửa hoặc 24 giờ; trang khách hiện giờ mở cửa, nút giờ theo khung mở cửa (sau 0:00 là "hôm sau", gửi đúng ngày lịch), ô "Giờ khác" bước 15 phút, thời lượng theo `bookingPolicy`, dịch 422 sang tiếng Việt.
- FE-020: mục "Báo cáo" cho Owner/Branch Manager (quyền `reports.view`, Lễ tân/Thu ngân không thấy) với ba tab booking & doanh thu / công suất phòng / kênh, lọc ngày-kỳ-chi nhánh, CSV; mục "Báo cáo" ở `/platform` (snapshot, biểu đồ, bảng merchant 20 dòng + xem tất cả, CSV). Biểu đồ SVG tự viết, không thêm dependency.
- Điều khoản công khai: 404 nay báo "Chi nhánh này hiện không nhận đặt phòng online" thay vì coi là chưa cấu hình.
- Sửa test: `staff.mjs` gọi biến `results` không tồn tại khi một bước fail → script dừng giữa chừng (chỉ in 13 dòng).
- Kiểm chứng: unit 67/67, `tsc`, `types:check`, `next build`. `npm run e2e` lượt đầu: API 66, vị trí 7, giờ mở cửa 11, khách 26, Platform 16, vai trò 28, files 13, user Platform 12, báo cáo 15 đạt; `staff` (bước hold trên lịch) và `session` (đổi merchant) mỗi bộ fail 1 bước, chạy lại sau rebuild cả hai đạt (29/29, 9/9) → tổng **232/232** khi gộp lần chạy lại; hai bước này có dấu hiệu không ổn định, theo dõi thêm.

---

## 2026-11-28 — Luồng BE: hợp nhất contract điều khoản công khai

- Mục treo từ 2026-11-26 trong handoff: endpoint công khai trả 404 khi chưa cấu hình điều khoản, lẫn với 404 "chi nhánh không công khai". Nay trả 200 `configured:false`; 404 chỉ cho chi nhánh không công khai. E2E mới + contract. Unit 71/71, E2E 55/55. OpenAPI thêm mô tả 404 (FE `types:generate`).
- Endpoint chẩn đoán IP (`/v1/internal/diag/client-ip`, bảo vệ bằng `CRON_SECRET`): giữ lại để đo lại khi đổi hạ tầng proxy/CDN — không có trong OpenAPI, sai secret → 404.

---

## 2026-11-28 — Luồng BE: rà soát phân quyền mức dữ liệu của báo cáo/dashboard (RPT-002)

- Người dùng: "rà soát các báo cáo, dashboard đã phân quyền ở mức dữ liệu chưa". Rà mọi route GET tổng hợp: báo cáo merchant/Platform, báo cáo tiền mặt, cọc chưa xử lý, danh sách giữ chỗ/booking theo chi nhánh (lịch lễ tân), thanh toán, audit, backlog, health/metrics.
- Kết luận: đã lọc theo tenant (TenantGuard + `tenant_id` trong mọi truy vấn) và theo chi nhánh được giao cho vai trò không phải Owner. Hai điểm sửa: (1) báo cáo merchant với `branchId` của merchant khác trả 404 thay vì 200 rỗng; (2) audit `HOLD_CREATED` chỉ ghi trường cấu trúc (trước ghi nguyên bản ghi gồm trường SĐT/email — lúc tạo đang rỗng nên chưa lộ). Thêm E2E chứng minh phạm vi Branch Manager/Lễ tân/Thu ngân/sai tenant cho cả 3 báo cáo và CSV.
- Ghi chú không sửa: `/v1/health/jobs` công khai trả số đếm toàn nền tảng (đã chấp nhận ở PD-041); `/v1/metrics` công khai chỉ có số request theo method/status.
- Kiểm chứng: unit 71/71, E2E 54/54. Không đổi OpenAPI, không migration.

---

## 2026-11-28 — Luồng BE: báo cáo và thống kê (RPT-001, PD-044)

- Người dùng: "Bổ sung các màn hình báo cáo và thống kê cho admin". PO chọn cả Owner/quản lý merchant và Platform Admin; đủ bốn nhóm (booking & doanh thu, công suất phòng, kênh & chuyển đổi, tăng trưởng nền tảng); lọc khoảng ngày + chi nhánh, xuất CSV → PD-044 (định nghĩa số liệu ghi trong PD).
- Code: `be/src/reports/` (DTO, service — tiền dùng cùng nhóm với `dailyReport` của PAY-007, ngày địa phương theo múi giờ từng chi nhánh; controller merchant + platform; `csv.ts` có BOM và chống chèn công thức).
- Kiểm chứng: unit 71/71, E2E 53/53 (chi nhánh riêng: 3 booking + 1 giữ chỗ hết hạn → số theo ngày/tháng, tiền 130.000 − 10.000, công suất, heatmap, kênh 0,75, CSV, 422 khoảng sai, Platform 403/200). Không migration.
- FE-020 `READY`.

---

## 2026-11-28 — Luồng FE: địa chỉ, SĐT và chỉ đường cho chi nhánh (FE-018)

- Form chi nhánh có địa chỉ/SĐT/link Google Maps + xem trước vị trí; trang khách có địa chỉ, nút gọi, nút Chỉ đường ở chọn quán, xác nhận, biên nhận, tra cứu. Chi nhánh UAT local được đặt địa chỉ "Số 1 Hàng Bài", SĐT 0989 015 619, toạ độ 21.0285, 105.8542.
- Kiểm chứng: unit 58/58, `next build`; `npm run e2e` **206/206** (backend local rebuild có VEN-004).

---

## 2026-11-28 — Luồng BE: giờ lẻ 15 phút và giờ mở cửa chi nhánh (VEN-005, PD-043)

- Người dùng: "Khi đặt phòng ngoài khung giờ cố định cho phép chọn giờ". Trang khách đang chỉ có nút 09:00…23:00 và thời lượng viết cứng. PO chọn bước 15 phút, giới hạn theo giờ mở cửa chi nhánh, thời lượng theo chính sách merchant → PD-043.
- Code: migration `20261124080000_branch_opening_hours`; `be/src/venue/opening-hours.ts` (`assertPublicStartAllowed`, SQL theo múi giờ chi nhánh, xét khung của ngày đó và ngày trước cho giờ sau nửa đêm); áp ở catalog availability/quote và public hold; branch DTO/service; catalog thêm `openingTime`, `closingTime`, `bookingPolicy`.
- Kiểm chứng: unit 70/70, E2E 52/52 (18:00–02:00: 19:07 → 422, 17:45 → 422, 23:45 và 00:30 → 200, 01:15 + thời lượng vượt 02:00 → 422, offset UTC đúng; giữ chỗ nhân viên 15:10 vẫn 201), migration up → down → up. Các test public cũ vẫn đạt (chi nhánh không đặt giờ = 24 h).
- Lưu ý: FE-011 sinh type từ OpenAPI → FE phải `types:generate`. FE-019 `READY`.

---

## 2026-11-28 — Luồng FE: type từ OpenAPI và kiểm tra drift (FE-011)

- `openapi-typescript` sinh `fe/src/lib/api-types.gen.ts`; `npm run types:check` trong FE CI; `fe/src/lib/api-contract.ts` khẳng định 44 response khớp type FE đang đọc (cả 44 khớp, ca sai cố ý báo đúng 2 lỗi).
- Kiểm chứng: unit 56/56, `tsc`, `next build`. Không đổi hành vi giao diện nên không chạy lại e2e.

---

## 2026-11-28 — Luồng BE: địa chỉ, SĐT và vị trí Google Maps của chi nhánh (VEN-004, PD-042)

- Người dùng: cần vị trí Google Maps ở phần khai báo cơ sở và phần đặt phòng. PO chọn: dán link Google Maps (không API key), khách thấy địa chỉ + nút Chỉ đường, SĐT công khai có nút gọi, địa chỉ một dòng → PD-042 (cũng trả lời câu hỏi treo của VEN-004).
- Code: migration `20261124070000_branch_location`; `be/src/venue/branch-location.ts` (toạ độ từ `!3d…!4d…`, `@lat,lng`, `q/query/destination/ll`, `/search|place|dir/lat,lng`, `consent.google.com?continue=`; link rút gọn theo redirect thủ công tối đa 5 bước, mỗi bước https + host Google, timeout 4 s, không đọc body); DTO/service/controller chi nhánh; catalog công khai.
- Kiểm chứng: unit 70/70 (parser + redirect giả, chặn redirect sang `169.254.169.254`), E2E 51/51, migration up → down → up. Chưa thử link `maps.app.goo.gl` thật (môi trường test không gọi mạng) — kiểm ở UAT N1.
- FE-018 `READY`. Production cần migrate trước push; dữ liệu MAJESTIC nhập qua giao diện.

---

## 2026-11-28 — Luồng FE: quản lý user cho Platform Admin (FE-017)

- Mục Người dùng ở `/platform`, chi tiết user với các thao tác có lý do (hộp thoại `<dialog>`), mật khẩu tạm hiện một lần; Thành viên theo merchant. Thông báo lỗi PD-040 dịch sang tiếng Việt.
- Kiểm chứng: unit 56/56, `next build`; `npm run e2e` **195/195** (API 66, khách 22, lễ tân 29, Platform 16, vai trò 28, files 13, phiên 9, quản lý user 12); backend local rebuild lúc bắt đầu FE-017 từ code có IAM-008 (trước BKG-011/OPS-003).

---

## 2026-11-28 — Luồng BE: giám sát job nền (OPS-003, PD-041)

- PO chọn cảnh báo bằng dịch vụ uptime miễn phí. `GET /v1/health/jobs` (công khai, chỉ số đếm/tuổi, `no-store`): 200 khi ổn, 503 khi hold quá hạn lâu nhất hoặc outbox chờ lâu nhất vượt ngưỡng (mặc định 1560 phút vì cron Hobby chạy hằng ngày) hoặc có outbox `DEAD`. Ngưỡng chỉnh bằng `JOB_HOLD_EXPIRY_MAX_LAG_MINUTES`, `JOB_OUTBOX_MAX_LAG_MINUTES`.
- Kiểm chứng: unit 67/67, E2E 50/50 (200/503 theo hold quá hạn 2 ngày, contract cả hai mã). Không migration.
- Local: worker tắt nên DB local có thể trả 503 — bình thường. OPS-009 (người dùng đăng ký monitor) `READY`.

---

## 2026-11-28 — Luồng BE: giữ chỗ quá hạn chặn phòng (BKG-011) và audit không PII (AUD-002)

- Khi xem OPS-003 phát hiện lỗi production: Vercel Hobby chạy cron `hold-expiry` mỗi ngày một lần, còn hold chỉ được dọn khi request chạm đúng hold đó. Hold khách bỏ dở vẫn giữ occupancy `HELD` → tìm phòng báo bận và giữ chỗ mới (khách lẫn nhân viên) cùng khung bị 409 tới ~24 h.
- Sửa: `be/src/availability/occupancy-lock.ts` — `lockRoomOccupancy` sau khi lấy khoá phòng gọi `releaseOverdueHolds` (EXPIRED + RELEASED + audit `HOLD_EXPIRED`, `FOR UPDATE SKIP LOCKED`); `HoldService.expireById` dùng chung `expireOverdueHold`; `availability-search.service.ts` bỏ qua occupancy HELD của hold quá hạn. E2E BKG-011 fail khi bỏ bản sửa, pass khi có. Benchmark: tìm phòng p95 24,5 ms, tranh chấp 175 ms — đạt.
- AUD-002: audit membership bỏ email/tên; audit khoá phòng bỏ lý do tự do (cờ `reasonChanged`). Bản ghi cũ còn nguyên — hỏi PO nếu muốn làm sạch.
- Kiểm chứng: unit 67/67, E2E 49/49, benchmark đạt. Không migration.
- OPS-003 chưa làm (cần chọn cách cảnh báo trên Vercel).

---

## 2026-11-28 — Luồng FE: giữ phiên qua F5 và chọn merchant (FE-012)

- Refresh token chỉ trong cookie HttpOnly; khôi phục phiên khi tải trang, hẹn giờ refresh và đăng xuất qua cookie; danh sách chọn merchant (`/v1/me/tenants`), nhớ merchant gần nhất.
- FE-015 chuyển `VERIFY`: `files.mjs` 13/13 sau bản sửa `sendFile` của BE.
- Kiểm chứng: unit 54/54, `tsc`; `session.mjs` 9/9, `platform-role.mjs` 16/16, `files.mjs` 13/13, `roles.mjs` 28/28, `api-smoke.mjs` 66/66, `customer.mjs` 22/22, `staff.mjs` 29/29 (chạy riêng). Bộ e2e cũ chấp nhận lỗi console 401 của lần thử khôi phục phiên khi chưa đăng nhập.
---

## 2026-11-28 — Luồng BE: quản lý user của Platform Admin (IAM-008, PD-040)

- Người dùng: "Admin nền tảng chưa có tính năng quản lý user". PO chọn đủ bốn nhóm (tìm/xem, khoá/mở khoá, mật khẩu tạm, cấp/thu hồi Platform Admin) và cho Platform Admin **sửa** thành viên merchant → PD-040.
- Code: `be/src/platform-users/` (service, controller, DTO); `MembershipService` thêm hook `start`/`beforeCommit` để kiểm tra (khoá theo merchant, ≥ 1 Owner, admin không thuộc merchant) và ghi audit trong cùng transaction. Migration `20261124060000_platform_user_management`: `platform_audit_logs` (audit_logs bắt buộc tenant nên không dùng được), `users.disabled_at/by/reason`, `platform_admins.granted_by/revoked_by`.
- Bảo vệ: không tự khoá/tự đặt mật khẩu tạm/tự thu hồi admin; mật khẩu tạm 16 ký tự dễ đọc, `Cache-Control: no-store`, không vào audit; khoá user thu hồi mọi phiên (AuthGuard kiểm phiên + trạng thái nên có hiệu lực ngay).
- Kiểm chứng: unit 67/67, E2E 48/48, migration up → down → up trên Postgres 17 tạm.
- Ghi chú: audit `MEMBERSHIP_CREATED` có sẵn từ trước vẫn chứa email (lệch quy tắc "audit không PII") — chưa sửa, để task riêng nếu PO muốn.
- Production đã có `84aa397` (gồm BKG-010 + FE-016 cùng lần, IAM-007). IAM-008 cần migrate trước push. FE-017 `READY`.

---

## 2026-11-28 — Luồng FE: ảnh/logo/giấy tờ (FE-015) và mã đặt phòng 6 ký tự (FE-016)

- FE-016 (`VERIFY`): mã 6 ký tự PD-038 trên trang khách, vẫn nhận mã cũ 32 hex; phải deploy cùng BKG-010.
- FE-015 (`BLOCKED` chờ BE): thư viện ảnh phòng có nén trên trình duyệt (5,1 MB → 276 KB, xoá EXIF), logo (Marketplace, sidebar, `/booking`), giấy tờ PDF (Owner, Platform Admin), fallback khi ảnh lỗi. Kho local của BE trả 500 khi phục vụ file (`sendFile` + thư mục `.storage`) — đã ghi yêu cầu trong handoff.
- Kiểm chứng: FE unit 51/51, `next build`; `npm run e2e`: API 66/66, khách 22/22, lễ tân 29/29, Platform 16/16, vai trò 28/28, `files.mjs` 10/13 (3 bước hiển thị ảnh chờ BE).

---

## 2026-11-28 — Luồng BE: giữ phiên qua F5 (IAM-007, PD-039) và sửa lỗi phục vụ file local

- Người dùng báo "đăng nhập xong F5 là phải đăng nhập lại": đúng thiết kế cũ (phiên chỉ trong bộ nhớ, FE-012 `BACKLOG`). PO chọn cookie HttpOnly + danh sách merchant tự chọn → PD-039.
- Code: `be/src/platform/auth/refresh-cookie.ts`, `auth.controller.ts` (cookie `kn_refresh`, header `X-KN-Session: 1`), `auth.service.ts` (cửa sổ 10 s cho refresh trùng giữa các tab, chỉ ở chế độ cookie), `be/src/membership/my-tenants.controller.ts` (`GET /v1/me/tenants`). `compose.yaml` đặt `AUTH_COOKIE_SECURE=false` cho stack HTTP local. Không migration.
- Sửa lỗi FILE-001 do Luồng FE báo: thư mục mặc định `be/.storage` có dấu chấm → express `send` từ chối → 500. `sendFile(..., { dotfiles: 'allow' })`, lỗi → 404; E2E giờ dùng thư mục `.storage` (đã thấy test fail khi bỏ bản sửa).
- Redis `redis-byzantium-mirror`: người dùng cho phép dùng khi cần; **chưa cần** (ghi ở `deploy-vercel.md` §10).
- Kiểm chứng: unit 67/67, E2E 47/47, OpenAPI/Markdown sinh lại. Chưa rebuild container local. FE-012 → `READY`.

---

## 2026-11-28 — Session triển khai: merchant thật Karaoke Majestic (local + production)

- Nguồn: danh thiếp `docs/merchaint/img.png`. Tạo merchant `MAJESTIC` "Karaoke Majestic" + chi nhánh `LA_KHE` "Karaoke Majestic La Khê", `THANH_HA` "Karaoke Majestic Thanh Hà" (`Asia/Ho_Chi_Minh`, ACTIVE), chưa có phòng/giá, chưa xin công khai.
- Cách tạo: script một lần (không commit) gọi `MerchantOnboardingService.create` và `VenueService.createBranch` với DTO đã validate — cùng logic, khoá và audit như API (`MERCHANT_CREATED`, 2× `BRANCH_CREATED`). Actor: production = Platform Admin của người dùng; local = Platform Admin UAT. Owner (người dùng chọn): tài khoản Platform Admin thứ hai — production dùng tài khoản sẵn có (không đổi mật khẩu); local tạo tài khoản mới với mật khẩu tạm, bắt đổi khi đăng nhập (đã kiểm: login 200, `/merchant/me` 403 "Password change is required").
- Địa chỉ/SĐT chi nhánh chưa có chỗ lưu → task VEN-004 (BLOCKED chờ PO), dữ liệu ghi sẵn trong task.

---

## 2026-11-28 — Session triển khai: đo IP khách trên production (OPS-007)

- Theo `ops-007-client-ip-runbook.md` + `deploy-vercel.md`: kiểm tra tại HEAD `44a388e` (BE verify 57/57, E2E 45/45; FE 42/42, `tsc`, `build` trên worktree sạch); áp `20261124040000_cash_reconciliation` lên Prisma **trước** push; người dùng push `main` (5 commit `4af700b`…`44a388e`); hai project READY; smoke 200, `/docs`, cron và diag không secret → 404.
- `CRON_SECRET` là biến sensitive, `vercel env pull` không trả giá trị thật → đã **đổi giá trị** (`vercel env update`, production + preview) để gọi endpoint chẩn đoán; giá trị mới không lưu ngoài Vercel. Cron với secret mới → 200.
- Kết quả đo (IP máy đo che bớt: 58.186.x.x): trước cấu hình `req.ip`=`127.0.0.1` mọi đường → mọi khách chung hạn mức. `x-real-ip`, `x-vercel-forwarded-for`, `x-forwarded-for` = IP máy đo cả trực tiếp BE lẫn qua FE rewrite; header giả `1.2.3.4` bị Vercel ghi đè (trừ `cf-connecting-ip`).
- Áp: `CLIENT_IP_HEADER=x-real-ip` cho `vn-karaoke-now-api` (production + preview), `vercel redeploy` bản production `44a388e`. Kiểm lại 4 ca → `{ip: IP thật, source: platform-header}`. Không cần FE, không dùng `CLIENT_IP_PROXY_SECRET`/`TRUST_PROXY_HOPS`.
- Endpoint chẩn đoán vẫn còn (bảo vệ bằng `CRON_SECRET`); Luồng BE quyết định giữ hay gỡ.

---

## 2026-11-28 — Luồng FE: đối soát tiền mặt (FE-014)

- Tài khoản tiền trên mỗi booking (phải thu/đã thu/số dư/giữ lại, sổ tiền, phụ thu, thu tiền mặt, đảo bút toán), đảo cọc trên hold, mục **Tiền mặt** (báo cáo cuối ngày, cọc chờ xử lý). Quyền theo PD-036 qua `/me`.
- Kiểm chứng: FE unit 46/46, `npm run e2e` 157/157; audit local có `BOOKING_SURCHARGE_ADDED`, `MONEY_REVERSED`, `HOLD_DEPOSIT_RESOLVED` từ lượt chạy giao diện. Ảnh review: `docs/deg/fe-review/*-cash.png`, `*-booking-account.png`.
- Sửa trình bày: số tiền dùng khoảng trắng không ngắt trước "₫" và không hiện "−0 ₫" ở màn tiền mặt.
---

## 2026-11-28 — Triển khai Vercel + Prisma Postgres (OPS-006)

- Vercel (tài khoản Hobby): `vn-karaoke-now` → https://vn-karaoke-now.vercel.app (root `fe`, Next.js, `BACKEND_API_ORIGIN=https://vn-karaoke-now-api.vercel.app`); `vn-karaoke-now-api` → https://vn-karaoke-now-api.vercel.app (root `be`, NestJS). Cả hai nối GitHub `MrNeo8x/KaraokNow`, nhánh `main` → push là deploy production.
- Database: Prisma Postgres `prisma-postgres-cerulean-drawer` (PostgreSQL 17.2, có `btree_gist`) gắn vào cả hai project; BE dùng `DATABASE_URL` (trực tiếp `db.prisma.io:5432`, SSL). Đã chạy `db:migrate` từ máy (25 migration). **Không seed** (production). Env BE: `JWT_SECRET`, `CRON_SECRET` (ngẫu nhiên, sensitive), `SWAGGER_ENABLED=false`, `PG_POOL_MAX=5`.
- Code: `be/src/jobs/` (cron thay worker liên tục; file đã lọt vào commit `617198a` của Luồng BE), `be/vercel.json` (cron 1 lần/ngày — Hobby không cho chạy dày hơn; hold vẫn hết hạn khi có request chạm vào), hạ `@nestjs/config` xuống 4.0.4 vì bản 12 thuần ESM làm function crash `ERR_REQUIRE_ESM` trên Vercel.
- Kiểm chứng: `npm run verify` 52/52, `npm run test:e2e` 43/43; production: `/v1/health/live|ready` 200 (trực tiếp và qua rewrite FE), `/docs` 404, cron thiếu/sai secret 404, login sai 401, `/`, `/booking`, `/merchant`, `/platform` 200.
- Còn lại: tạo Platform Admin đầu tiên trên production (DB trống); OPS-007 xác minh IP khách để đặt `TRUST_PROXY_HOPS`; project FE cũng đang nhận biến DB do Prisma gắn (FE không dùng, có thể gỡ); cập nhật mục "Trạng thái hiện tại" khi luồng FE commit xong.

---

## 2026-11-28 — Luồng BE: mã đặt phòng 6 ký tự (BKG-010, PD-038)

- Người dùng yêu cầu mã ngắn, dễ nhớ: 6 ký tự gồm số và chữ in hoa. Chọn bảng 32 ký tự bỏ 0/O/1/I (tránh đọc nhầm) — ~1,07 tỉ mã; tra cứu vẫn cần SĐT + mã và giới hạn 10 lần/15 phút mỗi SĐT, nên đoán mã không khả thi. Ghi PD-038.
- `be/src/booking/booking-code.ts`: mã suy ra từ hold id bằng HMAC (`JWT_SECRET`), replay trả cùng mã, DB chỉ lưu HMAC của mã; khi tạo hold, nếu mã trùng với hold khác cùng SĐT thì sinh hold id mới (tối đa 5 lần). Tra cứu chuẩn hoá (hoa/thường, khoảng trắng, gạch); mã 32 hex cũ vẫn dùng SHA-256 như trước → khách đã có mã cũ không bị ảnh hưởng. Không migration.
- Kiểm chứng: unit 65/65, E2E 46/46 (định dạng mã, tra cứu chữ thường có gạch, 400 khi chứa `O`, mã cũ vẫn tra được), OpenAPI/Markdown sinh lại.
- **Phá vỡ FE**: `cleanBookingCode` ở FE chỉ nhận 32 hex → FE-016 `READY`, phải deploy cùng lần. Chưa rebuild container local.

---

## 2026-11-28 — Luồng BE: rebuild backend local sau FILE-001

- `npm run db:migrate` áp `20261124050000_file_storage` vào Postgres `:5433`; `docker compose up -d --build backend` → `1205321`, `/v1/health/ready` 200, Swagger có `media/upload`, `/v1/files/public/…` 404 cho file không tồn tại.
- Container không có biến `BLOB_*` → backend LOCAL, thư mục `/app/.storage` (ghi được, mất khi rebuild). Muốn giữ file local qua các lần rebuild thì thêm volume cho `STORAGE_LOCAL_DIR` — chưa làm.
- Chưa chạy lại E2E FE trên container này.

---

## 2026-11-28 — Luồng BE: lưu ảnh và giấy tờ trên Vercel Blob (FILE-001, PD-037)

- PO chốt PD-037: Vercel Blob gói Hobby; upload qua BE (FE nén ảnh), ≤ 4 MB; store public `vn-karaoke-now-blob-pub` (ảnh phòng ≤ 10/phòng, logo merchant), store private `vn-karaoke-now-blob-pri` (PDF của merchant ≤ 10, Owner tải/xoá, Owner + Platform Admin xem). Người dùng đã tạo sẵn cả hai store.
- Tài liệu Vercel (đọc 2026-11-28): Hobby 1 GB, 10 GB băng thông, 2.000 thao tác ghi/tháng; vượt → khoá 30 ngày, không tính tiền; function body ≤ 4,5 MB; đọc private bằng `get(pathname, { access: 'private', token })`; hai store trên một project phải truyền `token` từng lệnh. `@vercel/blob` 2.9.0 có bản CommonJS — ghim chính xác.
- Code: `be/src/platform/storage/` (service chọn Vercel Blob/thư mục local, magic bytes, route `/v1/files/public/*` cho local), `be/src/catalog/merchant-logo.ts`, `be/src/merchant-documents/`, upload ảnh trong `venue`; migration `20261124050000_file_storage` (up → down → up đã kiểm). Trên Vercel thiếu token → 503, không ghi đĩa function.
- Kiểm chứng: unit 62/62, E2E 46/46.
- Chưa có trên production: OPS-008 giao session triển khai (nối store với read-write token, migrate, push, smoke). FE-015 `READY` cho màn upload.

---

## 2026-11-28 — Luồng BE: IP khách cho giới hạn theo IP (OPS-007, phần code)

- Bối cảnh: production chạy trình duyệt → FE Vercel → Next.js rewrite → BE Vercel, preset NestJS của Vercel chạy `src/main.ts`; production chưa đặt `TRUST_PROXY_HOPS` nên `req.ip` là địa chỉ nội bộ — nhiều khả năng mọi khách đang chung một hạn mức giữ chỗ (20/15 phút) và tra cứu (60/15 phút).
- `be/src/platform/http/client-ip.ts` + unit test; `public-booking.controller.ts` dùng `resolveClientIp`; env `CLIENT_IP_HEADER`, `CLIENT_IP_PROXY_SECRET` (kiểm tra khi khởi động, `.env.example`); chẩn đoán `GET /v1/internal/diag/client-ip` (`be/src/operations/client-ip-diag.controller.ts`, guard `CRON_SECRET` dùng lại từ `be/src/jobs/`).
- Kiểm chứng: unit 57/57, E2E 45/45.
- **Chưa làm trên production** — người dùng giao session triển khai, runbook `docs/03-delivery/ops-007-client-ip-runbook.md` (production có 25 migration, chỉ thiếu `20261124040000`): máy này không có Vercel CLI và không có `DATABASE_URL` production; `main` local đi trước `origin` nhiều commit (gồm PAY-007 cần migration `20261124040000`) — push trước khi migrate sẽ làm lỗi API cọc. Quy trình bắt buộc ở `docs/03-delivery/deploy-vercel.md` (đang được session triển khai viết, chưa commit). Session triển khai cần cập nhật dòng `TRUST_PROXY_HOPS`/`CLIENT_IP_HEADER` trong tài liệu đó sau khi đo.

---

## 2026-11-28 — Luồng BE: rebuild backend local sau PAY-007

- `npm run db:migrate` áp `20261124040000_cash_reconciliation`; `docker compose up -d --build backend` (healthy), frontend/PostgreSQL giữ nguyên.
- Smoke (chỉ đọc, tài khoản seed UAT): Thu ngân `cash-report` và `unresolved-deposits` 200; Lễ tân `cash-report` và `money-reversals` 403; `bookings/{id}/account` trả due/paid/settlement; overtime-policy 200.

---

## 2026-11-28 — Luồng BE: đối soát tiền mặt (PAY-007, PD-036)

- PO chốt PD-036 (phải thu = giá + phụ thu; đã thu ròng sau đảo; hủy/no-show phải thu 0; đảo toàn phần có lý do; cọc hold hết hạn do Owner/Quản lý ghi hoàn/giữ; báo cáo ngày theo chi nhánh, chưa mở/đóng ca). Phụ thu: Owner, Quản lý, Lễ tân, Thu ngân.
- Migration `20261124040000_cash_reconciliation` (up → down → up đã kiểm). `be/src/booking/cash-ledger.{dto,service,controller}.ts`: 6 endpoint (account, surcharges, money-reversals, unresolved-deposits, deposit-resolution, cash-report). `HoldService.expireById` mở public để xử lý cọc của hold quá hạn chưa được đánh dấu.
- Thay đổi hành vi: tổng cọc trên hold, điều kiện đủ cọc khi xác nhận và giới hạn tiền hoàn khi hủy nay **trừ khoản đã đảo**; mỗi khoản cọc có `reversed`.
- Kiểm chứng: unit 52/52, E2E 44/44 (kịch bản PAY-007 đối chiếu contract OpenAPI).
- **Sự cố staging:** commit API-004 `617198a` của Luồng BE dùng `git add be/` nên gom nhầm `be/src/jobs/*` và phần đăng ký trong `be/src/app.module.ts` của session triển khai (OPS-006). Session đó đã ghi nhận và commit tiếp (`73deaec`); không viết lại lịch sử. Từ nay Luồng BE stage đúng từng file (đã ghi vào `AGENTS.md`).

---

## 2026-11-28 — Luồng BE: PO chốt các giả định (PD-032…PD-035)

- PD-032 Thu ngân giữ quyền đọc SĐT/email khách ở hold/booking chi nhánh được cấp; PD-033 quy tắc cọc (FIXED tối đa bằng tổng, PERCENT làm tròn lên đến đồng, không ghi vượt); PD-034 overtime quá ân hạn tính toàn bộ phút trễ; PD-035 publish lại giữ trạng thái đã duyệt. Cả bốn xác nhận cách đang cài — **không đổi code**.
- Đã gỡ nhãn "giả định chờ PO" trong decision log (PD-030), RBAC matrix, handoff, checklist UAT (B1, D2, E3), task board.

---

## 2026-11-28 — Luồng BE: response schema OpenAPI đầy đủ và kiểm thử contract (API-004)

- Thêm response DTO cho 43 operation còn thiếu (`venue-response.dto.ts`, `membership-response.dto.ts`, `audit-response.dto.ts`, `pricing-response.dto.ts`, `RoomBlockResponseDto`, `AvailabilityPolicyResponseDto`, `SessionResponseDto`, health); `/v1/metrics` khai báo `text/plain`. Nay 102/102 operation có schema.
- Phát hiện nhờ test contract: 24 property `string|null`/`number|null` thiếu `type` nên Swagger sinh thành `object` (vd. `HoldResponseDto.customerPhone`) — đã thêm `type`. Bẫy đã ghi vào `AGENTS.md`.
- `be/test/openapi-contract.ts`: validator tối giản (`$ref`, `allOf`, `nullable`, `required`, enum, uuid/date-time/date, chặn trường không khai báo). Không thêm `ajv` vì lệnh cài devDependency bị chặn ở môi trường này; ajv chỉ có sẵn gián tiếp qua `@nestjs/cli`. Đã thử validator bắt đủ 5 loại lỗi.
- Kiểm chứng: unit 47/47, E2E 43/43 (test contract mới), `npm run verify` (OpenAPI/Markdown khớp).

---

## 2026-11-28 — Luồng BE: giới hạn pool/timeout PostgreSQL (OPS-004)

- `be/src/platform/database/pool-config.ts`: biến `PG_POOL_MAX`, `PG_CONNECTION_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`, `PG_LOCK_TIMEOUT_MS`, `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` (mặc định 10 / 5 s / 30 s / 15 s / 5 s / 60 s), kiểm tra trong `env.validation.ts`, ghi trong `.env.example`. Trước đây chờ kết nối, câu lệnh, chờ khoá và transaction bỏ dở đều không có giới hạn.
- `ApiExceptionFilter`: `55P03` (hết chờ khoá) → 409 thử lại; `57014` (hết thời gian câu lệnh) và hết chờ kết nối pool → 503 "The service is temporarily busy; retry shortly".
- Script benchmark: luôn dọn dẹp app/pool/container trong `finally` (trước đây treo nếu ghi file kết quả lỗi) và tự tạo thư mục output.
- Kiểm chứng: unit 47/47, E2E 42/42 (giá trị áp vào phiên PostgreSQL; lock chờ 5 s → 409 rồi gửi lại 201), benchmark sau thay đổi đạt mục tiêu, 0 chồng lấn, 10/10 vòng một người thắng. Backend container local **chưa** rebuild với OPS-004.
- Không có yêu cầu mới từ FE: API-003 và OPS-005 đã được FE tích hợp (`cd3cd4a`, e2e 138/138); REC-003 FE đang làm không cần API mới.

---

## 2026-11-28 — Luồng FE: lịch lễ tân hợp nhất (REC-003)

- Timeline theo phòng ghép hold + booking (bỏ hold `CONFIRMED`), cửa sổ 06:00 → 06:00 theo múi giờ chi nhánh, buffer dọn phòng gạch chéo, vạch giờ hiện tại, chế độ danh sách, bộ lọc hủy/no-show/hết hạn, chi tiết khi bấm; giá trị thời gian chỉ tính trên trình duyệt (tránh lỗi prerender đã gặp ở `/booking`).
- Kiểm chứng: FE unit 42/42 (+4 `reception-calendar`), `npm run e2e` 142/142 (`staff.mjs` +4 bước lịch). Ảnh review: `docs/deg/fe-review/d-calendar.png`, `m-calendar.png`.
- Phiên FE trước (2026-11-26/27, commit `cd3cd4a`): FE-013, ẩn thao tác theo `/me`, `roles.mjs`, sửa lỗi prerender ngày/giờ ở `/booking` (UI giữ giá trị lúc build sau hydrate), README theo OPS-005. Chi tiết trong handoff (FE INTEGRATED API-003/OPS-005, FE ROLE TEST).

---

## 2026-11-26 (23:50) — Luồng BE: xử lý yêu cầu từ FE ROLE TEST (API-003) và OPS-005

- **Hold WEB:** `GET /merchant/booking/holds/{id}` trả `publicAcceptedTerms`/`publicAcceptedTermsVersion` — yêu cầu này đã có trong handoff từ commit FE `221c6d8` nhưng Luồng BE bỏ sót ở các lượt trước; nay Lễ tân xác nhận được hold WEB (E2E).
- **Thu ngân:** thêm CASHIER vào bốn endpoint đọc hold/booking (theo chi nhánh được cấp). Ghi chú trong RBAC matrix: cần PO/bảo mật xem lại nếu Thu ngân không được thấy SĐT khách.
- **`GET /v1/merchant/me`** (`be/src/membership/merchant-me.controller.ts`).
- **OPS-005:** `be/Dockerfile` target `tools`; compose service `migrate` (profile `tools`), `hold-expiry-worker`, `outbox-worker` (profile `workers`); `SWAGGER_ENABLED` (+ kiểm tra env, unit test, `.env.example`).
- Kiểm chứng: unit 43/43, E2E 41/41; migrate trong container ("No migrations to run"), hai worker khởi động và dừng sạch rồi đã tắt; `SWAGGER_ENABLED=false` → `/docs` 404.
- **Sự cố và khôi phục:** script Python của Luồng BE dùng `open(p,'w').write(f(open(p).read()))` nên xoá trắng `docs/03-delivery/fe-backend-handoff.md` trong working tree (gồm phần FE chưa commit). Đã khôi phục từ HEAD + nguyên văn diff FE đọc được ngay trước đó (17 dòng: FE INTEGRATED, FE ROLE TEST, Yêu cầu BE — triển khai). **Luồng FE nên kiểm lại các mục này trong handoff.** Đã thêm cảnh báo vào `AGENTS.md`.

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

### Giả định đang chờ PO xác nhận (đã chốt 2026-11-28: PD-033, PD-035; xem thêm PD-032, PD-034)

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
