// FE-020 / RPT-001 (PD-044): merchant reports (Owner, Branch Manager) and platform reports. Read-only: creates no data.
import fs from 'node:fs';
import { BASE, TENANT, OWNER, PLATFORM, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const MANAGER = { email: process.env.E2E_MANAGER_EMAIL ?? 'uat.manager@karaokenow.local', password: process.env.E2E_MANAGER_PASSWORD ?? 'Uat-manager-password-2026!' };
const RECEPTION = { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' };
const ownerToken = await loginToken(OWNER); const platformToken = await loginToken(PLATFORM); const receptionToken = await loginToken(RECEPTION);
const vnd = value => `${BigInt(value).toLocaleString('vi-VN')} ₫`;

log((await api('GET', '/merchant/reports/bookings?from=2026-11-01&to=2026-11-28', { token: receptionToken, tenant: TENANT })).status === 403, 'API: Lễ tân xem báo cáo → 403');
log((await api('GET', '/merchant/reports/bookings?from=2025-01-01&to=2026-11-28', { token: ownerToken, tenant: TENANT })).status === 422, 'API: khoảng > 366 ngày → 422');
log((await api('GET', '/platform/reports/overview?from=2026-11-01&to=2026-11-28', { token: ownerToken })).status === 403, 'API: Owner xem báo cáo nền tảng → 403');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
const step = async (name, fn, target = page) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await target.screenshot({ path: `${SHOTS}/reports-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
const signIn = async (target, path, account) => { await target.goto(BASE + path); await target.getByLabel('Email').fill(account.email); await target.getByLabel('Mật khẩu').fill(account.password); await target.getByRole('button', { name: 'Đăng nhập' }).click(); };
const reports = page.locator('section[aria-labelledby="reports-title"]');
try {
  await signIn(page, '/merchant', OWNER); await selectTenant(page, TENANT);
  let range;
  await step('Owner: mục Báo cáo, mặc định 30 ngày gần nhất', async () => {
    await goSection(page, 'Báo cáo'); await reports.locator('.kpi').first().waitFor();
    range = { from: await reports.getByLabel('Từ ngày').inputValue(), to: await reports.getByLabel('Đến ngày').inputValue() };
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1; if (days !== 30) throw new Error(`${range.from}…${range.to}`); return `${range.from} → ${range.to}`;
  });
  await step('Booking & doanh thu: số liệu khớp API, có biểu đồ và ghi chú hai loại ngày', async () => {
    const data = (await api('GET', `/merchant/reports/bookings?from=${range.from}&to=${range.to}`, { token: ownerToken, tenant: TENANT })).json;
    const tiles = await reports.locator('.kpi small').allInnerTexts();
    if (!(await reports.locator('.kpi strong').first().innerText()).includes(String(data.totals.bookings))) throw new Error('tổng booking lệch');
    if (!tiles.some(text => text.includes(vnd(data.totals.netCollectedVnd)))) throw new Error(`thực thu lệch: ${tiles.join(' | ')}`);
    if ((await reports.locator('.chart svg').count()) !== 2) throw new Error('thiếu biểu đồ');
    await reports.getByText('ngày ghi nhận').waitFor(); return `${data.totals.bookings} booking · thực thu ${vnd(data.totals.netCollectedVnd)}`;
  });
  await step('Rê chuột lên cột hiện tooltip; nút Bảng số liệu hiện đủ dòng theo kỳ', async () => {
    const card = reports.locator('.chart-card').first(); const box = await card.locator('svg').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await card.locator('.chart-tooltip').waitFor();
    await card.getByRole('button', { name: 'Bảng số liệu' }).click(); const rows = await card.locator('tbody tr').count(); if (rows !== 30) throw new Error(`${rows} dòng`);
    await card.getByRole('button', { name: 'Xem biểu đồ' }).click(); return `${rows} dòng`;
  });
  await page.screenshot({ path: `${SHOTS}/reports-bookings.png`, fullPage: true });
  await step('Gộp theo tháng gửi groupBy=month', async () => {
    const [sent] = await Promise.all([page.waitForRequest(request => request.url().includes('/merchant/reports/bookings?') && request.url().includes('groupBy=month')), reports.getByLabel('Gộp theo').selectOption('month')]);
    await page.waitForResponse(response => response.url() === sent.url()); return new URL(sent.url()).search;
  });
  await step('Tải CSV: tệp .csv có dòng tiêu đề', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), reports.getByRole('button', { name: /Tải CSV/ }).click()]);
    const file = await download.path(); const head = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n')[0];
    if (!download.suggestedFilename().endsWith('.csv') || !head.includes(',')) throw new Error(`${download.suggestedFilename()}: ${head}`); return `${download.suggestedFilename()} · ${head.slice(0, 60)}`;
  });
  await step('Công suất phòng: tỷ lệ khớp API, thanh theo phòng và bản đồ nhiệt 7×24', async () => {
    await reports.getByRole('tab', { name: 'Công suất phòng' }).click(); await reports.locator('.heatmap').waitFor();
    const data = (await api('GET', `/merchant/reports/occupancy?from=${range.from}&to=${range.to}`, { token: ownerToken, tenant: TENANT })).json;
    const shown = await reports.locator('.kpi strong').first().innerText(); const expected = `${(data.occupancyRate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
    if (shown !== expected) throw new Error(`${shown} ≠ ${expected}`);
    const cells = await reports.locator('.heat-cell').count(); const bars = await reports.locator('.rate-bars li').count();
    if (cells !== 168 || bars !== data.rooms.length) throw new Error(`cells=${cells} bars=${bars}/${data.rooms.length}`); return `${shown} · ${bars} phòng`;
  });
  await page.screenshot({ path: `${SHOTS}/reports-occupancy.png`, fullPage: true });
  await step('Kênh & chuyển đổi: số kênh khớp API', async () => {
    await reports.getByRole('tab', { name: 'Kênh & chuyển đổi' }).click();
    const data = (await api('GET', `/merchant/reports/channels?from=${range.from}&to=${range.to}`, { token: ownerToken, tenant: TENANT })).json;
    await reports.getByText('Tỷ lệ chuyển đổi theo kênh').waitFor(); const bars = await reports.locator('.rate-bars li').count();
    if (bars !== data.rows.length) throw new Error(`${bars} ≠ ${data.rows.length}`); return data.rows.map(row => `${row.channel} ${row.confirmed}/${row.holds}`).join(', ');
  });
  await step('Ngày bắt đầu sau ngày kết thúc: báo lỗi tiếng Việt', async () => {
    await reports.getByLabel('Từ ngày').fill(`${range.to.slice(0, 4)}-12-31`); await reports.locator('.error', { hasText: 'Ngày bắt đầu phải trước' }).waitFor();
  });

  const managerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const manager = await managerCtx.newPage(); manager.setDefaultTimeout(15000);
  await step('Quản lý chi nhánh: thấy và mở được Báo cáo', async () => {
    await signIn(manager, '/merchant', MANAGER); await selectTenant(manager, TENANT); await goSection(manager, 'Báo cáo');
    await manager.locator('section[aria-labelledby="reports-title"] .kpi').first().waitFor(); if (await manager.locator('.error[role="alert"]').count()) throw new Error(await manager.locator('.error[role="alert"]').first().innerText());
  }, manager);
  await managerCtx.close();
  const receptionCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const reception = await receptionCtx.newPage(); reception.setDefaultTimeout(15000);
  await step('Lễ tân: không có mục Báo cáo', async () => {
    await signIn(reception, '/merchant', RECEPTION); await selectTenant(reception, TENANT);
    if (await reception.locator('.admin-sidebar').getByRole('button', { name: 'Báo cáo', exact: true }).count()) throw new Error('vẫn thấy Báo cáo');
  }, reception);
  await receptionCtx.close();

  const platformCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); const platform = await platformCtx.newPage(); platform.setDefaultTimeout(15000);
  const section = platform.locator('section[aria-labelledby="platform-reports-title"]');
  await step('Platform: chỉ số tổng quan khớp API, bảng merchant đủ dòng', async () => {
    await signIn(platform, '/platform', PLATFORM); await platform.locator('.admin-sidebar').waitFor(); await goSection(platform, 'Báo cáo'); await section.locator('.kpi').first().waitFor();
    const from = await section.getByLabel('Từ ngày').inputValue(); const to = await section.getByLabel('Đến ngày').inputValue();
    const overview = (await api('GET', `/platform/reports/overview?from=${from}&to=${to}`, { token: platformToken })).json;
    const merchants = (await api('GET', `/platform/reports/merchants?from=${from}&to=${to}`, { token: platformToken })).json;
    const first = await section.locator('.kpi strong').first().innerText(); if (first !== String(overview.snapshot.merchantsActive)) throw new Error(`${first} ≠ ${overview.snapshot.merchantsActive}`);
    await section.locator('.merchant-report-table tbody tr').first().waitFor();
    if (merchants.rows.length > 20) { if ((await section.locator('.merchant-report-table tbody tr').count()) !== 20) throw new Error('chưa giới hạn 20 dòng'); await section.getByRole('button', { name: /Xem tất cả/ }).click(); }
    const rows = await section.locator('.merchant-report-table tbody tr').count();
    if (rows !== merchants.rows.length) throw new Error(`${rows} ≠ ${merchants.rows.length}`); return `${overview.snapshot.merchantsActive} merchant hoạt động · ${rows} dòng`;
  }, platform);
  await step('Platform: tải CSV merchant', async () => {
    const [download] = await Promise.all([platform.waitForEvent('download'), section.getByRole('button', { name: 'Tải CSV merchant' }).click()]);
    if (!download.suggestedFilename().endsWith('.csv')) throw new Error(download.suggestedFilename()); return download.suggestedFilename();
  }, platform);
  await section.getByRole('button', { name: /Chỉ hiện/ }).click().catch(() => {});
  await platform.screenshot({ path: `${SHOTS}/reports-platform.png`, fullPage: true });
  await platformCtx.close();
} finally { await ctx.close(); }
await browser.close();
finish();
