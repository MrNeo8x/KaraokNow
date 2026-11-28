// FE-012 / IAM-007: session kept across F5 through the HttpOnly kn_refresh cookie, merchant picker, multi-tab
// refresh, logout clearing the cookie, single-membership auto-open and a missing cookie falling back to sign-in.
import { BASE, TENANT, OWNER, SHOTS, launch, reporter } from './lib.mjs';

const { log, finish } = reporter();
const RECEPTION = { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' };
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('dialog', dialog => dialog.accept());
const step = async (name, fn, target = page) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await target.screenshot({ path: `${SHOTS}/session-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
const refreshCookie = async () => (await ctx.cookies(`${BASE}/v1/auth/refresh`)).find(cookie => cookie.name === 'kn_refresh'); // cookie path is /v1/auth
const signedIn = target => target.locator('.admin-sidebar').waitFor({ timeout: 15000 });

try {
  await step('Đăng nhập Owner: hiện danh sách chọn merchant', async () => {
    await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.locator('.kpi, .tenant-picker').first().waitFor();
    if (await page.locator('.tenant-picker').count()) { const count = await page.locator('.tenant-option').count(); await page.locator(`.tenant-option[data-tenant-id="${TENANT}"]`).click(); await page.locator('.kpi').first().waitFor(); return `${count} merchant trong danh sách`; }
    return 'đã tự mở merchant đã nhớ';
  });
  await step('Cookie kn_refresh: HttpOnly, SameSite=Strict, path /v1/auth', async () => {
    const cookie = await refreshCookie(); if (!cookie) throw new Error('không có cookie kn_refresh');
    if (!cookie.httpOnly || cookie.sameSite !== 'Strict' || cookie.path !== '/v1/auth') throw new Error(JSON.stringify({ httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path }));
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    if (stored.includes(cookie.value)) throw new Error('refresh token xuất hiện trong web storage');
    return `secure=${cookie.secure} (local compose tắt Secure)`;
  });
  await step('F5: vẫn đăng nhập, giữ merchant và mục đang xem', async () => {
    await page.locator('.admin-sidebar').getByRole('button', { name: 'Tiền mặt', exact: true }).click(); await page.locator('#cash-report-title').waitFor();
    await page.reload(); await signedIn(page);
    if (await page.getByLabel('Mật khẩu').count()) throw new Error('hiện lại form đăng nhập');
    await page.locator('#cash-report-title').waitFor();
    const footer = await page.locator('.admin-sidebar-footer').innerText(); if (!footer.includes(TENANT)) throw new Error('mở sai merchant');
  });
  let second;
  await step('Tab thứ hai cùng trình duyệt tự khôi phục phiên', async () => { second = await ctx.newPage(); second.setDefaultTimeout(15000); await second.goto(BASE + '/merchant'); await signedIn(second); await second.locator('.kpi').first().waitFor(); });
  await step('Hai tab F5 cùng lúc: cả hai vẫn đăng nhập', async () => {
    await Promise.all([page.reload(), second.reload()]); await Promise.all([signedIn(page), signedIn(second)]);
    for (const target of [page, second]) if (await target.getByLabel('Mật khẩu').count()) throw new Error('một tab bị đăng xuất');
    await second.close();
  });
  await step('Đổi merchant: hiện lại danh sách chọn', async () => {
    const button = page.locator('.admin-sidebar-footer').getByRole('button', { name: 'Đổi merchant' });
    if (!(await button.count())) return 'tài khoản chỉ có một merchant: không có nút đổi';
    await button.click(); await page.locator('.tenant-picker').waitFor(); await page.locator(`.tenant-option[data-tenant-id="${TENANT}"]`).click(); await page.locator('.kpi').first().waitFor();
  });
  await step('Đăng xuất xoá cookie; F5 về màn đăng nhập', async () => {
    await page.locator('.admin-sidebar-footer').getByRole('button', { name: 'Đăng xuất' }).click(); await page.getByLabel('Mật khẩu').waitFor();
    await page.waitForTimeout(500); if (await refreshCookie()) throw new Error('cookie còn sau đăng xuất');
    await page.reload(); await page.getByLabel('Mật khẩu').waitFor();
  });
} finally { await ctx.close(); }

// Single membership opens directly; a lost cookie falls back to sign-in without an error loop.
{
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const rpage = await rctx.newPage(); rpage.setDefaultTimeout(15000);
  await step('Lễ tân (một merchant): tự mở merchant, không hiện danh sách', async () => {
    await rpage.goto(BASE + '/merchant'); await rpage.getByLabel('Email').fill(RECEPTION.email); await rpage.getByLabel('Mật khẩu').fill(RECEPTION.password); await rpage.getByRole('button', { name: 'Đăng nhập' }).click();
    await rpage.locator('.kpi').first().waitFor(); if (await rpage.locator('.tenant-picker').count()) throw new Error('vẫn hiện danh sách chọn');
  }, rpage);
  await step('Mất cookie: F5 về màn đăng nhập, không báo lỗi lặp', async () => {
    await rctx.clearCookies(); await rpage.reload(); await rpage.getByLabel('Mật khẩu').waitFor();
    const errors = await rpage.locator('.error').allInnerTexts(); if (errors.length) throw new Error(`hiện lỗi: ${errors[0]}`);
  }, rpage);
  await rctx.close();
}

await browser.close();
finish();
