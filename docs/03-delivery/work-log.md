# Work log — KaraokeNow

Nhật ký theo phiên để agent sau (Codex/Claude Code, luồng BE hoặc FE) tiếp tục mà không phải đọc lại toàn bộ lịch sử chat. Ghi mục mới **trên cùng**. Mỗi mục: phạm vi, commit, kiểm chứng thực tế, quyết định mới, việc dở dang, cảnh báo. Trạng thái task chi tiết vẫn nằm ở `task-board.md`.

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

### Trạng thái luồng FE tại thời điểm ghi

- Đã commit (`c56fea1`): guest hold/lookup ở `/booking`, `fe/src/lib/public-booking.ts`, test.
- **Chưa commit** trong working tree (session FE đang làm): `/platform` (`platform-listings.tsx`, `platform-merchants.tsx`), cọc trên hold (`hold-details.tsx`), check-in/out/hủy (`booking-operations.tsx`, `lib/booking-lifecycle.ts`), và các màn quản trị merchant `catalog-publication.tsx`, `memberships.tsx`, `audit-log.tsx`, `my-sessions.tsx`, `ops-backlog.tsx`, `lib/admin.ts` cùng test. FE ghi nhận unit test 27/27 ở lượt trước; chưa có browser/FE–BE role test.

### Việc tiếp theo

**BE**

1. Chờ PO: overtime khi trả muộn, đối soát sổ quỹ (phải thu/đã thu, sửa/đảo giao dịch, hoàn cọc khi hold hết hạn), xác nhận các giả định ở trên.
2. IAM-004 reset mật khẩu qua ZBS — bị chặn đến khi có OA/App/template.
3. QA/vận hành: benchmark booking/concurrency (QA-002), giám sát worker `holds:expire`/`outbox:work`, backup/restore (OPS-002).
4. Có thể cần (chưa có quyết định): khoá merchant, reset mật khẩu Owner bởi Platform Admin, `GET /platform/me` thay cho cách dò quyền bằng 403.

**FE**

1. Commit các màn đang làm dở; smoke test với backend local đã rebuild bằng `uat.owner@karaokenow.local` và `uat.platform@karaokenow.local`.
2. Màn lịch hợp nhất hold + booking (REC-002), lọc trạng thái hủy/no-show.
3. Browser/mobile/accessibility test và FE–BE role test (Owner, Branch Manager, Receptionist, Cashier, Platform Admin).

### Cảnh báo

- Database local có 6 merchant `SMOKE_…` (chưa publish) do smoke test FE tạo; chưa có API xoá merchant.
- Container backend không tự migrate; worker hết hạn hold không chạy trong compose.
- Chưa push lên remote; CI GitHub chưa có kết quả.
