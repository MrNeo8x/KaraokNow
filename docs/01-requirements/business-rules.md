# Business Rules — KaraokeNow

> Vai trò: BA · Phiên bản 1.0 · 22/11/2026  
> Quy tắc đã phê duyệt được đánh dấu **APPROVED** theo Decision Log. Quy tắc chưa được quyết định không được tự suy diễn thành hành vi sản phẩm.

## 1. Tenant, identity và quyền

| ID | Quy tắc | Trạng thái |
|---|---|---|
| BR-TEN-01 | Mọi dữ liệu tenant-owned được truy vấn với tenant ID rõ ràng. | Đã triển khai ở module hiện có |
| BR-TEN-02 | `X-Tenant-ID` chọn tenant context; chỉ cấp quyền khi user có membership active. | Đã triển khai |
| BR-TEN-03 | Role branch-scoped phải có grant tại branch được truy cập. | Đã triển khai |
| BR-TEN-04 | Branch/room deactivate là soft status `INACTIVE`, không xóa vật lý. | Đã triển khai |

## 2. Chi nhánh, phòng và dữ liệu

- Branch code duy nhất trong phạm vi tenant; room code duy nhất trong branch theo schema/validation.
- Phòng có sức chứa, trạng thái vận hành và thuộc một branch.
- Amenity là nhãn tự do hiện tại; media API chỉ lưu `assetRef`, alt text, display order; không upload/download file.
- Chỉ Owner/Branch Manager sửa venue, amenity/media và maintenance block theo branch grant.

## 3. Thời gian, buffer và availability

| ID | Quy tắc | Trạng thái |
|---|---|---|
| BR-TIME-01 | Merchant cấu hình increment/min/max; mặc định 30 phút, min 1h, max 8h. | APPROVED PD-001 |
| BR-TIME-02 | Buffer bật mặc định 15 phút; Merchant có thể bật/tắt và chỉnh số phút. | APPROVED PD-002 |
| BR-TIME-03 | Hold TTL cấu hình theo channel; mặc định 15 phút. | APPROVED PD-003 |
| BR-TIME-04 | Khoảng chiếm dụng lưu dạng `[start,end)`; hai khoảng liền kề không overlap khi không có buffer. | Implemented DB invariant |
| BR-TIME-05 | Availability reserving interval bắt đầu tại giờ yêu cầu và kết thúc sau thời lượng booking cộng buffer cleanup; không cộng buffer trước giờ bắt đầu. Merchant có thể tắt hoặc đổi buffer. | APPROVED PD-024; search API implemented |
| BR-AVL-01 | Availability loại phòng inactive, maintenance và occupancy đang active. | Target; query chưa có |
| BR-AVL-02 | Một phòng không được có hai occupancy active chồng nhau. | DB constraint đã có; hold workflow chưa có |

## 4. Pricing

- Merchant gán priority rõ ràng; match cùng priority gây ambiguity thì từ chối (PD-011).
- Rule chọn `PER_HOUR` hoặc `PER_BOOKING`; per-hour nhân duration; per-booking áp dụng một lần (PD-019).
- Rule match một lần theo ngày/giờ local bắt đầu tại timezone branch; áp dụng cho toàn duration (PD-023).
- Fractional VND làm tròn half-up đến 1 VND (PD-019); tổng cuối làm tròn đến 1 VND (PD-011).
- Quote API đã có; pricing snapshot vào booking chưa có vì booking workflow chưa có.

## 5. Booking và khách

- Cho phép guest booking; phone bắt buộc, email tùy chọn; Merchant/staff xác minh phone bằng gọi thủ công (PD-010).
- Không yêu cầu customer account hoặc automated phone verification.
- No-deposit/fixed/percentage cấu hình bởi Merchant; default no-deposit. Owner/Branch Manager quyết định channel/case áp dụng; vẫn cần hold hợp lệ và kiểm tra booking rules (PD-004/005).
- Walk-in do staff tạo với origin `WALK_IN`; khoản tiền mặt là payment transaction riêng phục vụ đối soát (PD-008).
- Hold hết hạn không tự xác nhận booking hoặc chiếm lại room đã giải phóng.

## 6. Hủy và hoàn tiền

- Merchant cung cấp free-form cancellation terms theo booking; lưu snapshot chính xác và hiển thị trước khách gửi/confirm (PD-006/015).
- Authorized staff xem xét và ghi outcome; hệ thống không tự quyết định refund/no-show trong pilot.
- Late arrival grace period, overtime và tax invoice còn mở.

## 7. Thanh toán, commission và channel

- Pilot không online payment; ghi nhận thủ công; provider/MoR quyết định sau pilot (PD-007).
- Chỉ completed Marketplace-attributed bookings có thể tính commission; merchant-owned booking không bị tính (PD-009).
- Commission theo rate riêng Merchant trên room revenue giữ lại sau discount/refund, không gồm tax (PD-013); pilot chỉ báo cáo, không thu/settle (PD-016).
- Merchant/Tenant thuộc đúng một Zalo OA; một OA có thể phục vụ nhiều Merchant (PD-017). Tài khoản/OA chưa được cấu hình.
- Zalo/Messenger WebView và kết quả qua chat chỉ bật sau xác minh quyền/kỹ thuật; không chặn web pilot (PD-022).

## 8. Audit và thông báo

- Mutation nhạy cảm ghi audit trong cùng transaction khi module hỗ trợ.
- Notification được phát qua outbox sau commit; provider failure không rollback domain transaction.
- Không ghi secret/token/password vào log; logger dùng allowlist/redaction.

## 9. Mở cần quyết định

Grace/overtime; tax invoice; privacy retention/legal review; production SLO/backup; online payment/MoR và settlement sau pilot; age restriction/license verification.
