'use client';
import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Policy = { channel: string; configured: boolean; allowed: boolean | null };
export default function NoDepositSettings({ token, tenant }: { token: string; tenant: string }) {
  const [channel, setChannel] = useState('WALK_IN'); const [policy, setPolicy] = useState<Policy | null>(null);
  const [choice, setChoice] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) { setError('Mã kênh chỉ gồm chữ hoa, số và dấu gạch dưới.'); return; }
    setBusy(true); setError(''); setMessage(''); setPolicy(null); setChoice('');
    try { const data = await request<Policy>(`/merchant/booking/no-deposit-confirmation/${encodeURIComponent(channel)}`, {}, token, tenant); setPolicy(data); setChoice(data.configured && data.allowed !== null ? String(data.allowed) : ''); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!policy || policy.channel !== channel || !['true', 'false'].includes(choice)) return;
    setBusy(true); setError(''); setMessage('');
    try { const data = await request<Policy>(`/merchant/booking/no-deposit-confirmation/${encodeURIComponent(policy.channel)}`, { method: 'PATCH', body: JSON.stringify({ allowed: choice === 'true' }) }, token, tenant); setPolicy(data); setChoice(data.allowed === null ? '' : String(data.allowed)); setMessage('Đã lưu cấu hình theo kênh.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <details className="card pricing-settings"><summary>Xác nhận không đặt cọc theo kênh</summary><p>Cấu hình này chưa xác nhận booking và chưa thay thế quy tắc tiền cọc hoặc điều kiện theo trường hợp. Owner/Branch Manager được phép cấu hình.</p>
    <form className="action-form" onSubmit={load}><label>Mã kênh<input value={channel} onChange={event => { setChannel(event.target.value); setPolicy(null); setChoice(''); setError(''); setMessage(''); }} pattern="[A-Z][A-Z0-9_]{0,49}" maxLength={50} disabled={busy} required /></label><button className="primary" disabled={busy}>Xem cấu hình</button></form>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {policy && <form className="action-form" onSubmit={save}><p>Trạng thái hiện tại: <strong>{!policy.configured || policy.allowed === null ? 'Chưa cấu hình' : policy.allowed ? 'Cho phép' : 'Không cho phép'}</strong></p><label>Lựa chọn cho {policy.channel}<select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy} required><option value="">Chọn một quyết định</option><option value="true">Cho phép</option><option value="false">Không cho phép</option></select></label><button className="primary" disabled={busy || !choice}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button></form>}
  </details>;
}
