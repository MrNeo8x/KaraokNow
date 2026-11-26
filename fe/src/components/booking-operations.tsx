'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import { allowedActions, bookingStatusLabel, outcomeLabel, parseVnd, type BookingStatus, type OutcomeType } from '@/lib/booking-lifecycle';

type Booking = { id: string; roomId: string; channel: string; startAt: string; durationMinutes: number; customerPhone: string; status: BookingStatus; priceSnapshot: { totalAmountVnd?: string; currency?: string }; reservedEndAt?: string; confirmationPolicySnapshot?: { depositMode?: string; requiredDepositVnd?: string; depositRecordedVnd?: string } | null; checkedInAt?: string | null; checkedOutAt?: string | null; outcome?: { type: OutcomeType; note: string; refundAmountVnd: string; recordedAt: string } | null };
type OutcomeDraft = { type: OutcomeType; note: string; refund: string };
type Page = { items: Booking[]; limit: number; offset: number; hasMore: boolean };
type Payment = { id: string; method: string; amountVnd: string; note: string | null; recordedAt: string };
type PaymentSummary = { totalRecordedVnd: string; paymentCount: number };

export default function BookingOperations({ token, tenant, branchId, timezone, rooms }: { token: string; tenant: string; branchId: string; timezone: string; rooms: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [utcOffset, setUtcOffset] = useState('+07:00');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null); const [pageOffset, setPageOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null); const [payments, setPayments] = useState<Record<string, Payment[]>>({}); const [summaries, setSummaries] = useState<Record<string, PaymentSummary>>({}); const [paymentLoadErrors, setPaymentLoadErrors] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({}); const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, OutcomeDraft>>({}); const [acting, setActing] = useState('');
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

  function replaceBooking(next: Booking) { setPage(current => current ? { ...current, items: current.items.map(item => item.id === next.id ? { ...item, ...next } : item) } : current); }

  async function transition(booking: Booking, action: 'check-in' | 'check-out') {
    const label = action === 'check-in' ? 'check-in' : 'check-out';
    if (action === 'check-out' && !window.confirm(`Check-out booking ${rooms.find(room => room.id === booking.roomId)?.name ?? booking.id} ngay bây giờ? Giờ thực tế sẽ được ghi lại và phòng có thể mở lại sớm.`)) return;
    setActing(booking.id); setError(''); setNotice('');
    try { replaceBooking(await request<Booking>(`/merchant/booking/bookings/${encodeURIComponent(booking.id)}/${action}`, { method: 'POST' }, token, tenant)); setNotice(`Đã ${label} booking.`); }
    catch (err) { setError(`${(err as Error).message} · Tải lại danh sách để xem trạng thái mới nhất.`); }
    finally { setActing(''); }
  }

  async function recordOutcome(event: FormEvent<HTMLFormElement>, booking: Booking) {
    event.preventDefault(); setError(''); setNotice('');
    const draft = outcomes[booking.id] ?? { type: 'CUSTOMER_CANCELLED', note: '', refund: '' };
    if (!draft.note.trim()) { setError('Ghi chú xem xét là bắt buộc.'); return; }
    const refund = draft.refund.trim() ? parseVnd(draft.refund, { allowZero: true }) : 0n;
    if (refund === null) { setError('Số tiền hoàn phải là số nguyên VND, không âm.'); return; }
    if (!window.confirm(`Ghi nhận "${outcomeLabel[draft.type]}" cho booking này? Phòng sẽ được giải phóng và mỗi booking chỉ ghi một kết quả.`)) return;
    setActing(booking.id);
    try {
      replaceBooking(await request<Booking>(`/merchant/booking/bookings/${encodeURIComponent(booking.id)}/outcome`, { method: 'POST', body: JSON.stringify({ type: draft.type, note: draft.note.trim(), ...(refund > 0n ? { refundAmountVnd: refund.toString() } : {}) }) }, token, tenant));
      setOutcomes(current => { const next = { ...current }; delete next[booking.id]; return next; }); setNotice(`Đã ghi nhận ${outcomeLabel[draft.type].toLowerCase()}.`);
    } catch (err) { setError(`${(err as Error).message} · Số tiền hoàn không được vượt tổng cọc và tiền mặt đã ghi.`); }
    finally { setActing(''); }
  }

  const money = (value: string) => `${BigInt(value).toLocaleString('vi-VN')} ₫`;
  const date = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: timezone });
  return <section className="card availability" aria-labelledby="booking-ops-title">
    <h2 id="booking-ops-title">Booking, check-in/out &amp; thu tiền mặt</h2>
    <p>Lịch theo khoảng thời gian của chi nhánh; gồm mọi trạng thái booking (đã xác nhận, đang sử dụng, hoàn tất, đã hủy, không đến). Múi giờ: {timezone}.</p>
    <form className="availability-form" onSubmit={search}>
      <label>Từ thời gian<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} required /></label>
      <label>Đến thời gian<input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} required /></label>
      <label>Độ lệch UTC<input value={utcOffset} onChange={event => setUtcOffset(event.target.value)} pattern="[+\-][0-9]{2}:[0-9]{2}" required /></label>
      <button className="primary" disabled={loading}>{loading ? 'Đang tải…' : 'Xem booking'}</button>
    </form>
    {error && <div role="alert" className="error">{error}</div>}{paymentLoadErrors.length > 0 && <div role="alert" className="error">Không đọc được danh sách tiền mặt của một hoặc nhiều booking; tổng thu đang được ẩn để tránh hiển thị sai. {paymentLoadErrors[0]}</div>}{notice && <div role="status" className="notice">{notice}</div>}
    {loading && <p aria-live="polite">Đang tải booking…</p>}
    {page && (page.items.length === 0 ? <p role="status">Không có booking trong khoảng thời gian đã chọn.</p> : <div className="booking-list">{page.items.map(booking => {
      const summary = summaries[booking.id];
      return <article className="booking-row" key={booking.id}><div><strong>{rooms.find(room => room.id === booking.roomId)?.name ?? `Phòng ${booking.roomId}`}</strong><span className={`tag booking-${booking.status.toLowerCase()}`}>{bookingStatusLabel[booking.status] ?? booking.status}</span><p>{date(booking.startAt)} · {booking.durationMinutes} phút · {booking.channel}<br />Khách: {booking.customerPhone}<br />Booking: {booking.id}<br />Giá snapshot: {booking.priceSnapshot?.totalAmountVnd ? money(booking.priceSnapshot.totalAmountVnd) : 'Chưa có'}{booking.confirmationPolicySnapshot?.requiredDepositVnd ? <><br />Cọc khi xác nhận: {money(booking.confirmationPolicySnapshot.depositRecordedVnd ?? '0')} / yêu cầu {money(booking.confirmationPolicySnapshot.requiredDepositVnd)}</> : null}{booking.checkedInAt ? <><br />Check-in: {date(booking.checkedInAt)}</> : null}{booking.checkedOutAt ? <><br />Check-out: {date(booking.checkedOutAt)}</> : null}</p>{booking.outcome && <p className="outcome">Kết quả: {outcomeLabel[booking.outcome.type]} · {date(booking.outcome.recordedAt)}<br />Ghi chú: {booking.outcome.note}<br />Đã hoàn tiền mặt: {money(booking.outcome.refundAmountVnd)}</p>}<p>Đã ghi nhận tiền mặt: {summary ? `${money(summary.totalRecordedVnd)} qua ${summary.paymentCount} giao dịch` : 'Chưa tải được dữ liệu giao dịch'}</p>{(payments[booking.id] ?? []).map(payment => <small key={payment.id}>{money(payment.amountVnd)} · {date(payment.recordedAt)}{payment.note ? ` · ${payment.note}` : ''}<br /></small>)}</div>
        <div className="booking-side"><div className="payment-form">{(() => { const actions = allowedActions(booking.status); const draft = outcomes[booking.id] ?? { type: 'CUSTOMER_CANCELLED' as OutcomeType, note: '', refund: '' }; const setDraft = (patch: Partial<OutcomeDraft>) => setOutcomes(current => ({ ...current, [booking.id]: { ...draft, ...patch } })); return <>
          {actions.checkIn && <button type="button" className="primary" disabled={acting === booking.id} onClick={() => void transition(booking, 'check-in')}>Check-in</button>}
          {actions.checkOut && <button type="button" className="primary" disabled={acting === booking.id} onClick={() => void transition(booking, 'check-out')}>Check-out</button>}
          {actions.outcome && <details className="outcome-form"><summary>Hủy / khách không đến</summary><form onSubmit={event => void recordOutcome(event, booking)}><label>Kết quả<select value={draft.type} onChange={event => setDraft({ type: event.target.value as OutcomeType })}>{(Object.keys(outcomeLabel) as OutcomeType[]).map(type => <option key={type} value={type}>{outcomeLabel[type]}</option>)}</select></label><label>Ghi chú xem xét (bắt buộc)<textarea value={draft.note} onChange={event => setDraft({ note: event.target.value })} maxLength={1000} rows={2} required /></label><label>Tiền mặt đã hoàn (VND, không bắt buộc)<input inputMode="numeric" value={draft.refund} onChange={event => setDraft({ refund: event.target.value })} placeholder="0" /></label><button className="primary" disabled={acting === booking.id}>Ghi nhận kết quả</button><small>Chỉ Owner/Branch Manager. Hệ thống không tự tính tiền hoàn.</small></form></details>}
        </>; })()}</div>
        <form className="payment-form" onSubmit={event => void recordPayment(event, booking.id)}><label>Khoản thu tiền mặt (VND)<input inputMode="numeric" pattern="[1-9][0-9]{0,18}" value={amounts[booking.id] ?? ''} onChange={event => setAmounts(current => ({ ...current, [booking.id]: event.target.value }))} required /></label><label>Ghi chú<input maxLength={500} value={notes[booking.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [booking.id]: event.target.value }))} /></label><button className="primary">Ghi nhận tiền mặt</button></form></div>
      </article>;
    })}</div>)}
    {page && <div className="amenity-buttons"><button type="button" disabled={loading || pageOffset === 0} onClick={() => setPageOffset(value => Math.max(0, value - 20))}>← Trang trước</button><span>Trang {Math.floor(pageOffset / 20) + 1}</span><button type="button" disabled={loading || !page.hasMore || pageOffset >= 10000} onClick={() => setPageOffset(value => value + 20)}>Trang sau →</button></div>}
  </section>;
}
