# Runbook OPS-002 — backup và diễn tập khôi phục PostgreSQL

Quyết định: PD-047 (2026-11-28). Áp dụng cho production (Prisma Postgres, PostgreSQL 17). Bản backup **chứa SĐT/email khách** → luôn mã hoá khi rời máy chạy, không gửi qua chat/email, không commit.

## Thành phần

| Thành phần | Vai trò |
|---|---|
| `be/scripts/ops/db-backup.sh` (`npm run db:backup`) | `pg_dump --format=custom` trong container `postgres:17-alpine`; file `karaokenow-<UTC>.dump`, `.sha256`, `.counts.tsv` (số dòng từng bảng). Có `BACKUP_PASSPHRASE` → mã hoá AES-256-CBC (PBKDF2 200k) thành `.dump.enc` và xoá bản thường. URL chỉ đi qua biến môi trường, không in ra |
| `be/scripts/ops/db-restore-drill.sh` (`npm run db:restore-drill -- <file>`) | Kiểm checksum, giải mã (nếu `.enc`), khôi phục vào container Postgres tạm, so số dòng từng bảng với `.counts.tsv`, đọc `pgmigrations`, in `restore_seconds` (RTO). Lệch → exit 1. Không chạm DB thật |
| `.github/workflows/db-backup.yml` | Hằng ngày 02:00 giờ Việt Nam (+ chạy tay): backup mã hoá → diễn tập khôi phục → upload artifact (chỉ `.dump.enc`, `.sha256`, `.counts.tsv`) giữ 30 ngày. Thiếu secret thì bỏ qua kèm thông báo |

## Mục tiêu (đề xuất trong PD-047)

- **RPO ≤ 24 giờ** (backup hằng đêm). Dữ liệu sau lần backup cuối có thể mất nếu DB hỏng hoàn toàn.
- **RTO ≤ 1 giờ** cho khôi phục logic (đo thực tế mỗi đêm bằng `restore_seconds`; dữ liệu hiện tại khôi phục trong vài giây) + thời gian đổi `DATABASE_URL` và redeploy.

## Cài đặt (một lần — người dùng)

1. Tạo passphrase ngẫu nhiên ≥ 32 ký tự, cất trong trình quản lý mật khẩu (mất passphrase = mất khả năng khôi phục).
2. GitHub → repo → Settings → Secrets and variables → Actions → New repository secret:
   - `PROD_DATABASE_URL`: chuỗi kết nối PostgreSQL **trực tiếp** của Prisma Postgres (dạng `postgres://…`, không phải `prisma+postgres://` Accelerate). Nên dùng role chỉ đọc nếu tạo được.
   - `BACKUP_PASSPHRASE`: passphrase ở bước 1.
3. Actions → "Production DB backup" → Run workflow. Kiểm tra summary có dòng `counts_match=yes` và artifact được tạo.

## Khôi phục thật (sự cố)

1. Tải artifact gần nhất (Actions → run → Artifacts) vào thư mục riêng trên máy vận hành; giải nén.
2. Diễn tập trước: `BACKUP_PASSPHRASE=… npm --prefix be run db:restore-drill -- <file>.dump.enc` → phải `counts_match=yes`.
3. Tạo database đích mới (Prisma Postgres mới hoặc DB trống), giải mã rồi khôi phục:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <file>.dump.enc -out restore.dump -pass env:BACKUP_PASSPHRASE
   docker run --rm -i -e PGURL="$TARGET_DATABASE_URL" postgres:17-alpine sh -c 'pg_restore --no-owner --no-privileges --exit-on-error --dbname="$PGURL"' < restore.dump
   rm -f restore.dump
   ```
4. Đổi `DATABASE_URL` của project `vn-karaoke-now-api` sang DB mới (theo `deploy-vercel.md`), redeploy, smoke `/v1/health/ready`, `/v1/health/jobs`.
5. Ghi work log: thời điểm sự cố, bản backup dùng, RPO/RTO thực tế.

## Kiểm chứng (2026-11-28, local)

Backup DB local (31 migration, 42 bảng, 4.093 dòng): thường và mã hoá đều khôi phục `counts_match=yes`, `restore_seconds=1`; sai passphrase → exit 1; file bị sửa → `checksum mismatch`, exit 1. Chưa chạy trên production (chờ secret).
