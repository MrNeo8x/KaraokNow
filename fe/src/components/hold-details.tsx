'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { confirmationMode, depositAmountError } from '@/lib/booking-lifecycle';
import { useCan } from './permissions-context';

export type DetailedHold = { id: string; branchId: string; roomId: string; channel: string; startAt: string; durationMinutes: number; reservedEndAt: string; expiresAt: string; bufferMinutes: number; status: 'HELD' | 'EXPIRED' | 'CONFIRMED'; customerPhone?: string | null; customerEmail?: string | null; priceSnapshot?: { totalAmountVnd?: string; currency?: string } | null; phoneVerifiedAt?: string | null; phoneVerifiedBy?: string | null; depositPolicySnapshot?: DepositSnapshot | null; publicAcceptedTerms?: string | null };
type DepositSnapshot = { mode: 'NONE' | 'FIXED' | 'PERCENT'; fixedAmountVnd: string | null; percent: string | null; policyVersion: string | null; requiredAmountVnd: string };
type DepositEntry = { id: string; amountVnd: string; note: string | null; recordedAt: string };
type DepositStatus = { holdId: string; holdStatus: string; depositPolicySnapshot: DepositSnapshot | null; requiredAmountVnd: string; totalRecordedVnd: string; remainingVnd: string; depositSatisfied: boolean; items: DepositEntry[] };
const money = (value: string) => `${BigInt(value).toLocaleString('vi-VN')} ₫`;
type Quote = { priceSnapshot: { totalAmountVnd: string; currency: string; timezone: string; calculation: { priceRuleCode: string } } };

export default function HoldDetails({ hold, token, tenant, onUpdated }: { hold: DetailedHold; token: string; tenant: string; onUpdated: (hold: DetailedHold) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState('');
  const [called, setCalled] = useState(false);
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [deposits, setDeposits] = useState<DepositStatus | null>(null); const [depositError, setDepositError] = useState(''); const [depositRevision, setDepositRevision] = useState(0);
  const [depositAmount, setDepositAmount] = useState(''); const [depositNote, setDepositNote] = useState(''); const [depositKey, setDepositKey] = useState(() => crypto.randomUUID()); const [depositForbidden, setDepositForbidden] = useState(false);
  const allowed = useCan(); const canManage = allowed('hold.manage');
  const hasSnapshot = Boolean(hold.priceSnapshot);
  // A web hold must be confirmed with exactly the terms the guest accepted. Prefer the hold's own copy when the backend
  // returns it; otherwise fall back to the current public terms (Owner-readable only), which fails if they changed since.
  const isWeb = hold.channel === 'WEB';
  const [termsSource, setTermsSource] = useState<'manual' | 'accepted' | 'current' | 'unavailable'>(isWeb ? 'unavailable' : 'manual');
  useEffect(() => {
    if (!isWeb || hold.status !== 'HELD') return;
    if (hold.publicAcceptedTerms) { setTerms(hold.publicAcceptedTerms); setTermsSource('accepted'); return; }
    const controller = new AbortController();
    request<{ configured: boolean; terms: string | null }>('/merchant/catalog/public-booking-terms', { signal: controller.signal }, token, tenant)
      .then(value => { if (value.configured && value.terms) { setTerms(value.terms); setTermsSource('current'); } })
      .catch(() => { if (!controller.signal.aborted) setTermsSource('unavailable'); });
    return () => controller.abort();
  }, [isWeb, hold.status, hold.publicAcceptedTerms, token, tenant]);

  useEffect(() => {
    if (!hasSnapshot) { setDeposits(null); return; }
    // Keep any error from the last submission visible while the status reloads.
    const controller = new AbortController();
    request<DepositStatus>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}/deposits`, { signal: controller.signal }, token, tenant)
      .then(setDeposits).catch(err => { if (!controller.signal.aborted) { setDeposits(null); setDepositError((err as Error).message); } });
    return () => controller.abort();
  }, [hold.id, hasSnapshot, depositRevision, token, tenant]);

  function editDeposit(update: () => void) { update(); setDepositKey(crypto.randomUUID()); }
  async function recordDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!deposits) return;
    const invalid = depositAmountError(depositAmount, deposits.remainingVnd); if (invalid) { setDepositError(invalid); return; }
    setBusy(true); setDepositError(''); setMessage('');
    try {
      const entry = await request<DepositEntry>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}/deposits`, { method: 'POST', headers: { 'Idempotency-Key': depositKey }, body: JSON.stringify({ method: 'CASH', amountVnd: depositAmount.trim().replace(/[.,\s]/g, ''), ...(depositNote.trim() ? { note: depositNote.trim() } : {}) }) }, token, tenant);
      setMessage(`Đã ghi nhận cọc tiền mặt ${money(entry.amountVnd)}.`); setDepositAmount(''); setDepositNote(''); setDepositKey(crypto.randomUUID()); setDepositRevision(value => value + 1);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 403) { setDepositForbidden(true); setDepositError('Chỉ Owner, Quản lý chi nhánh hoặc Thu ngân được ghi cọc. Vai trò của bạn chỉ xem được số cọc.'); }
      else setDepositError(status === undefined || status >= 500 ? `${(err as Error).message} · Chưa rõ kết quả: bấm ghi nhận lại với cùng số tiền và ghi chú, hệ thống không ghi trùng.` : (err as Error).message);
      setDepositRevision(value => value + 1);
    }
    finally { setBusy(false); }
  }
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
  async function confirm() {
    setBusy(true); setError(''); setMessage('');
    try {
      const booking = await request<{ id: string }>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}/confirm`, { method: 'POST', body: JSON.stringify({ cancellationTerms: terms.trim() }) }, token, tenant);
      setMessage(`Đã xác nhận booking ${booking.id}.`); setDepositRevision(value => value + 1);
      onUpdated({ ...hold, status: 'CONFIRMED' });
    } catch (err) {
      const message = (err as Error).message;
      setError(/terms must match/i.test(message) ? 'Điều khoản xác nhận phải trùng khớp với điều khoản khách đã đồng ý khi đặt online. Điều khoản công khai có thể đã được Owner sửa sau khi khách đặt; liên hệ Owner hoặc tạo hold mới.' : message);
      setDepositRevision(value => value + 1);
    }
    finally { setBusy(false); }
  }
  return <div className="hold-detail-form"><h3>Thông tin khách &amp; giá</h3>
    {error && <div className="error" role="alert">{error}</div>}{message && <div className="notice" role="status">{message}</div>}
    {hold.priceSnapshot ? <p>Số điện thoại: {hold.customerPhone}<br />Email: {hold.customerEmail || 'Không cung cấp'}<br />Giá đã lưu: {hold.priceSnapshot.totalAmountVnd} {hold.priceSnapshot.currency}<br />Xác minh cuộc gọi: {hold.phoneVerifiedAt ? `Đã ghi nhận lúc ${new Date(hold.phoneVerifiedAt).toLocaleString('vi-VN')}` : 'Chưa ghi nhận'}</p> : hold.status === 'HELD' && !canManage ? <p>Chưa có thông tin khách và giá. Lễ tân hoặc quản lý sẽ nhập sau khi báo giá.</p> : hold.status === 'HELD' ? <><p>Xem báo giá hiện tại trước khi lưu. Backend sẽ tính lại giá và từ chối nếu tổng tiền đã thay đổi; thông tin đã lưu không thể chỉnh sửa từ bước này.</p><button type="button" className="primary" disabled={busy} onClick={() => void getQuote()}>{busy ? 'Đang xử lý…' : 'Xem báo giá hiện tại'}</button>{quote && <><div className="notice" role="status">Giá hiển thị: <strong>{quote.priceSnapshot.totalAmountVnd} {quote.priceSnapshot.currency}</strong> · quy tắc {quote.priceSnapshot.calculation.priceRuleCode} · {quote.priceSnapshot.timezone}</div><form className="action-form" onSubmit={attach}><label>Số điện thoại khách<input type="tel" value={phone} onChange={event => setPhone(event.target.value)} pattern="\+?[0-9]{8,15}" maxLength={16} required /></label><label>Email (không bắt buộc)<input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></label><button className="primary" disabled={busy}>Lưu khách và giá hiển thị</button></form></>}</> : <p>Hold đã hết hạn; không thể lưu thông tin khách hoặc giá.</p>}
    {canManage && hold.status === 'HELD' && hold.customerPhone && !hold.phoneVerifiedAt && <form className="action-form" onSubmit={verify}><label className="check-row"><input type="checkbox" checked={called} onChange={event => setCalled(event.target.checked)} /> Tôi đã gọi và xác minh thành công số {hold.customerPhone}.</label><button className="primary" disabled={busy || !called}>Ghi nhận cuộc gọi xác minh</button></form>}
    {hasSnapshot && <div className="deposit-panel"><h4>Tiền cọc tại quầy</h4>{depositError && <div className="error" role="alert">{depositError}</div>}
      {!deposits ? !depositError && <p role="status">Đang tải thông tin cọc…</p> : !deposits.depositPolicySnapshot ? <p>Hold chưa có snapshot chính sách cọc.</p> : deposits.depositPolicySnapshot.mode === 'NONE' ? <p>Chính sách tại thời điểm báo giá: không yêu cầu cọc{deposits.depositPolicySnapshot.policyVersion ? ` (phiên bản ${deposits.depositPolicySnapshot.policyVersion})` : ' (kênh chưa cấu hình)'}.</p> : <>
        <p>Chính sách snapshot: {deposits.depositPolicySnapshot.mode === 'FIXED' ? `cố định ${money(deposits.depositPolicySnapshot.fixedAmountVnd ?? '0')}` : `${deposits.depositPolicySnapshot.percent}% tổng tiền`}{deposits.depositPolicySnapshot.policyVersion ? ` · phiên bản ${deposits.depositPolicySnapshot.policyVersion}` : ''}<br />Cần cọc: <strong>{money(deposits.requiredAmountVnd)}</strong> · Đã ghi: {money(deposits.totalRecordedVnd)} · Còn thiếu: <strong>{money(deposits.remainingVnd)}</strong></p>
        <span className={deposits.depositSatisfied ? 'tag' : 'tag warn'}>{deposits.depositSatisfied ? 'Đã đủ cọc' : 'Chưa đủ cọc'}</span>
        {deposits.items.map(item => <small key={item.id}><br />{money(item.amountVnd)} · {new Date(item.recordedAt).toLocaleString('vi-VN')}{item.note ? ` · ${item.note}` : ''}</small>)}
        {hold.status === 'HELD' && allowed('deposit.record') && !depositForbidden && BigInt(deposits.remainingVnd) > 0n && <form className="action-form" onSubmit={recordDeposit}><label>Cọc tiền mặt (VND)<input inputMode="numeric" value={depositAmount} onChange={event => editDeposit(() => setDepositAmount(event.target.value))} placeholder={deposits.remainingVnd} required /></label><label>Ghi chú<input maxLength={500} value={depositNote} onChange={event => editDeposit(() => setDepositNote(event.target.value))} /></label><button className="primary" disabled={busy}>Ghi nhận cọc</button></form>}
      </>}
      <small>Chỉ ghi nhận tiền mặt đã thu tại quầy; không có thanh toán online. Hoàn cọc khi hold hết hạn xử lý ngoài hệ thống.</small></div>}
    {canManage && hold.status === 'HELD' && hold.phoneVerifiedAt && hold.priceSnapshot && (() => { const mode = confirmationMode(deposits?.depositPolicySnapshot, deposits?.depositSatisfied); return <div className="action-form"><label>Điều khoản hủy đã thống nhất<textarea value={terms} onChange={event => setTerms(event.target.value)} readOnly={termsSource === 'accepted' || termsSource === 'current'} minLength={1} maxLength={5000} rows={3} required placeholder="Nhập đúng điều khoản đã thông báo cho khách" /></label>{termsSource === 'accepted' && <small>Điều khoản khách đã đồng ý khi đặt online.</small>}{termsSource === 'current' && <small>Đã điền điều khoản công khai hiện tại. Hold này được khách đặt online; nếu Owner đã sửa điều khoản sau thời điểm khách đặt, xác nhận sẽ bị từ chối.</small>}{isWeb && termsSource === 'unavailable' && <small>Hold đặt online: cần nhập chính xác điều khoản khách đã đồng ý. Chỉ Owner xem được điều khoản công khai hiện tại.</small>}<button type="button" className="primary" disabled={busy || !terms.trim() || !deposits || mode === 'DEPOSIT_MISSING' || mode === 'NO_SNAPSHOT'} onClick={() => void confirm()}>{busy ? 'Đang xác nhận…' : mode === 'DEPOSIT_COVERED' ? 'Xác nhận booking (đã đủ cọc)' : mode === 'DEPOSIT_MISSING' ? 'Cần đủ cọc trước khi xác nhận' : 'Xác nhận booking không đặt cọc'}</button><small>{mode === 'NO_DEPOSIT' ? 'Chỉ khả dụng nếu kênh đã bật xác nhận không đặt cọc.' : mode === 'DEPOSIT_MISSING' ? 'Ghi nhận đủ cọc tiền mặt ở trên để mở xác nhận.' : 'Backend kiểm tra lại số cọc khi xác nhận.'}</small></div>; })()}
    {hold.status !== 'CONFIRMED' && <p>Việc lưu thông tin hoặc ghi nhận cuộc gọi không xác nhận booking và không xử lý thanh toán.</p>}
  </div>;
}
