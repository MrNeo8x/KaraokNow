'use client';

import { useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

export type DetailedHold = { id: string; branchId: string; roomId: string; channel: string; startAt: string; durationMinutes: number; reservedEndAt: string; expiresAt: string; bufferMinutes: number; status: 'HELD' | 'EXPIRED'; customerPhone?: string | null; customerEmail?: string | null; priceSnapshot?: { totalAmountVnd?: string; currency?: string } | null; phoneVerifiedAt?: string | null; phoneVerifiedBy?: string | null };
type Quote = { priceSnapshot: { totalAmountVnd: string; currency: string; timezone: string; calculation: { priceRuleCode: string } } };

export default function HoldDetails({ hold, token, tenant, onUpdated }: { hold: DetailedHold; token: string; tenant: string; onUpdated: (hold: DetailedHold) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [called, setCalled] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function getQuote() {
    setBusy(true); setError(''); setMessage(''); setQuote(null);
    try { setQuote(await request<Quote>(`/merchant/rooms/${encodeURIComponent(hold.roomId)}/quote`, { method: 'POST', body: JSON.stringify({ startAt: hold.startAt, durationMinutes: hold.durationMinutes }) }, token, tenant)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!quote) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<DetailedHold>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}/details`, { method: 'POST', body: JSON.stringify({ phone: phone.trim(), ...(email.trim() ? { email: email.trim() } : {}), expectedTotalAmountVnd: quote.priceSnapshot.totalAmountVnd }) }, token, tenant);
      setPhone(''); setEmail(''); setQuote(null); setMessage('Đã lưu thông tin khách và snapshot giá.'); onUpdated(result);
    } catch (err) { setError(`${(err as Error).message} Nếu giá đã thay đổi, hãy xem lại báo giá trước khi gửi lại.`); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!called) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<DetailedHold>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}/phone-verification`, { method: 'POST' }, token, tenant);
      setCalled(false); setMessage('Đã ghi nhận cuộc gọi xác minh.'); onUpdated(result);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="hold-detail-form"><h3>Thông tin khách &amp; giá</h3>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {hold.priceSnapshot ? <p>Số điện thoại: {hold.customerPhone}<br />Email: {hold.customerEmail || 'Không cung cấp'}<br />Giá đã lưu: {hold.priceSnapshot.totalAmountVnd} {hold.priceSnapshot.currency}<br />Xác minh cuộc gọi: {hold.phoneVerifiedAt ? `Đã ghi nhận lúc ${new Date(hold.phoneVerifiedAt).toLocaleString('vi-VN')}` : 'Chưa ghi nhận'}</p> : hold.status === 'HELD' ? <><p>Xem báo giá hiện tại trước khi lưu. Backend sẽ tính lại giá và từ chối nếu tổng tiền đã thay đổi; thông tin đã lưu không thể chỉnh sửa từ bước này.</p><button type="button" className="primary" disabled={busy} onClick={() => void getQuote()}>{busy ? 'Đang xử lý…' : 'Xem báo giá hiện tại'}</button>{quote && <><div className="notice" role="status">Giá hiển thị: <strong>{quote.priceSnapshot.totalAmountVnd} {quote.priceSnapshot.currency}</strong> · quy tắc {quote.priceSnapshot.calculation.priceRuleCode} · {quote.priceSnapshot.timezone}</div><form className="action-form" onSubmit={attach}><label>Số điện thoại khách<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} pattern="\+?[0-9]{8,15}" maxLength={16} required /></label><label>Email (không bắt buộc)<input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></label><button className="primary" disabled={busy}>Lưu khách và giá hiển thị</button></form></>}</> : <p>Hold đã hết hạn; không thể lưu thông tin khách hoặc giá.</p>}
    {hold.status === 'HELD' && hold.customerPhone && !hold.phoneVerifiedAt && <form className="action-form" onSubmit={verify}><label className="check-row"><input type="checkbox" checked={called} onChange={event => setCalled(event.target.checked)} /> Tôi đã gọi và xác minh thành công số {hold.customerPhone}.</label><button className="primary" disabled={busy || !called}>Ghi nhận cuộc gọi xác minh</button></form>}
    <p>Việc lưu thông tin hoặc ghi nhận cuộc gọi không xác nhận booking và không xử lý thanh toán.</p>
  </div>;
}
