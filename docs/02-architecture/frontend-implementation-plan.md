# Phương án triển khai Frontend KaraokeNow

> Vai trò: SA / Frontend · Phiên bản 1.0 · 22/11/2026  
> Công nghệ UI đã chốt: React. Đây là kế hoạch triển khai, chưa phải frontend đã được scaffold.

> Cập nhật định hướng: dùng **Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui** cho landing, đặt phòng và quản trị. Khởi đầu bằng một project `fe/` với các khu vực route riêng; frontend vẫn deploy độc lập khỏi backend. Ant Design chỉ xem xét nếu nghiệp vụ quản trị phức tạp thực sự cần. Phần mô tả Vite/hai ứng dụng bên dưới là phương án trước đây và cần được thay thế khi refinement chi tiết. Các màn hình hiện tại đã được chuyển sang Next.js, còn dùng CSS cũ và customer vẫn là dữ liệu minh họa.

## 1. Quyết định đề xuất

- **React + TypeScript + Vite** cho frontend SPA; build artifact độc lập, không nằm trong NestJS backend.
- **pnpm workspace tại `fe/`** để tổ chức 2 ứng dụng deploy độc lập và package dùng chung:
  - `apps/merchant`: Merchant Admin / Reception.
  - `apps/customer`: customer booking responsive web; có thể được host trong browser hoặc mở trong Zalo/Messenger WebView.
  - `packages/api-client`: typed API client sinh từ OpenAPI.
  - `packages/ui`: primitives/design tokens dùng chung khi hai app thực sự cần chung component.
- Mỗi app có entry point, environment config, build/test pipeline và deployment riêng. Chúng có thể dùng chung một monorepo `fe/`; tách repository không cần thiết để bắt đầu.
- Frontend chỉ gọi backend qua HTTPS API; không import NestJS source, đọc DB hoặc chứa provider secrets.

## 2. Vì sao cấu trúc này

Merchant console và khách hàng có khác nhau về xác thực, điều hướng, tốc độ và trải nghiệm. Hai app tách build giúp customer web nhẹ/mobile-first, Merchant UI có thể tập trung dashboard sau đăng nhập. Dùng React/TypeScript và OpenAPI client chia sẻ contract, nhưng không buộc hai sản phẩm chung một bundle/deployment.

Vite phù hợp SPA/API-first và tạo build tĩnh dễ host độc lập. Chỉ xem xét SSR/framework khác nếu có yêu cầu SEO công khai hoặc nhu cầu server rendering đã được xác nhận; không thêm lớp server frontend vào NestJS.

## 3. Stack đề xuất

| Mục đích | Công nghệ |
|---|---|
| UI | React + TypeScript + Vite |
| Routing | React Router |
| Server state/cache | TanStack Query |
| Form | React Hook Form + Zod |
| API types | OpenAPI-generated TypeScript types/client từ `docs/02-architecture/openapi.json` |
| Styling | CSS Modules hoặc Tailwind CSS; chọn một và duy trì design tokens chung |
| Unit/component tests | Vitest + Testing Library |
| Browser E2E | Playwright |
| Package/workspace | pnpm workspace, chỉ trong `fe/` |

Thư viện chính xác cần pin version theo Node/toolchain tại thời điểm scaffold. Không chạy cài đặt dependency trong bước lập phương án.

## 4. Cấu trúc thư mục đích

```text
fe/
  package.json                 # workspace scripts; độc lập với be/package.json
  pnpm-workspace.yaml
  apps/
    merchant/
      src/app/                  # routes, providers, auth boundary
      src/features/             # branches, rooms, availability, reception
      src/pages/
    customer/
      src/app/                  # public routes, booking flow
      src/features/             # location, schedule, room selection, request status
      src/pages/
  packages/
    api-client/                 # generated API types + typed transport wrapper
    ui/                          # shared accessible controls and tokens
  playwright/
  vitest.config.ts
```

`be/` giữ package NestJS riêng. Workspace root repository chỉ điều phối tài liệu/CI; không gộp package frontend vào backend.

## 5. Kết nối API và hợp đồng

1. Backend là nguồn chuẩn OpenAPI: `docs/02-architecture/openapi.json`.
2. Sinh types/client trong `fe/packages/api-client` bằng script frontend; không copy DTO backend bằng tay.
3. Base URL cấu hình theo môi trường (`VITE_API_BASE_URL`); chỉ public config, không đặt secret trong `VITE_*`.
4. Client wrapper thống nhất correlation ID, timeout, error envelope và xử lý 401/refresh.
5. Mỗi feature chỉ dùng operation API đã có; endpoint chưa tồn tại dùng mock adapter được gắn nhãn, không giả vờ đã lưu dữ liệu.
6. Thêm contract smoke test để phát hiện frontend gọi endpoint đã bị đổi/xóa.

API hiện có phù hợp để bắt đầu Merchant foundation: auth/session, memberships, branch/room CRUD, amenity/media metadata, room blocks, buffer/duration policy, availability query và room quote. Luồng create hold, booking, cancel, check-in/out và manual payment record còn thiếu/đang hoàn thiện; customer booking không thể làm production-complete trước các endpoint này.

## 6. Bảo mật phiên

- Không lưu refresh token dài hạn trong `localStorage`.
- Ưu tiên backend BFF hoặc cookie `HttpOnly; Secure; SameSite` nếu backend hỗ trợ cookie/CSRF; hiện API contract chủ yếu dùng bearer JWT nên cookie flow cần ADR/thay đổi backend trước khi chọn.
- Trong giai đoạn bearer token, access token ngắn hạn giữ trong memory; thiết kế refresh/reload/revocation và XSS threat review trước pilot.
- Merchant UI gửi tenant context, nhưng backend luôn kiểm tra membership và branch grant; việc ẩn menu không phải authorization.
- Customer UI không gửi tenant ID để được tin cậy; dùng public venue IDs và API public có publication policy.
- CORS allowlist theo domain, HTTPS, CSP, security headers, log không chứa token/PII.

## 7. Trình tự triển khai

### Phase 0 — Scaffold và contract

- Tạo React/TypeScript/Vite workspace trong `fe/`, strict TypeScript, lint/format, CI riêng.
- Tạo merchant/customer apps trống, responsive shell, accessible baseline, error boundary.
- Tạo OpenAPI type generation và API transport; xác lập env/runtime configuration.
- Cổng: build độc lập, CI không gọi NestJS compile thay frontend; không import backend source.

### Phase 1 — Merchant foundation

- Login/logout, session expiry, tenant selector/context.
- Branch/room list/detail/edit, amenity metadata, staff/membership, room blocks.
- Role-aware navigation và loading/empty/error states.
- Cổng: API authorization tests vẫn quyết định quyền; UI flow qua browser E2E.

### Phase 2 — Pricing và availability

- Buffer/duration settings, room availability search, quote preview.
- Ngày/giờ và timezone rõ ràng; hiển thị trạng thái phòng không trùng.
- Cổng: contract với backend; coverage các price rule, date boundary, buffer semantics và empty availability.

### Phase 3 — Reception workflow

- Lịch theo branch/room, walk-in booking, booking detail, manual transaction recording, check-in/out.
- Chỉ bắt đầu production UI khi booking API/state machine sẵn sàng.
- Cổng: branch authorization, idempotency, audit, conflict handling, receptionist UAT.

### Phase 4 — Customer booking web

- Mobile-first search: khu vực/chi nhánh → ngày/giờ/duration/guest count → room cards → price/policy → phone → hold/request → result/status.
- Guest-first; phone required, email optional; không yêu cầu account/OTP.
- Cổng: hold correctness, API quote authoritative, policy snapshot, accessibility/mobile E2E.

### Phase 5 — Channel WebView

- Zalo/Messenger message mở URL/route của `apps/customer`; giữ booking flow cùng bản web.
- Submit xong hiển thị kết quả trên web; gửi message result khi adapter/quyền/kênh được cấu hình.
- Cổng: platform approval, deep-link/session behavior, callback/message delivery and failure recovery. Không chặn web pilot.

## 8. Release và hosting

- Frontend build artifacts host độc lập (static hosting/CDN hoặc web hosting tương đương); backend API deploy riêng.
- Có thể dùng subdomain như `app.*` cho Merchant và `book.*` cho customer, nhưng domain thật phải được thống nhất khi triển khai.
- Dev/staging/prod có API base URL riêng, không dùng production data trong local/test.
- Cache static assets có content hash; API responses có caching policy theo dữ liệu và quyền; không cache nhầm private tenant data ở CDN.
- CI frontend: install frozen lockfile → lint/typecheck → unit → build → browser smoke; release riêng backend.

## 9. Rủi ro và dependency

| Dependency | Ảnh hưởng | Xử lý |
|---|---|---|
| Hold/booking API chưa hoàn chỉnh | Không thể hoàn tất luồng booking thật | Phối hợp backend milestones; UI có thể prototype nhưng phải gắn mock rõ |
| PD-024 buffer semantics | Availability UX không thể mô tả chính xác | PO/backend chốt semantics trước release search |
| Token storage/backend cookie support | Session security và refresh UX | ADR bảo mật riêng trước production frontend |
| Zalo/Meta permission | WebView/message result | Chạy web browser trước, channel activation sau phê duyệt |
| CORS/domain/session policy | Frontend không gọi được API an toàn | Chốt domain, CORS, CSP, cookie/token flow trước staging |

## 10. Tiêu chí hoàn thành frontend MVP

- Merchant app và customer app build/release độc lập khỏi `be/`.
- Không có direct DB access hoặc secrets trong browser bundle.
- Tất cả API call có typed contract và xử lý lỗi thống nhất.
- User flows hoạt động ở mobile và desktop; keyboard/screen reader basics được kiểm tra.
- Loading, empty, validation, conflict, expired hold, offline và retry states có thiết kế.
- E2E cho role/branch behavior, quote display, booking submit và status.
- WebView là cùng customer frontend; message result có correlation/reference với request.
- Không đánh dấu integration/channel done khi chưa có quyền và bằng chứng delivery thật.

## 11. Các quyết định cần chốt khi scaffold

- React Router hay framework router; đề xuất React Router do Vite SPA.
- Tailwind hay CSS Modules; chọn một theo khả năng duy trì của team.
- Token/session pattern: backend cookie/BFF hay bearer token memory + refresh flow.
- Domain/subdomain, CORS/CSP, deployment provider.
- Merchant/customer apps chung workspace hay tách repositories sau khi team/CI ownership rõ.
