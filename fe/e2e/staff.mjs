// Reception/Owner flow on holds created by customer.mjs: deposit → verification → confirm → calendar → check-in/out → cash → cancel/refund → audit → sessions.
import { BASE, TENANT, OWNER, SHOTS, launch, reporter, readArtifact, goSection } from './lib.mjs';
const holds = readArtifact('customer-holds.json'); const { desktop } = holds;
const { log, finish } = reporter();
const lookup = await (await fetch(BASE + '/v1/public/booking/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: desktop.phone, bookingCode: desktop.code }) })).json();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) console.log('   ↳', r.status(), r.request().method(), r.url().replace(BASE, '')); });
page.on('dialog', d => { console.log('   ⚑ confirm:', d.message().slice(0, 90)); d.accept(); });
const step = async (name, fn) => { try { const extra = await fn(); log(true, name, extra ?? ''); } catch (e) { log(false, name, e.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/staff-error-${results.length}.png`, fullPage: true }); } };
try {
  await step('Owner đăng nhập', async () => { await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click(); await page.getByLabel('Tenant ID').waitFor(); });
  await step('Nhập tenant, tải chi nhánh', async () => { await page.getByLabel('Tenant ID').fill(TENANT); await page.getByRole('button', { name: 'Áp dụng' }).click(); await page.locator('.kpi').first().waitFor({ timeout: 15000 }); });
  await step('Màn Owner hiển thị (publication, nhân viên, vận hành, audit)', async () => {
    for (const h of ['Hiển thị catalog công khai', 'Theo dõi vận hành']) await page.getByRole('heading', { name: h }).waitFor({ timeout: 10000 });
    const tag = await page.locator('#publication-title').locator('..').locator('.tag').first().innerText();
    await goSection(page, 'Người dùng'); await page.getByRole('heading', { name: 'Nhân viên & phân quyền' }).waitFor();
    await goSection(page, 'Cài đặt hệ thống'); for (const h of ['Nhật ký audit', 'Phiên đăng nhập của tôi']) await page.getByRole('heading', { name: h }).waitFor();
    await goSection(page, 'Lịch & Đặt phòng'); await page.getByRole('heading', { name: 'Danh sách giữ phòng tạm thời' }).waitFor();
    return tag;
  });
  const holdCard = page.locator('section[aria-labelledby="hold-lookup-title"]');
  await step('Tra hold của khách', async () => { await holdCard.getByLabel('Mã giữ phòng', { exact: true }).fill(lookup.holdId); await holdCard.getByRole('button', { name: 'Tra cứu trạng thái' }).click(); await holdCard.locator('.deposit-panel').waitFor({ timeout: 10000 }); return await holdCard.locator('.deposit-panel p').first().innerText(); });
  await step('Nút xác nhận bị khoá khi thiếu cọc', async () => { const t = await holdCard.locator('.deposit-panel .tag').innerText(); if (t !== 'Chưa đủ cọc') throw new Error('tag=' + t); });
  await step('Chặn cọc vượt số còn thiếu ở client', async () => { await holdCard.getByLabel('Cọc tiền mặt (VND)').fill('999999999'); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click(); await holdCard.locator('.deposit-panel .error').waitFor(); return await holdCard.locator('.deposit-panel .error').innerText(); });
  await step('Ghi cọc đủ (2 lần)', async () => {
    const remaining = BigInt(lookup.depositRequiredVnd); const half = remaining / 2n;
    await holdCard.getByLabel('Cọc tiền mặt (VND)').fill(half.toString()); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click(); await holdCard.getByText(/Đã ghi nhận cọc tiền mặt/).waitFor();
    await holdCard.getByLabel('Cọc tiền mặt (VND)').fill((remaining - half).toString()); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click();
    await holdCard.locator('.deposit-panel .tag', { hasText: 'Đã đủ cọc' }).waitFor({ timeout: 10000 });
  });
  await step('Ghi nhận cuộc gọi xác minh', async () => { await holdCard.getByLabel(/Tôi đã gọi và xác minh/).check(); await holdCard.getByRole('button', { name: 'Ghi nhận cuộc gọi xác minh' }).click(); await holdCard.getByText('Đã ghi nhận cuộc gọi xác minh.').waitFor(); });
  await step('Xác nhận booking đã đủ cọc', async () => { const ta = holdCard.getByLabel('Điều khoản hủy đã thống nhất'); await page.waitForFunction(() => document.querySelector('.hold-detail-form textarea')?.value.length > 0); if (!(await ta.evaluate(e => e.readOnly))) throw new Error('điều khoản chưa bị khoá'); await holdCard.getByRole('button', { name: 'Xác nhận booking (đã đủ cọc)' }).click(); await holdCard.getByText(/Đã xác nhận booking/).waitFor({ timeout: 10000 }); });
  await page.screenshot({ path: SHOTS + '/staff-hold-confirmed.png', fullPage: true });
  const ops = page.locator('section[aria-labelledby="booking-ops-title"]');
  const start = new Date(lookup.startAt); const local = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 16);
  await step('Lịch booking tìm thấy booking', async () => { await ops.getByLabel('Từ thời gian').fill(local(new Date(start.getTime() - 3600000))); await ops.getByLabel('Đến thời gian').fill(local(new Date(start.getTime() + 3600000))); await ops.getByRole('button', { name: 'Xem booking' }).click(); await ops.locator('.booking-row', { hasText: desktop.phone }).waitFor({ timeout: 10000 }); });
  const row = ops.locator('.booking-row', { hasText: desktop.phone });
  await step('Hiển thị cọc lúc xác nhận', async () => row.getByText(/Cọc khi xác nhận/).innerText());
  await step('Check-in', async () => { await row.getByRole('button', { name: 'Check-in' }).click(); await row.locator('.tag', { hasText: 'Đang sử dụng' }).waitFor(); });
  await step('Ẩn hủy/no-show sau check-in', async () => { if (await row.getByText('Hủy / khách không đến').count()) throw new Error('vẫn hiện form hủy'); });
  await step('Check-out (có hộp xác nhận)', async () => { await row.getByRole('button', { name: 'Check-out' }).click(); await row.locator('.tag', { hasText: 'Hoàn tất' }).waitFor(); return await row.getByText(/Check-out:/).innerText(); });
  await step('Ghi tiền mặt cho booking', async () => { await row.getByLabel('Khoản thu tiền mặt (VND)').fill('210000'); await row.getByRole('button', { name: 'Ghi nhận tiền mặt' }).click(); await row.getByText(/210\.000 ₫ qua 1 giao dịch/).waitFor({ timeout: 10000 }); });
  await page.screenshot({ path: SHOTS + '/staff-booking-completed.png', fullPage: true });
  // second hold (mobile one) → cancel path
  await step('Hủy booking: xác nhận hold thứ hai rồi ghi CUSTOMER_CANCELLED', async () => {
    const other = holds.mobile;
    const lk = await (await fetch(BASE + '/v1/public/booking/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: other.phone, bookingCode: other.code }) })).json();
    await holdCard.getByLabel('Mã giữ phòng', { exact: true }).fill(lk.holdId); await holdCard.getByRole('button', { name: 'Tra cứu trạng thái' }).click(); await holdCard.locator('.deposit-panel .tag').waitFor();
    await holdCard.getByLabel('Cọc tiền mặt (VND)').fill(lk.depositRequiredVnd); await holdCard.getByRole('button', { name: 'Ghi nhận cọc' }).click(); await holdCard.locator('.deposit-panel .tag', { hasText: 'Đã đủ cọc' }).waitFor();
    await holdCard.getByLabel(/Tôi đã gọi và xác minh/).check(); await holdCard.getByRole('button', { name: 'Ghi nhận cuộc gọi xác minh' }).click(); await holdCard.getByText('Đã ghi nhận cuộc gọi xác minh.').waitFor();
    const ta = holdCard.getByLabel('Điều khoản hủy đã thống nhất'); await page.waitForFunction(() => document.querySelector('.hold-detail-form textarea')?.value.length > 0); if (!(await ta.evaluate(e => e.readOnly))) throw new Error('điều khoản chưa bị khoá'); await holdCard.getByRole('button', { name: 'Xác nhận booking (đã đủ cọc)' }).click(); await holdCard.getByText(/Đã xác nhận booking/).waitFor();
    const s2 = new Date(lk.startAt);
    await ops.getByLabel('Từ thời gian').fill(local(new Date(s2.getTime() - 3600000))); await ops.getByLabel('Đến thời gian').fill(local(new Date(s2.getTime() + 3600000))); await ops.getByRole('button', { name: 'Xem booking' }).click();
    const r2 = ops.locator('.booking-row', { hasText: other.phone }); await r2.waitFor();
    await r2.getByText('Hủy / khách không đến').click();
    await r2.getByLabel('Ghi chú xem xét (bắt buộc)').fill('Khách gọi hủy, đã hoàn cọc.');
    await r2.getByLabel(/Tiền mặt đã hoàn/).fill('999999999'); await r2.getByRole('button', { name: 'Ghi nhận kết quả' }).click();
    await ops.locator('.error', { hasText: /vượt/ }).waitFor();
    await r2.getByLabel(/Tiền mặt đã hoàn/).fill(lk.depositRequiredVnd); await r2.getByRole('button', { name: 'Ghi nhận kết quả' }).click();
    await r2.locator('.tag', { hasText: 'Đã hủy' }).waitFor(); return await r2.locator('p.outcome').innerText();
  });
  await step('Audit hiện thao tác mới', async () => { await goSection(page, 'Cài đặt hệ thống'); await page.getByText('Nhật ký audit').click(); await page.locator('table.admin-table code').first().waitFor({ timeout: 10000 }); return await page.locator('table.admin-table code').first().innerText(); });
  await step('Phiên đăng nhập: đánh dấu phiên này', async () => { await page.getByText('Phiên đăng nhập của tôi').click(); await page.locator('.tag', { hasText: 'Phiên này' }).waitFor({ timeout: 10000 }); });
  await page.screenshot({ path: SHOTS + '/staff-admin.png', fullPage: true });
} finally {
  log(errors.filter(e => !/status of (409|404)/.test(e)).length === 0, 'Không có lỗi console ngoài 409/404 cố ý', errors.slice(0, 4).join(' | '));
  await browser.close(); finish();
}
