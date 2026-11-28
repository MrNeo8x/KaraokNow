// FE-017 / IAM-008 (PD-040): Platform Admin user management. Destructive actions run only on a merchant and users this
// script creates; UAT accounts are only read.
import { BASE, OWNER, PLATFORM, SHOTS, launch, reporter, api, loginToken, goSection } from './lib.mjs';

const { log, finish } = reporter();
const stamp = Date.now(); const ownerEmail = `pu.owner.${stamp}@karaokenow.local`; const memberEmail = `pu.member.${stamp}@karaokenow.local`; const temp = 'Platform-temp-2026';
const platformToken = await loginToken(PLATFORM);
const merchant = (await api('POST', '/platform/merchants', { token: platformToken, body: { code: `PU_${stamp.toString(36).toUpperCase()}`, name: `Karaoke PU ${stamp}`, owner: { email: ownerEmail, displayName: 'PU Owner', temporaryPassword: temp } } })).json;
log(Boolean(merchant.tenantId), 'chuẩn bị: merchant thử với Owner riêng', merchant.code);
const ownerToken = await loginToken(OWNER);
log((await api('GET', '/platform/users', { token: ownerToken })).status === 403, 'API: user không phải Platform Admin → 403');
const loginStatus = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).status;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const step = async (name, fn) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/platform-users-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
const users = page.locator('section[aria-labelledby="users-title"]'); const detail = users.locator('.user-detail'); const dialog = page.locator('dialog.reason-dialog[open]');
async function search(text) { await users.getByLabel('Tìm theo email hoặc tên').fill(text); await users.locator('tbody tr', { hasText: text }).first().waitFor(); }
async function open(email) { await search(email); await users.getByRole('button', { name: `Xem chi tiết ${email}` }).click(); await detail.waitFor(); }
async function confirmWith(reason, label) { await dialog.getByLabel(/Lý do/).fill(reason); await dialog.getByRole('button', { name: label }).click(); await dialog.waitFor({ state: 'hidden' }); }

try {
  await page.goto(BASE + '/platform'); await page.getByLabel('Email').fill(PLATFORM.email); await page.getByLabel('Mật khẩu').fill(PLATFORM.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.locator('.admin-sidebar').waitFor();
  await step('Tìm user Lễ tân UAT, xem merchant và vai trò', async () => { await goSection(page, 'Người dùng'); await open('uat.reception@karaokenow.local'); const text = await detail.innerText(); if (!/KaraokeNow UAT/.test(text) || !/Lễ tân/.test(text)) throw new Error(text.slice(0, 160)); });
  await step('Tài khoản của chính mình: không có nút thao tác', async () => { await open(PLATFORM.email); await detail.getByText('Đây là tài khoản của bạn').waitFor(); if (await detail.getByRole('button', { name: 'Khoá tài khoản' }).count()) throw new Error('vẫn có nút khoá'); });

  // Members of the test merchant
  const row = () => page.locator('section[aria-labelledby="platform-merchants-title"] tbody tr', { hasText: merchant.code }).first();
  const panel = page.locator('.members-panel');
  await step('Thành viên: thêm thành viên qua giao diện (bắt buộc lý do)', async () => {
    await goSection(page, 'Merchant'); await row().waitFor(); await row().getByRole('button', { name: 'Thành viên' }).click(); await panel.locator('table').waitFor();
    await panel.locator('summary', { hasText: 'Thêm thành viên' }).click();
    await panel.getByLabel('Email').fill(memberEmail); await panel.getByLabel('Tên hiển thị').fill('PU Member'); await panel.getByLabel(/Mật khẩu tạm/).fill(temp);
    await panel.locator('.grant-picker fieldset').first().getByLabel('Chủ (Owner)').uncheck(); await panel.locator('.grant-picker fieldset').first().getByLabel('Thu ngân').check();
    await panel.getByLabel('Lý do (bắt buộc)').fill('Thêm quản lý theo yêu cầu merchant');
    await panel.getByRole('button', { name: 'Thêm thành viên' }).click(); await panel.locator('.error', { hasText: 'chi nhánh' }).waitFor(); // branch-scoped role without a branch
    await panel.locator('.grant-picker fieldset').first().getByLabel('Chủ (Owner)').check(); await panel.getByRole('button', { name: 'Thêm thành viên' }).click();
    await panel.locator('td', { hasText: memberEmail }).waitFor();
  });
  await step('Thành viên: vô hiệu hoá được thành viên; Owner hoạt động cuối cùng thì bị chặn (409)', async () => {
    const memberRow = panel.locator('tr', { hasText: memberEmail }); await memberRow.getByRole('button', { name: 'Vô hiệu hoá' }).click(); await confirmWith('Thử vô hiệu hoá', 'Vô hiệu hoá');
    await memberRow.locator('.pill', { hasText: 'Đã vô hiệu hoá' }).waitFor();
    const ownerRow = panel.locator('tr', { hasText: ownerEmail }); await ownerRow.getByRole('button', { name: 'Vô hiệu hoá' }).click();
    await dialog.getByLabel(/Lý do/).fill('Thử bỏ Owner cuối'); await dialog.getByRole('button', { name: 'Vô hiệu hoá' }).click(); await dialog.locator('.error').waitFor();
    const message = await dialog.locator('.error').innerText(); await dialog.getByRole('button', { name: 'Huỷ' }).click(); return message.slice(0, 90);
  });
  await step('Thành viên: kích hoạt lại có lý do', async () => {
    const memberRow = panel.locator('tr', { hasText: memberEmail }); await memberRow.getByRole('button', { name: 'Kích hoạt lại' }).click(); await confirmWith('Kích hoạt lại', 'Kích hoạt lại');
    await memberRow.locator('.pill', { hasText: 'Hoạt động' }).waitFor();
  });
  await page.screenshot({ path: `${SHOTS}/platform-members.png`, fullPage: true });

  // Account actions on the new member
  await step('Khoá tài khoản: thiếu lý do bị chặn; khoá xong không đăng nhập được', async () => {
    await goSection(page, 'Người dùng'); await open(memberEmail);
    await detail.getByRole('button', { name: 'Khoá tài khoản' }).click(); await dialog.getByRole('button', { name: 'Khoá tài khoản' }).click(); await dialog.locator('.error', { hasText: 'lý do' }).waitFor();
    await confirmWith('Nghi lộ mật khẩu', 'Khoá tài khoản'); await detail.getByText(/Đã khoá/).first().waitFor();
    const status = await loginStatus(memberEmail, temp); if (status < 400) throw new Error(`đăng nhập vẫn được (${status})`); return `đăng nhập → ${status}`;
  });
  await step('Mở khoá: đăng nhập lại được', async () => { await detail.getByRole('button', { name: 'Mở khoá' }).click(); await confirmWith('Đã xác minh chủ tài khoản', 'Mở khoá'); await detail.getByRole('button', { name: 'Khoá tài khoản' }).waitFor(); const status = await loginStatus(memberEmail, temp); if (status >= 400) throw new Error(`đăng nhập lỗi ${status}`); });
  await step('Mật khẩu tạm: hiện một lần, đăng nhập bằng mật khẩu đó phải đổi mật khẩu', async () => {
    await detail.getByRole('button', { name: 'Cấp mật khẩu tạm' }).click(); await confirmWith('Người dùng quên mật khẩu', 'Cấp mật khẩu tạm');
    const password = (await detail.locator('.secret-box code').innerText()).trim();
    const login = await api('POST', '/auth/login', { body: { email: memberEmail, password } }); if (login.status >= 400 || login.json.mustChangePassword !== true) throw new Error(`login ${login.status} mustChange=${login.json?.mustChangePassword}`);
    await detail.getByRole('button', { name: 'Ẩn' }).click(); if (await detail.locator('.secret-box').count()) throw new Error('mật khẩu vẫn hiện');
  });
  await step('Cấp rồi thu hồi Platform Admin', async () => {
    await detail.getByRole('button', { name: 'Cấp Platform Admin' }).click(); await confirmWith('Hỗ trợ vận hành tạm thời', 'Cấp quyền'); await users.locator('tr', { hasText: memberEmail }).locator('.pill', { hasText: 'Platform Admin' }).waitFor();
    await detail.getByRole('button', { name: 'Thu hồi Platform Admin' }).click(); await confirmWith('Hết thời gian hỗ trợ', 'Thu hồi quyền'); await detail.getByRole('button', { name: 'Cấp Platform Admin' }).waitFor();
  });
  await step('Lọc: chỉ Platform Admin', async () => { await users.getByLabel('Tìm theo email hoặc tên').fill(''); await users.getByLabel('Platform Admin').selectOption('true'); await users.locator('tbody tr', { hasText: PLATFORM.email }).waitFor(); if (await users.locator('tbody tr', { hasText: memberEmail }).count()) throw new Error('user đã thu hồi vẫn trong danh sách admin'); });
  await page.screenshot({ path: `${SHOTS}/platform-users.png`, fullPage: true });
} finally { await ctx.close(); }

// Clean up: suspend the throwaway merchant so it never shows to guests.
await api('POST', `/platform/merchants/${merchant.tenantId}/suspend`, { token: platformToken, body: { reason: 'E2E platform-users dọn dẹp' } });
await browser.close();
finish();
