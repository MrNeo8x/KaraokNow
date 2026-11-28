'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, LifeBuoy } from 'lucide-react';
import { request } from '@/lib/api';
import type { components } from '@/lib/api-types.gen';
import { supportHref } from '@/lib/support';

type SupportSession = components['schemas']['SupportSessionDto'];

/** Super Admin support sessions (FE-021, PD-045): open sessions, history, end a session. Sessions start from the merchant list. */
export default function SupportSessions({ token }: { token: string }) {
  const [status, setStatus] = useState<'active' | 'all'>('active'); const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<SupportSession[] | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [ending, setEnding] = useState('');

  useEffect(() => {
    const controller = new AbortController(); setError('');
    request<SupportSession[]>(`/platform/support-sessions?status=${status}`, { signal: controller.signal }, token).then(setItems)
      .catch(err => { if (!controller.signal.aborted) { setItems([]); setError((err as Error).message); } });
    return () => controller.abort();
  }, [status, token, revision]);

  async function end(item: SupportSession) {
    setEnding(item.id); setError(''); setNotice('');
    try { await request(`/platform/support-sessions/${encodeURIComponent(item.id)}/end`, { method: 'POST' }, token); setNotice(`Đã kết thúc phiên hỗ trợ ${item.tenantName}.`); setRevision(value => value + 1); }
    catch (err) { setError((err as Error).message); } finally { setEnding(''); }
  }

  const when = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '—';
  return <section className="card amenities" aria-labelledby="support-title">
    <div className="section-head"><h2 id="support-title"><LifeBuoy size={18} aria-hidden /> Phiên hỗ trợ</h2>
      <label className="select-label">Hiển thị<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="active">Đang mở</option><option value="all">Tất cả</option></select></label></div>
    <p>Mở phiên từ mục <strong>Merchant</strong> (nút &quot;Hỗ trợ&quot;, cần lý do). Mỗi phiên kéo dài 60 phút, chỉ xem, SĐT/email bị che một phần; Owner thấy trong nhật ký audit của merchant.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {items === null ? <p role="status">Đang tải…</p> : items.length === 0 ? <div className="empty">{status === 'active' ? 'Không có phiên hỗ trợ đang mở.' : 'Chưa có phiên hỗ trợ.'}</div>
      : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Merchant</th><th>Người hỗ trợ</th><th>Lý do</th><th>Bắt đầu</th><th>Hết hạn / kết thúc</th><th></th></tr></thead><tbody>
        {items.map(item => <tr key={item.id}><td data-label="Merchant"><strong>{item.tenantName}</strong>{item.active ? <> <span className="pill green">Đang mở</span></> : <> <span className="pill gray">Đã đóng</span></>}</td><td data-label="Người hỗ trợ">{item.adminDisplayName}</td><td data-label="Lý do">{item.reason}</td><td data-label="Bắt đầu">{when(item.startedAt)}</td><td data-label="Hết hạn / kết thúc">{item.endedAt ? `Kết thúc ${when(item.endedAt)}` : `Hết hạn ${when(item.expiresAt)}`}</td>
          <td data-label="">{item.active && <div className="hold-actions"><a className="secondary button-link" href={supportHref(item.tenantId)}><ExternalLink size={14} aria-hidden /> Mở merchant</a><button type="button" className="secondary danger" disabled={ending === item.id} onClick={() => void end(item)}>Kết thúc</button></div>}</td></tr>)}
      </tbody></table></div>}
  </section>;
}
