# Runbook OPS-007 — IP khách qua Vercel rewrite

Người thực hiện: **session triển khai** (người dùng giao ngày 2026-11-28). Code đã có trên `main` local từ commit `02202cd` (Luồng BE). Tuân thủ toàn bộ `docs/03-delivery/deploy-vercel.md` (đặc biệt: migrate trước khi push, chỉ deploy từ GitHub, không in secret, kiểm `git log origin/main..HEAD`).

## Vì sao cần

Production chạy trình duyệt → FE Vercel → Next.js rewrite `/v1/*` → BE Vercel. Hạn mức công khai tính theo IP: giữ chỗ 20 / 15 phút, tra cứu 60 / 15 phút (`PUBLIC_*`). Production chưa đặt `TRUST_PROXY_HOPS` / `CLIENT_IP_HEADER`, nên BE dùng địa chỉ nội bộ của Vercel → mọi khách nhiều khả năng **chung một hạn mức**: khi có vài chục lượt giữ chỗ/tra cứu, tất cả khách nhận 429.

BE (commit `02202cd`) chọn IP khách theo thứ tự:

1. `X-KN-Client-IP` — chỉ khi `X-KN-Proxy-Secret` khớp env `CLIENT_IP_PROXY_SECRET` (FE chuyển tiếp IP trình duyệt).
2. Header tên trong env `CLIENT_IP_HEADER` (`x-real-ip` | `x-vercel-forwarded-for` | `x-forwarded-for` | `cf-connecting-ip`), lấy mục đầu tiên.
3. `req.ip` (theo `TRUST_PROXY_HOPS`), rồi địa chỉ socket.

Endpoint chẩn đoán: `GET /v1/internal/diag/client-ip`, cần `Authorization: Bearer $CRON_SECRET` (sai/thiếu → 404, không có trong OpenAPI). Trả `resolved {ip, source}`, `reqIp`, `socketAddress`, `config`, và giá trị các header `x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`, `forwarded`, `cf-connecting-ip`, `x-forwarded-host`, `via`.

## Bước 1 — Đưa code lên production

1. `git fetch origin && git log --oneline origin/main..HEAD` — tại thời điểm viết gồm `4af700b` (PAY-007), `64d09d9` (work log), `ab345fb` (FE REC-003), `02202cd` (OPS-007) và có thể thêm commit mới. Có commit lạ → hỏi người dùng.
2. Production đã có 25 migration (đến `20261124030000_overtime_recording`). **Chỉ còn thiếu `20261124040000_cash_reconciliation`** — tương thích ngược (chỉ thêm 3 bảng và index). Chạy theo mục 4 của `deploy-vercel.md` **trước** khi push; code PAY-007 truy vấn bảng `money_reversals`, push trước khi migrate sẽ làm lỗi API cọc.
3. Kiểm tra mục 3 của `deploy-vercel.md` (verify, E2E, FE build) rồi push `main`. Chờ hai project Vercel deploy xong.
4. Smoke: `/v1/health/ready` 200 trực tiếp và qua FE.

## Bước 2 — Đo

Lấy `CRON_SECRET` từ `vercel env pull` vào file **ngoài repo** (scratchpad), đọc vào biến shell, không in ra:

```bash
set -a; . /đường/dẫn/scratchpad/.env.production; set +a     # chứa CRON_SECRET; xoá file sau khi xong
MYIP=$(curl -s https://api.ipify.org); echo "IP công khai của máy: $MYIP"
BE=https://vn-karaoke-now-api.vercel.app/v1/internal/diag/client-ip
FE=https://vn-karaoke-now.vercel.app/v1/internal/diag/client-ip
AUTH="Authorization: Bearer $CRON_SECRET"

curl -s -H "$AUTH" "$BE"; echo                                        # (a) gọi thẳng BE
curl -s -H "$AUTH" "$FE"; echo                                        # (b) qua FE rewrite — đường của khách thật
curl -s -H "$AUTH" -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' -H 'X-Vercel-Forwarded-For: 1.2.3.4' "$FE"; echo   # (c) thử giả mạo qua FE
curl -s -H "$AUTH" -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' -H 'X-Vercel-Forwarded-For: 1.2.3.4' "$BE"; echo   # (d) thử giả mạo thẳng BE
```

Không dán `CRON_SECRET` vào tài liệu hay log. Kết quả (b)–(d) chỉ chứa IP của máy đo, có thể ghi vào work log.

## Bước 3 — Chọn cấu hình

Gọi **H** là header ứng viên (`x-real-ip` hoặc `x-vercel-forwarded-for`).

| Kết quả quan sát | Cấu hình |
|---|---|
| Ở (b), H = `$MYIP`; ở (c) và (d), H **không** phải `1.2.3.4` | Đặt env BE `CLIENT_IP_HEADER=H` (production + preview). Không cần FE làm gì. Ưu tiên `x-real-ip` nếu cả hai đều đạt |
| Ở (b), H là IP khác `$MYIP` (IP của Vercel/AWS) trong khi ở (a) H = `$MYIP` | Rewrite làm mất IP gốc. Sinh `CLIENT_IP_PROXY_SECRET` ngẫu nhiên ≥ 32 ký tự, đặt cho **cả** BE và FE; báo Luồng FE làm middleware chuyển tiếp (handoff mục "Chờ đo production — IP khách qua rewrite"). Chưa đặt `CLIENT_IP_HEADER` cho tới khi FE xong |
| H đổi thành `1.2.3.4` ở (c) hoặc (d) | H **giả mạo được** — không dùng. Thử header còn lại; nếu cả hai đều giả mạo được → dùng cách chuyển tiếp có secret ở dòng trên |
| `x-forwarded-for` dạng `ip1, ip2` | Chỉ dùng `x-forwarded-for` nếu mục đầu = `$MYIP` ở (b) **và** không đổi thành `1.2.3.4` ở (c)/(d) |

Không dùng `TRUST_PROXY_HOPS` trên Vercel trừ khi kết quả cho thấy chuỗi proxy cố định; `CLIENT_IP_HEADER` rõ ràng hơn.

## Bước 4 — Áp và kiểm

1. Thêm env (production + preview) cho project `vn-karaoke-now-api` (và FE nếu dùng secret), rồi **redeploy** — env chỉ có hiệu lực ở lần deploy mới.
2. Gọi lại (b): phải có `resolved.source = "platform-header"` (hoặc `"trusted-proxy"`) và `resolved.ip = $MYIP`. Gọi lại (c): `resolved.ip` vẫn là `$MYIP`.
3. Xoá file env đã pull.

## Bước 5 — Ghi lại

- `docs/03-delivery/deploy-vercel.md`: bảng biến môi trường (`CLIENT_IP_HEADER` / `CLIENT_IP_PROXY_SECRET` thay cho dòng `TRUST_PROXY_HOPS` "chờ OPS-007").
- `docs/03-delivery/work-log.md`: kết quả (b)–(d) đã che bớt nếu muốn, cấu hình chọn, thời điểm redeploy.
- `docs/03-delivery/task-board.md`: OPS-007 → `DONE`; nếu cần FE chuyển tiếp thì tạo task FE mới và để OPS-007 ở `VERIFY` tới khi FE xong.
