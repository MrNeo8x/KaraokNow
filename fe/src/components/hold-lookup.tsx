'use client';

import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import HoldDetails, { type DetailedHold } from './hold-details';

export default function HoldLookup({ token, tenant }: { token: string; tenant: string }) {
  const [id, setId] = useState('');
  const [hold, setHold] = useState<DetailedHold | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = id.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) { setError('Vui lòng nhập mã giữ phòng UUID hợp lệ.'); setHold(null); return; }
    setBusy(true); setError(''); setHold(null);
    try { setHold(await request<DetailedHold>(`/merchant/booking/holds/${encodeURIComponent(value)}`, {}, token, tenant)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="card amenities" aria-labelledby="hold-lookup-title">
    <h2 id="hold-lookup-title">Tra cứu mã giữ phòng</h2>
    <p>Nhập mã đã nhận khi giữ phòng. Backend kiểm tra quyền Merchant và chi nhánh trước khi trả kết quả.</p>
    <form className="action-form" onSubmit={lookup}><label>Mã giữ phòng<input value={id} onChange={event => setId(event.target.value)} placeholder="UUID giữ phòng" required maxLength={36} /></label><button className="primary" disabled={busy}>{busy ? 'Đang tra cứu…' : 'Tra cứu trạng thái'}</button></form>
    {error && <div role="alert" className="error">{error}</div>}
    {hold && <><div className="hold-result" role="status"><strong>{hold.status === 'HELD' ? 'Đang giữ' : 'Đã hết hạn'}</strong><p>Mã giữ: {hold.id}<br />Mã chi nhánh: {hold.branchId}<br />Mã phòng: {hold.roomId}<br />Kênh: {hold.channel}<br />Bắt đầu: {new Date(hold.startAt).toISOString()}<br />Thời lượng: {hold.durationMinutes} phút<br />Hết hạn giữ: {new Date(hold.expiresAt).toISOString()}<br />Giữ chỗ đến: {new Date(hold.reservedEndAt).toISOString()} · buffer {hold.bufferMinutes} phút</p><small>Thời gian hiển thị theo UTC. Đây là trạng thái hold, chưa phải booking được xác nhận.</small></div><HoldDetails key={hold.id} hold={hold} token={token} tenant={tenant} onUpdated={setHold} /></>}
  </section>;
}
