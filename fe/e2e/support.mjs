// FE-021 / IAM-009 (PD-045, PD-046): Super Admin read-only support session from the Platform area into a merchant.
// The seeded UAT Platform Admin is a Super Admin locally. Ends every session it opens.
import { BASE, TENANT, OWNER, PLATFORM, SHOTS, launch, reporter, api, loginToken, goSection } from './lib.mjs';

const { log, finish } = reporter();
const platformToken = await loginToken(PLATFORM); const ownerToken = await loginToken(OWNER);
const tenantName = (await api('GET', '/merchant/me', { token: ownerToken, tenant: TENANT })).json.tenantName;
const endAll = async () => { for (const item of (await api('GET', '/platform/support-sessions?status=active', { token: platformToken })).json ?? []) await api('POST', `/platform/support-sessions/${item.id}/end`, { token: platformToken }); };
await endAll();
log((await api('POST', '/platform/support-sessions', { token: ownerToken, body: { tenantId: TENANT, reason: 'thử' } })).status === 403, 'API: Owner (không phải Platform Admin) mở phiên hỗ trợ → 403');
log((await api('GET', '/merchant/me', { token: platformToken, tenant: TENANT })).status === 403, 'API: chưa mở phiên → Platform Admin không xem được merchant');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const writes = []; page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/v1/merchant/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${url.pathname}`); });
const step = async (name, fn) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/support-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
const banner = page.locator('.support-banner');
try {
  await page.goto(BASE + '/platform'); await page.getByLabel('Email').fill(PLATFORM.email); await page.getByLabel('Mật khẩu').fill(PLATFORM.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await step('Super Admin: có mục Hỗ trợ, chưa có phiên đang mở', async () => {
    await page.locator('.admin-sidebar').getByRole('button', { name: 'Hỗ trợ', exact: true }).waitFor(); await goSection(page, 'Hỗ trợ');
    await page.getByText('Không có phiên hỗ trợ đang mở.').waitFor();
  });
  await step('Người dùng: tài khoản Super Admin có nhãn, không tự thu hồi được', async () => {
    await goSection(page, 'Người dùng'); await page.getByLabel('Tìm theo email hoặc tên').fill(PLATFORM.email);
    const row = page.locator('tbody tr', { hasText: PLATFORM.email }); await row.locator('.pill', { hasText: 'Super Admin' }).waitFor();
    await row.getByRole('button', { name: /chi tiết/i }).click(); await page.getByText('Đây là tài khoản của bạn').waitFor();
    if (await page.getByRole('button', { name: /Super Admin/ }).count()) throw new Error('có nút Super Admin trên chính mình');
  });
  await step('Merchant → Hỗ trợ: lý do bắt buộc, mở phiên và vào khu merchant', async () => {
    await goSection(page, 'Merchant'); const button = page.getByRole('button', { name: `Hỗ trợ ${tenantName}`, exact: true });
    while (!(await button.count())) { const next = page.getByRole('button', { name: 'Trang sau →' }); if (await next.isDisabled()) throw new Error('không thấy merchant UAT'); await next.click(); await page.waitForTimeout(500); }
    await button.click(); const dialog = page.locator('dialog.reason-dialog[open]'); await dialog.getByRole('heading', { name: `Mở phiên hỗ trợ ${tenantName}` }).waitFor();
    await dialog.getByRole('textbox').fill('Ticket UAT-021: kiểm tra lịch đặt'); await Promise.all([page.waitForURL(url => url.pathname === '/merchant' && url.searchParams.get('support') === TENANT), dialog.getByRole('button', { name: 'Mở phiên hỗ trợ' }).click()]);
    await banner.waitFor(); return await banner.locator('p').innerText();
  });
  await step('Banner chỉ xem: tên merchant, giờ hết hạn, lý do; sidebar ghi "Hỗ trợ (chỉ xem)", ẩn nút publish', async () => {
    const text = await banner.innerText(); if (!text.includes(tenantName) || !/còn (59|60) phút/.test(text) || !text.includes('Ticket UAT-021')) throw new Error(text);
    await page.locator('.admin-sidebar-footer', { hasText: 'Hỗ trợ (chỉ xem)' }).waitFor(); await page.getByRole('heading', { name: 'Hiển thị catalog công khai' }).waitFor();
    if (await page.getByRole('button', { name: /Ngừng publish|Publish catalog/ }).count()) throw new Error('vẫn có nút publish');
    if (await page.locator('.admin-sidebar-footer').getByRole('button', { name: 'Đổi merchant' }).count()) throw new Error('vẫn có nút Đổi merchant');
  });
  await page.screenshot({ path: `${SHOTS}/support-merchant.png`, fullPage: true });
  await step('Xem như Owner: thấy mục Người dùng, email nhân viên bị che, không có nút thêm/sửa', async () => {
    await goSection(page, 'Người dùng'); const section = page.locator('section[aria-labelledby="memberships-title"]'); await section.locator('tbody tr, li').first().waitFor();
    const text = await section.innerText(); if (!text.includes('•••') || text.includes(OWNER.email)) throw new Error('email chưa bị che');
    if (await section.getByText('Thêm nhân viên').count() || await section.getByRole('button', { name: 'Sửa quyền' }).count()) throw new Error('vẫn có nút sửa nhân viên'); return text.match(/\S+•••\S+/)?.[0];
  });
  await step('Phòng hát: không có form sửa chi nhánh/phòng', async () => {
    await goSection(page, 'Phòng hát'); await page.locator('#room-table-title').waitFor();
    if (await page.getByText('Chỉnh sửa chi nhánh').count()) throw new Error('vẫn có form sửa chi nhánh');
  });
  await step('Lưu cài đặt bị chặn ngay trên trình duyệt (không gửi lệnh ghi)', async () => {
    await goSection(page, 'Giá & chính sách'); await page.getByText('Thời gian giữ phòng theo kênh').click(); await page.getByRole('button', { name: 'Xem cấu hình' }).first().click(); await page.getByRole('button', { name: 'Lưu thời gian giữ' }).first().click();
    await page.getByText('Phiên hỗ trợ chỉ được xem').first().waitFor(); if (writes.length) throw new Error(writes.join(', ')); return 'không có request ghi';
  });
  await step('Báo cáo vẫn xem được', async () => { await goSection(page, 'Báo cáo'); await page.locator('section[aria-labelledby="reports-title"] .kpi').first().waitFor(); });
  await step('F5 vẫn ở phiên hỗ trợ', async () => { await page.reload(); await banner.waitFor(); });
  await step('Owner thấy dòng audit SUPPORT_SESSION_STARTED', async () => {
    const audit = (await api('GET', '/merchant/audit-logs?limit=20', { token: ownerToken, tenant: TENANT })).json; const items = audit.items ?? audit;
    if (!items.some(item => item.action === 'SUPPORT_SESSION_STARTED')) throw new Error(items.slice(0, 5).map(item => item.action).join(', '));
  });
  await step('Không ghi nhớ merchant hỗ trợ làm merchant mặc định', async () => { const remembered = await page.evaluate(() => localStorage.getItem('karaokenow:last-tenant:v1')); if (remembered === TENANT) throw new Error(remembered); });
  await step('Kết thúc phiên: về khu Platform, phiên biến khỏi danh sách đang mở', async () => {
    await Promise.all([page.waitForURL(url => url.pathname === '/platform'), banner.getByRole('button', { name: 'Kết thúc phiên' }).click()]);
    await page.getByText('Không có phiên hỗ trợ đang mở.').waitFor();
    if ((await api('GET', '/merchant/me', { token: platformToken, tenant: TENANT })).status !== 403) throw new Error('vẫn xem được merchant');
  });
  await step('Mở lại link hỗ trợ sau khi kết thúc: báo phiên đã kết thúc', async () => {
    await page.goto(`${BASE}/merchant?support=${TENANT}`); await page.locator('[role="alert"].error', { hasText: 'Phiên hỗ trợ của merchant này đã kết thúc' }).waitFor();
  });
  await step('Lịch sử: bộ lọc Tất cả có phiên vừa đóng', async () => {
    await page.goto(BASE + '/platform#support'); await page.getByLabel('Hiển thị').selectOption('all');
    await page.locator('tbody tr', { hasText: 'Ticket UAT-021' }).first().locator('.pill', { hasText: 'Đã đóng' }).waitFor();
  });
  await page.screenshot({ path: `${SHOTS}/support-platform.png`, fullPage: true });
} finally { await endAll(); await ctx.close(); }
await browser.close();
finish();
