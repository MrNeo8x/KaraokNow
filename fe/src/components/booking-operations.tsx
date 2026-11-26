'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Booking = { id: string; roomId: string; channel: string; startAt: string; durationMinutes: number; customerPhone: string; status: string; priceSnapshot: { totalAmountVnd?: string; currency?: string } };
type Page = { items: Booking[]; limit: number; offset: number; hasMore: boolean };
type Payment = { id: string; method: string; amountVnd: string; note: string | null; recordedAt: string };
type PaymentSummary = { totalRecordedVnd: string; paymentCount: number };

export default function BookingOperations({ token, tenant, branchId, timezone, rooms }: { token: string; tenant: string; branchId: string; timezone: string; rooms: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [utcOffset, setUtcOffset] = useState('+07:00');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null); const [pageOffset, setPageOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [payments, setPayments] = useState<Record<string, Payment[]>>({}); const [summaries, setSummaries] = useState<Record<string, PaymentSummary>>({}); const [paymentLoadErrors, setPaymentLoadErrors] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({}); const [notes, setNotes] = useState<Record<string, string>>({});
  const [paymentKeys, setPaymentKeys] = useState<Record<string, string>>({}); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!range) return;
    const controller = new AbortController(); setLoading(true); setError(''); setPage(null);
    const query = new URLSearchParams({ ...range, limit: '20', offset: String(pageOffset) });
    request<Page>(`/merchant/branches/${encodeURIComponent(branchId)}/booking/bookings?${query}`, { signal: controller.signal }, token, tenant)
      .then(async result => {
        setPage(result);
        const rows = await Promise.all(result.items.map(async booking => {
          try {
            const [data, summary] = await Promise.all([
              request<{ items: Payment[] }>(`/merchant/booking/bookings/${encodeURIComponent(booking.id)}/manual-payments?limit=100`, { signal: controller.signal }, token, tenant),
              request<PaymentSummary>(`/merchant/booking/bookings/${encodeURIComponent(booking.id)}/manual-payments/summary`, { signal: controller.signal }, token, tenant),
            ]);
            return { id: booking.id, items: data.items, summary, error: '' };
          }
          catch (err) { return { id: booking.id, items: [], summary: null, error: (err as Error).message }; }
        }));
        if (!controller.signal.aborted) { setPayments(Object.fromEntries(rows.map(row => [row.id, row.items]))); setSummaries(Object.fromEntries(rows.flatMap(row => row.summary ? [[row.id, row.summary] as const] : []))); setPaymentLoadErrors(rows.filter(row => row.error).map(row => row.error)); }
      }).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, pageOffset, branchId, token, tenant]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(utcOffset) || (utcOffset.slice(1, 3) === '14' && utcOffset.slice(4) !== '00')) { setError('Độ lệch UTC không hợp lệ. Ví dụ: +07:00.'); return; }
    const next = { from: `${from}:00${utcOffset}`, to: `${to}:00${utcOffset}` };
    if (!Number.isFinite(Date.parse(next.from)) || !Number.isFinite(Date.parse(next.to)) || Date.parse(next.from) >= Date.parse(next.to)) { setError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    setPageOffset(0); setRange(next);
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>, bookingId: string) {
    event.preventDefault(); setError(''); setNotice('');
    const key = paymentKeys[bookingId] ?? crypto.randomUUID(); setPaymentKeys(current => ({ ...current, [bookingId]: key }));
    try {
      const payment = await request<Payment>(`/merchant/booking/bookings/${encodeURIComponent(bookingId)}/manual-payments`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ method: 'CASH', amountVnd: amounts[bookingId], ...(notes[bookingId]?.trim() ? { note: notes[bookingId].trim() } : {}) }) }, token, tenant);
      const summary = await request<PaymentSummary>(`/merchant/booking/bookings/${encodeURIComponent(bookingId)}/manual-payments/summary`, {}, token, tenant);
      setPayments(current => ({ ...current, [bookingId]: [payment, ...(current[bookingId] ?? []).filter(item => item.id !== payment.id)] }));
      setSummaries(current => ({ ...current, [bookingId]: summary }));
      setPaymentKeys(current => ({ ...current, [bookingId]: crypto.randomUUID() })); setAmounts(current => ({ ...current, [bookingId]: '' })); setNotes(current => ({ ...current, [bookingId]: '' })); setNotice('Đã ghi nhận khoản thu tiền mặt.');
    } catch (err) { setError((err as Error).message); }
  }

  const money = (value: string) => `${BigInt(value).toLocaleString('vi-VN')} ₫`;
  const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: timezone });
  return <section className="card availability" aria-labelledby="booking-ops-title">
    <h2 id="booking-ops-title">Booking đã xác nhận &amp; thu tiền mặt</h2>
    <p>Lịch theo khoảng thời gian của chi nhánh; chỉ hiện booking đã xác nhận. Múi giờ: {timezone}.</p>
    <form className="availability-form" onSubmit={search}>
      <label>Từ thời gian<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} required /></label>
      <label>Đến thời gian<input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} required /></label>
      <label>Độ lệch UTC<input value={utcOffset} onChange={event => setUtcOffset(event.target.value)} pattern="[+-][0-9]{2}:[0-9]{2}" required /></label>
      <button className="primary" disabled={loading}>{loading ? 'Đang tải…' : 'Xem booking'}</button>
    </form>
    {error && <div role="alert" className="error">{error}</div>}{paymentLoadErrors.length > 0 && <div role="alert" className="error">Không đọc được danh sách tiền mặt của một hoặc nhiều booking; tổng thu đang được ẩn để tránh hiển thị sai. {paymentLoadErrors[0]}</div>}{notice && <div role="status" className="notice">{notice}</div>}
    {loading && <p aria-live="polite">Đang tải booking…</p>}
    {page && (page.items.length === 0 ? <p role="status">Không có booking trong khoảng thời gian đã chọn.</p> : <div className="booking-list">{page.items.map(booking => {
      const summary = summaries[booking.id];
      return <article className="booking-row" key={booking.id}><div><strong>{rooms.find(room => room.id === booking.roomId)?.name ?? `Phòng ${booking.roomId}`}</strong><span className="tag">{booking.status}</span><p>{date(booking.startAt)} · {booking.durationMinutes} phút · {booking.channel}<br />Khách: {booking.customerPhone}<br />Booking: {booking.id}<br />Giá snapshot: {booking.priceSnapshot?.totalAmountVnd ? money(booking.priceSnapshot.totalAmountVnd) : 'Chưa có'}</p><p>Đã ghi nhận tiền mặt: {summary ? `${money(summary.totalRecordedVnd)} qua ${summary.paymentCount} giao dịch` : 'Chưa tải được dữ liệu giao dịch'}</p>{(payments[booking.id] ?? []).map(payment => <small key={payment.id}>{money(payment.amountVnd)} · {date(payment.recordedAt)}{payment.note ? ` · ${payment.note}` : ''}<br /></small>)}</div>
        <form className="payment-form" onSubmit={event => void recordPayment(event, booking.id)}><label>Khoản thu tiền mặt (VND)<input inputMode="numeric" pattern="[1-9][0-9]{0,18}" value={amounts[booking.id] ?? ''} onChange={event => setAmounts(current => ({ ...current, [booking.id]: event.target.value }))} required /></label><label>Ghi chú<input maxLength={500} value={notes[booking.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [booking.id]: event.target.value }))} /></label><button className="primary">Ghi nhận tiền mặt</button></form>
      </article>;
    })}</div>)}
    {page && <div className="amenity-buttons"><button type="button" disabled={loading || pageOffset === 0} onClick={() => setPageOffset(value => Math.max(0, value - 20))}>← Trang trước</button><span>Trang {Math.floor(pageOffset / 20) + 1}</span><button type="button" disabled={loading || !page.hasMore || pageOffset >= 10000} onClick={() => setPageOffset(value => value + 20)}>Trang sau →</button></div>}
  </section>;
}
