'use client';
import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import { depositPayload } from '@/lib/deposit-policy';

type Policy = { channel: string; configured: boolean; mode: 'NONE' | 'FIXED' | 'PERCENT'; fixedAmountVnd: string | null; percent: string | null };
export default function DepositSettings({ token, tenant }: { token: string; tenant: string }) {
  const [channel, setChannel] = useState('WALK_IN'); const [policy, setPolicy] = useState<Policy | null>(null);
  const [mode, setMode] = useState<Policy['mode']>('NONE'); const [amount, setAmount] = useState(''); const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!/^[A-Z][A-Z0-9_]{0,49}$/.test(channel)) { setError('Mã kênh phải gồm chữ hoa, số hoặc dấu gạch dưới.'); return; }
    setBusy(true); setError(''); setMessage(''); setPolicy(null);
    try { const data = await request<Policy>(`/merchant/booking/deposit-policy/${encodeURIComponent(channel)}`, {}, token, tenant); setPolicy(data); setMode(data.mode); setAmount(data.fixedAmountVnd ?? ''); setPercent(data.percent ?? ''); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!policy || policy.channel !== channel) return;
    let body: ReturnType<typeof depositPayload>;
    try { body = depositPayload(mode, amount, percent); } catch (err) { setError((err as Error).message); return; }
    setBusy(true); setError(''); setMessage('');
    try { const data = await request<Policy>(`/merchant/booking/deposit-policy/${encodeURIComponent(policy.channel)}`, { method: 'PATCH', body: JSON.stringify(body) }, token, tenant); setPolicy(data); setMode(data.mode); setAmount(data.fixedAmountVnd ?? ''); setPercent(data.percent ?? ''); setMessage('Đã lưu cấu hình tiền cọc.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <details className="card pricing-settings"><summary>Tiền cọc theo kênh</summary><p>Owner hoặc Branch Manager cấu hình. Pilot ghi nhận thanh toán thủ công; cấu hình này chưa thu tiền hoặc xác nhận booking.</p>
    <form className="action-form" onSubmit={load}><label>Mã kênh<input value={channel} onChange={event => { setChannel(event.target.value); setPolicy(null); setError(''); setMessage(''); }} pattern="[A-Z][A-Z0-9_]{0,49}" maxLength={50} disabled={busy} required /></label><button className="primary" disabled={busy}>Xem cấu hình</button></form>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {policy && <form className="action-form" onSubmit={save}><p>Trạng thái: <strong>{policy.configured ? 'Đã cấu hình' : 'Chưa cấu hình · mặc định không cọc'}</strong></p><label>Loại tiền cọc<select value={mode} onChange={event => setMode(event.target.value as Policy['mode'])} disabled={busy}><option value="NONE">Không cọc</option><option value="FIXED">Số tiền cố định</option><option value="PERCENT">Tỷ lệ phần trăm</option></select></label>{mode === 'FIXED' && <label>Số tiền VND<input inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required disabled={busy} /></label>}{mode === 'PERCENT' && <label>Tỷ lệ phần trăm<input inputMode="decimal" value={percent} onChange={event => setPercent(event.target.value)} required disabled={busy} /></label>}<button className="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button></form>}
  </details>;
}
