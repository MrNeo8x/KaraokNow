'use client';

import { useEffect, useState } from 'react';
import { Copy, Crown, KeyRound, Lock, ShieldCheck, ShieldOff, Unlock } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { currentUserId, roleLabel, type Role } from '@/lib/admin';
import ReasonDialog, { type ReasonRequest } from './reason-dialog';

type Membership = { membershipId: string; tenantId: string; tenantName: string; tenantStatus: string; status: string; roles: Role[]; branchIds: string[] };
export type PlatformUser = { id: string; email: string; displayName: string; status: 'ACTIVE' | 'DISABLED'; mustChangePassword: boolean; platformAdmin: boolean; superAdmin?: boolean; createdAt: string; lastLoginAt: string | null; disabledAt: string | null; disabledReason: string | null; memberships: Membership[] };
export type Page = { items: PlatformUser[]; limit: number; offset: number; hasMore: boolean };
const LIMIT = 20;

// Backend messages are translated in lib/api.ts (FRIENDLY); errors pass through unchanged here.
function explain(err: unknown): Error { return err instanceof Error ? err : new Error(String(err)); }

/** PD-040: Platform Admins list/search users, disable/enable, issue a one-time temporary password, grant/revoke admin. */
export default function PlatformUsers({ token, superAdmin = false }: { token: string; superAdmin?: boolean }) {
  const me = currentUserId(token);
  const [query, setQuery] = useState(''); const [q, setQ] = useState(''); const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL'); const [admin, setAdmin] = useState<'' | 'true' | 'false'>('');
  const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<PlatformUser | null>(null); const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [secret, setSecret] = useState<{ userId: string; password: string } | null>(null); const [copied, setCopied] = useState(false); const [notice, setNotice] = useState('');

  useEffect(() => { const timer = window.setTimeout(() => { setQ(query.trim()); setOffset(0); }, 300); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const params = new URLSearchParams({ status, limit: String(LIMIT), offset: String(offset) }); if (q) params.set('q', q); if (admin) params.set('platformAdmin', admin);
    request<Page>(`/platform/users?${params}`, { signal: controller.signal }, token).then(setPage)
      .catch(err => { if (controller.signal.aborted) return; setPage(null); if (err instanceof ApiError && err.status === 403) setForbidden(true); else setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, status, admin, offset, token, revision]);

  function applyUser(next: PlatformUser) { setSelected(next); setPage(current => current ? { ...current, items: current.items.map(item => item.id === next.id ? next : item) } : current); }
  async function act(user: PlatformUser, path: string, reason: string, done: string) {
    try { const next = await request<PlatformUser>(`/platform/users/${encodeURIComponent(user.id)}/${path}`, { method: 'POST', body: JSON.stringify({ reason }) }, token); applyUser(next); setNotice(done); }
    catch (err) { throw explain(err); }
  }
  function ask(user: PlatformUser, kind: 'disable' | 'enable' | 'password' | 'grant' | 'revoke' | 'grantSuper' | 'revokeSuper') {
    setNotice(''); setSecret(null);
    const name = user.displayName || user.email;
    const requests: Record<typeof kind, ReasonRequest> = {
      disable: { title: `Khoá tài khoản ${name}`, description: 'Người dùng bị đăng xuất ngay trên mọi thiết bị và không đăng nhập được cho đến khi mở khoá.', confirmLabel: 'Khoá tài khoản', danger: true, run: reason => act(user, 'disable', reason, `Đã khoá ${name}.`) },
      enable: { title: `Mở khoá tài khoản ${name}`, description: 'Người dùng đăng nhập lại được bằng mật khẩu hiện có.', confirmLabel: 'Mở khoá', run: reason => act(user, 'enable', reason, `Đã mở khoá ${name}.`) },
      password: { title: `Cấp mật khẩu tạm cho ${name}`, description: 'Người dùng bị đăng xuất; lần đăng nhập sau phải đổi mật khẩu. Mật khẩu chỉ hiện một lần — gửi cho người dùng qua kênh riêng.', confirmLabel: 'Cấp mật khẩu tạm', run: async reason => {
        try { const result = await request<{ temporaryPassword: string; user: PlatformUser }>(`/platform/users/${encodeURIComponent(user.id)}/temporary-password`, { method: 'POST', body: JSON.stringify({ reason }), cache: 'no-store' }, token); applyUser(result.user); setSecret({ userId: user.id, password: result.temporaryPassword }); setCopied(false); }
        catch (err) { throw explain(err); }
      } },
      grant: { title: `Cấp quyền Platform Admin cho ${name}`, description: 'Người dùng có toàn quyền quản trị nền tảng: duyệt listing, tạo/khoá merchant, quản lý user.', confirmLabel: 'Cấp quyền', danger: true, run: reason => act(user, 'platform-admin', reason, `Đã cấp Platform Admin cho ${name}.`) },
      revoke: { title: `Thu hồi Platform Admin của ${name}`, description: 'Không thu hồi được nếu đây là Platform Admin cuối cùng.', confirmLabel: 'Thu hồi quyền', danger: true, run: reason => act(user, 'platform-admin/revoke', reason, `Đã thu hồi Platform Admin của ${name}.`) },
      grantSuper: { title: `Cấp Super Admin cho ${name}`, description: 'Super Admin được mở phiên hỗ trợ chỉ xem vào merchant và cấp/thu hồi Super Admin cho Platform Admin khác.', confirmLabel: 'Cấp Super Admin', danger: true, run: reason => act(user, 'super-admin', reason, `Đã cấp Super Admin cho ${name}.`) },
      revokeSuper: { title: `Thu hồi Super Admin của ${name}`, description: 'Các phiên hỗ trợ đang mở của người này bị kết thúc. Không thu hồi được nếu đây là Super Admin cuối cùng.', confirmLabel: 'Thu hồi Super Admin', danger: true, run: reason => act(user, 'super-admin/revoke', reason, `Đã thu hồi Super Admin của ${name}.`) },
    };
    setDialog(requests[kind]);
  }
  async function copySecret() { if (!secret) return; try { await navigator.clipboard.writeText(secret.password); setCopied(true); } catch { setCopied(false); } }

  if (forbidden) return <section className="card"><div className="error" role="alert">Tài khoản này không có quyền Platform Admin.</div></section>;
  const when = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';
  const self = selected?.id === me;
  return <section className="card amenities" aria-labelledby="users-title">
    <div className="section-head"><h2 id="users-title">Người dùng</h2>{page && <span className="pill purple">{page.items.length}{page.hasMore ? '+' : ''} kết quả</span>}</div>
    <p>Mọi tài khoản trên nền tảng. Mọi thay đổi cần lý do và được ghi nhật ký.</p>
    <div className="user-filters">
      <label>Tìm theo email hoặc tên<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="vd. uat.owner" /></label>
      <label>Trạng thái<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setOffset(0); }}><option value="ALL">Tất cả</option><option value="ACTIVE">Đang hoạt động</option><option value="DISABLED">Đã khoá</option></select></label>
      <label>Platform Admin<select value={admin} onChange={event => { setAdmin(event.target.value as typeof admin); setOffset(0); }}><option value="">Tất cả</option><option value="true">Là admin</option><option value="false">Không phải admin</option></select></label>
    </div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {loading && !page ? <p role="status">Đang tải…</p> : page && (page.items.length === 0 ? <div className="empty">Không có người dùng phù hợp.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Người dùng</th><th>Trạng thái</th><th>Merchant</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>{page.items.map(user => <tr key={user.id} className={selected?.id === user.id ? 'row-selected' : ''}>
      <td data-label="Người dùng"><strong>{user.displayName || '—'}</strong>{user.platformAdmin && <> <span className="pill purple">Platform Admin</span></>}{user.superAdmin && <> <span className="pill amber">Super Admin</span></>}<br /><small>{user.email}</small></td>
      <td data-label="Trạng thái">{user.status === 'ACTIVE' ? <span className="pill green">Hoạt động</span> : <span className="pill rose">Đã khoá</span>}{user.mustChangePassword && <><br /><small>Phải đổi mật khẩu</small></>}</td>
      <td data-label="Merchant">{user.memberships.length ? user.memberships.map(item => item.tenantName).join(', ') : '—'}</td>
      <td data-label="Đăng nhập gần nhất">{when(user.lastLoginAt)}</td>
      <td data-label=""><button type="button" className="link-button" onClick={() => { setSelected(user); setSecret(null); setNotice(''); }} aria-label={`Xem chi tiết ${user.email}`}>Chi tiết</button></td>
    </tr>)}</tbody></table></div>)}
    {page && (offset > 0 || page.hasMore) && <div className="amenity-buttons"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - LIMIT))}>← Trang trước</button><span>Trang {Math.floor(offset / LIMIT) + 1}</span><button type="button" disabled={loading || !page.hasMore} onClick={() => setOffset(value => value + LIMIT)}>Trang sau →</button></div>}

    {selected && <div className="user-detail" aria-labelledby="user-detail-title">
      <div className="order-head"><h3 id="user-detail-title">{selected.displayName || selected.email}</h3><button type="button" className="link-button" onClick={() => { setSelected(null); setSecret(null); }}>Đóng</button></div>
      <dl><dt>Email</dt><dd>{selected.email}</dd><dt>Trạng thái</dt><dd>{selected.status === 'ACTIVE' ? 'Hoạt động' : `Đã khoá ${when(selected.disabledAt)}${selected.disabledReason ? ` · ${selected.disabledReason}` : ''}`}</dd><dt>Tạo lúc</dt><dd>{when(selected.createdAt)}</dd><dt>Đăng nhập gần nhất</dt><dd>{when(selected.lastLoginAt)}</dd><dt>Quyền nền tảng</dt><dd>{selected.superAdmin ? 'Super Admin' : selected.platformAdmin ? 'Platform Admin' : 'Không'}</dd><dt>Mật khẩu</dt><dd>{selected.mustChangePassword ? 'Phải đổi ở lần đăng nhập tới' : 'Bình thường'}</dd></dl>
      <div><strong>Merchant và vai trò</strong>{selected.memberships.length === 0 ? <p>Không thuộc merchant nào.</p> : <ul className="ledger">{selected.memberships.map(item => <li key={item.membershipId}><div className="ledger-line"><span><strong>{item.tenantName}</strong>{item.tenantStatus === 'INACTIVE' && <> <span className="pill rose">Merchant bị khoá</span></>}<br /><small>{item.roles.map(role => roleLabel[role] ?? role).join(', ')}{item.status !== 'ACTIVE' ? ' · thành viên đã vô hiệu hoá' : ''}</small></span></div></li>)}</ul>}</div>
      {secret?.userId === selected.id && <div className="secret-box" role="status"><span>Mật khẩu tạm (chỉ hiện một lần):</span><code>{secret.password}</code><button type="button" className="secondary" onClick={() => void copySecret()}><Copy size={14} aria-hidden /> {copied ? 'Đã sao chép' : 'Sao chép'}</button><button type="button" className="link-button" onClick={() => setSecret(null)}>Ẩn</button></div>}
      {self ? <p><small>Đây là tài khoản của bạn: không tự khoá, cấp mật khẩu tạm hay thu hồi quyền của chính mình.</small></p> : <div className="hold-actions">
        {selected.status === 'ACTIVE' ? <button type="button" className="secondary danger" onClick={() => ask(selected, 'disable')}><Lock size={14} aria-hidden /> Khoá tài khoản</button> : <button type="button" className="secondary" onClick={() => ask(selected, 'enable')}><Unlock size={14} aria-hidden /> Mở khoá</button>}
        <button type="button" className="secondary" disabled={selected.status !== 'ACTIVE'} onClick={() => ask(selected, 'password')}><KeyRound size={14} aria-hidden /> Cấp mật khẩu tạm</button>
        {selected.platformAdmin ? <button type="button" className="secondary danger" onClick={() => ask(selected, 'revoke')}><ShieldOff size={14} aria-hidden /> Thu hồi Platform Admin</button> : <button type="button" className="secondary" disabled={selected.status !== 'ACTIVE'} onClick={() => ask(selected, 'grant')}><ShieldCheck size={14} aria-hidden /> Cấp Platform Admin</button>}
        {superAdmin && selected.platformAdmin && (selected.superAdmin ? <button type="button" className="secondary danger" onClick={() => ask(selected, 'revokeSuper')}><Crown size={14} aria-hidden /> Thu hồi Super Admin</button> : <button type="button" className="secondary" disabled={selected.status !== 'ACTIVE'} onClick={() => ask(selected, 'grantSuper')}><Crown size={14} aria-hidden /> Cấp Super Admin</button>)}
      </div>}
    </div>}
    <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
  </section>;
}
