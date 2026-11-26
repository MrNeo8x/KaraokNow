// Idempotently prepares the seeded UAT merchant so the guest flow can quote and hold:
// public terms, an always-on price plan and a 30% WEB deposit policy. Writes to the target database through the API.
import { TENANT, OWNER, api, loginToken } from './lib.mjs';

const token = await loginToken(OWNER);
const call = (method, route, body) => api(method, route, { token, tenant: TENANT, body });
const check = (label, response) => { if (response.status >= 400) throw new Error(`${label}: ${response.status} ${JSON.stringify(response.json).slice(0, 300)}`); console.log('✔', label); return response.json; };

const terms = check('đọc điều khoản', await call('GET', '/merchant/catalog/public-booking-terms'));
if (!terms.configured) check('tạo điều khoản công khai', await call('PATCH', '/merchant/catalog/public-booking-terms', { terms: 'UAT: Hủy miễn phí trước 2 giờ. Cọc tiền mặt tại quầy.' }));

const plans = check('đọc bảng giá', await call('GET', '/merchant/pricing/plans'));
const activePlan = (plans.items ?? plans).find(item => item.status === 'ACTIVE');
// Never add a second always-on rule next to an existing active plan: equal-priority matches are rejected as ambiguous.
let plan = activePlan ?? (plans.items ?? plans).find(item => item.code === 'UAT_E2E') ?? check('tạo bảng giá UAT_E2E', await call('POST', '/merchant/pricing/plans', { code: 'UAT_E2E', name: 'UAT E2E' }));
if (plan.status !== 'ACTIVE') plan = check('kích hoạt bảng giá', await call('PATCH', `/merchant/pricing/plans/${plan.id}`, { name: plan.name, status: 'ACTIVE', effectiveFrom: null, effectiveTo: null, version: plan.version }));
const rules = check('đọc quy tắc giá', await call('GET', `/merchant/pricing/plans/${plan.id}/rules`));
if (!(rules.items ?? rules).length) check('tạo quy tắc 150.000 ₫/giờ', await call('POST', '/merchant/pricing/rules', { code: 'UAT_E2E_ALL_DAY', name: 'Cả ngày', priority: 1, amountUnit: 'PER_HOUR', amountVnd: '150000', weekdays: [0, 1, 2, 3, 4, 5, 6], pricePlanId: plan.id }));

const deposit = check('đọc cọc kênh WEB', await call('GET', '/merchant/booking/deposit-policy/WEB'));
if (deposit.mode === 'NONE' || !deposit.configured) check('đặt cọc WEB 30%', await call('PATCH', '/merchant/booking/deposit-policy/WEB', { mode: 'PERCENT', percent: '30.0000' }));

const publication = check('đọc publication', await call('GET', '/merchant/catalog/publication'));
if (!publication.published || !publication.platformApproved) throw new Error('Merchant UAT chưa publish hoặc chưa được Platform duyệt; chạy `npm run db:seed:uat` trong be/.');
console.log('UAT sẵn sàng cho e2e.');
