// Role checks (QA-003) for Branch Manager, Receptionist and Cashier, plus merchant suspension (PLT-003) and public
// lookup rate limiting (429). Pass criteria follow the business rules: each role can do what the backend allows, and a
// forbidden action ends with a clear Vietnamese message instead of a raw backend error.
import { BASE, TENANT, OWNER, PLATFORM, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const ROLES = {
  manager: { email: process.env.E2E_MANAGER_EMAIL ?? 'uat.manager@karaokenow.local', password: process.env.E2E_MANAGER_PASSWORD ?? 'Uat-manager-password-2026!' },
  reception: { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' },
  cashier: { email: process.env.E2E_CASHIER_EMAIL ?? 'uat.cashier@karaokenow.local', password: process.env.E2E_CASHIER_PASSWORD ?? 'Uat-cashier-password-2026!' },
};
const RAW_ROLE_ERROR = /Insufficient role|Forbidden/i;
const ownerToken = await loginToken(OWNER);

/** Creates a public (WEB) hold on a random future slot of the seeded branch; retries on occupied slots. */
async function publicHold() {
  const branches = (await api('GET', '/public/branches?limit=100')).json.items;
  const branch = branches.find(item => item.id === '10000000-0000-4000-8000-000000000004') ?? branches[0];
  const terms = (await api('GET', `/public/branches/${branch.id}/booking-terms`)).json;
  for (let attempt = 0; attempt < 12; attempt++) {
    const day = new Date(Date.now() + (40 + Math.floor(Math.random() * 600)) * 86400000).toISOString().slice(0, 10);
    const startAt = `${day}T${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}:00:00+07:00`;
    const availability = (await api('GET', `/public/branches/${branch.id}/availability?startAt=${encodeURIComponent(startAt)}&durationMinutes=120`)).json;
    const room = availability.rooms?.[0]; if (!room) continue;
    const quote = (await api('POST', `/public/rooms/${room.id}/quote`, { body: { startAt, durationMinutes: 120 } })).json;
    const phone = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const hold = await api('POST', '/public/booking/holds', { headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { roomId: room.id, startAt, durationMinutes: 120, phone, expectedTotalAmountVnd: quote.totalAmountVnd, termsVersion: terms.version } });
    if (hold.status === 201) return { ...hold.json, phone, terms: terms.terms };
  }
  throw new Error('Không tạo được hold công khai để chuẩn bị dữ liệu');
}
const owner = (method, route, body, headers) => api(method, route, { token: ownerToken, tenant: TENANT, body, headers });

// Data: B1 = confirmed booking (for check-in/out and cash), H2 = held hold still missing its deposit.
const h1 = await publicHold();
await owner('POST', `/merchant/booking/holds/${h1.holdId}/phone-verification`);
await owner('POST', `/merchant/booking/holds/${h1.holdId}/deposits`, { method: 'CASH', amountVnd: h1.depositRequiredVnd }, { 'Idempotency-Key': crypto.randomUUID() });
const b1 = (await owner('POST', `/merchant/booking/holds/${h1.holdId}/confirm`, { cancellationTerms: h1.terms })).json;
const h2 = await publicHold();
const h3 = await publicHold(); // deposit paid by Owner; the Receptionist verifies and confirms it in the browser
await owner('POST', `/merchant/booking/holds/${h3.holdId}/deposits`, { method: 'CASH', amountVnd: h3.depositRequiredVnd }, { 'Idempotency-Key': crypto.randomUUID() });
log(Boolean(b1.id) && Boolean(h2.holdId), 'chuẩn bị dữ liệu: 1 booking đã xác nhận, 1 hold còn thiếu cọc', `booking=${b1.id} hold=${h2.holdId}`);

const browser = await launch();
const local = date => new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 16);

async function roleSession(key, label, run) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('dialog', dialog => dialog.accept());
  const step = async (name, fn) => { try { log(true, `${label}: ${name}`, (await fn()) ?? ''); } catch (error) { log(false, `${label}: ${name}`, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/roles-${key}-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }); } };
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(ROLES[key].email); await page.getByLabel('Mật khẩu').fill(ROLES[key].password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await selectTenant(page, TENANT); await page.locator('.kpi').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(1200);
  await step('menu không có mục chỉ dành cho Owner', async () => { for (const name of ['Người dùng', 'Marketplace']) if (await page.locator('.admin-sidebar').getByRole('button', { name, exact: true }).count()) throw new Error(`vẫn hiện ${name}`); });
  await goSection(page, 'Lịch & Đặt phòng');
  const holdCard = page.locator('section[aria-labelledby="hold-lookup-title"]');
  const ops = page.locator('section[aria-labelledby="booking-ops-title"]');
  const lookupHold = async id => { await holdCard.getByLabel('Mã giữ phòng', { exact: true }).fill(id); await holdCard.getByRole('button', { name: 'Tra cứu trạng thái' }).click(); await holdCard.locator('.deposit-panel, .error').first().waitFor(); };
  const listBookings = async () => { await ops.getByLabel('Từ thời gian').fill(local(new Date(new Date(b1.startAt).getTime() - 3600000))); await ops.getByLabel('Đến thời gian').fill(local(new Date(new Date(b1.startAt).getTime() + 3600000))); await ops.getByRole('button', { name: 'Xem booking' }).click(); await ops.locator('.booking-row, .error, [role=status]').first().waitFor(); await page.waitForTimeout(800); };
  const noRawError = async () => { const texts = await page.locator('.error').allInnerTexts(); const raw = texts.filter(text => RAW_ROLE_ERROR.test(text)); if (raw.length) throw new Error(`lỗi thô: ${raw[0].slice(0, 120)}`); return texts.join(' | ').slice(0, 160); };
  await run({ page, step, holdCard, ops, lookupHold, listBookings, noRawError });
  await page.screenshot({ path: `${SHOTS}/roles-${key}.png`, fullPage: true });
  await ctx.close();
}

await roleSession('manager', 'Quản lý chi nhánh', async ({ page, step, holdCard, ops, lookupHold, listBookings }) => {
  await step('tra hold và ghi một phần cọc', async () => { await lookupHold(h2.holdId); await holdCard.getByLabel('Cọc tiền mặt (VND)').fill('10000'); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click(); await holdCard.getByText(/Đã ghi nhận cọc tiền mặt/).waitFor(); });
  await step('xem lịch booking không có lỗi', async () => { await listBookings(); await ops.locator('.booking-row', { hasText: h1.phone }).waitFor(); if (await ops.locator('.error').count()) throw new Error(await ops.locator('.error').first().innerText()); });
  await step('check-in booking', async () => { const row = ops.locator('.booking-row', { hasText: h1.phone }); await row.getByRole('button', { name: 'Check-in' }).click(); await row.locator('.tag', { hasText: 'Đang sử dụng' }).waitFor(); });
  await step('lưu ân hạn quá giờ', async () => { await goSection(page, 'Giá & chính sách'); const sec = page.locator('section[aria-labelledby="overtime-title"]'); await sec.getByRole('button', { name: 'Lưu ân hạn' }).click(); await sec.locator('.notice').waitFor(); });
});

await roleSession('reception', 'Lễ tân', async ({ page, step, holdCard, ops, lookupHold, listBookings, noRawError }) => {
  await step('tra hold xem được cọc', async () => { await lookupHold(h2.holdId); await holdCard.locator('.deposit-panel .tag').waitFor(); return await holdCard.locator('.deposit-panel .tag').innerText(); });
  await step('không hiện form ghi cọc (Lễ tân chỉ xem cọc)', async () => { if (await holdCard.getByLabel('Cọc tiền mặt (VND)').count()) throw new Error('vẫn hiện form ghi cọc'); return await noRawError(); });
  await step('xác nhận hold online bằng đúng điều khoản khách đã chấp nhận', async () => {
    await lookupHold(h3.holdId);
    await holdCard.getByLabel(/Tôi đã gọi và xác minh/).check(); await holdCard.getByRole('button', { name: 'Ghi nhận cuộc gọi xác minh' }).click(); await holdCard.getByText('Đã ghi nhận cuộc gọi xác minh.').waitFor();
    const terms = holdCard.getByLabel('Điều khoản hủy đã thống nhất');
    await holdCard.getByText('Điều khoản khách đã đồng ý khi đặt online.').waitFor();
    if (await terms.inputValue() !== h3.terms || !(await terms.evaluate(element => element.readOnly))) throw new Error('điều khoản không khớp hoặc chưa khoá');
    await holdCard.getByRole('button', { name: 'Xác nhận booking (đã đủ cọc)' }).click(); await holdCard.getByText(/Đã xác nhận booking/).waitFor({ timeout: 10000 });
  });
  await step('xem lịch booking không bị báo lỗi tiền mặt', async () => { await listBookings(); await ops.locator('.booking-row', { hasText: h1.phone }).waitFor(); const errors = await ops.locator('.error').allInnerTexts(); if (errors.length) throw new Error(errors[0].slice(0, 160)); });
  await step('không có form thu tiền mặt và hủy/no-show', async () => { const row = ops.locator('.booking-row', { hasText: h1.phone }); for (const label of ['Ghi nhận tiền mặt', 'Hủy / khách không đến']) if (await row.getByText(label).count()) throw new Error(`vẫn hiện ${label}`); });
  await step('sổ tiền chỉ xem (không đảo) và không có mục Tiền mặt', async () => { const row = ops.locator('.booking-row', { hasText: h1.phone }); await row.getByRole('button', { name: /Xem sổ tiền/ }).click(); await row.locator('.ledger li').first().waitFor(); if (await row.getByRole('button', { name: 'Đảo khoản này' }).count()) throw new Error('Lễ tân vẫn thấy nút đảo'); if (await page.locator('.admin-sidebar').getByRole('button', { name: 'Tiền mặt', exact: true }).count()) throw new Error('Lễ tân vẫn thấy mục Tiền mặt'); });
  await step('check-out booking', async () => { const row = ops.locator('.booking-row', { hasText: h1.phone }); await row.getByRole('button', { name: 'Check-out' }).click(); await row.locator('.tag', { hasText: 'Hoàn tất' }).waitFor(); });
  await step('ân hạn quá giờ chỉ xem, không có nút lưu', async () => { await goSection(page, 'Giá & chính sách'); const sec = page.locator('section[aria-labelledby="overtime-title"]'); await sec.getByText('Chỉ Owner hoặc Quản lý chi nhánh được thay đổi').waitFor(); if (await sec.getByRole('button', { name: 'Lưu ân hạn' }).count()) throw new Error('vẫn có nút lưu'); });
});

await roleSession('cashier', 'Thu ngân', async ({ page, step, holdCard, ops, lookupHold, listBookings, noRawError }) => {
  await step('không có nút giữ phòng walk-in', async () => { const sec = page.locator('section[aria-labelledby="availability-title"]'); await sec.getByLabel('Thời gian bắt đầu').fill(local(new Date(Date.now() + 25 * 86400000))); await sec.getByRole('button', { name: 'Tìm phòng' }).click(); await sec.locator('.availability-list li, p').first().waitFor(); await page.waitForTimeout(800); if (await sec.getByRole('button', { name: 'Giữ phòng walk-in' }).count()) throw new Error('vẫn hiện nút giữ phòng'); });
  await step('tra hold và ghi cọc', async () => { await lookupHold(h2.holdId); if (await holdCard.locator('.error').count()) throw new Error(`không mở được hold: ${(await holdCard.locator('.error').first().innerText()).slice(0, 120)}`); await holdCard.getByLabel('Cọc tiền mặt (VND)').fill('10000'); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click(); await holdCard.getByText(/Đã ghi nhận cọc tiền mặt/).waitFor(); });
  await step('không có thao tác xác minh/xác nhận hold', async () => { for (const label of ['Ghi nhận cuộc gọi xác minh', 'Xem báo giá hiện tại']) if (await holdCard.getByRole('button', { name: label }).count()) throw new Error(`vẫn hiện ${label}`); });
  await step('xem booking và thu tiền mặt, không có check-in/hủy', async () => {
    await listBookings(); if (await ops.locator('.error').count()) throw new Error(`không xem được booking: ${(await ops.locator('.error').first().innerText()).slice(0, 120)}`);
    const row = ops.locator('.booking-row', { hasText: h1.phone }); await row.waitFor();
    for (const label of ['Check-in', 'Check-out']) if (await row.getByRole('button', { name: label }).count()) throw new Error(`vẫn hiện ${label}`);
    await row.getByLabel('Khoản thu tiền mặt (VND)').fill('50000'); await row.getByRole('button', { name: 'Ghi nhận tiền mặt' }).click(); await row.getByText('Đã ghi nhận thu tiền mặt 50.000 ₫.').waitFor({ timeout: 10000 });
    await row.getByRole('button', { name: /Xem sổ tiền/ }).click(); if (await row.getByRole('button', { name: 'Đảo khoản này' }).count()) throw new Error('Thu ngân vẫn thấy nút đảo bút toán');
  });
  await step('không có lỗi phân quyền thô', noRawError);
});

// Suspension: a fresh merchant with its own Owner, branch and room.
{
  const platformToken = await loginToken(PLATFORM);
  const suffix = Date.now().toString(36).toUpperCase(); const email = `susp.owner.${Date.now()}@karaokenow.local`; const temp = 'Suspend-temp-2026'; const fresh = 'Suspend-fresh-2026!';
  const merchant = (await api('POST', '/platform/merchants', { token: platformToken, body: { code: `SUSP_${suffix}`, name: 'Karaoke Suspend Test', owner: { email, displayName: 'Suspend Owner', temporaryPassword: temp } } })).json;
  const firstToken = await loginToken({ email, password: temp });
  await api('POST', '/auth/password/change', { token: firstToken, body: { currentPassword: temp, newPassword: fresh } });
  const susToken = await loginToken({ email, password: fresh });
  const branch = (await api('POST', '/merchant/branches', { token: susToken, tenant: merchant.tenantId, body: { code: 'HN', name: 'Chi nhánh Suspend', timezone: 'Asia/Ho_Chi_Minh' } })).json;
  await api('POST', '/merchant/rooms', { token: susToken, tenant: merchant.tenantId, body: { branchId: branch.id, code: 'R1', name: 'Phòng S1', capacity: 6 } });
  const suspended = await api('POST', `/platform/merchants/${merchant.tenantId}/suspend`, { token: platformToken, body: { reason: 'E2E kiểm thử khoá' } });
  log(suspended.json?.status === 'INACTIVE', 'khoá merchant: chuẩn bị merchant, Owner, chi nhánh, phòng rồi khoá', merchant.code);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const step = async (name, fn) => { try { log(true, `khoá merchant: ${name}`, (await fn()) ?? ''); } catch (error) { log(false, `khoá merchant: ${name}`, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/roles-suspended.png`, fullPage: true }); } };
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(fresh); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await selectTenant(page, merchant.tenantId); await page.locator('.kpi').first().waitFor({ timeout: 15000 });
  await step('Owner thấy cảnh báo merchant đang bị khoá', async () => page.locator('.pill', { hasText: 'Merchant đang bị khoá' }).innerText());
  await step('tạo hold walk-in bị chặn với thông báo tiếng Việt', async () => {
    await goSection(page, 'Lịch & Đặt phòng');
    const sec = page.locator('section[aria-labelledby="availability-title"]');
    const day = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    await sec.getByLabel('Thời gian bắt đầu').fill(`${day}T19:00`); await sec.getByRole('button', { name: 'Tìm phòng' }).click();
    await sec.getByRole('button', { name: 'Giữ phòng walk-in' }).first().click();
    const message = await sec.locator('.error', { hasText: 'bị Platform khoá' }).innerText(); return message.slice(0, 90);
  });
  await page.screenshot({ path: `${SHOTS}/roles-suspended.png`, fullPage: true });
  await ctx.close();
  const reactivated = await api('POST', `/platform/merchants/${merchant.tenantId}/reactivate`, { token: platformToken, body: { reason: 'E2E mở khoá' } });
  log(reactivated.json?.status === 'ACTIVE', 'khoá merchant: mở khoá lại sau kiểm thử');
}

// 429: repeated wrong lookups for one phone number (default 10 per phone per window).
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const phone = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  await page.goto(BASE + '/booking'); const lookup = page.locator('section.customer-lookup');
  await lookup.getByLabel('Số điện thoại').fill(phone); await lookup.getByLabel('Mã đặt phòng').fill('f'.repeat(32));
  let limited = false; let attempts = 0;
  for (; attempts < 15 && !limited; attempts++) {
    await lookup.getByRole('button', { name: /Tra cứu/ }).click(); await lookup.locator('.error').waitFor();
    limited = /quá nhiều lần/.test(await lookup.locator('.error').innerText());
  }
  log(limited, '429: tra cứu sai liên tục bị tạm chặn với thông báo chờ', `sau ${attempts} lần`);
  log(limited && await lookup.getByRole('button', { name: /Tra cứu/ }).isDisabled(), '429: nút tra cứu bị khoá trong thời gian chờ');
  const text = await lookup.locator('.error').innerText();
  log(!text.includes(phone), '429: thông báo không lộ số điện thoại');
  await ctx.close();
}

await browser.close();
finish();
