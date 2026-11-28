'use client';

import { useEffect, useState } from 'react';
import { ApiError, request } from '@/lib/api';
import { useReadOnly } from './permissions-context';

export type Publication = { published: boolean; platformApproved: boolean; version?: string; tenantStatus?: 'ACTIVE' | 'INACTIVE' };

// Owner-only. Other roles receive 403 and the section is hidden.
export default function CatalogPublication({ token, tenant }: { token: string; tenant: string }) {
  const readOnly = useReadOnly();
  const [value, setValue] = useState<Publication | null>(null); const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request<Publication>('/merchant/catalog/publication', { signal: controller.signal }, token, tenant).then(setValue)
      .catch(err => { if (controller.signal.aborted) return; if (err instanceof ApiError && err.status === 403) setHidden(true); else setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant]);

  async function toggle(published: boolean) {
    if (!published && !window.confirm('Ngừng publish? Khách sẽ không còn thấy chi nhánh, phòng và không thể giữ chỗ online.')) return;
    setBusy(true); setError(''); setNotice('');
    try { const next = await request<Publication>('/merchant/catalog/publication', { method: 'PATCH', body: JSON.stringify({ published }) }, token, tenant); setValue(current => ({ ...next, tenantStatus: next.tenantStatus ?? current?.tenantStatus })); setNotice(published ? 'Đã yêu cầu publish catalog.' : 'Đã ngừng publish catalog.'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (hidden) return null;
  const state = !value ? null : value.tenantStatus === 'INACTIVE' ? { label: 'Merchant đang bị khoá', tone: 'pill rose', text: 'Platform Admin đã khoá merchant: khách không thấy chi nhánh và không giữ chỗ mới được, kể cả khi đã publish. Giữ chỗ và booking hiện có vẫn xử lý bình thường. Liên hệ KaraokeNow để được mở khoá.' } : !value.published ? { label: 'Chưa publish', tone: 'tag warn', text: 'Khách chưa thấy catalog. Publish để gửi yêu cầu hiển thị.' } : value.platformApproved ? { label: 'Đang hiển thị', tone: 'tag', text: 'Khách thấy chi nhánh và phòng đang hoạt động, có thể giữ chỗ online.' } : { label: 'Đang chờ Platform duyệt', tone: 'tag warn', text: 'Đã publish nhưng khách chưa thấy cho đến khi Platform Admin duyệt.' };
  return <section className="card amenities" aria-labelledby="publication-title">
    <h2 id="publication-title">Hiển thị catalog công khai</h2>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!value ? !error && <p role="status">Đang tải…</p> : state && <><p><span className={state.tone}>{state.label}</span></p><p>{state.text}</p>
      {!readOnly && <div className="hold-actions">{value.published ? <button type="button" className="secondary" disabled={busy} onClick={() => void toggle(false)}>Ngừng publish</button> : <button type="button" className="primary" disabled={busy} onClick={() => void toggle(true)}>Publish catalog</button>}</div>}
      <small>Duyệt Platform là bước riêng, merchant không tự thay đổi được. Nên cấu hình điều khoản công khai trước khi publish.</small></>}
  </section>;
}
