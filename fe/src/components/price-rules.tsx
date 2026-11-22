'use client';
import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

export type PriceRule = { id: string; code: string; name: string; priority: number; amountVnd: string; amountUnit: string; status: string; weekdays: number[]; roomId: string | null; specialDateId: string | null; startTime: string | null; endTime: string | null; minDurationMinutes: number | null; maxDurationMinutes: number | null };
type Props = { token: string; tenant: string; planId: string; rules: PriceRule[]; loading: boolean; refresh: () => void };
const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export default function PriceRules({ token, tenant, planId, rules, loading, refresh }: Props) {
  const [editId, setEditId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = rules.find(rule => rule.id === editId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const optional = (name: string) => String(data.get(name) ?? '').trim() || null;
    const startTime = optional('startTime'); const endTime = optional('endTime');
    const min = optional('min'); const max = optional('max');
    if (!!startTime !== !!endTime || (startTime && startTime === endTime)) { setError('Cần nhập cả giờ bắt đầu và kết thúc khác nhau, hoặc để trống cả hai.'); return; }
    if (min && max && Number(min) > Number(max)) { setError('Thời lượng tối đa phải lớn hơn hoặc bằng tối thiểu.'); return; }
    const values = { name: String(data.get('name')).trim(), priority: Number(data.get('priority')), amountVnd: String(data.get('amount')).trim(), amountUnit: String(data.get('unit')), weekdays: data.getAll('weekday').map(Number), roomId: optional('roomId'), specialDateId: optional('specialDateId'), startTime, endTime, minDurationMinutes: min ? Number(min) : null, maxDurationMinutes: max ? Number(max) : null };
    if (!values.name || (!selected && !String(data.get('code')).trim())) { setError('Mã và tên quy tắc không được để trống.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await request(selected ? `/merchant/pricing/rules/${encodeURIComponent(selected.id)}` : '/merchant/pricing/rules', { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(selected ? { ...values, status: data.get('status') } : { ...values, code: String(data.get('code')).trim(), pricePlanId: planId }) }, token, tenant);
      setMessage(selected ? 'Đã cập nhật quy tắc.' : 'Đã tạo quy tắc.'); setEditId(''); form.reset(); refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="rules-heading"><h3 id="rules-heading">Quy tắc giá</h3>
    {error && <div role="alert" className="error">{error}</div>}{message && <div role="status" className="notice">{message}</div>}
    {loading ? <p>Đang tải quy tắc giá…</p> : rules.length === 0 ? <p>Chưa có quy tắc giá.</p> : <ul className="amenity-list">{rules.map(rule => <li key={rule.id}><span>{rule.code} · {rule.name} · ưu tiên {rule.priority} · {rule.amountVnd} ₫ / {rule.amountUnit === 'PER_HOUR' ? 'giờ' : 'lượt'} · {rule.status}</span><button type="button" disabled={busy} onClick={() => { setEditId(rule.id); setError(''); setMessage(''); }}>Sửa</button></li>)}</ul>}
    <form className="action-form pricing-grid" key={selected?.id ?? 'new'} onSubmit={submit}>
      <h3>{selected ? `Sửa quy tắc ${selected.code}` : 'Thêm quy tắc giá'}</h3>
      {!selected && <label>Mã quy tắc<input name="code" required maxLength={50} /></label>}
      <label>Tên quy tắc<input name="name" required maxLength={200} defaultValue={selected?.name} /></label>
      <label>Độ ưu tiên<input name="priority" type="number" min={-2147483648} max={2147483647} required defaultValue={selected?.priority ?? 0} /></label>
      <label>Giá VND<input name="amount" inputMode="numeric" pattern="(0|[1-9][0-9]{0,18})" required defaultValue={selected?.amountVnd} /></label>
      <label>Đơn vị<select name="unit" defaultValue={selected?.amountUnit ?? 'PER_HOUR'}><option value="PER_HOUR">Theo giờ</option><option value="PER_BOOKING">Theo lượt</option></select></label>
      {selected && <label>Trạng thái<select name="status" defaultValue={selected.status}><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></select></label>}
      <fieldset className="weekday-field"><legend>Thứ áp dụng · không chọn nghĩa là mọi ngày</legend>{days.map((day, index) => <label className="check-row" key={day}><input type="checkbox" name="weekday" value={index} defaultChecked={selected?.weekdays.includes(index)} />{day}</label>)}</fieldset>
      <label>Giờ bắt đầu<input type="time" name="startTime" defaultValue={selected?.startTime?.slice(0, 8) ?? ''} step={1} /></label><label>Giờ kết thúc<input type="time" name="endTime" defaultValue={selected?.endTime?.slice(0, 8) ?? ''} step={1} /></label>
      <label>Thời lượng tối thiểu (phút)<input type="number" name="min" min={1} max={1440} defaultValue={selected?.minDurationMinutes ?? ''} /></label><label>Thời lượng tối đa (phút)<input type="number" name="max" min={1} max={1440} defaultValue={selected?.maxDurationMinutes ?? ''} /></label>
      <label>ID phòng (để trống cho mọi phòng)<input name="roomId" defaultValue={selected?.roomId ?? ''} placeholder="UUID phòng" /></label><label>ID ngày đặc biệt (không bắt buộc)<input name="specialDateId" defaultValue={selected?.specialDateId ?? ''} placeholder="UUID ngày đặc biệt" /></label>
      <p>Quy tắc được xét theo giờ bắt đầu tại múi giờ chi nhánh. Nếu ưu tiên cao nhất trùng nhau, báo giá sẽ bị từ chối.</p>
      <div className="amenity-buttons"><button className="primary" disabled={busy || loading}>{busy ? 'Đang lưu…' : selected ? 'Lưu quy tắc' : 'Tạo quy tắc'}</button>{selected && <button type="button" disabled={busy} onClick={() => { setEditId(''); setError(''); }}>Hủy sửa</button>}</div>
    </form>
  </section>;
}
