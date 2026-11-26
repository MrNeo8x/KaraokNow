'use client';

import { useEffect, useState } from 'react';
import { ApiError, request } from '@/lib/api';
import { formatAge } from '@/lib/admin';

type HoldBacklog = { overdueCount: string; oldestOverdueSeconds: number | null };
type OutboxBacklog = { pendingCount: string; processingCount: string; deadCount: string; oldestReadySeconds: number | null };
const STALE_SECONDS = 300;

// Owner-only. Other roles receive 403 and the section is hidden.
export default function OpsBacklog({ token, tenant }: { token: string; tenant: string }) {
  const [holds, setHolds] = useState<HoldBacklog | null>(null); const [outbox, setOutbox] = useState<OutboxBacklog | null>(null);
  const [error, setError] = useState(''); const [hidden, setHidden] = useState(false); const [loading, setLoading] = useState(false); const [revision, setRevision] = useState(0); const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([
      request<HoldBacklog>('/merchant/booking/hold-expiry/backlog', { signal: controller.signal }, token, tenant),
      request<OutboxBacklog>('/merchant/notifications/outbox/backlog', { signal: controller.signal }, token, tenant),
    ]).then(([holdValue, outboxValue]) => { setHolds(holdValue); setOutbox(outboxValue); setCheckedAt(new Date()); })
      .catch(err => { if (controller.signal.aborted) return; if (err instanceof ApiError && err.status === 403) setHidden(true); else { setHolds(null); setOutbox(null); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, tenant, revision]);

  if (hidden) return null;
  const holdWarn = holds && (BigInt(holds.overdueCount) > 0n && (holds.oldestOverdueSeconds ?? 0) > STALE_SECONDS);
  const outboxWarn = outbox && (BigInt(outbox.deadCount) > 0n || (outbox.oldestReadySeconds ?? 0) > STALE_SECONDS);
  return <section className="card amenities" aria-labelledby="ops-title">
    <h2 id="ops-title">Theo dõi vận hành</h2>
    <p>Số tồn đọng lớn hoặc cũ nghĩa là worker nền không chạy. Trang này chỉ đọc, không tự xử lý.</p>
    {error && <div className="error" role="alert">{error}</div>}
    {holds && outbox && <div className="ops-grid">
      <div className={holdWarn ? 'ops-card warn' : 'ops-card'}><span className="eyebrow">HOLD QUÁ HẠN CHƯA XỬ LÝ</span><strong>{holds.overdueCount}</strong><small>Cũ nhất: {formatAge(holds.oldestOverdueSeconds)}</small>{holdWarn && <small>Worker hết hạn hold có thể đang dừng.</small>}</div>
      <div className={outboxWarn ? 'ops-card warn' : 'ops-card'}><span className="eyebrow">HÀNG ĐỢI THÔNG BÁO</span><strong>{outbox.pendingCount}</strong><small>Đang xử lý {outbox.processingCount} · Lỗi vĩnh viễn {outbox.deadCount}</small><small>Chờ lâu nhất: {formatAge(outbox.oldestReadySeconds)}</small>{outboxWarn && <small>Worker thông báo có thể đang dừng hoặc có tin lỗi.</small>}</div>
    </div>}
    <div className="amenity-buttons"><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? 'Đang tải…' : 'Làm mới'}</button>{checkedAt && <span>Cập nhật {checkedAt.toLocaleTimeString('vi-VN')}</span>}</div>
  </section>;
}
