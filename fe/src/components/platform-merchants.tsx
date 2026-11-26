'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { merchantCodeError, temporaryPasswordError } from '@/lib/admin';

type Merchant = { tenantId: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; createdAt: string; ownerCount: number; activeBranchCount: number; published: boolean; platformApproved: boolean };
type Created = Merchant & { owner: { userId: string; email: string; membershipId: string; accountCreated: boolean } };
type Page = { items: Merchant[]; limit: number; offset: number; hasMore: boolean };
const LIMIT = 20;

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(16)), value => alphabet[value % alphabet.length]).join('');
}

// Platform Admin is a global grant: requests deliberately omit X-Tenant-ID.
export default function PlatformMerchants({ token }: { token: string }) {
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL'); const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [forbidden, setForbidden] = useState(false);
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [displayName, setDisplayName] = useState(''); const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false); const [createError, setCreateError] = useState(''); const [created, setCreated] = useState<{ value: Created; password: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Page>(`/platform/merchants?${new URLSearchParams({ status, limit: String(LIMIT), offset: String(offset) })}`, { signal: controller.signal }, token)
      .then(setPage)
      .catch(err => { if (controller.signal.aborted) return; setPage(null); if (err instanceof ApiError && err.status === 403) setForbidden(true); else setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, offset, revision, token]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreateError(''); setCreated(null);
    const normalizedCode = code.trim().toUpperCase();
    const invalid = merchantCodeError(normalizedCode) ?? temporaryPasswordError(password); if (invalid) { setCreateError(invalid); return; }
    setCreating(true);
    try {
      const value = await request<Created>('/platform/merchants', { method: 'POST', body: JSON.stringify({ code: normalizedCode, name: name.trim(), owner: { email: email.trim(), displayName: displayName.trim(), temporaryPassword: password } }) }, token);
      setCreated({ value, password: value.owner.accountCreated ? password : '' });
      setCode(''); setName(''); setEmail(''); setDisplayName(''); setPassword(''); setOffset(0); setRevision(current => current + 1);
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.status : undefined;
      setCreateError(statusCode === 409 ? `Mã merchant ${normalizedCode} đã được dùng. Chọn mã khác.` : statusCode === undefined || statusCode >= 500 ? `${(err as Error).message} · Chưa rõ merchant đã được tạo chưa: tải lại danh sách trước khi thử lại (trùng mã sẽ bị từ chối).` : (err as Error).message);
    } finally { setCreating(false); }
  }

  if (forbidden) return null; // PlatformListings already explains the missing Platform Admin grant.
  return <section className="card amenities" aria-labelledby="platform-merchants-title">
    <div className="heading"><div><div className="eyebrow">PLATFORM ADMIN</div><h2 id="platform-merchants-title">Merchant</h2><p>Tạo merchant thủ công cùng Owner đầu tiên. Merchant mới chưa publish và chưa được duyệt.</p></div></div>
    <form className="admin-form" onSubmit={create}>
      <label>Mã merchant<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="KARAOKE_HCM" maxLength={50} required /></label>
      <label>Tên merchant<input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></label>
      <label>Email Owner<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" required /></label>
      <label>Tên hiển thị Owner<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={200} required /></label>
      <label>Mật khẩu tạm (≥ 12 ký tự)<span className="inline-input"><input value={password} onChange={event => setPassword(event.target.value)} minLength={12} autoComplete="new-password" required /><button type="button" className="secondary" onClick={() => setPassword(randomPassword())}>Tạo ngẫu nhiên</button></span></label>
      <button className="primary" disabled={creating}>{creating ? 'Đang tạo…' : 'Tạo merchant'}</button>
    </form>
    {createError && <div className="error" role="alert">{createError}</div>}
    {created && <div className="customer-receipt" role="status"><span className="eyebrow">ĐÃ TẠO MERCHANT</span><h3>{created.value.name} ({created.value.code})</h3><p>Tenant ID (Owner nhập khi đăng nhập): <code>{created.value.tenantId}</code><br />Owner: {created.value.owner.email}</p>
      {created.value.owner.accountCreated ? <p>Tài khoản Owner mới. Gửi mật khẩu tạm <code>{created.password}</code> cho Owner qua kênh riêng; Owner phải đổi mật khẩu ở lần đăng nhập đầu. Mật khẩu chỉ hiển thị tại đây.</p> : <p className="deposit-callout">Email này đã có tài khoản: mật khẩu tạm <strong>không</strong> được áp dụng. Owner đăng nhập bằng mật khẩu hiện có.</p>}
      <button type="button" className="secondary" onClick={() => setCreated(null)}>Đóng</button></div>}
    <div className="section-title"><div><h3>Danh sách merchant</h3></div><label className="select-label">Trạng thái<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="ALL">Tất cả</option><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></select></label></div>
    {error && <div className="error" role="alert">{error}</div>}
    {loading ? <p role="status">Đang tải merchant…</p> : page && (page.items.length === 0 ? <div className="empty">Chưa có merchant.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Merchant</th><th>Trạng thái</th><th>Owner</th><th>Chi nhánh</th><th>Catalog</th><th>Tạo lúc</th></tr></thead><tbody>{page.items.map(item => <tr key={item.tenantId}><td data-label="Merchant"><strong>{item.name}</strong><br /><small>{item.code} · {item.tenantId}</small></td><td data-label="Trạng thái">{item.status === 'ACTIVE' ? 'Hoạt động' : 'Ngừng'}</td><td data-label="Owner">{item.ownerCount}</td><td data-label="Chi nhánh">{item.activeBranchCount}</td><td data-label="Catalog">{item.platformApproved ? 'Đã duyệt' : item.published ? 'Chờ duyệt' : 'Chưa publish'}</td><td data-label="Tạo lúc">{new Date(item.createdAt).toLocaleString('vi-VN')}</td></tr>)}</tbody></table></div>)}
    {page && <div className="amenity-buttons"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - LIMIT))}>← Trang trước</button><span>Trang {Math.floor(offset / LIMIT) + 1}</span><button type="button" disabled={loading || !page.hasMore} onClick={() => setOffset(value => value + LIMIT)}>Trang sau →</button></div>}
  </section>;
}
