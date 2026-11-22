'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Hold = { id: string; roomId: string; channel: string; startAt: string; durationMinutes: number; expiresAt: string; status: 'HELD' | 'EXPIRED' };
type Result = { items: Hold[]; limit: number; offset: number; hasMore: boolean };
type Query = { from: string; to: string };
type Props = { token: string; tenant: string; branchId: string; timezone: string; rooms: { id: string; name: string }[] };

export default function BranchHolds({ token, tenant, branchId, timezone, rooms }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offsetZone, setOffsetZone] = useState('+07:00');
  const [query, setQuery] = useState<Query | null>(null);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null);
    const params = new URLSearchParams({ ...query, limit: '20', offset: String(offset) });
    request<Result>(`/merchant/branches/${encodeURIComponent(branchId)}/booking/holds?${params}`, { signal: controller.signal }, token, tenant)
      .then(setResult)
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, offset, branchId, token, tenant]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offsetZone) || (offsetZone.slice(1, 3) === '14' && offsetZone.slice(4) !== '00')) { setError('Độ lệch UTC phải có dạng +07:00 và nằm trong khoảng -14:00 đến +14:00.'); return; }
    const next = { from: `${from}:00${offsetZone}`, to: `${to}:00${offsetZone}` };
    if (!Number.isFinite(Date.parse(next.from)) || !Number.isFinite(Date.parse(next.to)) || Date.parse(next.from) >= Date.parse(next.to)) { setError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    setOffset(0); setQuery(next);
  }

  const format = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: timezone });
  return <section className="card availability" aria-labelledby="branch-holds-title">
    <h2 id="branch-holds-title">Danh sách giữ phòng tạm thời</h2>
    <p>Chỉ gồm hold của chi nhánh, không phải lịch booking đã xác nhận. Khoảng lọc xét thời gian sử dụng, không gồm buffer. Múi giờ chi nhánh: {timezone}.</p>
    <form className="availability-form" onSubmit={search}>
      <label>Từ thời gian<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} required /></label>
      <label>Đến thời gian<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} required /></label>
      <label>Độ lệch UTC<input value={offsetZone} onChange={e => setOffsetZone(e.target.value)} pattern="[+-][0-9]{2}:[0-9]{2}" required /></label>
      <button className="primary" disabled={loading}>{loading ? 'Đang tải…' : 'Xem danh sách'}</button>
    </form>
    {error && <div className="error" role="alert">{error}</div>}
    {loading && <p aria-live="polite">Đang tải danh sách giữ phòng…</p>}
    {result && <div aria-live="polite">{result.items.length === 0 ? <p>Không có hold trong khoảng đã chọn.</p> : <ul className="amenity-list">{result.items.map(hold => <li key={hold.id}><span><strong>{rooms.find(room => room.id === hold.roomId)?.name ?? `Phòng ${hold.roomId}`}</strong> · {hold.status === 'HELD' ? 'Đang giữ' : 'Đã hết hạn'}<br />Bắt đầu: {format(hold.startAt)} · {hold.durationMinutes} phút · {hold.channel}<br />Hạn giữ: {format(hold.expiresAt)} · Mã: {hold.id}</span></li>)}</ul>}
      <p>Thời gian hiển thị theo {timezone}. Trạng thái hết hạn trong danh sách không tự giải phóng phòng; worker hết hạn phải hoạt động.</p>
      <div className="amenity-buttons"><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>← Trang trước</button><span>Trang {Math.floor(offset / 20) + 1}</span><button type="button" disabled={loading || !result.hasMore || offset >= 10000} onClick={() => setOffset(value => value + 20)}>Trang sau →</button></div><small>Danh sách có thể thay đổi giữa các trang khi phát sinh hold mới.</small>
    </div>}
  </section>;
}
