'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '@/lib/api';
import { bookingStatusLabel, type BookingStatus } from '@/lib/booking-lifecycle';
import { PUBLIC_HOLD_ATTEMPT_KEY, PUBLIC_HOLD_RECEIPT_KEY, cleanBookingCode, cleanPhone, clear, isRetryable, prepareAttempt, readAttempt, readReceipt, save, type PublicHoldAttempt, type PublicHoldReceipt } from '@/lib/public-booking';

type Branch = { id: string; merchantId: string; merchantName: string; name: string; timezone: string };
type Room = { id: string; branchId?: string; name: string; capacity: number };
type Page<T> = { items: T[]; hasMore: boolean };
type Availability = { branchId: string; startAt: string; requestedEndAt: string; durationMinutes: number; bufferEnabled: boolean; bufferMinutes: number; appliedBufferMinutes: number; reservedEndAt: string; rooms: Room[] };
type Quote = { branchId: string; roomId: string; timezone: string; startAt: string; endAt: string; durationMinutes: number; currency: 'VND'; totalAmountVnd: string; bookingDurationPolicy: { durationStepMinutes: number; minDurationMinutes: number; maxDurationMinutes: number } };
type Terms = { configured: boolean; terms: string | null; version: string | null; updatedAt?: string | null };
type Lookup = { holdId: string; bookingId: string | null; branchId: string; roomId: string; startAt: string; durationMinutes: number; status: 'HELD' | 'EXPIRED' | 'CONFIRMED'; bookingStatus?: BookingStatus | null; totalAmountVnd: string; termsVersion: string; depositRequiredVnd?: string; depositRecordedVnd?: string };
const statusLabel = { HELD: 'Đang giữ chỗ · chờ nhân viên gọi xác minh', CONFIRMED: 'Đã xác nhận đặt phòng', EXPIRED: 'Đã hết hạn giữ chỗ' } as const;
const RETRY_COOLDOWN_MS = 60_000;
function session(): Storage | null { try { return window.sessionStorage; } catch { return null; } }
const fixedRoomImages = ['/rooms/room-violet.svg', '/rooms/room-rose.svg', '/rooms/room-blue.svg'];

// The public terms endpoint answers 404 when the merchant has not configured terms; that is a normal state, not a failure.
function fetchTerms(branchId: string, signal?: AbortSignal): Promise<Terms> {
  return request<Terms>(`/public/branches/${encodeURIComponent(branchId)}/booking-terms`, { signal })
    .catch(err => { if (err instanceof ApiError && err.status === 404) return { configured: false, terms: null, version: null }; throw err; });
}
function money(value: string) { return `${BigInt(value).toLocaleString('vi-VN')} ₫`; }
function when(value: string, timezone?: string) { return new Date(value).toLocaleString('vi-VN', { timeZone: timezone ?? 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }); }

export default function CustomerBooking() {
  const [branches, setBranches] = useState<Branch[]>([]); const [branchId, setBranchId] = useState('');
  const [catalogRooms, setCatalogRooms] = useState<Room[]>([]); const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(''); const [time, setTime] = useState('20:00'); const [duration, setDuration] = useState('120'); const [guests, setGuests] = useState(8);
  const [availability, setAvailability] = useState<Availability | null>(null); const [quote, setQuote] = useState<Quote | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null); const [acceptedTerms, setAcceptedTerms] = useState<Terms | null>(null);
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [holding, setHolding] = useState(false); const [holdError, setHoldError] = useState('');
  const [pending, setPending] = useState<PublicHoldAttempt | null>(null); const [receipt, setReceipt] = useState<PublicHoldReceipt | null>(null); const [retryAt, setRetryAt] = useState(0); const [copied, setCopied] = useState(false);
  const [lookupPhone, setLookupPhone] = useState(''); const [lookupCode, setLookupCode] = useState(''); const [lookup, setLookup] = useState<Lookup | null>(null); const [lookupError, setLookupError] = useState(''); const [lookingUp, setLookingUp] = useState(false); const [lookupRetryAt, setLookupRetryAt] = useState(0);
  const [loading, setLoading] = useState(true); const [searching, setSearching] = useState(false); const [quoting, setQuoting] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    const storage = session(); if (!storage) return;
    setReceipt(readReceipt(storage)); setPending(readAttempt(storage));
  }, []);

  useEffect(() => {
    const until = Math.max(retryAt, lookupRetryAt); if (until <= Date.now()) return;
    const timer = window.setTimeout(() => { setRetryAt(0); setLookupRetryAt(0); }, until - Date.now());
    return () => window.clearTimeout(timer);
  }, [retryAt, lookupRetryAt]);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    request<Page<Branch>>('/public/branches?limit=100', { signal: controller.signal })
      .then(result => { setBranches(result.items); setBranchId(current => result.items.some(item => item.id === current) ? current : result.items[0]?.id ?? ''); })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setAvailability(null); setQuote(null); setAcceptedTerms(null);
    if (!branchId) { setCatalogRooms([]); setRoomId(''); setTerms(null); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([
      request<Page<Room>>(`/public/branches/${encodeURIComponent(branchId)}/rooms?limit=100`, { signal: controller.signal }),
      fetchTerms(branchId, controller.signal),
    ]).then(([roomPage, termsValue]) => {
      setCatalogRooms(roomPage.items); setRoomId(current => roomPage.items.some(item => item.id === current) ? current : roomPage.items[0]?.id ?? ''); setTerms(termsValue);
    }).catch(err => { if (!controller.signal.aborted) { setCatalogRooms([]); setRoomId(''); setTerms(null); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId]);

  async function send(attempt: PublicHoldAttempt) {
    const storage = session(); if (storage) save(storage, PUBLIC_HOLD_ATTEMPT_KEY, attempt);
    setPending(attempt); setHolding(true); setHoldError('');
    try {
      const result = await request<Omit<PublicHoldReceipt, 'phone'>>('/public/booking/holds', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.body) });
      const value = { ...result, phone: attempt.body.phone };
      if (storage) { save(storage, PUBLIC_HOLD_RECEIPT_KEY, value); clear(storage, PUBLIC_HOLD_ATTEMPT_KEY); }
      setReceipt(value); setPending(null); setLookupPhone(value.phone); setLookupCode(value.bookingCode); setCopied(false);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined; const message = (err as Error).message;
      if (!isRetryable(status)) { if (storage) clear(storage, PUBLIC_HOLD_ATTEMPT_KEY); setPending(null); }
      if (status === 409) await explainConflict(attempt, message);
      else if (status === 429) { setRetryAt(Date.now() + RETRY_COOLDOWN_MS); setHoldError('Bạn đã gửi quá nhiều yêu cầu. Vui lòng chờ khoảng 1 phút rồi bấm gửi lại; thông tin đặt được giữ nguyên nên sẽ không tạo trùng.'); }
      else if (isRetryable(status)) setHoldError(`${message} · Chưa xác định được kết quả. Bấm "Gửi lại yêu cầu" để thử lại an toàn với cùng mã yêu cầu; hệ thống không tạo giữ chỗ trùng.`);
      else setHoldError(message);
    } finally { setHolding(false); }
  }

  async function explainConflict(attempt: PublicHoldAttempt, message: string) {
    const body = attempt.body;
    const [latestTerms, latestQuote] = await Promise.all([
      branchId ? fetchTerms(branchId).catch(() => null) : Promise.resolve(null),
      request<Quote>(`/public/rooms/${encodeURIComponent(body.roomId)}/quote`, { method: 'POST', body: JSON.stringify({ startAt: body.startAt, durationMinutes: body.durationMinutes }) }).catch(() => null),
    ]);
    if (latestTerms && latestTerms.version !== body.termsVersion) { setTerms(latestTerms); setAcceptedTerms(null); setHoldError(`Điều khoản đặt phòng đã được cập nhật lên phiên bản ${latestTerms.version ?? 'mới'}. Vui lòng đọc lại và đồng ý trước khi gửi.`); return; }
    if (latestQuote && latestQuote.totalAmountVnd !== body.expectedTotalAmountVnd) { setQuote(latestQuote); setHoldError(`Giá phòng vừa thay đổi thành ${money(latestQuote.totalAmountVnd)}. Vui lòng kiểm tra giá mới rồi gửi lại.`); return; }
    setQuote(null); setAvailability(null);
    setHoldError(`Không thể giữ phòng (${message}). Phòng có thể vừa được người khác giữ trong khung giờ này; vui lòng tìm lại phòng trống.`);
  }

  async function submitHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setHoldError('');
    if (!quote || !availability || !acceptedTerms?.version || acceptedTerms.version !== terms?.version) { setHoldError('Vui lòng xem giá và đồng ý điều khoản trước khi gửi.'); return; }
    const cleaned = cleanPhone(phone); if (!cleaned) { setHoldError('Số điện thoại cần 8–15 chữ số, có thể bắt đầu bằng +.'); return; }
    const mail = email.trim();
    const body = { roomId: quote.roomId, startAt: availability.startAt, durationMinutes: availability.durationMinutes, phone: cleaned, ...(mail ? { email: mail } : {}), expectedTotalAmountVnd: quote.totalAmountVnd, termsVersion: acceptedTerms.version };
    const storage = session();
    await send(prepareAttempt(storage ? readAttempt(storage) : pending, body, () => crypto.randomUUID()));
  }

  function discardPending() { const storage = session(); if (storage) clear(storage, PUBLIC_HOLD_ATTEMPT_KEY); setPending(null); setHoldError(''); }
  function newBooking() { const storage = session(); if (storage) clear(storage, PUBLIC_HOLD_RECEIPT_KEY); setReceipt(null); setQuote(null); setAvailability(null); setAcceptedTerms(null); setHoldError(''); }
  async function copyCode(code: string) { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } }

  async function lookupBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLookup(null); setLookupError('');
    const cleanedPhone = cleanPhone(lookupPhone); const code = cleanBookingCode(lookupCode);
    if (!cleanedPhone || !code) { setLookupError('Nhập số điện thoại đã dùng khi đặt và mã đặt phòng gồm 32 ký tự.'); return; }
    setLookingUp(true);
    try { setLookup(await request<Lookup>('/public/booking/lookup', { method: 'POST', body: JSON.stringify({ phone: cleanedPhone, bookingCode: code }) })); }
    catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status === 404) setLookupError('Không tìm thấy đặt phòng khớp với số điện thoại và mã đã nhập. Vui lòng kiểm tra lại.');
      else if (status === 429) { setLookupRetryAt(Date.now() + RETRY_COOLDOWN_MS); setLookupError('Bạn đã tra cứu quá nhiều lần. Vui lòng chờ khoảng 1 phút rồi thử lại.'); }
      else setLookupError((err as Error).message);
    } finally { setLookingUp(false); }
  }

  function startAt() { return `${date}T${time}:00+07:00`; }

  async function findAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setQuote(null); setAcceptedTerms(null);
    if (!branchId || !date || !time) { setError('Vui lòng chọn địa điểm, ngày và giờ bắt đầu.'); return; }
    setSearching(true);
    try {
      const query = new URLSearchParams({ startAt: startAt(), durationMinutes: duration });
      const value = await request<Availability>(`/public/branches/${encodeURIComponent(branchId)}/availability?${query}`);
      const eligible = value.rooms.filter(room => room.capacity >= guests);
      setAvailability({ ...value, rooms: eligible }); setRoomId(current => eligible.some(item => item.id === current) ? current : eligible[0]?.id ?? '');
    } catch (err) { setAvailability(null); setRoomId(''); setError((err as Error).message); }
    finally { setSearching(false); }
  }

  async function getQuote() {
    if (!roomId || !availability) return;
    setQuoting(true); setError(''); setQuote(null);
    try { setQuote(await request<Quote>(`/public/rooms/${encodeURIComponent(roomId)}/quote`, { method: 'POST', body: JSON.stringify({ startAt: availability.startAt, durationMinutes: availability.durationMinutes }) })); }
    catch (err) { setError((err as Error).message); }
    finally { setQuoting(false); }
  }

  const branch = branches.find(item => item.id === branchId); const rooms = availability?.rooms ?? catalogRooms; const selectedRoom = rooms.find(item => item.id === roomId);
  return <main className="customer">
    <div className="demo">DỮ LIỆU THẬT · Đã nối catalog, phòng trống, báo giá, điều khoản, giữ chỗ và tra cứu. Giữ chỗ cần nhân viên gọi xác minh trước khi xác nhận.</div>
    <div className="customer-hero"><div className="eyebrow">KARAOKENOW · HÀ NỘI</div><h1>Buổi hát hay bắt đầu từ một căn phòng phù hợp.</h1><p>Chọn địa điểm, thời gian và xem giá chính xác trước khi quyết định.</p></div>
    <section className="booking card" aria-labelledby="customer-booking-title"><div className="booking-head"><div><h2 id="customer-booking-title">Tìm phòng trống</h2><p>Thời gian trống và giá được tính trực tiếp từ hệ thống Merchant.</p></div><span aria-hidden="true">✦</span></div>
      {error && <div className="error" role="alert">{error}</div>}
      <form className="fields customer-search" onSubmit={findAvailability}><label>Địa điểm<select value={branchId} onChange={event => setBranchId(event.target.value)} disabled={loading || branches.length === 0}>{branches.map(item => <option key={item.id} value={item.id}>{item.merchantName} · {item.name}</option>)}</select></label><label>Ngày<input type="date" value={date} onChange={event => { setDate(event.target.value); setAvailability(null); setQuote(null); }} required /></label><label>Giờ bắt đầu<input type="time" value={time} onChange={event => { setTime(event.target.value); setAvailability(null); setQuote(null); }} step={1800} required /></label><label>Thời lượng<select value={duration} onChange={event => { setDuration(event.target.value); setAvailability(null); setQuote(null); }}><option value="60">1 giờ</option><option value="90">1,5 giờ</option><option value="120">2 giờ</option><option value="180">3 giờ</option></select></label><label>Số khách<input type="number" value={guests} onChange={event => { setGuests(Number(event.target.value)); setAvailability(null); setQuote(null); }} min={1} max={100} /></label><button className="primary" disabled={loading || searching || !branchId}>{searching ? 'Đang tìm…' : 'Tìm phòng trống'}</button></form>
      <div className="section-title"><div><h2>{availability ? 'Phòng còn trống' : `Phòng tại ${branch?.name ?? 'địa điểm đã chọn'}`}</h2><p>{availability ? `${new Date(availability.startAt).toLocaleString('vi-VN', { timeZone: branch?.timezone })} · ${availability.durationMinutes} phút · buffer ${availability.appliedBufferMinutes} phút` : branch ? `${branch.merchantName} · ${branch.timezone}` : 'Chưa có địa điểm công khai'}</p></div></div>
      {loading ? <p role="status">Đang tải danh mục…</p> : branches.length === 0 ? <div className="empty">Chưa có địa điểm được công khai.</div> : rooms.length === 0 ? <div className="empty">{availability ? 'Không có phòng phù hợp còn trống trong thời gian đã chọn.' : 'Địa điểm này chưa có phòng công khai.'}</div> : <div className="room-grid">{rooms.map((room, index) => <button type="button" className={`choice-card ${roomId === room.id ? 'selected' : ''}`} key={room.id} onClick={() => { setRoomId(room.id); setQuote(null); }} aria-pressed={roomId === room.id}><div className="choice-art"><img src={fixedRoomImages[index % fixedRoomImages.length]} alt={`Ảnh minh họa cố định cho ${room.name}`} /><span>{room.name}</span></div><div className="choice-content"><strong>{room.name}</strong><p>Tối đa {room.capacity} khách</p><small>Ảnh minh họa cố định</small></div></button>)}</div>}
      {availability && selectedRoom && <div className="quote-actions"><div><strong>{selectedRoom.name}</strong><p>{date} · {time} · {Number(duration) / 60} giờ · {guests} khách</p></div><button type="button" className="primary" disabled={quoting} onClick={() => void getQuote()}>{quoting ? 'Đang tính giá…' : 'Xem giá phòng này'}</button></div>}
      {quote && <div className="customer-quote" role="status"><span>Tổng giá phòng</span><strong>{money(quote.totalAmountVnd)}</strong><small>{quote.durationMinutes} phút · {quote.currency} · chính sách bước {quote.bookingDurationPolicy.durationStepMinutes} phút</small></div>}
      {terms?.configured && terms.terms && terms.version ? <div className="customer-terms"><details><summary>Đọc điều khoản đặt phòng</summary><p>{terms.terms}</p><small>Phiên bản {terms.version}{terms.updatedAt ? ` · cập nhật ${new Date(terms.updatedAt).toLocaleString('vi-VN')}` : ''}</small></details><label className="check-row"><input type="checkbox" checked={acceptedTerms?.version === terms.version} onChange={event => setAcceptedTerms(event.target.checked ? { ...terms } : null)} /> Tôi đã đọc và đồng ý điều khoản phiên bản {terms.version}.</label></div> : <div className="notice">Merchant chưa cấu hình điều khoản đặt phòng công khai.</div>}
      {holdError && <div className="error" role="alert">{holdError}</div>}
      {pending && !receipt && <div className="notice" role="status">Có một yêu cầu giữ phòng chưa xác định kết quả ({when(pending.body.startAt, branch?.timezone)} · {pending.body.durationMinutes} phút · {money(pending.body.expectedTotalAmountVnd)}). <div className="hold-actions"><button type="button" className="primary" disabled={holding || retryAt > Date.now()} onClick={() => void send(pending)}>{holding ? 'Đang gửi…' : 'Gửi lại yêu cầu'}</button><button type="button" className="secondary" disabled={holding} onClick={discardPending}>Bỏ yêu cầu này</button></div></div>}
      {receipt ? <div className="customer-receipt" role="status" aria-live="polite"><span className="eyebrow">ĐÃ GIỮ CHỖ</span><h3>{statusLabel[receipt.status] ?? receipt.status}</h3><p>{when(receipt.startAt, branch?.timezone)} · {receipt.durationMinutes} phút · {money(receipt.totalAmountVnd)} · điều khoản phiên bản {receipt.termsVersion}</p><p>Giữ chỗ đến {when(receipt.expiresAt, branch?.timezone)}. Nhân viên sẽ gọi số {receipt.phone} để xác minh; giữ chỗ chưa phải đặt phòng đã xác nhận.</p>{receipt.depositRequiredVnd && receipt.depositRequiredVnd !== '0' ? <p className="deposit-callout">Cần đặt cọc <strong>{money(receipt.depositRequiredVnd)}</strong> bằng tiền mặt tại quầy trước khi nhân viên xác nhận. Không có thanh toán online.</p> : receipt.depositRequiredVnd === '0' ? <p>Không yêu cầu đặt cọc.</p> : null}<label>Mã đặt phòng — hãy lưu lại để tra cứu<code className="booking-code">{receipt.bookingCode}</code></label><div className="hold-actions"><button type="button" className="primary" onClick={() => void copyCode(receipt.bookingCode)}>{copied ? 'Đã sao chép' : 'Sao chép mã'}</button><button type="button" className="secondary" onClick={newBooking}>Đặt phòng khác</button></div><small>Mã chỉ hiển thị một lần và được lưu tạm trong tab này. Đóng tab sẽ mất; dùng số điện thoại và mã để tra cứu.</small></div>
      : quote && acceptedTerms && acceptedTerms.version === terms?.version && !pending && <form className="customer-contact" onSubmit={submitHold}><h3>Thông tin liên hệ</h3><p>Nhân viên sẽ gọi số này để xác minh trước khi xác nhận. Không cần đặt cọc online.</p><div className="fields contact-fields"><label>Số điện thoại<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="0912 345 678" required maxLength={24} /></label><label>Email (không bắt buộc)<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></label><button className="primary" disabled={holding || retryAt > Date.now()}>{holding ? 'Đang giữ phòng…' : `Giữ phòng · ${money(quote.totalAmountVnd)}`}</button></div></form>}
    </section>
    <section className="booking card customer-lookup" aria-labelledby="customer-lookup-title"><h2 id="customer-lookup-title">Tra cứu đặt phòng</h2><p>Nhập số điện thoại đã dùng và mã đặt phòng 32 ký tự.</p>
      <form className="fields contact-fields" onSubmit={lookupBooking}><label>Số điện thoại<input type="tel" inputMode="tel" autoComplete="tel" value={lookupPhone} onChange={event => setLookupPhone(event.target.value)} required maxLength={24} /></label><label>Mã đặt phòng<input value={lookupCode} onChange={event => setLookupCode(event.target.value)} required maxLength={40} autoComplete="off" spellCheck={false} /></label><button className="primary" disabled={lookingUp || lookupRetryAt > Date.now()}>{lookingUp ? 'Đang tra cứu…' : 'Tra cứu'}</button></form>
      {lookupError && <div className="error" role="alert">{lookupError}</div>}
      {lookup && <div className="customer-receipt" role="status"><span className="eyebrow">KẾT QUẢ TRA CỨU</span><h3>{lookup.bookingStatus ? bookingStatusLabel[lookup.bookingStatus] ?? lookup.bookingStatus : statusLabel[lookup.status] ?? lookup.status}</h3><p>{branches.find(item => item.id === lookup.branchId)?.name ?? 'Địa điểm'} · {catalogRooms.find(item => item.id === lookup.roomId)?.name ?? 'Phòng đã chọn'}</p><p>{when(lookup.startAt, branches.find(item => item.id === lookup.branchId)?.timezone)} · {lookup.durationMinutes} phút · {money(lookup.totalAmountVnd)} · điều khoản phiên bản {lookup.termsVersion}</p>{lookup.depositRequiredVnd && lookup.depositRequiredVnd !== '0' && <p>Cọc yêu cầu: {money(lookup.depositRequiredVnd)} · đã ghi nhận: {money(lookup.depositRecordedVnd ?? '0')}{lookup.status === 'HELD' && BigInt(lookup.depositRecordedVnd ?? '0') < BigInt(lookup.depositRequiredVnd) ? ' · vui lòng đặt cọc tiền mặt tại quầy' : ''}</p>}{lookup.bookingId && <small>Mã booking: {lookup.bookingId}</small>}</div>}
    </section>
  </main>;
}
