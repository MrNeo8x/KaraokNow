// FE-022 / VEN-006 (PD-048) + FE-023 / VEN-007 (PD-049): merchant gallery (Owner) and branch gallery (Owner/Branch Manager), at most 10 photos each,
// browser compression, alt text/order, role gating and the photo strip on /booking. Deletes every photo it creates.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BASE, TENANT, OWNER, ARTIFACTS, SHOTS, launch, reporter, api, loginToken, goSection, selectTenant } from './lib.mjs';

const { log, finish } = reporter();
const MANAGER = { email: process.env.E2E_MANAGER_EMAIL ?? 'uat.manager@karaokenow.local', password: process.env.E2E_MANAGER_PASSWORD ?? 'Uat-manager-password-2026!' };
const RECEPTION = { email: process.env.E2E_RECEPTION_EMAIL ?? 'uat.reception@karaokenow.local', password: process.env.E2E_RECEPTION_PASSWORD ?? 'Uat-reception-password-2026!' };
const BRANCH = '10000000-0000-4000-8000-000000000004';
const MERCHANT_PATH = '/merchant/catalog/photos'; const BRANCH_PATH = `/merchant/branches/${BRANCH}/photos`;

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const value = pixel(x, y); const offset = y * (width * 3 + 1) + 1 + x * 3; raw[offset] = value[0]; raw[offset + 1] = value[1]; raw[offset + 2] = value[2]; }
  const chunk = (type, data) => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
let seed = 11; const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
const dir = path.join(ARTIFACTS, 'files'); fs.mkdirSync(dir, { recursive: true });
const bigPhoto = path.join(dir, 'gallery-photo.png'); fs.writeFileSync(bigPhoto, png(2000, 1400, (x, y) => [(x / 8 + noise() / 4) & 255, (90 + noise() / 3) & 255, (y / 6 + noise() / 4) & 255]));
const small = png(64, 48, (x, y) => [x * 4, y * 5, 160]);

const ownerToken = await loginToken(OWNER); const managerToken = await loginToken(MANAGER); const receptionToken = await loginToken(RECEPTION);
const list = async route => (await api('GET', route, { token: ownerToken, tenant: TENANT })).json;
const before = { merchant: new Set((await list(MERCHANT_PATH)).map(item => item.id)), branch: new Set((await list(BRANCH_PATH)).map(item => item.id)) };
async function upload(route, token, buffer = small, altText) {
  const form = new FormData(); form.append('file', new Blob([buffer], { type: 'image/png' }), 'photo.png'); if (altText) form.append('altText', altText);
  const response = await fetch(`${BASE}/v1${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT }, body: form });
  return response.status;
}
log(await upload(BRANCH_PATH, receptionToken) === 403, 'API: Lễ tân tải ảnh chi nhánh → 403');
log(await upload(MERCHANT_PATH, managerToken) === 403, 'API: Quản lý chi nhánh tải ảnh merchant → 403');
log(await upload(BRANCH_PATH, ownerToken, Buffer.from('not an image')) === 422, 'API: nội dung không phải ảnh → 422');

const browser = await launch();
const step = async (page, name, fn) => { try { log(true, name, (await fn()) ?? ''); } catch (error) { log(false, name, error.message.split('\n')[0]); await page.screenshot({ path: `${SHOTS}/gallery-error-${name.replace(/[^\p{L}\d]+/gu, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {}); } };
const signIn = async (account) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.on('dialog', dialog => dialog.accept()); await page.goto(BASE + '/merchant'); await page.getByLabel('Email').fill(account.email); await page.getByLabel('Mật khẩu').fill(account.password); await page.getByRole('button', { name: 'Đăng nhập' }).click(); await selectTenant(page, TENANT); return { ctx, page }; };
try {
  const { ctx, page } = await signIn(OWNER);
  const merchantGallery = page.locator('section.venue-gallery', { has: page.getByRole('heading', { name: 'Ảnh merchant' }) });
  await step(page, 'Owner: Marketplace → tải ảnh merchant, ảnh được nén trước khi gửi', async () => {
    await goSection(page, 'Marketplace'); await merchantGallery.waitFor();
    await merchantGallery.getByLabel('Chọn ảnh merchant').setInputFiles(bigPhoto); const info = await merchantGallery.locator('.media-preview p').innerText();
    await merchantGallery.getByLabel('Mô tả ảnh').fill('Sảnh chính E2E'); await merchantGallery.getByRole('button', { name: 'Tải ảnh lên' }).click();
    await merchantGallery.getByText('Đã tải ảnh lên').waitFor(); await merchantGallery.locator('.media-item', { hasText: 'Sảnh chính E2E' }).waitFor();
    const saved = (await list(MERCHANT_PATH)).find(item => item.altText === 'Sảnh chính E2E'); if (!saved || saved.sizeBytes > 600 * 1024) throw new Error(`size=${saved?.sizeBytes}`);
    return `${info} · lưu ${Math.round(saved.sizeBytes / 1024)} KB`;
  });
  await step(page, 'Sửa mô tả và thứ tự ảnh merchant', async () => {
    await merchantGallery.locator('.media-item', { hasText: 'Sảnh chính E2E' }).getByRole('button', { name: 'Sửa' }).click(); const item = merchantGallery.locator('.media-item', { has: page.locator('.media-edit') });
    await item.getByLabel('Mô tả ảnh').fill('Sảnh chính E2E (đã sửa)'); await item.getByLabel('Thứ tự hiển thị').fill('5'); await item.getByRole('button', { name: 'Lưu' }).click();
    await merchantGallery.getByText('Đã cập nhật ảnh.').waitFor(); const saved = (await list(MERCHANT_PATH)).find(photo => photo.altText === 'Sảnh chính E2E (đã sửa)'); if (saved?.displayOrder !== 5) throw new Error(JSON.stringify(saved));
  });
  const branchGallery = page.locator('section.venue-gallery', { has: page.getByRole('heading', { name: /^Ảnh chi nhánh/ }) });
  await step(page, 'Owner: Phòng hát → tải ảnh chi nhánh đang chọn', async () => {
    await goSection(page, 'Phòng hát'); await branchGallery.waitFor();
    await branchGallery.getByLabel('Chọn ảnh chi nhánh này').setInputFiles(bigPhoto); await branchGallery.getByLabel('Mô tả ảnh').fill('Mặt tiền E2E');
    await branchGallery.getByRole('button', { name: 'Tải ảnh lên' }).click(); await branchGallery.locator('.media-item', { hasText: 'Mặt tiền E2E' }).waitFor();
  });
  await step(page, 'Đủ 10 ảnh: giao diện báo đủ, API ảnh thứ 11 → 409', async () => {
    while ((await list(BRANCH_PATH)).length < 10) if (await upload(BRANCH_PATH, ownerToken, small, 'Ảnh lấp đầy E2E') !== 201) throw new Error('không tải được ảnh lấp đầy');
    const extra = await upload(BRANCH_PATH, ownerToken); if (extra !== 409) throw new Error(`ảnh thứ 11 → ${extra}`);
    await goSection(page, 'Tổng quan'); await goSection(page, 'Phòng hát'); await branchGallery.getByText('Đã đủ 10 ảnh').waitFor();
    if (await branchGallery.getByLabel('Chọn ảnh chi nhánh này').count()) throw new Error('vẫn có ô chọn ảnh'); return await branchGallery.locator('.pill').innerText();
  });
  await page.screenshot({ path: `${SHOTS}/gallery-branch.png`, fullPage: true });

  const guest = await ctx.newPage(); guest.setDefaultTimeout(20000);
  await step(guest, 'Trang khách: dải ảnh chi nhánh rồi ảnh merchant', async () => {
    await guest.goto(BASE + '/booking'); await guest.locator('.branch-option').first().waitFor();
    const branches = (await api('GET', '/public/branches?limit=100')).json.items; const index = branches.findIndex(item => item.id === BRANCH); if (index < 0) throw new Error('chi nhánh UAT không công khai');
    await guest.locator('.branch-option').nth(index).click(); const strip = guest.locator('.branch-gallery'); await strip.waitFor();
    const count = await strip.locator('li').count(); const expected = branches[index].photos.length + branches[index].merchantPhotos.length;
    const first = await strip.locator('img').first().getAttribute('alt'); const last = await strip.locator('img').last().getAttribute('alt');
    if (count !== expected || !first.includes('Mặt tiền E2E') && branches[index].photos[0]?.altText !== first || last !== 'Sảnh chính E2E (đã sửa)') throw new Error(`count=${count}/${expected} first=${first} last=${last}`);
    await strip.screenshot({ path: `${SHOTS}/gallery-booking.png` }); return `${count} ảnh`;
  });

  // FE-023 / VEN-007 (PD-049): real room photos replace the fixed illustration in the guest room list.
  const room = (await api('GET', `/public/branches/${BRANCH}/rooms`)).json.items?.[0] ?? (await api('GET', `/public/branches/${BRANCH}/rooms`)).json[0];
  const roomMedia = [];
  await step(guest, 'Ảnh phòng thật: thẻ phòng dùng ảnh đầu tiên, có nhãn số ảnh và dải ảnh khi chọn phòng', async () => {
    for (const alt of ['Phòng E2E ảnh 1', 'Phòng E2E ảnh 2']) {
      const form = new FormData(); form.append('file', new Blob([small], { type: 'image/png' }), 'room.png'); form.append('altText', alt); form.append('displayOrder', String(roomMedia.length));
      const response = await fetch(`${BASE}/v1/merchant/rooms/${room.id}/media/upload`, { method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'x-tenant-id': TENANT }, body: form });
      if (response.status !== 201) throw new Error(`upload ${response.status}`); roomMedia.push((await response.json()).id);
    }
    await guest.reload(); await guest.locator('.branch-option', { hasText: 'KaraokeNow UAT Hồ Chí Minh' }).click();
    const day = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86400000).toISOString().slice(0, 10);
    await guest.getByLabel('Ngày', { exact: true }).fill(day); await guest.getByRole('group', { name: 'Giờ bắt đầu' }).getByRole('button', { name: '20:00' }).click();
    await guest.getByRole('button', { name: /Tìm phòng trống/ }).click(); await guest.getByRole('heading', { name: 'Phòng còn trống' }).waitFor();
    const card = guest.locator('.room-option', { hasText: room.name }); const image = card.locator('.room-photo img');
    if ((await image.getAttribute('alt')) !== 'Phòng E2E ảnh 1') throw new Error(`alt=${await image.getAttribute('alt')}`);
    await card.locator('.photo-count', { hasText: '2 ảnh' }).waitFor(); await card.click();
    const strip = guest.getByRole('list', { name: `Ảnh ${room.name}` }); await strip.waitFor(); if ((await strip.locator('li').count()) !== 2) throw new Error('dải ảnh phòng không đủ 2 ảnh');
    const others = guest.locator('.room-option', { hasNotText: room.name }).locator('img').first(); const fallback = (await others.count()) ? await others.getAttribute('src') : '/rooms/';
    await guest.screenshot({ path: `${SHOTS}/gallery-room-photos.png`, fullPage: true }); return `phòng khác: ${fallback}`;
  });
  for (const id of roomMedia) await api('DELETE', `/merchant/rooms/${room.id}/media/${id}`, { token: ownerToken, tenant: TENANT });

  const manager = await signIn(MANAGER);
  await step(manager.page, 'Quản lý chi nhánh: quản lý được ảnh chi nhánh được giao (xoá một ảnh)', async () => {
    await goSection(manager.page, 'Phòng hát'); const gallery = manager.page.locator('section.venue-gallery', { has: manager.page.getByRole('heading', { name: /^Ảnh chi nhánh/ }) });
    const filler = gallery.locator('.media-item', { hasText: 'Ảnh lấp đầy E2E' }).first(); await filler.getByRole('button', { name: /Xoá ảnh/ }).click();
    await gallery.getByText('Đã xoá ảnh.').waitFor(); const count = (await list(BRANCH_PATH)).length; if (count !== 9) throw new Error(`còn ${count}`);
    await gallery.getByLabel('Chọn ảnh chi nhánh này').waitFor(); return 'còn 9 ảnh, ô tải lên hiện lại';
  });
  await manager.ctx.close();
  const reception = await signIn(RECEPTION);
  await step(reception.page, 'Lễ tân: xem được ảnh chi nhánh, không có nút tải lên/sửa/xoá', async () => {
    await goSection(reception.page, 'Phòng hát'); const gallery = reception.page.locator('section.venue-gallery', { has: reception.page.getByRole('heading', { name: /^Ảnh chi nhánh/ }) });
    await gallery.locator('.media-item').first().waitFor();
    if (await gallery.getByLabel('Chọn ảnh chi nhánh này').count() || await gallery.getByRole('button', { name: 'Sửa' }).count()) throw new Error('vẫn có nút quản lý');
  });
  await reception.ctx.close(); await ctx.close();
} finally {
  let removed = 0;
  for (const [route, existing] of [[MERCHANT_PATH, before.merchant], [BRANCH_PATH, before.branch]]) for (const item of await list(route)) if (!existing.has(item.id)) { await api('DELETE', `${route}/${item.id}`, { token: ownerToken, tenant: TENANT }); removed++; }
  log((await list(MERCHANT_PATH)).length === before.merchant.size && (await list(BRANCH_PATH)).length === before.branch.size, 'dọn dẹp: xoá ảnh do test tạo', `${removed} ảnh`);
}
await browser.close();
finish();
