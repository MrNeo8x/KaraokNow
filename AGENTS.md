# KaraokeNow — hướng dẫn cho agent (Codex / Claude Code)

Đọc file này trước khi làm bất kỳ việc gì. `fe/AGENTS.md` bổ sung quy tắc riêng cho Next.js trong `fe/`.

## Bắt đầu một phiên

1. `git status --short` và `git log --oneline -10`. Working tree có thể chứa thay đổi **chưa commit của session khác** (BE và FE chạy song song trên cùng thư mục) — không revert, không commit hộ.
2. Đọc theo thứ tự:
   - `docs/03-delivery/work-log.md` — mục "Trạng thái hiện tại" ở đầu file (commit, môi trường, việc dở, việc tiếp theo), rồi nhật ký các phiên.
   - `docs/03-delivery/task-board.md` — nguồn sự thật về trạng thái task và hàng đợi tiếp theo.
   - `docs/03-delivery/fe-backend-handoff.md` — contract BE→FE (marker `FE READY` / `FE INTEGRATED`).
   - `docs/00-product/decision-log.md` — quyết định PO đã duyệt (PD-xxx, UAT-PD-xxx). **Không tự suy ra quyết định sản phẩm**; nếu thiếu, hỏi người dùng rồi ghi PD mới.
3. Nếu phiên trước bị ngắt (ví dụ hết usage limit), đối chiếu code với tài liệu và chạy lại verify trước khi tin trạng thái "DONE".

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `be/` | NestJS 11 + TypeScript, `pg` thuần (SQL viết tay, không ORM), migrations `node-pg-migrate` (`be/migrations/*.cjs`), E2E Testcontainers trong `be/test/venue.e2e-spec.ts` |
| `fe/` | Next.js (phiên bản mới, xem `fe/AGENTS.md`), gọi BE qua HTTPS/OpenAPI; không truy cập PostgreSQL |
| `docs/` | Sản phẩm, kiến trúc, delivery, quality. `docs/02-architecture/openapi.json` và `api-reference.md` là **file sinh tự động** |

## Hai luồng làm việc song song

- **Luồng BE** chỉ sửa `be/` và tài liệu; **Luồng FE** chỉ sửa `fe/` và tài liệu. Không sửa chồng code của luồng kia.
- BE xong một contract → thêm mục `## FE READY — <tên> (<task>, <ngày>)` trong handoff (endpoint, body, response, mã lỗi, quyền, lưu ý). FE nối xong → thêm `### FE INTEGRATED — …`.
- `task-board.md` và `fe-backend-handoff.md` bị cả hai luồng sửa. Khi commit, **chỉ stage phần của mình**: lưu diff của luồng kia (`git diff -- <file> > other.patch`), tạo bản tạm đã `patch -R`, rồi `git update-index --cacheinfo` bản đó. Kiểm tra `git diff --cached` không chứa hunk của luồng kia.
- Khi thêm dòng mới vào bảng task board, tránh sửa dòng luồng kia đang sửa; thêm dòng mới ở cuối bảng nếu cần.

## Lệnh

Node 26 (Homebrew): `export PATH=/opt/homebrew/opt/node@26/bin:$PATH`. CI dùng Node 24.

```bash
cd be
npm run verify            # build + unit + OpenAPI drift + API Markdown drift (bắt buộc trước commit)
npm run test:e2e          # PostgreSQL Testcontainers, cần Docker đang chạy (~15s)
npm run openapi:generate && npm run api:docs   # sau mọi thay đổi controller/DTO
npm run db:migrate        # áp migration vào Postgres compose (localhost:5433, từ .env)
npm run db:seed:uat       # merchant UAT (đủ 4 vai trò) + UAT2 (chờ duyệt) + Platform Admin; xem docs/04-quality/uat-checklist.md

cd fe
npm test && npx tsc --noEmit && npm run build
```

Stack Docker UAT (`be/compose.yaml`): Postgres `:5433`, backend `:3000` (Swagger `/docs`, tắt bằng `SWAGGER_ENABLED=false`), frontend `:3100`. **Container backend không tự chạy migration** — chạy `npm run db:migrate` từ host hoặc `docker compose --profile tools run --rm migrate` trước `docker compose up -d --build backend`. Worker chỉ chạy khi bật `docker compose --profile workers up -d` (hoặc `npm run holds:expire` / `npm run outbox:work` từ host); nếu không, hold chỉ hết hạn khi có request chạm vào nó.

## Quy ước backend

- Mọi API merchant: `AuthGuard` → `TenantGuard` (header `X-Tenant-ID`, kiểm membership) → `RolesGuard` + `@RequireRoles`. Role phạm vi chi nhánh phải kiểm `actor.branchIds` (Owner thấy mọi chi nhánh). API Platform: `AuthGuard` → `PlatformAdminGuard`, không dùng `X-Tenant-ID`. API public: không auth, chỉ thấy merchant `published && platform_approved`.
- Mutation: một transaction; khoá dòng `FOR UPDATE` hoặc `pg_advisory_xact_lock(hashtextextended(...))`; ghi `audit_logs` trong cùng transaction. **Audit không chứa PII hay ghi chú tự do** (SĐT, email, mật khẩu, booking code, note).
- Lệnh tạo tiền/booking dùng header `Idempotency-Key` (ASCII 1–100) + `request_hash`; replay cùng body trả cùng kết quả, body khác trả 409.
- Tiền là chuỗi số nguyên VND, xử lý bằng `BigInt`. Thời gian nhận vào phải có múi giờ tường minh.
- Snapshot bất biến: giá + chính sách cọc chụp khi gắn thông tin khách/tạo public hold; điều khoản hủy chụp khi xác nhận. Đổi chính sách sau đó không ảnh hưởng hold/booking đã có.
- Occupancy: `room_occupancy` với `tstzrange [)` và exclusion GiST trên trạng thái `HELD/CONFIRMED/IN_USE/MAINTENANCE`; buffer dọn phòng cộng **sau** giờ kết thúc (PD-024).
- Migration mới: `be/migrations/<YYYYMMDDHHMMSS>_<tên>.cjs`, có `down`. Kiểm up → down → up trên Postgres tạm khi thêm/sửa ràng buộc.
- Sau khi đổi API: regenerate OpenAPI + Markdown, cập nhật `rbac-matrix.md` nếu đổi quyền, thêm marker FE READY.

## Bẫy đã gặp

- `@ValidateNested()` bỏ qua `undefined` → thiếu object lồng nhau gây 500; luôn kèm `@IsDefined()`.
- Property `string | null` / `number | null` trong DTO phải ghi rõ `type: String` / `type: Number` trong `@ApiProperty`; thiếu thì Swagger sinh `object` và FE sinh type sai. Mọi route phải có `@ApiResponse({ status, type })`; E2E `returns responses that match the published OpenAPI contract` (`be/test/openapi-contract.ts`) bắt response lệch contract, kể cả trường không khai báo — thêm endpoint mới vào test này.
- PostgreSQL lưu micro giây, `Date` JS chỉ mili giây: so sánh/đặt lịch sát biên `upper(occupied_range)` có thể chồng lấn 1µs.
- E2E dùng chung một database theo thứ tự: test trước đổi chính sách tenant A (duration min 90/bước 45, buffer 10, deposit WEB…). **Thêm test mới ở cuối file** (trước helper `authorized`), tự tạo branch/room/plan/kênh riêng, đọc giá trị thực từ response thay vì giả định mặc định. Test `limits manual payment access…` dùng `bookings LIMIT 1`.
- Cột thời gian của `audit_logs` là `occurred_at`.
- Script Python sửa file: **đọc nội dung xong mới mở file để ghi**. `open(p,'w').write(f(open(p).read()))` xoá trắng file trước khi đọc (đã làm mất tạm thời phần FE chưa commit trong handoff ngày 2026-11-26).
- Ràng buộc exclusion GiST có thể **deadlock** khi nhiều transaction cùng chèn khoảng chồng lấn (lỗi `40P01`, mỗi chu trình mất 1 s phát hiện). Mọi lệnh tạo hoặc nới rộng `room_occupancy` phải gọi `lockRoomOccupancy(client, roomId)` (`be/src/availability/occupancy-lock.ts`) ngay trước khi ghi. `ApiExceptionFilter` trả 409 cho `40P01`/`40001` và ghi log mọi lỗi 5xx (không ghi message).
- Benchmark: `npm run bench:booking` (cần Docker); chạy lại sau thay đổi ở đường giữ phòng/xác nhận và so với `docs/04-quality/booking-benchmark.md`. macOS không có lệnh `timeout`; đừng bọc lệnh bằng `timeout`.
- Pool/timeout PostgreSQL có giới hạn mặc định (OPS-004, `be/src/platform/database/pool-config.ts`): mọi transaction và chờ khoá phải xong trong `PG_LOCK_TIMEOUT_MS` (5 s) / `PG_STATEMENT_TIMEOUT_MS` (15 s). Test cố tình giữ khoá lâu hơn sẽ nhận 409 (`55P03`).
- Số điện thoại public được chuẩn hoá (`be/src/booking/phone.ts`): `0…`, `84…`, `+840…` → `+84…`.

## Trạng thái task

`DONE` (xong hẳn) · `VERIFY` (code + test tự động xong, chỉ chờ kiểm thử trình duyệt QA-003/UAT-001) · `IN_PROGRESS` (đang code hoặc code chưa commit — giữ ít) · `READY` · `BLOCKED` (chờ PO/điều kiện ngoài) · `BACKLOG`. Còn việc dở trong task gần xong thì **tách task mới** với trạng thái đúng thực tế, không giữ task cũ ở `IN_PROGRESS`. Task board viết bằng tiếng Việt; mã trạng thái và mã task giữ nguyên.

## Definition of Done

Code + migration (có down) + unit/E2E phù hợp + `npm run verify` + `npm run test:e2e` pass; OpenAPI/Markdown sinh lại; quyền và audit đúng; task board, handoff (FE READY), traceability, Master Plan cập nhật; `work-log.md` có mục nhật ký mới và mục "Trạng thái hiện tại" được viết lại; quyết định PO mới ghi vào decision log. Commit chỉ khi người dùng yêu cầu; không push nếu không được bảo.
