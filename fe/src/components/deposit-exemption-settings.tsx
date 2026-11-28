'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { request } from '@/lib/api';
import { roleLabel, ROLES } from '@/lib/admin';
import { exemptionPayload, toForm, WEEKDAY_LABEL, type ExemptionForm, type ExemptionPolicy } from '@/lib/deposit-exemption';
import { useCan } from './permissions-context';

/** Case-level deposit exemptions (FE-024, BKG-008, PD-050): every role reads; Owner/Branch Manager edit. Every case is off by default. */
export default function DepositExemptionSettings({ token, tenant }: { token: string; tenant: string }) {
  const canEdit = useCan()('policy.update');
  const [policy, setPolicy] = useState<ExemptionPolicy | null>(null); const [form, setForm] = useState<ExemptionForm | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    request<ExemptionPolicy>('/merchant/booking/deposit-exemptions', { signal: controller.signal }, token, tenant).then(value => { setPolicy(value); setForm(toForm(value)); })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [token, tenant]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return; setError(''); setMessage('');
    const result = exemptionPayload(form); if ('error' in result) { setError(result.error); return; }
    setBusy(true);
    try { const next = await request<ExemptionPolicy>('/merchant/booking/deposit-exemptions', { method: 'PUT', body: JSON.stringify(result.payload) }, token, tenant); setPolicy(next); setForm(toForm(next)); setMessage(`Đã lưu chính sách miễn cọc (phiên bản ${next.version ?? '—'}). Áp dụng khi xác nhận các giữ chỗ từ bây giờ.`); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const update = (patch: Partial<ExemptionForm>) => setForm(current => current && { ...current, ...patch });
  const setWindow = (index: number, patch: Partial<ExemptionForm['windows'][number]>) => setForm(current => current && { ...current, windows: current.windows.map((window, position) => position === index ? { ...window, ...patch } : window) });
  return <details className="card pricing-settings deposit-exemptions"><summary>Miễn cọc theo trường hợp</summary>
    <p>Giữ chỗ được xác nhận dù chưa đủ cọc (hoặc kênh chưa bật không cọc) khi khớp một trường hợp dưới đây. Hệ thống xét lúc xác nhận và lưu lý do vào booking. Bỏ trống một mục = tắt mục đó.</p>
    {policy && <span className="pill gray">{policy.configured ? `Đã cấu hình · phiên bản ${policy.version}` : 'Chưa cấu hình · mọi trường hợp đang tắt'}</span>}
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {!form ? !error && <p role="status">Đang tải…</p> : <form className="exemption-form" onSubmit={save}>
      <fieldset disabled={!canEdit || busy}>
        <label>Tổng tiền tối đa được miễn cọc (VND)<input inputMode="numeric" value={form.maxAmount} onChange={event => update({ maxAmount: event.target.value })} placeholder="vd 300000 — bỏ trống để tắt" /></label>
        <div className="exemption-windows"><strong>Khung giờ vắng</strong><small>Giờ bắt đầu của booking nằm trong khung (giờ chi nhánh, không qua nửa đêm).</small>
          {form.windows.length === 0 && <p>Chưa có khung giờ vắng.</p>}
          {form.windows.map((window, index) => <div className="exemption-window" key={index} role="group" aria-label={`Khung giờ vắng ${index + 1}`}>
            <div className="weekday-picks">{WEEKDAY_LABEL.map((label, day) => <label key={label} className="check-row"><input type="checkbox" checked={window.weekdays.includes(day + 1)} onChange={event => setWindow(index, { weekdays: event.target.checked ? [...window.weekdays, day + 1] : window.weekdays.filter(value => value !== day + 1) })} />{label}</label>)}</div>
            <label>Từ<input type="time" value={window.from} onChange={event => setWindow(index, { from: event.target.value })} /></label>
            <label>Đến<input type="time" value={window.to} onChange={event => setWindow(index, { to: event.target.value })} /></label>
            <button type="button" className="link-button danger" onClick={() => update({ windows: form.windows.filter((_, position) => position !== index) })} aria-label={`Xoá khung giờ vắng ${index + 1}`}><Trash2 size={14} aria-hidden /> Xoá</button>
          </div>)}
          {form.windows.length < 14 && <button type="button" className="secondary" onClick={() => update({ windows: [...form.windows, { weekdays: [1, 2, 3, 4, 5], from: '10:00', to: '17:00' }] })}><Plus size={14} aria-hidden /> Thêm khung giờ vắng</button>}
        </div>
        <div className="fields-row">
          <label>Khách quen: số booking hoàn tất tối thiểu<input inputMode="numeric" value={form.regularMin} onChange={event => update({ regularMin: event.target.value })} placeholder="vd 3 — bỏ trống để tắt" /></label>
          <label>Xét trong (ngày)<input inputMode="numeric" value={form.lookback} onChange={event => update({ lookback: event.target.value })} /></label>
        </div>
        <small>Khách quen: cùng số điện thoại, đủ số booking hoàn tất và không có lần không đến trong khoảng ngày này.</small>
        <div><strong>Vai trò được duyệt miễn cọc thủ công</strong><div className="weekday-picks">{ROLES.map(role => <label key={role} className="check-row"><input type="checkbox" checked={role === 'OWNER' || form.waiverRoles.includes(role)} disabled={role === 'OWNER'} onChange={event => update({ waiverRoles: event.target.checked ? [...form.waiverRoles, role] : form.waiverRoles.filter(value => value !== role) })} />{roleLabel[role]}</label>)}</div><small>Owner luôn được duyệt. Người được duyệt bấm &quot;Miễn cọc&quot; trên giữ chỗ và ghi lý do.</small></div>
      </fieldset>
      {canEdit ? <button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu chính sách miễn cọc'}</button> : <small>Chỉ Owner hoặc Quản lý chi nhánh thay đổi được.</small>}
    </form>}
  </details>;
}
