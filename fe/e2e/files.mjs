// FILE-001 / FE-015: room photos (browser compression), merchant logo (admin sidebar + /booking), private PDF documents
// for the Owner and the Platform Admin, upload limits (413/422) and role gating. Cleans up what it creates.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BASE, TENANT, OWNER, PLATFORM, ARTIFACTS, SHOTS, launch, reporter, api, loginToken, goSection } from './lib.mjs';

const { log, finish } = reporter();
const RECEPTION = { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' };

/** Minimal PNG encoder: RGB or RGBA rows through zlib, enough to produce real test images without dependencies. */
function png(width, height, pixel, alpha = false) {
  const channels = alpha ? 4 : 3; const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * channels + 1)] = 0; for (let x = 0; x < width; x++) { const value = pixel(x, y); const offset = y * (width * channels + 1) + 1 + x * channels; for (let c = 0; c < channels; c++) raw[offset + c] = value[c]; } }
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
let seed = 7; const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
const files = path.join(ARTIFACTS, 'files'); fs.mkdirSync(files, { recursive: true });
const photo = path.join(files, 'room-photo.png'); fs.writeFileSync(photo, png(2400, 1600, (x, y) => [(x / 10 + noise() / 4) & 255, (y / 7 + noise() / 4) & 255, (120 + noise() / 3) & 255]));
const logoFile = path.join(files, 'logo.png'); fs.writeFileSync(logoFile, png(640, 640, (x, y) => { const inside = (x - 320) ** 2 + (y - 320) ** 2 < 280 ** 2; return inside ? [112, 46, 210, 255] : [0, 0, 0, 0]; }, true));
const pdf = path.join(files, 'giay-phep.pdf');
fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
log(fs.statSync(photo).size > 1024 * 1024, 'chuẩn bị file thử: ảnh PNG 2400×1600 nhiễu, logo trong suốt, PDF', `ảnh gốc ${(fs.statSync(photo).size / 1024 / 1024).toFixed(1)} MB`);

// API limits
const ownerToken = await loginToken(OWNER);
const rooms = (await api('GET', `/merchant/branches/10000000-0000-4000-8000-000000000004/rooms`, { token: ownerToken, tenant: TENANT })).json;
const roomId = rooms[0].id;
async function multipart(route, field, buffer, name, type, extra = {}) {
  const form = new FormData(); form.append(field, new Blob([buffer], { type }), name); for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const response = await fetch(`${BASE}/v1${route}`, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'x-tenant-id': TENANT }, body: form });
  return response.status;
}
log(await multipart(`/merchant/rooms/${roomId}/media/upload`, 'file', Buffer.alloc(5 * 1024 * 1024, 1), 'big.jpg', 'image/jpeg') === 413, 'API: ảnh > 4 MB → 413');
log(await multipart(`/merchant/rooms/${roomId}/media/upload`, 'file', Buffer.from('not an image'), 'fake.png', 'image/png') === 422, 'API: nội dung không phải ảnh → 422');
log(await multipart('/merchant/documents', 'file', Buffer.from('<html>fake</html>'), 'fake.pdf', 'application/pdf', { title: 'Giả' }) === 422, 'API: giấy tờ không phải PDF → 422');

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('dialog', dialog => dialog.accept());
const step = async (name, fn) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/files-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }); } };
const docTitle = `Giấy phép E2E ${Date.now()}`;
try {
  await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(OWNER.email); await page.getByLabel('Mật khẩu').fill(OWNER.password); await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.getByLabel('Tenant ID').fill(TENANT); await page.getByRole('button', { name: 'Áp dụng' }).click(); await page.locator('.kpi').first().waitFor();
  const media = page.locator('section[aria-labelledby="media-title"]');
  await step('Ảnh phòng: nén trên trình duyệt trước khi tải lên', async () => {
    await goSection(page, 'Phòng hát'); await media.getByLabel('Chọn ảnh phòng').setInputFiles(photo);
    const info = await media.locator('.media-preview p').innerText({ timeout: 30000 });
    const match = /(\d+)×(\d+) px .*→ (\d+) KB/.exec(info); if (!match) throw new Error(`không đọc được kết quả nén: ${info}`);
    if (Math.max(Number(match[1]), Number(match[2])) > 1600 || Number(match[3]) > 500) throw new Error(`chưa đạt giới hạn: ${info}`);
    return info;
  });
  let uploadedAlt = '';
  await step('Ảnh phòng: tải lên và hiển thị trong thư viện', async () => {
    uploadedAlt = `Ảnh E2E ${Date.now()}`; await media.getByLabel('Mô tả ảnh').fill(uploadedAlt); await media.getByRole('button', { name: 'Tải ảnh lên' }).click();
    await media.getByText(/Đã tải ảnh lên/).waitFor(); const image = media.locator(`img[alt="${uploadedAlt}"]`); await image.waitFor();
    await page.waitForFunction(alt => { const img = document.querySelector(`img[alt="${alt}"]`); return img && img.complete && img.naturalWidth > 0; }, uploadedAlt);
    return await image.getAttribute('src');
  });
  await page.screenshot({ path: `${SHOTS}/files-room-media.png`, fullPage: true });
  await step('Ảnh phòng: xoá ảnh vừa tải', async () => { await media.getByRole('button', { name: `Xoá ảnh ${uploadedAlt}` }).click(); await media.locator(`img[alt="${uploadedAlt}"]`).waitFor({ state: 'detached' }); });

  const logo = page.locator('section[aria-labelledby="logo-title"]');
  await step('Logo: Owner tải logo, hiện ở Marketplace và sidebar', async () => {
    await goSection(page, 'Marketplace'); await logo.getByLabel('Chọn logo').setInputFiles(logoFile); await logo.getByText(/Đã cập nhật logo/).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => { const img = document.querySelector('.admin-logo .logo-mark.has-logo img'); return img && img.complete && img.naturalWidth > 0; });
    return await logo.locator('.notice').innerText();
  });
  await step('Logo: hiện trên thẻ quán ở /booking', async () => {
    const guest = await ctx.newPage(); await guest.goto(BASE + '/booking');
    await guest.waitForFunction(() => { const img = document.querySelector('.branch-option img.merchant-logo'); return img && img.complete && img.naturalWidth > 0; });
    await guest.screenshot({ path: `${SHOTS}/files-booking-logo.png` }); await guest.close();
  });

  const docs = page.locator('section[aria-labelledby="documents-title"]');
  await step('Giấy tờ: Owner tải PDF và mở xem', async () => {
    await docs.getByLabel('Tên giấy tờ').fill(docTitle); await docs.getByLabel('File PDF').setInputFiles(pdf); await docs.getByRole('button', { name: 'Tải giấy tờ lên' }).click();
    await docs.getByText('Đã tải giấy tờ lên.').waitFor(); const row = docs.locator('.ledger li', { hasText: docTitle });
    const [tab] = await Promise.all([ctx.waitForEvent('page'), row.getByRole('button', { name: 'Xem PDF' }).click()]);
    await tab.waitForURL(/^blob:/, { timeout: 15000 }); const url = tab.url(); await tab.close(); return url.slice(0, 30);
  });
  await page.screenshot({ path: `${SHOTS}/files-marketplace.png`, fullPage: true });

  // Platform Admin reviews the document while approving listings.
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const adminPage = await admin.newPage(); adminPage.setDefaultTimeout(15000);
  await step('Platform Admin: xem giấy tờ merchant khi duyệt listing', async () => { try {
    await adminPage.goto(BASE + '/platform'); await adminPage.getByLabel('Email').fill(PLATFORM.email); await adminPage.getByLabel('Mật khẩu').fill(PLATFORM.password); await adminPage.getByRole('button', { name: 'Đăng nhập' }).click();
    await adminPage.locator('#platform-listings-title').locator('xpath=ancestor::section').getByLabel('Lọc').selectOption('ALL');
    const row = adminPage.locator('article.booking-row', { hasText: TENANT }); await row.waitFor();
    await row.getByRole('button', { name: 'Xem giấy tờ merchant' }).click(); const item = row.locator('.ledger li', { hasText: docTitle }); await item.waitFor();
    const [tab] = await Promise.all([admin.waitForEvent('page'), item.getByRole('button', { name: 'Xem PDF' }).click()]);
    await tab.waitForURL(/^blob:/, { timeout: 15000 }); await tab.close();
  } catch (error) { await adminPage.screenshot({ path: `${SHOTS}/files-error-platform.png`, fullPage: true }); throw error; } });
  await admin.close();

  await step('Giấy tờ và logo: Owner xoá sau kiểm thử', async () => {
    await docs.locator('.ledger li', { hasText: docTitle }).getByRole('button', { name: 'Xoá' }).click(); await docs.getByText('Đã xoá giấy tờ.').waitFor();
    await logo.getByRole('button', { name: 'Xoá logo' }).click(); await logo.getByText('Đã xoá logo.').waitFor();
  });
} finally { await ctx.close(); }

// Receptionist sees photos but no upload/delete controls.
{
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const rpage = await rctx.newPage(); rpage.setDefaultTimeout(15000);
  try {
    await rpage.goto(BASE + '/merchant'); await rpage.getByLabel('Email').fill(RECEPTION.email); await rpage.getByLabel('Mật khẩu').fill(RECEPTION.password); await rpage.getByRole('button', { name: 'Đăng nhập' }).click();
    await rpage.getByLabel('Tenant ID').fill(TENANT); await rpage.getByRole('button', { name: 'Áp dụng' }).click(); await rpage.locator('.kpi').first().waitFor(); await rpage.waitForTimeout(1200);
    await goSection(rpage, 'Phòng hát'); const section = rpage.locator('section[aria-labelledby="media-title"]'); await section.waitFor(); await rpage.waitForTimeout(800);
    log(!(await section.getByLabel('Chọn ảnh phòng').count()), 'Lễ tân: xem ảnh phòng, không có nút tải ảnh');
  } catch (error) { log(false, 'Lễ tân: xem ảnh phòng, không có nút tải ảnh', error.message.split('\n')[0]); }
  finally { await rctx.close(); }
}

await browser.close();
finish();
