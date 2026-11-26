'use client';

import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { currentSessionId } from '@/lib/admin';

type AuthSession = { id: string; createdAt: string; lastUsedAt: string | null; expiresAt: string; revoked: boolean };

// Each refresh rotates into a new session row and revokes the previous one, so history rows are hidden by default.
export default function MySessions({ token, onCurrentRevoked }: { token: string; onCurrentRevoked: () => void }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<AuthSession[] | null>(null); const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(''); const [revision, setRevision] = useState(0);
  const current = currentSessionId(token);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setError('');
    request<AuthSession[]>('/auth/sessions', { signal: controller.signal }, token).then(setItems)
      .catch(err => { if (!controller.signal.aborted) { setItems(null); setError((err as Error).message); } });
    return () => controller.abort();
  }, [open, token, revision]);

  async function revoke(item: AuthSession) {
    const isCurrent = item.id === current;
    if (!window.confirm(isCurrent ? 'Thu hồi phiên hiện tại sẽ đăng xuất bạn khỏi trình duyệt này. Tiếp tục?' : 'Thu hồi phiên này? Thiết bị đó sẽ phải đăng nhập lại.')) return;
    setBusy(item.id); setError(''); setNotice('');
    try {
      await request<void>(`/auth/sessions/${encodeURIComponent(item.id)}`, { method: 'DELETE' }, token);
      if (isCurrent) { onCurrentRevoked(); return; }
      setNotice('Đã thu hồi phiên.'); setRevision(value => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }

  const now = Date.now();
  const active = (item: AuthSession) => !item.revoked && Date.parse(item.expiresAt) > now;
  const visible = items?.filter(item => showHistory || active(item)) ?? [];
  const when = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';
  return <section className="card amenities" aria-labelledby="sessions-title">
    <details onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}><summary><h2 id="sessions-title" className="inline-heading">Phiên đăng nhập của tôi</h2></summary>
      <p>Thu hồi phiên trên thiết bị bạn không dùng nữa. Thu hồi phiên hiện tại tương đương đăng xuất.</p>
      {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
      <label className="check-row"><input type="checkbox" checked={showHistory} onChange={event => setShowHistory(event.target.checked)} /> Hiện cả phiên đã thu hồi/hết hạn (gồm lịch sử xoay token)</label>
      {!items ? !error && <p role="status">Đang tải phiên…</p> : visible.length === 0 ? <div className="empty">Không có phiên.</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Phiên</th><th>Tạo lúc</th><th>Dùng gần nhất</th><th>Hết hạn</th><th></th></tr></thead><tbody>{visible.map(item => <tr key={item.id} className={active(item) ? '' : 'muted'}>
        <td><small>{item.id}</small>{item.id === current && <> <span className="tag">Phiên này</span></>}</td><td>{when(item.createdAt)}</td><td>{when(item.lastUsedAt)}</td><td>{item.revoked ? 'Đã thu hồi' : when(item.expiresAt)}</td>
        <td>{active(item) && <button type="button" className="secondary danger" disabled={busy === item.id} onClick={() => void revoke(item)}>{item.id === current ? 'Đăng xuất phiên này' : 'Thu hồi'}</button>}</td>
      </tr>)}</tbody></table></div>}
    </details>
  </section>;
}
