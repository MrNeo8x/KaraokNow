'use client';
import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

export type SpecialDate = { id: string; code: string; name: string; startDate: string; endDate: string; status: string };

export default function SpecialDates({ dates, token, tenant, refresh }: { dates: SpecialDate[]; token: string; tenant: string; refresh: () => void }) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selected = dates.find(item => item.id === id);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    const code = String(data.get('code') ?? '').trim();
    const startDate = String(data.get('startDate')); const endDate = String(data.get('endDate'));
    if (!name || (!selected && !code)) { setError('Mã và tên ngày đặc biệt không được để trống.'); return; }
    if (endDate < startDate) { setError('Ngày kết thúc phải từ ngày bắt đầu trở đi.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await request(selected ? `/merchant/pricing/special-dates/${encodeURIComponent(selected.id)}` : '/merchant/pricing/special-dates', { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(selected ? { name, startDate, endDate, status: data.get('status') } : { code, name, startDate, endDate }) }, token, tenant);
      setMessage(selected ? 'Đã cập nhật ngày đặc biệt.' : 'Đã tạo ngày đặc biệt.'); setId(''); form.reset(); refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="special-dates-title"><h3 id="special-dates-title">Ngày đặc biệt</h3><p>Chỉ Owner có quyền quản lý. Chọn một khoảng ngày để chỉnh sửa hoặc tạo mới.</p>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    <label className="pricing-select">Chỉnh sửa ngày đặc biệt<select value={selected?.id ?? ''} disabled={busy} onChange={event => { setId(event.target.value); setError(''); setMessage(''); }}><option value="">Tạo mới</option>{dates.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name} · {item.startDate}–{item.endDate} · {item.status}</option>)}</select></label>
    <form className="action-form pricing-grid" key={selected?.id ?? 'new'} onSubmit={save}>
      {!selected && <label>Mã ngày đặc biệt<input name="code" required maxLength={50} /></label>}
      <label>Tên<input name="name" defaultValue={selected?.name} required maxLength={200} /></label>
      <label>Từ ngày<input name="startDate" type="date" defaultValue={selected?.startDate} required /></label><label>Đến ngày<input name="endDate" type="date" defaultValue={selected?.endDate} required /></label>
      {selected && <label>Trạng thái<select name="status" defaultValue={selected.status}><option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option></select></label>}
      <button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : selected ? 'Lưu thay đổi' : 'Tạo ngày đặc biệt'}</button>
    </form>
  </section>;
}
