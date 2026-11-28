# FE end-to-end scripts

Kiểm thử trình duyệt (Chrome headless qua `playwright-core`) và smoke test API, chạy với frontend + backend thật. Không chạy trong CI.

## Chuẩn bị

1. Trong `be/`: `npm run db:migrate`, `npm run db:seed:uat`, rồi `docker compose up -d --build backend frontend`.
2. Máy có Google Chrome (mặc định). Dùng trình duyệt khác: `E2E_BROWSER_CHANNEL=msedge` hoặc `E2E_BROWSER_PATH=/đường/dẫn/chrome`.
3. Trong `fe/`: `npm ci`.

## Chạy

```bash
npm run e2e                 # setup UAT → API smoke → vị trí chi nhánh → khách → lễ tân/Owner → Platform + phân quyền → vai trò/khoá merchant/429 → ảnh/logo/giấy tờ → phiên qua F5/chọn merchant → quản lý user Platform
node e2e/customer.mjs       # chạy riêng từng bộ
```

`staff.mjs` dùng hold do `customer.mjs` vừa tạo (`e2e/.artifacts/customer-holds.json`); hold hết hạn sau TTL kênh WEB (mặc định 15 phút), nên chạy hai bộ liền nhau. Ảnh chụp màn hình và artifact nằm trong `e2e/.artifacts/` (không commit).

## Giới hạn tần suất

Mỗi lượt `npm run e2e` tạo khoảng 6 giữ chỗ công khai (API smoke 1, khách 2, vai trò 3). Backend mặc định cho 20 giữ chỗ công khai mỗi IP trong 15 phút (`PUBLIC_HOLD_IP_LIMIT`, `PUBLIC_RATE_LIMIT_WINDOW_MINUTES`), nên chạy quá khoảng 3 lượt trong 15 phút sẽ gặp 429 ở bộ khách. Đợi hết cửa sổ, hoặc tăng giới hạn cho môi trường local trong cấu hình backend.

## Biến môi trường

| Biến | Mặc định |
|---|---|
| `E2E_BASE_URL` | `http://localhost:3100` (API đi qua rewrite `/v1` của FE) |
| `E2E_TENANT_ID` | Tenant UAT từ `seed-uat.ts` |
| `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD` | Owner UAT |
| `E2E_PLATFORM_EMAIL` / `E2E_PLATFORM_PASSWORD` | Platform Admin UAT |
| `E2E_MANAGER_*`, `E2E_RECEPTION_*`, `E2E_CASHIER_*` (`_EMAIL`/`_PASSWORD`) | Tài khoản Quản lý chi nhánh, Lễ tân, Thu ngân UAT |

## Lưu ý về dữ liệu

Các script **ghi dữ liệu thật** vào database đang chạy: `setup-uat.mjs` tạo điều khoản công khai, bảng giá luôn áp dụng (nếu chưa có bảng giá ACTIVE) và cọc WEB 30%; các bộ test tạo merchant `SMOKE_…`/`UI_…`/`SUSP_…`/`PU_…` (PU bị khoá sau khi chạy), nhân viên, hold, booking và giao dịch tiền mặt. Chỉ chạy trên môi trường local/UAT.
