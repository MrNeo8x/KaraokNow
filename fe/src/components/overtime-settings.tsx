'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { useCan } from './permissions-context';

export type OvertimePolicy = { configured: boolean; graceMinutes: number; version: string | null };

// Every merchant role can read; Owner and Branch Manager can update (backend enforces).
export default function OvertimeSettings({ token, tenant }: { token: string; tenant: string }) {
  const canEdit = useCan()('policy.update');
  const [policy, setPolicy] = useState<OvertimePolicy | null>(null); const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request<OvertimePolicy>('/merchant/booking/overtime-policy', { signal: controller.signal }, token, tenant)
      .then(value => { setPolicy(value); setDraft(String(value.graceMinutes)); })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0 || value > 60) { setError('Ân hạn phải là số phút nguyên từ 0 đến 60.'); return; }
    setBusy(true);
    try { const next = await request<OvertimePolicy>('/merchant/booking/overtime-policy', { method: 'PATCH', body: JSON.stringify({ graceMinutes: value }) }, token, tenant); setPolicy(next); setDraft(String(next.graceMinutes)); setNotice(`Đã lưu ân hạn ${next.graceMinutes} phút. Áp dụng cho các lần check-out sau.`); }
    catch (err) { setError(err instanceof ApiError && err.status === 403 ? 'Chỉ Owner hoặc Quản lý chi nhánh được đổi ân hạn quá giờ.' : (err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="card amenities" aria-labelledby="overtime-title">
    <h2 id="overtime-title">Ân hạn quá giờ</h2>
    <p>Khách check-out trễ trong khoảng ân hạn không bị tính quá giờ; vượt ân hạn thì toàn bộ số phút trễ được ghi là quá giờ. Chỉ để theo dõi và báo cáo: hệ thống không tự tính tiền, tiền thu thêm (nếu có) ghi như tiền mặt thường.</p>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}
    {!policy ? !error && <p role="status">Đang tải…</p> : <>
      <p><span className={policy.configured ? 'pill purple' : 'pill gray'}>{policy.configured ? `Đã cấu hình${policy.version ? ` · phiên bản ${policy.version}` : ''}` : 'Chưa cấu hình · đang dùng mặc định'}</span></p>
      {!canEdit ? <p>Ân hạn hiện tại: <strong>{policy.graceMinutes} phút</strong>. Chỉ Owner hoặc Quản lý chi nhánh được thay đổi.</p> : <form className="action-form" onSubmit={save}><label>Ân hạn (phút, 0–60)<input type="number" inputMode="numeric" min={0} max={60} step={1} value={draft} onChange={event => setDraft(event.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu ân hạn'}</button></form>}
    </>}
  </section>;
}
