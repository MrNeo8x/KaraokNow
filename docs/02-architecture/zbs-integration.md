# ZBS Template Message Integration

Status: provider selected for the first password-reset delivery channel; integration not implemented.

## Approved direction

- ZBS Template Message is the first channel for password-reset codes. Email is temporarily deferred; carrier SMS is not selected.
- The code is one-time, six digits, stored as a hash, expires in 10 minutes and permits at most five attempts.
- If ZBS cannot deliver to the recipient, stop the automated reset and direct the user to support. Staff must not reveal or send the code manually.
- A Merchant belongs to exactly one Zalo Official Account (OA); one OA may serve multiple Merchants. This cardinality is approved under PD-017.
- OA/App/ZBS account creation and configuration will happen in parallel with development. No OA or ZBS account exists yet.

In the current backend model, a Merchant is represented by a tenant. Therefore the approved logical relationship is `OA 1 -> many Merchant/Tenant`; each Merchant/Tenant has exactly one OA assignment for ZBS delivery.

## Integration prerequisites

Before real code delivery, the business needs an OA, Zalo App, ZBS account, app permissions for the required send operation and an approved OTP template. Confirm that the current ZBS OTP template allows the approved 10-minute validity period. The Zalo API also reports permission, quota, balance and recipient-eligibility failures; follow PD-014 when delivery is unavailable.

## Implementation boundary

No ZBS credentials, OA identifier, template identifier or live provider call is configured. Do not put provider secrets in source control or expose them in tenant APIs. Physical schema placement for OA assignments and secure credential storage are implementation details to design before adding migrations; do not infer that every ZBS account or token is tenant-owned.

## Official references

- [ZBS Template Message introduction](https://stc-developers.zdn.vn/docs/v2/zbs-template-message/bat-dau/gioi-thieu-zbs-template-message)
- [ZBS Template Message error codes](https://stc-developers.zdn.vn/docs/v2/zbs-template-message/bang-ma-loi/)
- [Zalo notice moving ZNS documentation to ZBS](https://stc-developers.zdn.vn/docs/v2/zalo-notification-service/bat-dau/gioi-thieu-zalo-notification-service-api)
