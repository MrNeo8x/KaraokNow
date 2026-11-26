// Platform Admin onboarding plus role separation: Owner blocked on /platform; Owner creates a Receptionist who must change
// the temporary password and then cannot see Owner-only sections.
import { BASE, TENANT, OWNER, PLATFORM, SHOTS, launch, reporter } from './lib.mjs';
const { log, finish } = reporter();
const browser = await launch();
async function session(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) console.log('   ↳', r.status(), r.request().method(), r.url().replace(BASE, '')); });
  page.on('dialog', d => d.accept());
  const step = async (name, fn) => { try { log(true, `${label}: ${name}`, (await fn()) ?? ''); } catch (e) { log(false, `${label}: ${name}`, e.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/${label}-error-${results.length}.png`, fullPage: true }); } };
  return { ctx, page, errors, step };
}
async function login(page, path, email, password) { await page.goto(BASE + path); await page.getByLabel('Email').fill(email); await page.getByLabel('Mật khẩu').fill(password); await page.getByRole('button', { name: 'Đăng nhập' }).click(); }

// Platform Admin
{
  const { ctx, page, errors, step } = await session('platform');
  await step('đăng nhập /platform', async () => { await login(page, '/platform', PLATFORM.email, PLATFORM.password); await page.getByRole('heading', { name: 'Duyệt listing merchant' }).waitFor(); });
  await step('lọc listing Tất cả', async () => { await page.locator('#platform-listings-title').locator('xpath=ancestor::section').getByLabel('Lọc').selectOption('ALL'); await page.locator('article.booking-row').first().waitFor(); return `${await page.locator('article.booking-row').count()} listing`; });
  const merchants = page.locator('section[aria-labelledby="platform-merchants-title"]');
  const code = 'UI_' + Date.now().toString(36).toUpperCase();
  await step('tạo merchant qua form (mã chữ thường tự viết hoa)', async () => {
    await merchants.getByLabel('Mã merchant').fill(code.toLowerCase()); await merchants.getByLabel('Tên merchant').fill('Karaoke UI test');
    await merchants.getByLabel('Email Owner').fill(`ui.owner.${Date.now()}@karaokenow.local`); await merchants.getByLabel('Tên hiển thị Owner').fill('UI Owner');
    await merchants.getByRole('button', { name: 'Tạo ngẫu nhiên' }).click(); await merchants.getByRole('button', { name: 'Tạo merchant' }).click();
    await merchants.locator('.customer-receipt').waitFor(); return (await merchants.locator('.customer-receipt h3').innerText());
  });
  await step('merchant mới có trong danh sách', async () => { await merchants.locator('table.admin-table td', { hasText: code }).first().waitFor(); });
  await step('trùng mã → thông báo 409', async () => {
    await merchants.getByLabel('Mã merchant').fill(code); await merchants.getByLabel('Tên merchant').fill('dup'); await merchants.getByLabel('Email Owner').fill('dup@karaokenow.local'); await merchants.getByLabel('Tên hiển thị Owner').fill('dup');
    await merchants.getByRole('button', { name: 'Tạo ngẫu nhiên' }).click(); await merchants.getByRole('button', { name: 'Tạo merchant' }).click();
    await merchants.locator('.error', { hasText: 'đã được dùng' }).waitFor();
  });
  await step('email đã có tài khoản → cảnh báo mật khẩu tạm không áp dụng', async () => {
    await merchants.getByLabel('Mã merchant').fill(code + '2'); await merchants.getByLabel('Tên merchant').fill('Existing'); await merchants.getByLabel('Email Owner').fill(OWNER.email); await merchants.getByLabel('Tên hiển thị Owner').fill('x');
    await merchants.getByRole('button', { name: 'Tạo ngẫu nhiên' }).click(); await merchants.getByRole('button', { name: 'Tạo merchant' }).click();
    await merchants.locator('.deposit-callout', { hasText: 'không' }).waitFor();
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); log(overflow <= 0, 'platform: không cuộn ngang', `overflow=${overflow}`);
  await page.screenshot({ path: SHOTS + '/platform.png', fullPage: true });
  log(errors.filter(e => !/status of (409|403)/.test(e)).length === 0, 'platform: không lỗi console ngoài 409', errors.slice(0, 3).join(' | '));
  await ctx.close();
}
// Owner trên /platform → thông báo không có quyền
{
  const { ctx, page, step } = await session('owner-platform');
  await step('Owner mở /platform thấy thông báo không có quyền', async () => { await login(page, '/platform', OWNER.email, OWNER.password); await page.getByText('không có quyền Platform Admin').waitFor(); if (await page.locator('#platform-merchants-title').count()) throw new Error('vẫn hiện màn merchant'); });
  await ctx.close();
}
// Owner tạo Lễ tân → Lễ tân đăng nhập, đổi mật khẩu, không thấy màn Owner
const staffEmail = `ui.reception.${Date.now()}@karaokenow.local`; const temp = 'Temp-password-2026'; const fresh = 'Fresh-password-2026!';
{
  const { ctx, page, step } = await session('owner');
  await step('tạo Lễ tân qua màn Nhân viên', async () => {
    await login(page, '/merchant', OWNER.email, OWNER.password);
    await page.getByLabel('Tenant ID').fill(TENANT); await page.getByRole('button', { name: 'Áp dụng' }).click();
    const sec = page.locator('section[aria-labelledby="memberships-title"]'); await sec.locator('table').waitFor({ timeout: 15000 });
    await sec.locator('summary', { hasText: 'Thêm nhân viên' }).click();
    await sec.getByLabel('Email').fill(staffEmail); await sec.getByLabel('Tên hiển thị').fill('UI Lễ tân'); await sec.getByLabel(/Mật khẩu tạm/).fill(temp);
    await sec.getByRole('button', { name: 'Thêm nhân viên' }).click();
    await sec.locator('.error', { hasText: 'ít nhất một chi nhánh' }).waitFor();
    await sec.locator('details.outcome-form .grant-picker fieldset').nth(1).locator('input[type=checkbox]').first().check();
    await sec.getByRole('button', { name: 'Thêm nhân viên' }).click();
    await sec.locator('td', { hasText: staffEmail }).waitFor(); return staffEmail;
  });
  await ctx.close();
}
{
  const { ctx, page, errors, step } = await session('reception');
  await step('đăng nhập lần đầu bị buộc đổi mật khẩu', async () => { await login(page, '/merchant', staffEmail, temp); await page.getByRole('heading', { name: 'Đổi mật khẩu' }).waitFor(); });
  await step('đổi mật khẩu rồi đăng nhập lại', async () => {
    await page.getByLabel('Mật khẩu hiện tại').fill(temp); await page.getByLabel('Mật khẩu mới').fill(fresh); await page.getByRole('button', { name: 'Đổi mật khẩu' }).click();
    await page.getByText('Đổi mật khẩu thành công').waitFor(); await page.getByLabel('Mật khẩu', { exact: true }).fill(fresh); await page.getByLabel('Email').fill(staffEmail); await page.getByRole('button', { name: 'Đăng nhập' }).click(); await page.getByLabel('Tenant ID').waitFor();
  });
  await step('Lễ tân thấy màn giữ phòng, không thấy màn Owner', async () => {
    await page.getByLabel('Tenant ID').fill(TENANT); await page.getByRole('button', { name: 'Áp dụng' }).click();
    await page.getByRole('heading', { name: 'Danh sách giữ phòng tạm thời' }).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500);
    const visible = []; for (const id of ['publication-title', 'memberships-title', 'ops-title', 'audit-title', 'public-terms-title']) if (await page.locator('#' + id).count()) visible.push(id);
    if (visible.length) throw new Error('vẫn hiện: ' + visible.join(',')); return 'ẩn publication/nhân viên/vận hành/audit';
  });
  await page.screenshot({ path: SHOTS + '/reception.png', fullPage: true });
  log(errors.filter(e => !/status of (403|404)/.test(e)).length === 0, 'reception: không lỗi console ngoài 403 dự kiến', errors.filter(e => !/status of (403|404)/.test(e)).slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close(); finish();
