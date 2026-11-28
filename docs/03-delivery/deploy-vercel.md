# Quy trình triển khai Vercel — KaraokeNow

Tài liệu bắt buộc cho mọi lần đưa code lên production (người hoặc agent). Lập ngày 2026-11-28 (OPS-006). Mọi thay đổi hạ tầng Vercel phải cập nhật file này trong cùng commit.

## 1. Hiện trạng

| Thành phần | Giá trị |
|---|---|
| Tài khoản Vercel | team `mrneo8x`, gói **Hobby** |
| Repo | GitHub `MrNeo8x/KaraokNow`, nhánh production `main` |
| FE | project `vn-karaoke-now`, Root Directory `fe`, Next.js → https://vn-karaoke-now.vercel.app |
| BE | project `vn-karaoke-now-api`, Root Directory `be`, NestJS (một Vercel Function) → https://vn-karaoke-now-api.vercel.app |
| Database | Prisma Postgres `prisma-postgres-cerulean-drawer` (PostgreSQL 17), **chỉ gắn vào project BE** (đã gỡ khỏi FE 2026-11-28; FE không được truy cập PostgreSQL). Không gắn lại vào FE |
| Worker | Vercel Cron trong `be/vercel.json` → `GET /v1/internal/cron/hold-expiry`, `/v1/internal/cron/outbox` |

Luồng request: trình duyệt → FE (`/v1/*` được Next.js rewrite) → BE → PostgreSQL. Trình duyệt không gọi thẳng BE.

### Biến môi trường

| Project | Biến | Ghi chú |
|---|---|---|
| BE | `DATABASE_URL` | Prisma gắn tự động (kết nối trực tiếp `db.prisma.io:5432`, SSL). Không sửa tay |
| BE | `JWT_SECRET`, `CRON_SECRET` | Sensitive, sinh ngẫu nhiên, không lưu ở đâu khác; `vercel env pull` **không** trả giá trị thật. Cần dùng `CRON_SECRET` (gọi cron/chẩn đoán tay) thì đổi giá trị bằng `vercel env update` rồi deploy lại. Đổi `JWT_SECRET` = mọi phiên đăng nhập mất hiệu lực |
| BE | `SWAGGER_ENABLED=false`, `PG_POOL_MAX=5` | Không bật Swagger trên production |
| BE | `CLIENT_IP_HEADER=x-real-ip` | OPS-007: IP khách cho hạn mức công khai. Vercel ghi đè header này ở edge (đã đo: không giả mạo được, giữ đúng IP qua FE rewrite). Không đặt `TRUST_PROXY_HOPS` (`req.ip` trên Vercel là `127.0.0.1`), không dùng `cf-connecting-ip` |
| BE | `BLOB_PUBLIC_READ_WRITE_TOKEN` (hoặc `BLOB_READ_WRITE_TOKEN`), `BLOB_PRIVATE_READ_WRITE_TOKEN` | PD-037: token read-write của store `vn-karaoke-now-blob-pub` (ảnh phòng, logo) và `vn-karaoke-now-blob-pri` (giấy tờ PDF). Nối store vào `vn-karaoke-now-api` với custom prefix `BLOB_PUBLIC` / `BLOB_PRIVATE` và **tick tạo read-write token**; nếu tên biến Vercel tạo khác thì đặt đúng hai tên trên. Thiếu token → API upload trả 503 (BE không ghi xuống đĩa của function), các API khác vẫn chạy. **Chưa đặt** — xem OPS-008 |
| FE | `BACKEND_API_ORIGIN=https://vn-karaoke-now-api.vercel.app` | Đọc lúc **build**; đổi xong phải redeploy FE |

Biến mới: thêm cho cả `production` và `preview` (`vercel env add <TÊN> <env> --project <project>`), ghi vào bảng trên và `be/.env.example`. Biến bắt buộc mới mà thiếu trên Vercel → function crash khi khởi động (`validateEnvironment`).

Gắn/gỡ storage (Prisma, Blob): gắn thì `vercel storage connect <store> -p <project>`; **gỡ** (`vercel storage disconnect`) bị CLI chặn với agent và với lệnh `!` trong Claude Code — người dùng tự gỡ trên dashboard (project → Storage → Disconnect) hoặc trong terminal tương tác riêng, sau đó kiểm tra bằng `vercel storage list`.

Env chỉ có hiệu lực ở lần deploy **mới**. Đổi env mà không có commit mới: `vercel redeploy <url bản production hiện tại> --target production` — build lại đúng commit Git đó (không tải working tree lên), được phép theo quy tắc 2.

## 2. Quy tắc bắt buộc

1. **Push lên `main` = deploy production ngay cho cả FE và BE.** Vercel không chờ GitHub Actions. Mọi kiểm tra ở mục 3 phải pass **trên máy trước khi push**.
2. **Chỉ deploy từ GitHub.** Không `vercel deploy --prod` từ thư mục làm việc: CLI tải lên cả file chưa commit của session khác. Trường hợp khẩn cấp phải dùng CLI thì chạy từ `git worktree` sạch tại commit cần deploy và ghi lý do vào work log.
3. **Migration không tự chạy.** Chạy migration vào Prisma Postgres **trước** khi push code cần nó (mục 4).
4. **Migration phải tương thích ngược** với code đang chạy: giữa lúc migrate và lúc deploy xong, code cũ chạy trên schema mới. Thêm cột nullable/có default, thêm bảng/index được; đổi tên, xoá cột, thêm `NOT NULL` không default thì tách hai lần deploy (expand → deploy code → contract).
5. **Preview dùng chung database production.** Prisma gắn cùng một DB cho `preview` và `production`. Không push nhánh/PR có migration chưa áp lên production; không thử thao tác phá dữ liệu trên preview.
6. **Dependency runtime của `be/` phải có bản CommonJS.** Runtime Vercel không cho `require()` gói thuần ESM (`ERR_REQUIRE_ESM`, function crash toàn bộ — đã gặp với `@nestjs/config@12`). Khi thêm/nâng dependency trong `be/package.json`, kiểm tra `package.json` của gói: có `"type": "module"` mà `exports` không có điều kiện `require` → không dùng được.
7. **Không seed trên production.** Không chạy `npm run db:seed:uat` với `DATABASE_URL` production (mật khẩu công khai trong mã nguồn). Tạo tài khoản theo mục 7.
8. **Không in secret** ra terminal, log, tài liệu, commit. `vercel env pull` chỉ ghi vào file ngoài repo (scratchpad) và xoá sau khi dùng; `.env*` đã nằm trong `.gitignore`.
9. **Chỉ commit/push phần của mình** (xem `AGENTS.md`): push `main` sẽ đẩy luôn các commit local chưa push của session khác — kiểm `git log origin/main..HEAD` và hỏi người dùng nếu có commit không phải của mình.
10. **Cron trên Hobby chỉ chạy tối đa 1 lần/ngày.** Đặt lịch dày hơn → deploy BE bị từ chối. Hold vẫn hết hạn khi có request chạm vào. Lên Pro thì đổi `be/vercel.json` thành `*/5 * * * *`.

## 3. Kiểm tra trước khi push

```bash
export PATH=/opt/homebrew/opt/node@26/bin:$PATH
git fetch origin && git status -sb && git log --oneline origin/main..HEAD   # biết chính xác những gì sẽ lên production

cd be && npm run verify && npm run test:e2e        # khi có thay đổi trong be/
cd fe && npm test && npx tsc --noEmit && npm run build   # khi có thay đổi trong fe/
```

Thêm khi thay đổi chạm vào:

- `be/package.json`: kiểm tra quy tắc 6 cho gói mới/nâng cấp.
- `be/migrations/`: up → down → up trên Postgres tạm (theo `AGENTS.md`), rồi làm mục 4.
- Biến môi trường mới: đã thêm trên Vercel cho cả hai môi trường (mục 1).
- `be/vercel.json` (cron): lịch hợp với gói hiện tại (quy tắc 10).

## 4. Chạy migration lên production

Làm ngay trước khi push, sau khi mục 3 pass. Sao lưu trước nếu migration có xoá/sửa dữ liệu (OPS-002 chưa có quy trình backup — hỏi người dùng trước khi chạy migration loại này).

```bash
S=<thư mục tạm ngoài repo>
mkdir -p $S/belink && cd $S/belink && vercel link --yes --project vn-karaoke-now-api
vercel env pull $S/be.env --environment production --yes
cd <repo>/be
DATABASE_URL=$(grep '^DATABASE_URL=' $S/be.env | cut -d= -f2- | tr -d '"') npm run db:migrate
rm $S/be.env
```

Ghi vào work log tên các migration đã áp. Nếu migration lỗi giữa chừng: dừng, không push, báo người dùng.

## 5. Push và theo dõi deploy

```bash
git push origin main
vercel api "/v6/deployments?projectId=<id>&limit=3"   # hoặc dashboard Vercel → Deployments
```

Cả hai project phải ở trạng thái `READY` với đúng SHA vừa push. Build lỗi → xem log build trên dashboard; bản production cũ vẫn phục vụ cho tới khi có bản build thành công.

## 6. Smoke test sau deploy

```bash
F=https://vn-karaoke-now.vercel.app; B=https://vn-karaoke-now-api.vercel.app
for u in $F/ $F/booking $F/merchant $F/platform $F/v1/health/ready $B/v1/health/live; do curl -s -o /dev/null -w "%{http_code} $u\n" $u; done   # tất cả 200
curl -s -o /dev/null -w "%{http_code} docs\n" $B/docs                                 # 404 (Swagger tắt)
curl -s -o /dev/null -w "%{http_code} cron\n" $B/v1/internal/cron/hold-expiry         # 404 khi không có secret
```

Sau đó đăng nhập thử `/merchant` hoặc `/platform` trên trình duyệt và mở luồng chịu ảnh hưởng của thay đổi. Lỗi `500 FUNCTION_INVOCATION_FAILED` ở mọi endpoint BE = function không khởi động được (thường do quy tắc 6 hoặc thiếu biến môi trường): xem `vercel logs --project vn-karaoke-now-api --since 15m --json`.

Lưu ý: vài request ngay sau khi deploy có thể rơi vào bản cũ đang được thay; gọi lại trước khi kết luận.

## 6a. Giám sát job nền (OPS-003, PD-041)

- Endpoint công khai `https://vn-karaoke-now-api.vercel.app/v1/health/jobs`: 200 = ổn, 503 = tồn đọng (giữ chỗ quá hạn chưa dọn hoặc outbox chờ quá ngưỡng, hoặc có sự kiện outbox `DEAD`). Chỉ trả số đếm. Ngưỡng: env `JOB_HOLD_EXPIRY_MAX_LAG_MINUTES`, `JOB_OUTBOX_MAX_LAG_MINUTES` (mặc định 1560 = cron hằng ngày + 2 h; không cần đặt).
- Đăng ký (người dùng, OPS-009): UptimeRobot (hoặc dịch vụ tương tự) → New monitor → HTTP(s), URL trên, chu kỳ 5 phút, cảnh báo email. Thêm monitor thứ hai cho `/v1/health/ready`.
- Khi nhận cảnh báo: mở URL xem check nào `ok: false`; chạy tay cron bằng `curl -H "Authorization: Bearer $CRON_SECRET" https://vn-karaoke-now-api.vercel.app/v1/internal/cron/hold-expiry` (hoặc `/outbox`); `DEAD` cần xem log và xử lý thủ công.

## 7. Tạo tài khoản quản trị trên production

Chỉ làm khi người dùng yêu cầu, với email do người dùng cung cấp. Dùng script một lần (không commit) với `DATABASE_URL` production: trong một transaction, kiểm tra email (chữ thường) chưa tồn tại, `INSERT INTO users(..., status='ACTIVE', must_change_password=true)` với mật khẩu tạm ngẫu nhiên băm `bcryptjs` cost 12, rồi `INSERT INTO platform_admins(user_id)`. Đưa mật khẩu tạm cho người dùng đúng một lần; không ghi email/mật khẩu vào tài liệu hay work log. Kiểm tra bằng `POST $F/v1/auth/login` → 200, `mustChangePassword: true`.

## 8. Rollback

- **Code:** dashboard Vercel → project → Deployments → bản trước → *Instant Rollback* (hoặc `vercel rollback <deployment-url>`), cho FE và/hoặc BE. Sau đó `git revert` commit lỗi rồi push để `main` khớp với production.
- **Database:** không có rollback tự động. Nhờ quy tắc 4, code cũ chạy được trên schema mới nên thường chỉ cần rollback code. `npm run db:rollback` chỉ dùng khi migration có `down` an toàn, đã sao lưu và người dùng đồng ý.

## 9. Sau mỗi lần deploy

- `work-log.md`: commit đã lên production, migration đã áp, kết quả smoke test, sự cố nếu có.
- `task-board.md`: cập nhật task liên quan; thay đổi hạ tầng thì sửa file này.

## 10. Việc còn mở

- **PD-043** (giờ lẻ 15 phút, giờ mở cửa chi nhánh): **migration `20261124080000_branch_opening_hours` trước push** (cột nullable + CHECK). Chi nhánh chưa đặt giờ mở cửa = không giới hạn, nên không ảnh hưởng đặt phòng hiện tại; chỉ thêm ràng buộc giờ chia hết 15 phút cho khách. Push cùng lần với commit FE sinh lại type (`types:check`).

- **VEN-004** (PD-042, địa chỉ/SĐT/vị trí chi nhánh): **migration `20261124070000_branch_location` phải áp lên Prisma trước khi push** (cột nullable + CHECK — tương thích ngược). Function BE gọi ra `maps.app.goo.gl`/`google.com` để mở link rút gọn (không cần env). Sau deploy: Owner MAJESTIC nhập địa chỉ/SĐT/link cho `LA_KHE`, `THANH_HA` qua giao diện (không seed).

- **OPS-003** (`/v1/health/jobs`): không migration. Sau deploy làm OPS-009 (đăng ký uptime monitor, §6a).

- **BKG-011** (lỗi production: giữ chỗ quá hạn chặn phòng tới lần cron hằng ngày) + **AUD-002**: không migration, không env. Nên push sớm. Smoke: tìm phòng trống `/v1/public/branches/{id}/availability` 200.

- **IAM-008** (PD-040, quản lý user của Platform): **migration `20261124060000_platform_user_management` phải áp lên Prisma trước khi push** (bảng `platform_audit_logs`, cột nullable ở `users`/`platform_admins`, index — tương thích ngược, code cũ không đụng tới). Smoke: Platform Admin `GET /v1/platform/users?limit=1` → 200; user thường → 403.

- **IAM-007 + FE-012** (PD-039, giữ phiên qua F5): không migration, không env mới (để trống `AUTH_COOKIE_SECURE` → cookie Secure). Push cùng lúc hoặc BE trước (BE vẫn nhận refresh token trong body). Smoke sau deploy: đăng nhập trên `vn-karaoke-now.vercel.app`, DevTools → cookie `kn_refresh` thuộc host FE, `HttpOnly`, `Secure`, path `/v1/auth` (xác nhận rewrite Next.js chuyển tiếp `Set-Cookie`); F5 vẫn đăng nhập.
- **Redis `redis-byzantium-mirror`** (người dùng cho phép dùng làm cache khi cần, 2026-11-28): **chưa dùng** — phiên, hạn mức và khoá đều ở PostgreSQL trong transaction. Chỉ thêm khi có số đo cho thấy cần cache (ví dụ catalog công khai), qua một service bọc riêng; không đưa trạng thái tiền/booking vào Redis.

- **BKG-010 + FE-016** (PD-038, mã đặt phòng 6 ký tự): không có migration, nhưng **BE và FE phải cùng một lần push** — BE đổi định dạng mã, FE cũ chặn tra cứu với mã không phải 32 hex. Chỉ push khi FE-016 đã commit; smoke: giữ chỗ → mã 6 ký tự → tra cứu bằng chữ thường.

- **OPS-008** (PD-037): nối hai store Blob vào project BE với read-write token, áp migration `20261124050000_file_storage` (chỉ thêm cột nullable và bảng mới — tương thích ngược), push, smoke upload ảnh phòng/logo/PDF rồi xoá thử.

- **OPS-002**: backup/restore cho Prisma Postgres.
- Cân nhắc tách database preview khỏi production (quy tắc 5).
