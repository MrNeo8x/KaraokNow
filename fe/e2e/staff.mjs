// Reception/Owner flow on holds created by customer.mjs: deposit → verification → confirm → calendar → check-in/out → cash → cancel/refund → audit → sessions.
import { BASE, TENANT, OWNER, SHOTS, launch, reporter, readArtifact, goSection, selectTenant } from './lib.mjs';
const holds = readArtifact('customer-holds.json'); const { desktop } = holds;
const { log, finish } = reporter();
const lookup = await (await fetch(BASE + '/v1/public/booking/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: desktop.phone, bookingCode: desktop.code }) })).json();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
page.on('response', r => { if (r.status() >= 400) console.log('   ↳', r.status(), r.request().method(), r.url().replace(BASE, '')); });
page.on('dialog', d => { console.log('   ⚑ confirm:', d.message().slice(0, 90)); d.accept(); });
const step = async (name, fn) => { try { const extra = await fn(); log(true, name, extra ?? ''); } catch (e) { log(false, name, e.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/staff-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
try {
  await step('Owner đăng nhập', async () => { await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click(); await page.locator('.kpi, .tenant-picker').first().waitFor({ timeout: 15000 }); });
  await step('Nhập tenant, tải chi nhánh', async () => { await selectTenant(page, TENANT); await page.locator('.kpi').first().waitFor({ timeout: 15000 }); });
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
  const calendar = page.locator('section[aria-labelledby="calendar-title"]');
  const dayOf = iso => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
  const mobileLookup = await (await fetch(BASE + '/v1/public/booking/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: holds.mobile.phone, bookingCode: holds.mobile.code }) })).json();
  await step('Lịch phòng: booking đã xác nhận hiện trên dòng thời gian', async () => { await calendar.getByLabel('Ngày xem lịch').fill(dayOf(lookup.startAt)); const block = calendar.locator('.timeline-block.tone-purple', { hasText: desktop.phone }); await block.waitFor(); return await block.getAttribute('aria-label'); });
  await step('Lịch phòng: hold chưa xác nhận hiện là "Đang giữ chỗ", không trùng booking', async () => { await calendar.getByLabel('Ngày xem lịch').fill(dayOf(mobileLookup.startAt)); await calendar.locator('.timeline-block.tone-amber').first().waitFor(); await calendar.locator('.timeline-block').first().click(); await calendar.locator('.calendar-detail', { hasText: 'Giữ chỗ' }).waitFor(); });
  await step('Lịch phòng: chế độ danh sách', async () => { await calendar.getByRole('button', { name: 'Danh sách' }).click(); await calendar.locator('table.admin-table tbody tr', { hasText: 'Đang giữ chỗ' }).first().waitFor(); await calendar.getByRole('button', { name: 'Dòng thời gian' }).click(); });
  const row = ops.locator('.booking-row', { hasText: desktop.phone });
  await step('Hiển thị cọc lúc xác nhận', async () => row.getByText(/Cọc khi xác nhận/).innerText());
  await step('Check-in', async () => { await row.getByRole('button', { name: 'Check-in' }).click(); await row.locator('.tag', { hasText: 'Đang sử dụng' }).waitFor(); });
  await step('Ẩn hủy/no-show sau check-in', async () => { if (await row.getByText('Hủy / khách không đến').count()) throw new Error('vẫn hiện form hủy'); });
  await step('Check-out (có hộp xác nhận)', async () => { await row.getByRole('button', { name: 'Check-out' }).click(); await row.locator('.tag', { hasText: 'Hoàn tất' }).waitFor(); return await row.getByText(/Check-out:/).innerText(); });
  await step('Hiển thị trễ/quá giờ sau check-out', async () => row.getByText(/Trả phòng đúng hoặc trước giờ|Trễ \d+ phút/).innerText());
  await step('Thu tiền mặt: "Đã thu" tăng', async () => { await row.getByLabel('Khoản thu tiền mặt (VND)').fill('210000'); await row.getByRole('button', { name: 'Ghi nhận tiền mặt' }).click(); await row.getByText('Đã ghi nhận thu tiền mặt 210.000 ₫.').waitFor({ timeout: 10000 }); return await row.locator('.account-summary > div').nth(1).innerText(); });
  await step('Thêm phụ thu: "Phải thu" tăng, có lý do', async () => { await row.getByLabel('Phụ thu (VND)').fill('25000'); await row.getByLabel('Lý do phụ thu').fill('Nước uống'); await row.getByRole('button', { name: 'Thêm phụ thu' }).click(); await row.getByText('gồm phụ thu 25.000 ₫').waitFor(); });
  await step('Sổ tiền: đảo khoản thu tiền mặt có lý do', async () => {
    await row.getByRole('button', { name: /Xem sổ tiền/ }).click();
    const cashLine = row.locator('.ledger li', { hasText: 'Thu tiền mặt' }).first();
    await cashLine.getByRole('button', { name: 'Đảo khoản này' }).click(); await cashLine.getByRole('button', { name: 'Xác nhận đảo' }).click(); await row.locator('.error', { hasText: 'lý do' }).waitFor();
    await cashLine.getByLabel(/Lý do đảo/).fill('Ghi nhầm số tiền'); await cashLine.getByRole('button', { name: 'Xác nhận đảo' }).click();
    await row.getByText('Đã đảo khoản thu tiền mặt 210.000 ₫.').waitFor(); await row.locator('.ledger li.reversed', { hasText: 'Thu tiền mặt' }).waitFor();
  });
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
  await step('Tiền mặt: báo cáo cuối ngày có tổng ròng', async () => { await goSection(page, 'Tiền mặt'); const sec = page.locator('section[aria-labelledby="cash-report-title"]'); await sec.locator('.kpi.highlight strong').waitFor(); return await sec.locator('.kpi.highlight strong').innerText(); });
  await step('Tiền mặt: xử lý một khoản cọc chờ (nếu có)', async () => {
    const sec = page.locator('section[aria-labelledby="unresolved-title"]'); await sec.locator('table, .empty').first().waitFor();
    if (await sec.locator('.empty').count()) return 'không có cọc chờ xử lý trong dữ liệu local';
    const row = sec.locator('tbody tr').first();
    await row.getByRole('button', { name: 'Ghi nhận' }).click(); await sec.locator('.error', { hasText: 'lý do' }).waitFor();
    await row.getByLabel(/Lý do xử lý cọc/).fill('Khách không đến, giữ cọc'); await row.getByRole('button', { name: 'Ghi nhận' }).click();
    return await sec.locator('.notice').innerText();
  });
  await step('Màn ân hạn quá giờ trong Giá & chính sách', async () => { await goSection(page, 'Giá & chính sách'); await page.getByRole('heading', { name: 'Ân hạn quá giờ' }).waitFor(); return await page.locator('section[aria-labelledby="overtime-title"] .pill').innerText(); });
  await step('Lịch phòng: booking đã hủy ẩn mặc định, hiện khi bật bộ lọc', async () => {
    await goSection(page, 'Lịch & Đặt phòng');
    await calendar.getByLabel('Ngày xem lịch').fill(dayOf(mobileLookup.startAt)); await page.waitForTimeout(1200);
    if (await calendar.locator('.timeline-block', { hasText: holds.mobile.phone.slice(-4) }).count()) throw new Error('booking đã hủy vẫn hiện');
    await calendar.getByLabel(/Hiện đã hủy/).check(); await calendar.locator('.timeline-block.tone-rose').first().waitFor();
  });
  await step('Audit hiện thao tác mới', async () => { await goSection(page, 'Cài đặt hệ thống'); await page.getByText('Nhật ký audit').click(); await page.locator('table.admin-table code').first().waitFor({ timeout: 10000 }); return await page.locator('table.admin-table code').first().innerText(); });
  await step('Phiên đăng nhập: đánh dấu phiên này', async () => { await page.getByText('Phiên đăng nhập của tôi').click(); await page.locator('.tag', { hasText: 'Phiên này' }).waitFor({ timeout: 10000 }); });
  await page.screenshot({ path: SHOTS + '/staff-admin.png', fullPage: true });
} finally {
  log(errors.filter(e => !/status of (409|404|401)/.test(e)).length === 0, 'Không có lỗi console ngoài 409/404 cố ý và 401 thử khôi phục phiên', errors.slice(0, 4).join(' | '));
  await browser.close(); finish();
}
