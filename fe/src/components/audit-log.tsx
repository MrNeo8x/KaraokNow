'use client';

import { useEffect, useState } from 'react';
import { ApiError, request } from '@/lib/api';
import { auditHasMore } from '@/lib/admin';

type AuditEntry = { id: string; actorUserId: string | null; action: string; entityType: string; entityId: string; beforeData: unknown; afterData: unknown; occurredAt: string };
const LIMIT = 50;

// Owner-only. Other roles receive 403 and the section is hidden.
export default function AuditLog({ token, tenant }: { token: string; tenant: string }) {
  const [open, setOpen] = useState(false); const [offset, setOffset] = useState(0); const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<AuditEntry[] | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [hidden, setHidden] = useState(false);

  // Probe once so non-Owner roles never see the collapsed section.
  useEffect(() => {
    const controller = new AbortController();
    request<AuditEntry[]>('/merchant/audit-logs?limit=1&offset=0', { signal: controller.signal }, token, tenant)
      .catch(err => { if (!controller.signal.aborted && err instanceof ApiError && err.status === 403) setHidden(true); });
    return () => controller.abort();
  }, [token, tenant]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError('');
    request<AuditEntry[]>(`/merchant/audit-logs?limit=${LIMIT}&offset=${offset}`, { signal: controller.signal }, token, tenant).then(setItems)
      .catch(err => { if (controller.signal.aborted) return; setItems(null); if (err instanceof ApiError && err.status === 403) setHidden(true); else setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, offset, revision, token, tenant]);

  if (hidden) return null;
  return <section className="card amenities" aria-labelledby="audit-title">
    <details onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}><summary><h2 id="audit-title" className="inline-heading">Nhật ký audit</h2></summary>
      <p>Mọi thay đổi dữ liệu merchant, mới nhất trước. Dữ liệu trước/sau là JSON tuỳ loại thao tác.</p>
      {error && <div className="error" role="alert">{error}</div>}
      {loading ? <p role="status">Đang tải nhật ký…</p> : items && (items.length === 0 ? <div className="empty">{offset === 0 ? 'Chưa có bản ghi audit.' : 'Không còn bản ghi.'}</div> : <div className="table-wrap"><table className="admin-table"><thead><tr><th>Thời gian</th><th>Thao tác</th><th>Đối tượng</th><th>Người thực hiện</th><th>Chi tiết</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString('vi-VN')}</td><td><code>{item.action}</code></td><td>{item.entityType}<br /><small>{item.entityId}</small></td><td><small>{item.actorUserId ?? 'Hệ thống'}</small></td><td>{(item.beforeData != null || item.afterData != null) && <details><summary>Xem</summary>{item.beforeData != null && <><small>Trước</small><pre>{JSON.stringify(item.beforeData, null, 2)}</pre></>}{item.afterData != null && <><small>Sau</small><pre>{JSON.stringify(item.afterData, null, 2)}</pre></>}</details>}</td></tr>)}</tbody></table></div>)}
      {items && <div className="amenity-buttons"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - LIMIT))}>← Mới hơn</button><span>Trang {Math.floor(offset / LIMIT) + 1}</span><button type="button" disabled={loading || !auditHasMore(items.length, LIMIT)} onClick={() => setOffset(value => value + LIMIT)}>Cũ hơn →</button><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Tải lại</button></div>}
    </details>
  </section>;
}
