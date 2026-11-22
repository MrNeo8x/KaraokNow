# Password-reset Notification Provider Shortlist

Research date: 2026-11-22. This is a provider comparison, not authorization to create an account, configure DNS, spend money or send real reset codes.

## Current PO direction

- Password-reset delivery should use ZBS Template Message first.
- Email is temporarily deferred; carrier SMS has not been selected.
- One Zalo OA may serve multiple Merchant/Tenant records; each Merchant/Tenant belongs to exactly one OA. OA setup will run in parallel with development; no OA/ZBS account exists yet.
- The application will be deployed in Vietnam.
- Carrier SMS may be evaluated later; Zalo ZNS is also under consideration (the current Zalo developer product is named ZBS Template Message).
- Reset code policy: one-time six-digit code, hash-only storage, 10-minute expiry, maximum five attempts.

## Email candidates

| Candidate | Fit | Operational constraints | Assessment |
|---|---|---|---|
| Amazon SES | Regional API/SMTP endpoints include Singapore (`ap-southeast-1`) and Thailand (`ap-southeast-7`), both usable candidates for an app deployed in Vietnam. | Sending domain must be verified. New accounts start in a sandbox; AWS documents a 200-email/day and 1-email/second limit and requires production access before sending to arbitrary recipients. Current pricing lists $0.10/1,000 emails à la carte; newly eligible accounts default to Essentials at $0.16/1,000 unless changed. | **Leading candidate for Vietnam deployment**, subject to choosing the AWS account/region and passing AWS production access. This is a regional endpoint choice, not a legal/data-residency determination. |
| Resend | Node.js SDK and REST API; direct fit for the current NestJS stack. Sending can be routed from Tokyo (`ap-northeast-1`). | Sender domain setup/verification is needed. Current free plan is 3,000 emails/month with a 100/day cap; Pro is $20/month for 50,000 emails. Resend states customer data including message content and delivery logs is stored in the United States even if a sending region is selected. Its product documentation describes detailed API logs including request headers and response bodies. | Fast developer integration, but use only after the team accepts U.S. storage and reviews OTP-content logging/data handling. |

## Zalo option for a later non-email channel

Zalo's current developer product is **ZBS Template Message**. Zalo's old ZNS documentation says ZNS was consolidated into ZBS Template Message effective 2026-01-01 and is no longer maintained. ZBS requires a Zalo Official Account, Zalo App and ZBS account; the current API supports template messages by phone number or UID. The official error reference includes OTP templates, but also documents approval, account/permission, quota, balance and recipient-eligibility failures. Treat this as a Zalo delivery channel, not carrier SMS, and validate template/account eligibility before choosing it. Verify that the selected ZBS OTP template accepts the approved 10-minute code lifetime; the legacy ZNS guide's sample OTP copy says 5 minutes, and that guide is now marked unmaintained.

## Vietnamese carrier SMS alternative

Viettel offers SMS Brandname for organizational/customer-care messaging and describes both manual and SMS Gateway delivery paths. Brandname registration/approval and commercial terms need to be confirmed directly before implementation. ZBS and carrier SMS have different delivery eligibility and cost models; do not treat one as a drop-in replacement for the other.

## Selection status and remaining prerequisites

1. PO selected ZBS Template Message as the first reset-code channel and temporarily deferred email (2026-11-22). This supersedes the earlier email-first shortlist recommendation.
2. Before implementation/live delivery, the business needs an OA, Zalo App, ZBS account, app permissions and an eligible approved OTP template; check that ZBS accepts the approved ten-minute code lifetime.
3. If a recipient is not eligible for ZBS delivery, stop reset and direct the user to support; staff must not reveal/send a code manually (PD-014 approved 2026-11-22).
4. No provider has been connected. IAM-004 remains blocked; no real code delivery is claimed. SES and Resend remain candidates if email is re-enabled later. Carrier SMS remains a separate future option.

## Deferred email shortlist (if/when email is re-enabled)

For future email delivery, choose between:

- **A. Amazon SES** — prefer if hosting is AWS; requires verified sender domain and production access outside the sandbox.
- **B. Resend** — suggested for a quick Node.js integration when hosting is not fixed; review provider request-log handling for OTP content before sending real codes.
- **C. Defer the provider** until hosting cloud/region and data-handling review are settled; keep live reset delivery blocked.

ZBS Template Message is the current Zalo option, not carrier SMS.

## Official sources

- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)
- [Amazon SES transactional sending setup and sandbox limits](https://docs.aws.amazon.com/ses/latest/dg/getting-started-sending.html)
- [Resend pricing](https://resend.com/pricing)
- [Resend email API](https://resend.com/features/email-api)
- [Zalo ZBS Template Message introduction](https://stc-developers.zdn.vn/docs/v2/zbs-template-message/bat-dau/gioi-thieu-zbs-template-message)
- [Zalo ZBS Template Message error codes](https://stc-developers.zdn.vn/docs/v2/zbs-template-message/bang-ma-loi/)
- [Zalo notice that ZNS moved to ZBS Template Message](https://stc-developers.zdn.vn/docs/v2/zalo-notification-service/bat-dau/gioi-thieu-zalo-notification-service-api)
- [Viettel SMS Brandname service](https://solutions.viettel.vn/vi/vien-thong/sms-brand-name.html)
- [Resend data storage and region FAQ](https://resend.com/security/gdpr/)
- [AWS SES regional endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html)
