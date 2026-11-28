// Guest booking flow on mobile (390px) and desktop: search → quote → terms → hold → booking code → lookup → reload.
import { BASE, SHOTS, launch, reporter, writeArtifact } from './lib.mjs';
const { log, finish } = reporter();
const browser = await launch();
const out = {};
for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); const errors = []; let expected404 = false;
  page.on('console', m => { if (m.type() === 'error' && !expected404) errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); page.on('response', r => { if (r.status() >= 400) console.log('   ↳', r.status(), r.request().method(), r.url().replace(BASE, '')); });
  try {
    await page.goto(BASE + '/booking'); await page.getByRole('button', { name: 'Tìm phòng trống' }).waitFor();
    await page.locator('.branch-option').first().waitFor();
    // Other published merchants (e.g. a real one added locally) may sort first: always book the seeded UAT branch.
    await page.locator('.branch-option', { hasText: 'KaraokeNow UAT Hồ Chí Minh' }).click();
    const day = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('Ngày', { exact: true }).fill(day); await page.getByRole('group', { name: 'Giờ bắt đầu' }).getByRole('button', { name: vp.name === 'mobile' ? '19:00' : '21:00' }).click();
    await page.getByRole('button', { name: 'Tăng số khách' }).click();
    await page.getByRole('button', { name: 'Tìm phòng trống' }).click();
    await page.getByRole('heading', { name: 'Phòng còn trống' }).waitFor(); log(true, `${vp.name}: tìm phòng trống`);
    await page.locator('.room-option:not([disabled]) .room-price', { hasText: '₫' }).first().waitFor(); log(true, `${vp.name}: giá hiện trên danh sách phòng`, await page.locator('.room-price').first().innerText());
    await page.locator('.room-option:not([disabled])').first().click();
    await page.locator('.summary.customer-quote').waitFor(); log(true, `${vp.name}: tóm tắt đặt phòng`, await page.locator('.summary .total strong').innerText());
    await page.getByText('Đọc điều khoản đặt phòng').click();
    await page.getByLabel(/Tôi đã đọc và đồng ý/).check();
    const phone = '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const contact = page.locator('form.customer-contact');
    await contact.getByLabel('Số điện thoại').fill(phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3'));
    await contact.getByRole('button', { name: /Giữ phòng/ }).click();
    await page.locator('.booking-code').waitFor({ timeout: 10000 });
    const shown = (await page.locator('.booking-code').innerText()).trim(); const code = shown.replace(/\s/g, '');
    log(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code) && /^\S{3} \S{3}$/.test(shown), `${vp.name}: giữ chỗ, hiện mã 6 ký tự tách đôi`, shown);
    log(await page.locator('.deposit-callout').isVisible(), `${vp.name}: hiện số cọc cần đóng`, await page.locator('.deposit-callout').innerText().catch(() => ''));
    log(await page.locator('.success-card .branch-contact a[href^="tel:"]').count() === 1 && await page.locator('.success-card .branch-contact a', { hasText: 'Chỉ đường' }).count() === 1, `${vp.name}: biên nhận có nút gọi và Chỉ đường của chi nhánh`);
    await page.screenshot({ path: `${SHOTS}/customer-${vp.name}-receipt.png`, fullPage: true });
    // lookup (prefilled after hold)
    const lookup = page.locator('section.customer-lookup');
    await lookup.getByRole('button', { name: 'Tra cứu' }).click();
    await lookup.locator('.customer-receipt').waitFor(); log(/chờ nhân viên/.test(await lookup.locator('h3').innerText()), `${vp.name}: tra cứu ra trạng thái giữ chỗ`, await lookup.locator('h3').innerText());
    log(await lookup.locator('.customer-receipt .branch-contact a', { hasText: 'Chỉ đường' }).count() === 1, `${vp.name}: kết quả tra cứu có Chỉ đường`);
    // wrong code → generic 404 message
    await lookup.getByLabel('Mã đặt phòng').fill(`${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`); await lookup.getByRole('button', { name: 'Tra cứu' }).click();
    await lookup.locator('.customer-receipt h3').waitFor(); log(true, `${vp.name}: tra cứu bằng chữ thường có dấu gạch`);
    await lookup.getByLabel('Mã đặt phòng').fill('f'.repeat(32)); expected404 = true; await lookup.getByRole('button', { name: 'Tra cứu' }).click();
    await lookup.locator('.error').waitFor(); await page.waitForTimeout(300); expected404 = false; log(/Không tìm thấy/.test(await lookup.locator('.error').innerText()), `${vp.name}: sai mã → thông báo chung`);
    // reload keeps receipt (sessionStorage)
    await page.reload(); await page.locator('.booking-code').waitFor({ timeout: 10000 });
    log((await page.locator('.booking-code').innerText()).replace(/\s/g, '') === code, `${vp.name}: reload vẫn giữ booking code`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    log(overflow <= 0, `${vp.name}: không cuộn ngang`, `overflow=${overflow}px`);
    await page.screenshot({ path: `${SHOTS}/customer-${vp.name}-full.png`, fullPage: true });
    const holdId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('karaokenow:public-hold-receipt:v1') || '{}').holdId);
    out[vp.name] = { phone, code, holdId };
  } catch (e) { log(false, `${vp.name}: lỗi kịch bản`, e.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/customer-${vp.name}-error.png`, fullPage: true }); }
  log(errors.length === 0, `${vp.name}: không có lỗi console (ngoài 404 tra sai mã cố ý)`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
writeArtifact('customer-holds.json', out);
await browser.close();
finish();
