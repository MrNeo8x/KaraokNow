// FE-024 / BKG-008 (PD-050): case-level deposit exemption policy, manual waiver on a hold, confirmation without deposit
// and the reason on the booking. Uses 2 public holds (rate limit). Restores the policy to "every case off" at the end.
import { BASE, TENANT, OWNER, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const RECEPTION = { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' };
const BRANCH = '10000000-0000-4000-8000-000000000004';
const OFF = { maxAmountVnd: null, offPeakWindows: [], regularMinCompleted: null, regularLookbackDays: 90, waiverRoles: ['OWNER', 'BRANCH_MANAGER'] };
const ownerToken = await loginToken(OWNER); const receptionToken = await loginToken(RECEPTION);
const owner = (method, route, body) => api(method, route, { token: ownerToken, tenant: TENANT, body });

async function publicHold() {
  const terms = (await api('GET', `/public/branches/${BRANCH}/booking-terms`)).json;
  for (let attempt = 0; attempt < 12; attempt++) {
    const day = new Date(Date.now() + (40 + Math.floor(Math.random() * 600)) * 86400000).toISOString().slice(0, 10);
    const startAt = `${day}T${String(10 + Math.floor(Math.random() * 10)).padStart(2, '0')}:00:00+07:00`;
    const room = (await api('GET', `/public/branches/${BRANCH}/availability?startAt=${encodeURIComponent(startAt)}&durationMinutes=120`)).json.rooms?.[0]; if (!room) continue;
    const quote = (await api('POST', `/public/rooms/${room.id}/quote`, { body: { startAt, durationMinutes: 120 } })).json;
    const phone = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const hold = await api('POST', '/public/booking/holds', { headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { roomId: room.id, startAt, durationMinutes: 120, phone, expectedTotalAmountVnd: quote.totalAmountVnd, termsVersion: terms.version } });
    if (hold.status === 201) return { ...hold.json, phone, total: quote.totalAmountVnd };
  }
  throw new Error('Không tạo được hold công khai');
}

log((await api('GET', '/merchant/booking/deposit-exemptions', { token: receptionToken, tenant: TENANT })).status === 200, 'API: Lễ tân đọc được chính sách miễn cọc');
log((await api('PUT', '/merchant/booking/deposit-exemptions', { token: receptionToken, tenant: TENANT, body: OFF })).status === 403, 'API: Lễ tân sửa chính sách → 403');
log((await owner('PUT', '/merchant/booking/deposit-exemptions', { ...OFF, offPeakWindows: [{ weekdays: [1], from: '17:00', to: '10:00' }] })).status === 409, 'API: khung giờ vắng kết thúc trước khi bắt đầu → 409');
await owner('PUT', '/merchant/booking/deposit-exemptions', OFF);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('dialog', dialog => dialog.accept());
const step = async (name, fn) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/exemption-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
try {
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await selectTenant(page, TENANT);
  const settings = page.locator('details.deposit-exemptions');
  await step('Chính sách: mặc định mọi trường hợp tắt; kiểm tra dữ liệu trên trình duyệt', async () => {
    await goSection(page, 'Giá & chính sách'); await settings.locator('summary').click(); await settings.getByText('Lưu chính sách miễn cọc').waitFor();
    await settings.getByLabel(/Tổng tiền tối đa/).fill('abc'); await settings.getByRole('button', { name: 'Lưu chính sách miễn cọc' }).click(); await settings.locator('.error', { hasText: 'Ngưỡng tiền' }).waitFor();
    await settings.getByLabel(/Tổng tiền tối đa/).fill(''); await settings.getByRole('button', { name: /Thêm khung giờ vắng/ }).click();
    const window = settings.getByRole('group', { name: 'Khung giờ vắng 1' }); await window.getByLabel('Từ').fill('22:00'); await window.getByLabel('Đến').fill('02:00');
    await settings.getByRole('button', { name: 'Lưu chính sách miễn cọc' }).click(); await settings.locator('.error', { hasText: 'không qua nửa đêm' }).waitFor();
  });
  await step('Lưu: khung giờ vắng T2–T6 10:00–12:00, khách quen 3 lần, Lễ tân được duyệt miễn', async () => {
    const window = settings.getByRole('group', { name: 'Khung giờ vắng 1' }); await window.getByLabel('Từ').fill('10:00'); await window.getByLabel('Đến').fill('12:00');
    await settings.getByLabel(/số booking hoàn tất tối thiểu/).fill('3'); await settings.getByLabel('Lễ tân').check();
    await settings.getByRole('button', { name: 'Lưu chính sách miễn cọc' }).click(); await settings.getByText('Đã lưu chính sách miễn cọc').waitFor();
    const saved = (await owner('GET', '/merchant/booking/deposit-exemptions')).json;
    if (saved.offPeakWindows[0]?.from !== '10:00' || saved.regularMinCompleted !== 3 || !saved.waiverRoles.includes('RECEPTIONIST') || !saved.waiverRoles.includes('OWNER')) throw new Error(JSON.stringify(saved));
    return `phiên bản ${saved.version}`;
  });
  await page.screenshot({ path: `${SHOTS}/exemption-settings.png`, fullPage: true });
  // Keep only the manual waiver for the UI flow (the random hold must not match an automatic case by chance).
  await owner('PUT', '/merchant/booking/deposit-exemptions', { ...OFF, waiverRoles: ['OWNER', 'BRANCH_MANAGER', 'RECEPTIONIST'] });

  const hold = await publicHold(); const holdId = hold.holdId ?? hold.id;
  const holdCard = page.locator('section[aria-labelledby="hold-lookup-title"]');
  await step('Giữ chỗ thiếu cọc: chưa được miễn, có nút Miễn cọc, nút xác nhận bị khoá', async () => {
    await goSection(page, 'Lịch & Đặt phòng'); await holdCard.getByLabel('Mã giữ phòng', { exact: true }).fill(holdId); await holdCard.getByRole('button', { name: 'Tra cứu trạng thái' }).click();
    await holdCard.getByLabel(/Tôi đã gọi và xác minh/).check(); await holdCard.getByRole('button', { name: 'Ghi nhận cuộc gọi xác minh' }).click(); await holdCard.getByText('Đã ghi nhận cuộc gọi xác minh.').waitFor();
    await holdCard.getByText('Chưa thuộc trường hợp miễn cọc nào.').waitFor(); await holdCard.getByRole('button', { name: 'Miễn cọc' }).waitFor();
    if (!(await holdCard.getByRole('button', { name: 'Cần đủ cọc trước khi xác nhận' }).isDisabled())) throw new Error('nút xác nhận đang mở');
  });
  await step('Miễn cọc có lý do → nhãn "Được miễn cọc", mở nút xác nhận', async () => {
    await holdCard.getByRole('button', { name: 'Miễn cọc' }).click(); const dialog = page.locator('dialog.reason-dialog[open]'); await dialog.getByRole('textbox').fill('Khách đoàn công ty quen, E2E');
    await dialog.getByRole('button', { name: 'Miễn cọc' }).click(); await holdCard.locator('.exemption-panel .tag', { hasText: 'Được miễn cọc: duyệt miễn thủ công' }).waitFor();
    await holdCard.getByText('Lý do miễn: Khách đoàn công ty quen, E2E').waitFor(); await holdCard.getByRole('button', { name: 'Xác nhận booking (được miễn cọc)' }).waitFor();
  });
  await step('Huỷ miễn cọc → quay lại cần đủ cọc', async () => {
    await holdCard.getByRole('button', { name: 'Huỷ miễn cọc' }).click(); await holdCard.getByText('Đã huỷ miễn cọc.').waitFor();
    await holdCard.getByRole('button', { name: 'Cần đủ cọc trước khi xác nhận' }).waitFor();
  });
  await step('Lễ tân (được cấp quyền) miễn cọc qua API; Owner xác nhận booking không cần cọc', async () => {
    const waived = await api('POST', `/merchant/booking/holds/${holdId}/deposit-waiver`, { token: receptionToken, tenant: TENANT, body: { reason: 'Lễ tân miễn theo chính sách E2E' } });
    if (waived.status !== 200 || !waived.json.exempt) throw new Error(`waive ${waived.status}`);
    await holdCard.getByRole('button', { name: 'Tra cứu trạng thái' }).click(); const confirm = holdCard.getByRole('button', { name: 'Xác nhận booking (được miễn cọc)' }); await confirm.waitFor();
    await page.waitForFunction(() => document.querySelector('.hold-detail-form textarea')?.value.length > 0); await confirm.click(); await holdCard.getByText(/Đã xác nhận booking/).waitFor();
  });
  await step('Booking lưu lý do miễn cọc, hiện trong lịch booking', async () => {
    const booking = (await owner('GET', `/merchant/branches/${BRANCH}/booking/bookings?from=${encodeURIComponent(new Date(Date.parse(hold.startAt) - 3600000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(hold.startAt) + 3600000).toISOString())}`)).json;
    const items = booking.items ?? booking; const found = items.find(item => item.customerPhone?.endsWith(hold.phone.slice(-3)) && Date.parse(item.startAt) === Date.parse(hold.startAt));
    if (!found?.confirmationPolicySnapshot?.depositExemptionReasons?.includes('MANUAL_WAIVER')) throw new Error(JSON.stringify(found?.confirmationPolicySnapshot ?? items.length));
    const ops = page.locator('section[aria-labelledby="booking-ops-title"]'); const local = iso => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 16);
    await ops.getByLabel('Từ thời gian').fill(local(new Date(Date.parse(hold.startAt) - 3600000).toISOString())); await ops.getByLabel('Đến thời gian').fill(local(new Date(Date.parse(hold.startAt) + 3600000).toISOString())); await ops.getByRole('button', { name: 'Xem booking' }).click();
    await ops.locator('.booking-row', { hasText: hold.phone.slice(-3) }).locator('.pill', { hasText: 'Được miễn cọc: duyệt miễn thủ công' }).waitFor();
  });
  await page.screenshot({ path: `${SHOTS}/exemption-hold.png`, fullPage: true });
  await step('Trường hợp tự động: ngưỡng tiền ≥ tổng tiền → hold được miễn "giá trị nhỏ"', async () => {
    const second = await publicHold(); await owner('PUT', '/merchant/booking/deposit-exemptions', { ...OFF, maxAmountVnd: second.total });
    const status = (await owner('GET', `/merchant/booking/holds/${second.holdId ?? second.id}/deposit-exemption`)).json; if (!status.exempt || !status.reasons.includes('AMOUNT')) throw new Error(JSON.stringify(status));
    return `tổng ${second.total}`;
  });
} finally {
  const reset = await owner('PUT', '/merchant/booking/deposit-exemptions', OFF);
  log(reset.status === 200, 'dọn dẹp: chính sách miễn cọc về mọi trường hợp tắt'); await ctx.close();
}
await browser.close();
finish();
