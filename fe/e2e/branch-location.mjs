// FE-018 / VEN-004 (PD-042): branch address, public phone and Google Maps location in the branch form and on /booking.
// Leaves the seeded UAT branch with a known address, phone and location (useful for UAT).
import { BASE, TENANT, OWNER, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const BRANCH = '10000000-0000-4000-8000-000000000004';
const ADDRESS = 'Số 1 Hàng Bài, Hoàn Kiếm, Hà Nội'; const PHONE = '0989 015 619'; const COORDS = '21.0285, 105.8542';
const token = await loginToken(OWNER);
const branchNow = async () => (await api('GET', `/merchant/branches/${BRANCH}`, { token, tenant: TENANT })).json;
log((await api('POST', '/merchant/branch-location/resolve', { token, tenant: TENANT, body: { mapsLink: 'https://example.com/quan-karaoke' } })).status === 422, 'API: link không phải Google Maps → 422');
const resolved = (await api('POST', '/merchant/branch-location/resolve', { token, tenant: TENANT, body: { mapsLink: COORDS } })).json;
log(Math.abs(resolved.latitude - 21.0285) < 1e-6 && Math.abs(resolved.longitude - 105.8542) < 1e-6 && typeof resolved.directionsUrl === 'string', 'API: toạ độ dạng "lat, lng" đọc được', resolved.directionsUrl);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const step = async (name, fn, target = page) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await target.screenshot({ path: `${SHOTS}/branch-location-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
try {
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await selectTenant(page, TENANT); await goSection(page, 'Phòng hát');
  const edit = page.locator('details', { has: page.locator('summary', { hasText: 'Chỉnh sửa chi nhánh' }) });
  const fields = edit.locator('.location-fields');
  await step('Form chi nhánh: link sai → hướng dẫn cách lấy link', async () => {
    await edit.locator('summary').click(); await fields.getByLabel('Link Google Maps hoặc toạ độ').fill('https://example.com/quan-karaoke');
    await fields.getByRole('button', { name: /Xem trước vị trí/ }).click(); return await fields.locator('.error', { hasText: 'Chia sẻ' }).innerText();
  });
  await step('Form chi nhánh: xem trước toạ độ trước khi lưu', async () => {
    await fields.getByLabel('Link Google Maps hoặc toạ độ').fill(COORDS); await fields.getByRole('button', { name: /Xem trước vị trí/ }).click();
    const notice = fields.locator('.notice'); await notice.waitFor(); const href = await notice.locator('a').getAttribute('href'); if (!href?.includes('21.0285')) throw new Error(`link: ${href}`); return await notice.innerText();
  });
  await step('Lưu địa chỉ, SĐT và vị trí; BE lưu SĐT dạng +84', async () => {
    await fields.getByLabel('Địa chỉ').fill(ADDRESS); await fields.getByLabel('Số điện thoại liên hệ').fill(PHONE);
    await edit.getByRole('button', { name: 'Lưu chi nhánh' }).click(); await page.getByText('Đã cập nhật chi nhánh.').waitFor();
    const saved = await branchNow(); if (saved.address !== ADDRESS || saved.phone !== '+84989015619' || Math.abs(saved.latitude - 21.0285) > 1e-6) throw new Error(JSON.stringify({ address: saved.address, phone: saved.phone, latitude: saved.latitude }));
    return `${saved.phone} · ${saved.latitude}, ${saved.longitude}`;
  });
  await step('Để trống SĐT khi sửa → xoá (null); điền lại được', async () => {
    await page.waitForTimeout(800); if (!(await edit.evaluate(element => element.open))) await edit.locator('summary').click();
    await fields.getByLabel('Số điện thoại liên hệ').fill(''); await edit.getByRole('button', { name: 'Lưu chi nhánh' }).click(); await page.waitForTimeout(1200);
    if ((await branchNow()).phone !== null) throw new Error('SĐT chưa bị xoá');
    if (!(await edit.evaluate(element => element.open))) await edit.locator('summary').click();
    await fields.getByLabel('Số điện thoại liên hệ').fill(PHONE); await edit.getByRole('button', { name: 'Lưu chi nhánh' }).click(); await page.waitForTimeout(1200);
    const saved = await branchNow(); if (saved.phone !== '+84989015619' || saved.address !== ADDRESS) throw new Error(`phone=${saved.phone} address=${saved.address}`);
  });
  await page.screenshot({ path: `${SHOTS}/branch-location-form.png`, fullPage: true });

  const guest = await ctx.newPage(); guest.setDefaultTimeout(15000);
  await step('Trang khách: địa chỉ, nút gọi và nút Chỉ đường', async () => {
    await guest.goto(BASE + '/booking'); await guest.locator(`.branch-option`, { hasText: ADDRESS }).first().click();
    const contact = guest.locator('#booking .branch-contact'); await contact.waitFor();
    const tel = await contact.locator('a[href^="tel:"]').getAttribute('href'); const text = await contact.locator('a[href^="tel:"]').innerText();
    const directions = contact.getByRole('link', { name: /Chỉ đường/ }); const href = await directions.getAttribute('href'); const target = await directions.getAttribute('target');
    if (tel !== 'tel:+84989015619' || !text.includes(PHONE) || href !== resolved.directionsUrl || target !== '_blank') throw new Error(JSON.stringify({ tel, text, href, target }));
    await guest.screenshot({ path: `${SHOTS}/branch-location-booking.png` }); return `${text} · ${href}`;
  }, guest);
} finally { await ctx.close(); }
await browser.close();
finish();
