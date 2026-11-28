'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import { membershipError, reasonError, roleLabel, temporaryPasswordError, type Role } from '@/lib/admin';
import { GrantPicker, type Grant } from './memberships';
import ReasonDialog, { type ReasonRequest } from './reason-dialog';

export type Member = { id: string; userId: string; email: string; displayName: string; status: 'ACTIVE' | 'INACTIVE'; roles: Role[]; branchIds: string[] };
export type Branch = { id: string; name: string; status: string };

// Backend messages are translated in lib/api.ts (FRIENDLY); errors pass through unchanged here.
function explain(err: unknown): Error { return err instanceof Error ? err : new Error(String(err)); }

/** PD-040: Platform Admin manages members of any merchant (reason required, last active Owner protected by the BE). */
export default function PlatformMembers({ token, tenantId, tenantName }: { token: string; tenantId: string; tenantName: string }) {
  const [members, setMembers] = useState<Member[] | null>(null); const [branches, setBranches] = useState<Branch[]>([]); const [revision, setRevision] = useState(0);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [dialog, setDialog] = useState<ReasonRequest | null>(null);
  const [editing, setEditing] = useState<{ id: string; grant: Grant } | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', password: '', reason: '' }); const [grant, setGrant] = useState<Grant>({ roles: ['OWNER'], branchIds: [] }); const [adding, setAdding] = useState(false);
  const base = `/platform/merchants/${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    const controller = new AbortController(); setError('');
    Promise.all([request<Member[]>(`${base}/memberships`, { signal: controller.signal }, token), request<Branch[]>(`${base}/branches`, { signal: controller.signal }, token)])
      .then(([list, branchList]) => { setMembers([...list].sort((a, b) => a.status.localeCompare(b.status) || a.email.localeCompare(b.email))); setBranches(branchList); })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [base, token, revision]);

  async function patch(member: Member, body: Partial<Pick<Member, 'status' | 'roles' | 'branchIds'>>, reason: string, done: string) {
    try { await request(`${base}/memberships/${encodeURIComponent(member.id)}`, { method: 'PATCH', body: JSON.stringify({ ...body, reason }) }, token); setEditing(null); setNotice(done); setRevision(value => value + 1); }
    catch (err) { throw explain(err); }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const invalid = membershipError(grant) ?? temporaryPasswordError(form.password) ?? reasonError(form.reason); if (invalid) { setError(invalid); return; }
    setAdding(true);
    try {
      await request(`${base}/memberships`, { method: 'POST', body: JSON.stringify({ email: form.email.trim(), displayName: form.displayName.trim(), temporaryPassword: form.password, roles: grant.roles, branchIds: grant.branchIds, reason: form.reason.trim() }) }, token);
      setNotice(`Đã thêm ${form.email.trim()} vào ${tenantName}. Nếu email đã có tài khoản thì mật khẩu tạm không được áp dụng.`);
      setForm({ email: '', displayName: '', password: '', reason: '' }); setGrant({ roles: ['OWNER'], branchIds: [] }); setRevision(value => value + 1);
    } catch (err) { setError(explain(err).message); } finally { setAdding(false); }
  }

  const branchName = (id: string) => branches.find(branch => branch.id === id)?.name ?? id;
  return <div className="members-panel">
    <strong>Thành viên của {tenantName}</strong>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!members ? !error && <p role="status">Đang tải thành viên…</p> : members.length === 0 ? <p>Chưa có thành viên.</p> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Thành viên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th><th></th></tr></thead><tbody>{members.map(member => <tr key={member.id} className={member.status === 'INACTIVE' ? 'muted' : ''}>
      <td data-label="Thành viên"><strong>{member.displayName}</strong><br /><small>{member.email}</small></td>
      {editing?.id === member.id ? <td colSpan={2} data-label="Quyền"><GrantPicker value={editing.grant} onChange={next => setEditing({ id: member.id, grant: next })} branches={branches} /><div className="hold-actions"><button type="button" className="primary" onClick={() => { const invalid = membershipError(editing.grant); if (invalid) { setError(invalid); return; } setDialog({ title: `Đổi quyền của ${member.email}`, description: `Áp dụng vai trò và chi nhánh mới trong ${tenantName}.`, confirmLabel: 'Lưu quyền', run: reason => patch(member, editing.grant, reason, `Đã cập nhật quyền của ${member.email}.`) }); }}>Lưu quyền</button><button type="button" className="link-button" onClick={() => setEditing(null)}>Huỷ</button></div></td>
        : <><td data-label="Vai trò">{member.roles.map(role => roleLabel[role] ?? role).join(', ')}</td><td data-label="Chi nhánh">{member.roles.includes('OWNER') ? 'Toàn merchant' : member.branchIds.map(branchName).join(', ') || '—'}</td></>}
      <td data-label="Trạng thái">{member.status === 'ACTIVE' ? <span className="pill green">Hoạt động</span> : <span className="pill gray">Đã vô hiệu hoá</span>}</td>
      <td data-label="" className="row-actions">{editing?.id !== member.id && <button type="button" className="secondary" onClick={() => setEditing({ id: member.id, grant: { roles: member.roles, branchIds: member.branchIds } })}>Sửa quyền</button>}{member.status === 'ACTIVE'
        ? <button type="button" className="secondary danger" onClick={() => setDialog({ title: `Vô hiệu hoá ${member.email}`, description: `Người này không truy cập được ${tenantName} nữa.`, confirmLabel: 'Vô hiệu hoá', danger: true, run: reason => patch(member, { status: 'INACTIVE' }, reason, `Đã vô hiệu hoá ${member.email}.`) })}>Vô hiệu hoá</button>
        : <button type="button" className="secondary" onClick={() => setDialog({ title: `Kích hoạt lại ${member.email}`, description: `Khôi phục quyền truy cập ${tenantName}.`, confirmLabel: 'Kích hoạt lại', run: reason => patch(member, { status: 'ACTIVE' }, reason, `Đã kích hoạt lại ${member.email}.`) })}>Kích hoạt lại</button>}</td>
    </tr>)}</tbody></table></div>}
    <details className="outcome-form"><summary>Thêm thành viên</summary><form className="admin-form" onSubmit={add}>
      <label>Email<input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} autoComplete="off" required /></label>
      <label>Tên hiển thị<input value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} maxLength={200} required /></label>
      <label>Mật khẩu tạm (≥ 12 ký tự)<input value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} minLength={12} autoComplete="new-password" required /></label>
      <label>Lý do (bắt buộc)<input value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} maxLength={500} required /></label>
      <GrantPicker value={grant} onChange={setGrant} branches={branches} />
      <button className="primary" disabled={adding}>{adding ? 'Đang thêm…' : 'Thêm thành viên'}</button>
    </form></details>
    <ReasonDialog request={dialog} onClose={() => setDialog(null)} />
  </div>;
}
