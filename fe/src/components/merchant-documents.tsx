'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FileText } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { formatBytes } from '@/lib/image-compress';
import { openPrivatePdf, pdfError } from '@/lib/open-pdf';

export type MerchantDocument = { id: string; tenantId: string; title: string; contentType: string; sizeBytes: number; uploadedBy: string; uploadedAt: string };
const MAX_DOCUMENTS = 10;

/** Owner-only PDF documents (licences, contracts) in the private store; Platform Admin reviews them when approving. */
export default function MerchantDocuments({ token, tenant }: { token: string; tenant: string }) {
  const [items, setItems] = useState<MerchantDocument[] | null>(null); const [hidden, setHidden] = useState(false); const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request<MerchantDocument[]>('/merchant/documents', { signal: controller.signal }, token, tenant)
      .then(setItems)
      .catch(err => { if (controller.signal.aborted) return; if (err instanceof ApiError && err.status === 403) setHidden(true); else setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant, revision]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!file) { setError('Chọn file PDF.'); return; }
    const invalid = pdfError(file); if (invalid) { setError(invalid); return; }
    if (!title.trim()) { setError('Cần nhập tên giấy tờ.'); return; }
    setBusy('upload');
    const form = new FormData(); form.append('file', file); form.append('title', title.trim().slice(0, 200));
    try { await request('/merchant/documents', { method: 'POST', body: form }, token, tenant); setTitle(''); setFile(null); setNotice('Đã tải giấy tờ lên.'); setRevision(value => value + 1); }
    catch (err) { const status = err instanceof ApiError ? err.status : undefined; setError(status === 409 ? `Tối đa ${MAX_DOCUMENTS} giấy tờ. Xoá bớt trước khi thêm.` : status === 422 ? 'File không phải PDF hợp lệ.' : status === 503 ? 'Kho lưu giấy tờ chưa sẵn sàng trên môi trường này.' : (err as Error).message); }
    finally { setBusy(''); }
  }

  async function view(item: MerchantDocument) {
    setError('');
    try { await openPrivatePdf(`/merchant/documents/${encodeURIComponent(item.id)}/file`, item.title, token, tenant); }
    catch (err) { setError((err as Error).message); }
  }

  async function remove(item: MerchantDocument) {
    if (!window.confirm(`Xoá "${item.title}"? File cũng bị xoá khỏi kho lưu trữ.`)) return;
    setBusy(item.id); setError(''); setNotice('');
    try { await request(`/merchant/documents/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, token, tenant); setNotice('Đã xoá giấy tờ.'); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  }

  if (hidden) return null;
  return <section className="card amenities" aria-labelledby="documents-title">
    <div className="section-head"><h2 id="documents-title">Giấy tờ merchant</h2>{items && <span className="pill purple">{items.length}/{MAX_DOCUMENTS}</span>}</div>
    <p>Giấy phép kinh doanh, hợp đồng… dạng PDF, tối đa 4 MB mỗi file. Chỉ Owner và Platform Admin xem được.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!items ? !error && <p role="status">Đang tải…</p> : items.length === 0 ? <div className="empty">Chưa có giấy tờ.</div> : <ul className="ledger">{items.map(item => <li key={item.id}><div className="ledger-line"><span><FileText size={14} aria-hidden /> <strong>{item.title}</strong><br /><small>{new Date(item.uploadedAt).toLocaleString('vi-VN')} · {formatBytes(item.sizeBytes)}</small></span><span className="hold-actions"><button type="button" className="link-button" onClick={() => void view(item)}>Xem PDF</button><button type="button" className="link-button danger" disabled={busy === item.id} onClick={() => void remove(item)}>Xoá</button></span></div></li>)}</ul>}
    {items && items.length < MAX_DOCUMENTS && <form className="admin-form" onSubmit={upload}>
      <label>Tên giấy tờ<input maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Giấy phép kinh doanh" required /></label>
      <label>File PDF<input type="file" accept="application/pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} required /></label>
      <button className="primary" disabled={busy === 'upload'}>{busy === 'upload' ? 'Đang tải lên…' : 'Tải giấy tờ lên'}</button>
    </form>}
  </section>;
}
