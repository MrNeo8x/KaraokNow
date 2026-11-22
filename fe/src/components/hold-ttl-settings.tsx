'use client';
import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Policy = { channel: string; ttlMinutes: number; version?: string };

export default function HoldTtlSettings({ token, tenant }: { token: string; tenant: string }) {
  const [channel, setChannel] = useState('WALK_IN');
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [ttl, setTtl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) { setError('Mã kênh phải viết hoa, chỉ gồm chữ, số hoặc dấu gạch dưới.'); return; }
    setBusy(true); setError(''); setMessage(''); setPolicy(null);
    try {
      const result = await request<Policy>(`/merchant/booking/hold-ttl/${encodeURIComponent(channel)}`, {}, token, tenant);
      setPolicy(result); setTtl(String(result.ttlMinutes));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || channel !== policy.channel) return;
    const value = Number(ttl);
    if (!Number.isInteger(value) || value < 1 || value > 1440) { setError('Thời gian giữ phải từ 1 đến 1440 phút.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<Policy>(`/merchant/booking/hold-ttl/${encodeURIComponent(policy.channel)}`, { method: 'PATCH', body: JSON.stringify({ ttlMinutes: value }) }, token, tenant);
      setPolicy(result); setTtl(String(result.ttlMinutes)); setMessage('Đã lưu thời gian giữ phòng.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <details className="card pricing-settings"><summary>Thời gian giữ phòng theo kênh</summary>
    <p>Owner hoặc Branch Manager có thể cấu hình theo mã kênh. Nếu chưa cấu hình, backend trả mặc định 15 phút; thay đổi áp dụng cho các hold tạo sau đó.</p>
    <form className="action-form" onSubmit={load}><label>Mã kênh<input value={channel} onChange={event => { setChannel(event.target.value); setPolicy(null); setError(''); setMessage(''); }} pattern="[A-Z][A-Z0-9_]{0,49}" maxLength={50} disabled={busy} required /></label><button className="primary" disabled={busy}>{busy ? 'Đang xử lý…' : 'Xem cấu hình'}</button></form>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {policy && <form className="action-form" onSubmit={save}><label>Thời gian giữ cho {policy.channel} (phút)<input type="number" min={1} max={1440} step={1} value={ttl} onChange={event => setTtl(event.target.value)} disabled={busy} required /></label><button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thời gian giữ'}</button></form>}
  </details>;
}
