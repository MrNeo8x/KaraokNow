'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { useReadOnly } from './permissions-context';
import { ROLES, membershipError, roleLabel, temporaryPasswordError, type Role } from '@/lib/admin';

export type Membership = { id: string; userId: string; email: string; displayName: string; status: 'ACTIVE' | 'INACTIVE'; roles: Role[]; branchIds: string[] };
export type Grant = { roles: Role[]; branchIds: string[] };

export function GrantPicker({ value, onChange, branches }: { value: Grant; onChange: (next: Grant) => void; branches: { id: string; name: string }[] }) {
  const toggle = <T,>(list: T[], item: T) => list.includes(item) ? list.filter(entry => entry !== item) : [...list, item];
  return <div className="grant-picker">
    <fieldset><legend>Vai trò</legend>{ROLES.map(role => <label key={role} className="check-row"><input type="checkbox" checked={value.roles.includes(role)} onChange={() => onChange({ ...value, roles: toggle(value.roles, role) })} /> {roleLabel[role]}</label>)}</fieldset>
    <fieldset><legend>Chi nhánh {value.roles.includes('OWNER') ? '(Owner có quyền toàn merchant)' : ''}</legend>{branches.length === 0 ? <small>Chưa có chi nhánh.</small> : branches.map(branch => <label key={branch.id} className="check-row"><input type="checkbox" checked={value.branchIds.includes(branch.id)} onChange={() => onChange({ ...value, branchIds: toggle(value.branchIds, branch.id) })} /> {branch.name}</label>)}</fieldset>
  </div>;
}

// Owner-only. Other roles receive 403 and the section is hidden.
export default function Memberships({ token, tenant, branches }: { token: string; tenant: string; branches: { id: string; name: string }[] }) {
  const readOnly = useReadOnly();
  const [items, setItems] = useState<Membership[] | null>(null); const [hidden, setHidden] = useState(false); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState('');
  const [email, setEmail] = useState(''); const [displayName, setDisplayName] = useState(''); const [password, setPassword] = useState(''); const [grant, setGrant] = useState<Grant>({ roles: ['RECEPTIONIST'], branchIds: [] });
  const [editing, setEditing] = useState<{ id: string; grant: Grant } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request<Membership[]>('/merchant/memberships', { signal: controller.signal }, token, tenant).then(value => setItems([...value].sort((a, b) => a.status.localeCompare(b.status) || a.email.localeCompare(b.email))))
      .catch(err => { if (controller.signal.aborted) return; if (err instanceof ApiError && err.status === 403) setHidden(true); else setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const invalid = membershipError(grant) ?? temporaryPasswordError(password); if (invalid) { setError(invalid); return; }
    setBusy('create');
    try {
      const created = await request<Membership>('/merchant/memberships', { method: 'POST', body: JSON.stringify({ email: email.trim(), displayName: displayName.trim(), temporaryPassword: password, roles: grant.roles, branchIds: grant.branchIds }) }, token, tenant);
      setNotice(`Đã thêm ${created.email}. Nếu email này đã có tài khoản, mật khẩu tạm không được áp dụng; nếu là tài khoản mới, gửi mật khẩu tạm qua kênh riêng và nhân viên phải đổi ở lần đăng nhập đầu.`);
      setEmail(''); setDisplayName(''); setPassword(''); setGrant({ roles: ['RECEPTIONIST'], branchIds: [] }); setRevision(value => value + 1);
    } catch (err) { setError(err instanceof ApiError && err.status === 409 ? 'Người dùng này đã là thành viên của merchant.' : (err as Error).message); }
    finally { setBusy(''); }
  }

  async function update(item: Membership, body: Partial<Pick<Membership, 'status' | 'roles' | 'branchIds'>>, message: string) {
    setBusy(item.id); setError(''); setNotice('');
    try { const next = await request<Membership>(`/merchant/memberships/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token, tenant); setItems(current => current?.map(entry => entry.id === next.id ? { ...entry, ...next } : entry) ?? null); setEditing(null); setNotice(message); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }

  function saveGrant(item: Membership) {
    if (!editing) return; const invalid = membershipError(editing.grant); if (invalid) { setError(invalid); return; }
    void update(item, editing.grant, `Đã cập nhật quyền của ${item.email}.`);
  }

  if (hidden) return null;
  const branchName = (id: string) => branches.find(branch => branch.id === id)?.name ?? id;
  return <section className="card amenities" aria-labelledby="memberships-title">
    <h2 id="memberships-title">Nhân viên &amp; phân quyền</h2>
    <p>Vai trò khác Owner chỉ thao tác trong các chi nhánh được gán. Vô hiệu hoá thay vì xoá để giữ lịch sử audit.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!items ? !error && <p role="status">Đang tải nhân viên…</p> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Nhân viên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th><th></th></tr></thead><tbody>{items.map(item => <tr key={item.id} className={item.status === 'INACTIVE' ? 'muted' : ''}>
      <td data-label="Nhân viên"><strong>{item.displayName}</strong><br /><small>{item.email}</small></td>
      {editing?.id === item.id ? <td colSpan={2} data-label="Quyền"><GrantPicker value={editing.grant} onChange={next => setEditing({ id: item.id, grant: next })} branches={branches} /><div className="hold-actions"><button type="button" className="primary" disabled={busy === item.id} onClick={() => saveGrant(item)}>Lưu quyền</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Huỷ</button></div></td>
        : <><td data-label="Vai trò">{item.roles.map(role => roleLabel[role] ?? role).join(', ') || '—'}</td><td data-label="Chi nhánh">{item.roles.includes('OWNER') ? 'Toàn merchant' : item.branchIds.map(branchName).join(', ') || '—'}</td></>}
      <td data-label="Trạng thái">{item.status === 'ACTIVE' ? <span className="pill green">Hoạt động</span> : <span className="pill gray">Đã vô hiệu hoá</span>}</td>
      <td className="row-actions" data-label="">{!readOnly && <>{editing?.id !== item.id && <button type="button" className="secondary" disabled={busy === item.id} onClick={() => setEditing({ id: item.id, grant: { roles: item.roles, branchIds: item.branchIds } })}>Sửa quyền</button>}{item.status === 'ACTIVE'
        ? <button type="button" className="secondary danger" disabled={busy === item.id} onClick={() => { if (window.confirm(`Vô hiệu hoá ${item.email}? Người này không truy cập được merchant nữa.`)) void update(item, { status: 'INACTIVE' }, `Đã vô hiệu hoá ${item.email}.`); }}>Vô hiệu hoá</button>
        : <button type="button" className="secondary" disabled={busy === item.id} onClick={() => void update(item, { status: 'ACTIVE' }, `Đã kích hoạt lại ${item.email}.`)}>Kích hoạt lại</button>}</>}</td>
    </tr>)}</tbody></table></div>}
    {!readOnly && <details className="outcome-form"><summary>Thêm nhân viên</summary><form className="admin-form" onSubmit={create}>
      <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" required /></label>
      <label>Tên hiển thị<input value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={200} required /></label>
      <label>Mật khẩu tạm (≥ 12 ký tự)<input value={password} onChange={event => setPassword(event.target.value)} minLength={12} autoComplete="new-password" required /></label>
      <GrantPicker value={grant} onChange={setGrant} branches={branches} />
      <button className="primary" disabled={busy === 'create'}>{busy === 'create' ? 'Đang thêm…' : 'Thêm nhân viên'}</button>
    </form></details>}
  </section>;
}
