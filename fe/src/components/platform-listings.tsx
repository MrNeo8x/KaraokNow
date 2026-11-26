'use client';

import { useEffect, useState } from 'react';
import { ApiError, request } from '@/lib/api';

type Listing = { tenantId: string; merchantCode: string; merchantName: string; tenantStatus: string; published: boolean; platformApproved: boolean; platformDecidedBy: string | null; platformDecidedAt: string | null; activeBranchCount: number; termsConfigured: boolean; updatedAt: string; version: string };
type Page = { items: Listing[]; limit: number; offset: number; hasMore: boolean };
type Filter = 'PENDING' | 'APPROVED' | 'ALL';
const LIMIT = 20;

// Platform Admin is a global grant: requests deliberately omit X-Tenant-ID.
export default function PlatformListings({ token }: { token: string }) {
  const [filter, setFilter] = useState<Filter>('PENDING'); const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [forbidden, setForbidden] = useState(false); const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({}); const [reasons, setReasons] = useState<Record<string, string>>({}); const [acting, setActing] = useState('');

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setForbidden(false);
    request<Page>(`/platform/catalog/listings?${new URLSearchParams({ status: filter, limit: String(LIMIT), offset: String(offset) })}`, { signal: controller.signal }, token)
      .then(setPage)
      .catch(err => { if (controller.signal.aborted) return; setPage(null); if (err instanceof ApiError && err.status === 403) setForbidden(true); else setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, offset, revision, token]);

  async function decide(listing: Listing, action: 'approve' | 'revoke') {
    setError(''); setNotice('');
    const reason = (reasons[listing.tenantId] ?? '').trim(); const note = (notes[listing.tenantId] ?? '').trim();
    if (action === 'revoke' && !reason) { setError('Cần nhập lý do thu hồi.'); return; }
    if (action === 'revoke' && !window.confirm(`Thu hồi duyệt ${listing.merchantName}? Catalog công khai của merchant sẽ bị ẩn ngay.`)) return;
    setActing(listing.tenantId);
    try {
      const next = await request<Listing>(`/platform/catalog/listings/${encodeURIComponent(listing.tenantId)}/${action}`, { method: 'POST', body: JSON.stringify(action === 'approve' ? (note ? { note } : {}) : { reason }) }, token);
      setPage(current => current ? { ...current, items: current.items.map(item => item.tenantId === next.tenantId ? next : item) } : current);
      setNotes(current => ({ ...current, [listing.tenantId]: '' })); setReasons(current => ({ ...current, [listing.tenantId]: '' }));
      setNotice(`${action === 'approve' ? 'Đã duyệt' : 'Đã thu hồi'} listing ${next.merchantName}.`);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      setError(status === 403 ? 'Không có quyền quyết định listing này (không phải Platform Admin hoặc bạn là thành viên của merchant).' : status === 409 ? `Merchant chưa publish catalog hoặc không còn hoạt động. ${(err as Error).message}` : (err as Error).message);
    } finally { setActing(''); }
  }

  const when = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';
  if (forbidden) return <section className="card amenities"><h2>Duyệt listing</h2><div className="error" role="alert">Tài khoản này không có quyền Platform Admin. Quyền chỉ được cấp qua dữ liệu hệ thống.</div></section>;
  return <section className="card amenities" aria-labelledby="platform-listings-title">
    <div className="heading"><div><div className="eyebrow">PLATFORM ADMIN</div><h2 id="platform-listings-title">Duyệt listing merchant</h2><p>Merchant chỉ hiển thị công khai khi đã publish và được duyệt. Mọi quyết định được ghi audit.</p></div>
      <label className="select-label">Lọc<select value={filter} onChange={event => { setFilter(event.target.value as Filter); setOffset(0); }}><option value="PENDING">Chờ duyệt</option><option value="APPROVED">Đã duyệt</option><option value="ALL">Tất cả</option></select></label></div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {loading ? <p role="status">Đang tải listing…</p> : page && (page.items.length === 0 ? <div className="empty">{filter === 'PENDING' ? 'Không có merchant chờ duyệt.' : 'Không có listing.'}</div> : <div className="booking-list">{page.items.map(listing => <article className="booking-row" key={listing.tenantId}>
      <div><strong>{listing.merchantName}</strong> <span className={listing.platformApproved ? 'tag' : 'tag warn'}>{listing.platformApproved ? 'Đã duyệt' : listing.published ? 'Chờ duyệt' : 'Chưa publish'}</span>
        <p>Mã: {listing.merchantCode} · Tenant: {listing.tenantId}<br />Trạng thái tenant: {listing.tenantStatus} · {listing.activeBranchCount} chi nhánh hoạt động · Điều khoản: {listing.termsConfigured ? 'đã cấu hình' : 'chưa cấu hình'}<br />Quyết định gần nhất: {when(listing.platformDecidedAt)} · Cập nhật: {when(listing.updatedAt)}</p>
        {listing.published && (listing.activeBranchCount === 0 || !listing.termsConfigured) && <small>Lưu ý: {listing.activeBranchCount === 0 ? 'chưa có chi nhánh hoạt động' : ''}{listing.activeBranchCount === 0 && !listing.termsConfigured ? ' · ' : ''}{!listing.termsConfigured ? 'chưa có điều khoản công khai, khách sẽ không gửi được giữ chỗ' : ''}.</small>}</div>
      <div className="payment-form">{listing.platformApproved
        ? <><label>Lý do thu hồi (bắt buộc)<input maxLength={500} value={reasons[listing.tenantId] ?? ''} onChange={event => setReasons(current => ({ ...current, [listing.tenantId]: event.target.value }))} /></label><button type="button" className="secondary" disabled={acting === listing.tenantId} onClick={() => void decide(listing, 'revoke')}>Thu hồi duyệt</button></>
        : <><label>Ghi chú duyệt (không bắt buộc)<input maxLength={500} value={notes[listing.tenantId] ?? ''} onChange={event => setNotes(current => ({ ...current, [listing.tenantId]: event.target.value }))} /></label><button type="button" className="primary" disabled={acting === listing.tenantId || !listing.published || listing.tenantStatus !== 'ACTIVE'} onClick={() => void decide(listing, 'approve')}>Duyệt listing</button></>}</div>
    </article>)}</div>)}
    {page && <div className="amenity-buttons"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - LIMIT))}>← Trang trước</button><span>Trang {Math.floor(offset / LIMIT) + 1}</span><button type="button" disabled={loading || !page.hasMore} onClick={() => setOffset(value => value + LIMIT)}>Trang sau →</button><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Tải lại</button></div>}
  </section>;
}
