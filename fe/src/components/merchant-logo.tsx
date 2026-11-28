'use client';

import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { compressImage, formatBytes, imageTypeError } from '@/lib/image-compress';
import { useCan } from './permissions-context';

export type MerchantLogo = { configured: boolean; url: string | null; contentType: string | null; sizeBytes: number | null; updatedAt: string | null };

/** Merchant logo (every role reads; Owner replaces/removes). Shown to guests on /booking. */
export default function MerchantLogoCard({ token, tenant, onChanged }: { token: string; tenant: string; onChanged?: (logo: MerchantLogo) => void }) {
  const canEdit = useCan()('owner.admin');
  const [logo, setLogo] = useState<MerchantLogo | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [broken, setBroken] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    request<MerchantLogo>('/merchant/catalog/logo', { signal: controller.signal }, token, tenant).then(setLogo).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant]);

  async function replace(file: File | undefined) {
    setError(''); setNotice(''); if (!file) return;
    const invalid = imageTypeError(file); if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const compressed = await compressImage(file, { maxSide: 512, targetBytes: 200 * 1024 });
      const form = new FormData(); form.append('file', compressed.file);
      const next = await request<MerchantLogo>('/merchant/catalog/logo', { method: 'PUT', body: form }, token, tenant);
      setLogo(next); setBroken(false); onChanged?.(next); setNotice(`Đã cập nhật logo (${formatBytes(compressed.file.size)}).`);
    } catch (err) { setError(err instanceof ApiError && err.status === 503 ? 'Kho lưu ảnh chưa sẵn sàng trên môi trường này.' : (err as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Xoá logo? Khách sẽ thấy ảnh mặc định.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await request('/merchant/catalog/logo', { method: 'DELETE' }, token, tenant); const next = { configured: false, url: null, contentType: null, sizeBytes: null, updatedAt: null }; setLogo(next); onChanged?.(next); setNotice('Đã xoá logo.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return <section className="card amenities" aria-labelledby="logo-title">
    <h2 id="logo-title">Logo merchant</h2>
    <p>Hiển thị cho khách trên trang đặt phòng. Logo được thu nhỏ còn tối đa 512 px trước khi tải lên.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!logo ? !error && <p role="status">Đang tải…</p> : <div className="logo-row">
      <div className="logo-box">{logo.url && !broken ? <img src={logo.url} alt="Logo merchant" onError={() => setBroken(true)} /> : logo.url ? 'Không tải được logo' : 'Chưa có logo'}</div>
      <div>{logo.configured && logo.updatedAt && <p><small>Cập nhật {new Date(logo.updatedAt).toLocaleString('vi-VN')}{logo.sizeBytes ? ` · ${formatBytes(logo.sizeBytes)}` : ''}</small></p>}
        {canEdit ? <div className="hold-actions"><label className="file-drop compact"><ImagePlus size={18} aria-hidden /><span>{busy ? 'Đang xử lý…' : logo.configured ? 'Thay logo' : 'Tải logo lên'}</span><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Chọn logo" disabled={busy} onChange={event => { void replace(event.target.files?.[0]); event.target.value = ''; }} /></label>{logo.configured && <button type="button" className="secondary danger" disabled={busy} onClick={() => void remove()}>Xoá logo</button>}</div> : <p><small>Chỉ Owner được thay logo.</small></p>}
      </div>
    </div>}
  </section>;
}
