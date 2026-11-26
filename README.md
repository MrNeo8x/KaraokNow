# KaraokeNow

Nền tảng đặt phòng karaoke: khách đặt phòng qua web (định hướng thêm Zalo Mini App/Messenger), chủ quán quản lý phòng, lịch, cọc và nhân viên; Platform Admin duyệt, tạo và khoá merchant.

| Thư mục | Nội dung |
|---|---|
| `be/` | Backend NestJS/TypeScript (modular monolith), migration PostgreSQL, test, script, Docker Compose local |
| `fe/` | Frontend Next.js: khách `/booking`, chủ quán `/merchant`, Platform Admin `/platform`. Build và phát hành tách khỏi backend, chỉ gọi API qua hợp đồng OpenAPI |
| `docs/` | Tài liệu sản phẩm, yêu cầu, kiến trúc, giao hàng (task board, handoff, work log), chất lượng và thiết kế (`docs/deg/`) |

Backend đã có: định danh/tenant/phân quyền, chi nhánh và phòng, khoá bảo trì, bảng giá, phòng trống, giữ chỗ (nhân viên và khách), cọc tiền mặt trên hold, xác nhận, check-in/out, hủy/no-show có nhân viên xem xét, thu tiền mặt, catalog công khai, Platform Admin duyệt listing, tạo merchant và khoá/mở khoá merchant; ghi nhận trễ/quá giờ khi check-out (chỉ báo cáo, không tính tiền). Thanh toán online và tích hợp kênh chat nằm ngoài phạm vi pilot. Xem [`docs/03-delivery/task-board.md`](docs/03-delivery/task-board.md) trước khi coi một tính năng là đã phát hành.

**Agent (Codex/Claude Code):** bắt đầu từ [`AGENTS.md`](AGENTS.md) và [`docs/03-delivery/work-log.md`](docs/03-delivery/work-log.md).

## Yêu cầu

- Node.js 24–26 (`be` khai báo `>=24 <27`; CI dùng Node 24, image Docker dùng Node 26) và npm.
- Docker Desktop (PostgreSQL 17, chạy stack UAT, E2E backend dùng Testcontainers).
- Google Chrome hoặc Edge nếu chạy kiểm thử trình duyệt `fe/e2e`.

## Chạy nhanh bằng Docker (UAT local)

Chạy PostgreSQL, backend và frontend trong Docker Desktop:

```bash
cd be
cp .env.example .env        # lần đầu; đặt JWT_SECRET ≥ 32 ký tự
npm ci                      # cần cho migrate/seed chạy từ máy host
docker compose up -d postgres
npm run db:migrate          # container backend KHÔNG tự chạy migration (hoặc: docker compose --profile tools run --rm migrate)
npm run db:seed:uat         # merchant UAT (đủ vai trò), UAT2 (chờ duyệt) và Platform Admin
docker compose up -d --build
docker compose --profile workers up -d --build   # tuỳ chọn: worker hết hạn hold và outbox
```

| Địa chỉ | Dùng cho |
|---|---|
| `http://localhost:3100/booking` | Khách đặt phòng |
| `http://localhost:3100/merchant` | Chủ quán / nhân viên (Tenant ID UAT: `10000000-0000-4000-8000-000000000001`) |
| `http://localhost:3100/platform` | Platform Admin |
| `http://localhost:3000/docs` | Swagger |
| `http://localhost:3000/v1/health/ready` | Health check backend |

Tài khoản UAT được in ra khi chạy `npm run db:seed:uat`; kịch bản và tài khoản theo vai trò ở [`docs/04-quality/uat-checklist.md`](docs/04-quality/uat-checklist.md). PostgreSQL của Compose mở ở cổng `5433` trên máy host.

Seed UAT đã tạo sẵn bảng giá, điều khoản công khai và cọc WEB 30% cho merchant UAT nên khách đặt thử được ngay. `fe/e2e/setup-uat.mjs` (chạy tự động trong `npm run e2e`) chỉ bổ sung phần còn thiếu nếu database được tạo từ seed cũ.

Sau khi sửa code, build lại đúng service: `docker compose up -d --build backend` hoặc `docker compose up -d --build frontend` (chạy trong `be/`). Có migration mới thì chạy `npm run db:migrate` trước khi khởi động backend.

## Chạy ở chế độ phát triển

```bash
# Terminal 1 — backend (watch mode, cổng 3000)
cd be
docker compose up -d postgres
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed:uat
npm run start:dev

# Terminal 2 — frontend (cổng 3100, /v1 được rewrite sang http://localhost:3000)
cd fe
npm ci
npm run dev
```

Frontend dùng cổng 3100 vì máy UAT hiện tại có ứng dụng chiếm cổng 3001. Đổi backend đích bằng biến `BACKEND_API_ORIGIN`.

### Worker nền

Worker không chạy cùng `docker compose up` mặc định. Bật bằng profile `workers` hoặc chạy trực tiếp từ `be/`:

```bash
docker compose --profile workers up -d   # hai container hold-expiry-worker và outbox-worker
docker compose --profile workers stop

npm run holds:expire   # hoặc chạy trên host: vòng lặp đánh dấu hold quá hạn, giải phóng phòng
npm run outbox:work    # vòng lặp gửi sự kiện outbox (adapter thông báo thật chưa cấu hình)
```

Cả hai chạy liên tục và dừng sạch khi nhận SIGINT/SIGTERM. Nếu không chạy `holds:expire`, hold quá hạn vẫn chiếm phòng; mục **Tổng quan → Theo dõi vận hành** sẽ báo số tồn đọng.

## Biến môi trường

Backend (`be/.env`, xem `be/.env.example`; giá trị được kiểm tra lúc khởi động trong `be/src/config/env.validation.ts`):

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `DATABASE_URL` | Có | `postgresql://…` |
| `JWT_SECRET` | Có | Tối thiểu 32 ký tự ngẫu nhiên; mỗi môi trường một giá trị riêng |
| `PORT` | Không | Mặc định `3000` |
| `TRUST_PROXY_HOPS` | Không | Số reverse proxy tin cậy phía trước backend (0–10). Phải đặt đúng khi chạy sau proxy để giới hạn tần suất theo IP hoạt động chính xác |
| `PUBLIC_RATE_LIMIT_WINDOW_MINUTES`, `PUBLIC_HOLD_IP_LIMIT`, `PUBLIC_HOLD_PHONE_LIMIT`, `PUBLIC_LOOKUP_IP_LIMIT`, `PUBLIC_LOOKUP_PHONE_LIMIT` | Không | Giới hạn giữ chỗ/tra cứu công khai; mặc định 15 phút, 20/5/60/10 |
| `SWAGGER_ENABLED` | Không | `false` tắt Swagger `/docs`; nên tắt ở production |
| `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Không | Tracing OpenTelemetry; không đặt endpoint thì không xuất span |
| `POSTGRES_PORT` | Không | Cổng PostgreSQL của Compose trên máy host (mặc định 5433) |

Frontend:

| Biến | Mô tả |
|---|---|
| `BACKEND_API_ORIGIN` | Origin nội bộ của backend mà Next.js rewrite `/v1/*` tới (mặc định `http://localhost:3000`). Truyền ở cả build (`--build-arg`) và runtime như `be/compose.yaml`. Đây là biến phía server, không đưa vào bundle trình duyệt |

## Kiểm thử

```bash
# Backend (trong be/)
npm run verify       # build, unit test, kiểm tra drift OpenAPI và API Markdown
npm run test:e2e     # E2E PostgreSQL qua Testcontainers (cần Docker)
npm run bench:booking  # benchmark đặt phòng, xem docs/04-quality/booking-benchmark.md

# Frontend (trong fe/)
npm test             # unit test
npm run build
npm run e2e          # trình duyệt + API trên stack đang chạy, xem fe/e2e/README.md
```

`npm run e2e` **ghi dữ liệu thật** (merchant, nhân viên, hold, booking) vào database đang chạy; chỉ dùng cho local/UAT. CI (`.github/workflows/backend-ci.yml`, `frontend-ci.yml`) chạy build và test, không chạy `fe/e2e`.

Sau khi đổi API, chạy `npm run openapi:generate` và `npm run api:docs` trong `be/` để cập nhật [`docs/02-architecture/openapi.json`](docs/02-architecture/openapi.json) và [`api-reference.md`](docs/02-architecture/api-reference.md).

## Triển khai

### Mô hình

```
Trình duyệt ──HTTPS──> Reverse proxy (TLS) ──> frontend :3100 ──/v1/*──> backend :3000 ──> PostgreSQL
                                                                     worker: holds:expire, outbox:work ──┘
```

Trình duyệt chỉ gọi cùng origin với frontend; Next.js chuyển tiếp `/v1/*` sang backend qua mạng nội bộ nên không cần CORS. Backend và PostgreSQL không cần mở ra Internet.

### Build image

```bash
docker build -t karaokenow-backend:<version> be                      # target runtime (mặc định): chỉ API
docker build --target tools -t karaokenow-tools:<version> be         # migration + worker
docker build -t karaokenow-frontend:<version> --build-arg BACKEND_API_ORIGIN=http://<backend-nội-bộ>:3000 fe
```

Image `tools` mặc định chạy `npm run db:migrate` (cần `DATABASE_URL`); đổi command thành `npm run holds:expire` hoặc `npm run outbox:work` (cần thêm `JWT_SECRET`) để chạy worker.

`be/compose.yaml` là ví dụ cấu hình đầy đủ cho một máy; khi triển khai thật, thay `JWT_SECRET` và mật khẩu database bằng secret của môi trường, không dùng giá trị trong file.

### Thứ tự phát hành

1. Sao lưu database.
2. Chạy migration bằng image `tools` (lệnh mặc định) với `DATABASE_URL` của môi trường đích.
3. Khởi động backend mới, chờ `GET /v1/health/ready` trả 200 (`/v1/health/live` dùng cho liveness).
4. Khởi động frontend mới.
5. Khởi động lại hai worker từ image `tools` (`npm run holds:expire`, `npm run outbox:work`), mỗi worker một container/tiến trình được giám sát, luôn chạy.
6. Smoke test: đăng nhập `/merchant`, mở `/booking`, theo dõi mục **Theo dõi vận hành**.

Rollback: triển khai lại image cũ. `npm run db:rollback` lùi một migration; chỉ dùng khi migration đó có `down` an toàn và đã sao lưu.

### Giới hạn hiện tại cần lưu ý

- **Không chạy `npm run db:seed:uat` trên production**: seed tạo tài khoản với mật khẩu công khai trong mã nguồn.
- **Đặt `SWAGGER_ENABLED=false` ở production.** `/v1/metrics` luôn bật: chặn ở reverse proxy hoặc chỉ cho mạng nội bộ.
- Đặt `TRUST_PROXY_HOPS` bằng đúng số proxy tin cậy phía trước backend. Khi backend chỉ nhận request qua rewrite của Next.js, cần kiểm tra trên môi trường đích IP mà backend nhận được (header `X-Forwarded-For` có được chuyển tiếp hay không) trước khi chọn giá trị; đặt sai thì giới hạn theo IP có thể gộp mọi khách thành một IP hoặc bị giả mạo.
- Phiên đăng nhập merchant lưu trong bộ nhớ trình duyệt; tải lại trang phải đăng nhập lại.
- Chưa có quy trình backup/restore đã diễn tập (OPS-002), chưa có giám sát/cảnh báo cho worker; thông báo Zalo (ZBS) và thanh toán online chưa tích hợp.

## Tài liệu

- Hợp đồng API cho frontend: [`docs/02-architecture/api-reference.md`](docs/02-architecture/api-reference.md), [`api-error-contract.md`](docs/02-architecture/api-error-contract.md).
- Phối hợp BE/FE: [`docs/03-delivery/fe-backend-handoff.md`](docs/03-delivery/fe-backend-handoff.md); trạng thái công việc: [`task-board.md`](docs/03-delivery/task-board.md).
- Thiết kế giao diện: `docs/deg/`.
- Ranh giới frontend: [`fe/README.md`](fe/README.md). Không thêm code frontend vào package NestJS và không để frontend truy cập PostgreSQL trực tiếp.
