// FE-019 / VEN-005 (PD-043): opening hours in the branch form, hour buttons from the opening window (past midnight on
// the next calendar day), custom 15-minute start, policy durations and 422 handling. Resets the UAT branch to 24 h.
import { BASE, TENANT, OWNER, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const BRANCH = '10000000-0000-4000-8000-000000000004';
const token = await loginToken(OWNER);
const branchNow = async () => (await api('GET', `/merchant/branches/${BRANCH}`, { token, tenant: TENANT })).json;
const day = new Date(Date.now() + 7 * 3600000 + (20 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const step = async (name, fn, target = page) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await target.screenshot({ path: `${SHOTS}/opening-hours-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
try {
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await selectTenant(page, TENANT); await goSection(page, 'Phòng hát');
  const edit = page.locator('details', { has: page.locator('summary', { hasText: 'Chỉnh sửa chi nhánh' }) });
  const hoursBox = edit.locator('fieldset', { hasText: 'Giờ mở cửa' });
  await step('Form chi nhánh: giờ mở và đóng trùng nhau bị chặn', async () => {
    await edit.locator('summary').click(); await hoursBox.getByLabel('Mở 24 giờ').uncheck();
    await hoursBox.getByLabel('Giờ mở cửa').fill('18:00'); await hoursBox.getByLabel('Giờ đóng cửa').fill('18:00');
    await edit.getByRole('button', { name: 'Lưu chi nhánh' }).click(); return await page.locator('.venue-actions .error', { hasText: 'trùng' }).innerText();
  });
  await step('Form chi nhánh: lưu giờ 18:00–02:00 (qua nửa đêm)', async () => {
    await hoursBox.getByLabel('Giờ đóng cửa').fill('02:00'); await hoursBox.getByText('Đóng cửa sau nửa đêm').waitFor();
    await edit.getByRole('button', { name: 'Lưu chi nhánh' }).click(); await page.getByText('Đã cập nhật chi nhánh.').waitFor();
    const saved = await branchNow(); if (saved.openingTime !== '18:00' || saved.closingTime !== '02:00') throw new Error(`${saved.openingTime}–${saved.closingTime}`);
  });

  const guest = await ctx.newPage(); guest.setDefaultTimeout(15000);
  await guest.goto(BASE + '/booking'); await guest.locator('.branch-option').first().waitFor(); await guest.locator('.branch-option', { hasText: 'KaraokeNow UAT Hồ Chí Minh' }).click();
  await step('Trang khách: hiện giờ mở cửa', async () => guest.getByText('Mở cửa 18:00–02:00 (qua nửa đêm)').first().innerText(), guest);
  await step('Nút giờ theo khung mở cửa: 18:00 → 00:00 (hôm sau) với 2 giờ', async () => {
    await guest.getByLabel('Ngày', { exact: true }).fill(day);
    const labels = await guest.getByRole('group', { name: 'Giờ bắt đầu' }).getByRole('button').allInnerTexts();
    const clean = labels.map(text => text.replace(/\s+/g, ' ').trim());
    if (clean[0] !== '18:00' || clean.at(-1) !== '00:00 hôm sau' || clean.some(text => text.startsWith('17:') || text.startsWith('01:'))) throw new Error(clean.join(', '));
    return clean.join(', ');
  }, guest);
  await step('Chọn 00:00: báo rạng sáng hôm sau và gửi startAt đúng ngày lịch', async () => {
    await guest.getByRole('group', { name: 'Giờ bắt đầu' }).getByRole('button', { name: /^00:00/ }).click();
    await guest.locator('.custom-time .notice', { hasText: 'rạng sáng' }).waitFor();
    const [requestSent] = await Promise.all([guest.waitForRequest(request => request.url().includes('/availability?')), guest.getByRole('button', { name: /Tìm phòng trống/ }).click()]);
    const startAt = new URL(requestSent.url()).searchParams.get('startAt'); if (startAt !== `${nextDay}T00:00:00+07:00`) throw new Error(startAt);
    await guest.getByRole('heading', { name: 'Phòng còn trống' }).waitFor(); return startAt;
  }, guest);
  await step('Giờ khác ngoài giờ mở cửa (17:45) hoặc lệch bước 15 phút (20:10): báo lỗi, khoá nút tìm', async () => {
    const custom = guest.getByLabel('Giờ khác'); const search = guest.getByRole('button', { name: /Tìm phòng trống/ });
    await custom.fill('17:45'); await guest.locator('.custom-time .error', { hasText: 'ngoài giờ mở cửa' }).waitFor(); if (!(await search.isDisabled())) throw new Error('nút tìm vẫn bật (17:45)');
    await custom.fill('20:10'); await guest.locator('.custom-time .error', { hasText: 'bước 15 phút' }).waitFor(); if (!(await search.isDisabled())) throw new Error('nút tìm vẫn bật (20:10)');
  }, guest);
  await step('Giờ khác 23:45 với 2 giờ (kết thúc 01:45) đặt được', async () => {
    await guest.getByLabel('Giờ khác').fill('23:45'); if (await guest.locator('.custom-time .error').count()) throw new Error(await guest.locator('.custom-time .error').innerText());
    await guest.getByRole('button', { name: /Tìm phòng trống/ }).click(); await guest.getByRole('heading', { name: 'Phòng còn trống' }).waitFor();
  }, guest);
  await step('Thời lượng theo chính sách: tối thiểu 1 giờ thì nút giảm bị khoá', async () => {
    const minus = guest.getByRole('button', { name: 'Giảm thời lượng' });
    while (!(await minus.isDisabled())) await minus.click();
    return await guest.getByLabel('Thời lượng', { exact: true }).innerText();
  }, guest);
  await guest.screenshot({ path: `${SHOTS}/opening-hours-booking.png`, fullPage: true });

  const outside = await api('GET', `/public/branches/${BRANCH}/availability?startAt=${encodeURIComponent(`${day}T17:00:00+07:00`)}&durationMinutes=120`);
  log(outside.status === 422 && /opening hours/i.test(outside.json?.error?.message ?? ''), 'API: đặt 17:00 ngoài giờ mở cửa → 422', outside.json?.error?.message);
  const offGrid = await api('GET', `/public/branches/${BRANCH}/availability?startAt=${encodeURIComponent(`${day}T20:10:00+07:00`)}&durationMinutes=60`);
  log(offGrid.status === 422 && /15-minute/i.test(offGrid.json?.error?.message ?? ''), 'API: giờ 20:10 lệch bước 15 phút → 422', offGrid.json?.error?.message);
} finally {
  const reset = await api('PATCH', `/merchant/branches/${BRANCH}`, { token, tenant: TENANT, body: { openingTime: null, closingTime: null } });
  log(reset.status === 200 && reset.json.openingTime === null, 'dọn dẹp: chi nhánh UAT về mở 24 giờ');
  await ctx.close();
}
await browser.close();
finish();
