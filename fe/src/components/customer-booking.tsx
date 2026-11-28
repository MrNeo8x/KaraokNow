'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigation, Phone } from 'lucide-react';
import { CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Home, MapPin, Mic2, Minus, Plus, Search } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { bookingStatusLabel, type BookingStatus } from '@/lib/booking-lifecycle';
import { formatPhone, telHref } from '@/lib/branch-location';
import { SLOTS, firstSlot, initialChoice, slotOpen, upcomingDates } from '@/lib/booking-time';
import { PUBLIC_HOLD_ATTEMPT_KEY, PUBLIC_HOLD_RECEIPT_KEY, cleanBookingCode, cleanPhone, formatBookingCode, clear, isRetryable, prepareAttempt, readAttempt, readReceipt, save, type PublicHoldAttempt, type PublicHoldReceipt } from '@/lib/public-booking';

export type Branch = { id: string; merchantId: string; merchantName: string; merchantLogoUrl?: string | null; name: string; timezone: string; address?: string | null; phone?: string | null; latitude?: number | null; longitude?: number | null; directionsUrl?: string | null };
export type Room = { id: string; branchId?: string; name: string; capacity: number };
type Page<T> = { items: T[]; hasMore: boolean };
export type Availability = { branchId: string; startAt: string; requestedEndAt: string; durationMinutes: number; bufferEnabled: boolean; bufferMinutes: number; appliedBufferMinutes: number; reservedEndAt: string; rooms: Room[] };
export type Quote = { branchId: string; roomId: string; timezone: string; startAt: string; endAt: string; durationMinutes: number; currency: 'VND'; totalAmountVnd: string; bookingDurationPolicy: { durationStepMinutes: number; minDurationMinutes: number; maxDurationMinutes: number } };
export type Terms = { configured: boolean; terms: string | null; version: string | null; updatedAt?: string | null };
export type Lookup = { holdId: string; bookingId: string | null; branchId: string; roomId: string; startAt: string; durationMinutes: number; status: 'HELD' | 'EXPIRED' | 'CONFIRMED'; bookingStatus?: BookingStatus | null; totalAmountVnd: string; termsVersion: string; depositRequiredVnd?: string; depositRecordedVnd?: string };
const statusLabel = { HELD: 'Đang giữ chỗ · chờ nhân viên gọi xác minh', CONFIRMED: 'Đã xác nhận đặt phòng', EXPIRED: 'Đã hết hạn giữ chỗ' } as const;
const RETRY_COOLDOWN_MS = 60_000;
function session(): Storage | null { try { return window.sessionStorage; } catch { return null; } }
const fixedRoomImages = ['/rooms/room-violet.svg', '/rooms/room-rose.svg', '/rooms/room-blue.svg'];

// The public terms endpoint answers 404 when the merchant has not configured terms; that is a normal state, not a failure.
function fetchTerms(branchId: string, signal?: AbortSignal): Promise<Terms> {
  return request<Terms>(`/public/branches/${encodeURIComponent(branchId)}/booking-terms`, { signal })
    .catch(err => { if (err instanceof ApiError && err.status === 404) return { configured: false, terms: null, version: null }; throw err; });
}
function durationLabel(minutes: number) { return minutes % 60 === 0 ? `${minutes / 60} giờ` : `${(minutes / 60).toLocaleString('vi-VN')} giờ`; }
/** Address, call button and Google Maps directions for a branch; each part is hidden when missing (PD-042). */
function BranchContact({ branch, compact = false }: { branch?: Branch; compact?: boolean }) {
  if (!branch || (!branch.address && !branch.phone && !branch.directionsUrl)) return null;
  return <div className="branch-contact-block">
    {branch.address && <p className="branch-address"><MapPin size={14} aria-hidden /> {branch.address}</p>}
    {!compact && (branch.phone || branch.directionsUrl) && <div className="branch-contact">
      {branch.phone && <a href={telHref(branch.phone)} aria-label={`Gọi ${branch.name} ${formatPhone(branch.phone)}`}><Phone size={14} aria-hidden /> {formatPhone(branch.phone)}</a>}
      {branch.directionsUrl && <a className="directions" href={branch.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={14} aria-hidden /> Chỉ đường</a>}
    </div>}
  </div>;
}
function money(value: string) { return `${BigInt(value).toLocaleString('vi-VN')} ₫`; }
function when(value: string, timezone?: string) { return new Date(value).toLocaleString('vi-VN', { timeZone: timezone ?? 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }); }

export default function CustomerBooking() {
  const [branches, setBranches] = useState<Branch[]>([]); const [branchId, setBranchId] = useState('');
  const [catalogRooms, setCatalogRooms] = useState<Room[]>([]); const [roomId, setRoomId] = useState('');
  // Time-dependent UI is computed only in the browser: this page is prerendered at build time, and React does not
  // repair server-rendered attributes (disabled, aria-pressed) on hydration, so build-time dates would stay on screen.
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => { setClock(Date.now()); const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const dayKey = clock === null ? null : upcomingDates(1, clock)[0].value;
  const dates = useMemo(() => dayKey === null ? [] : upcomingDates(7, Date.now()), [dayKey]);
  const [date, setDate] = useState(''); const [time, setTime] = useState('20:00');
  useEffect(() => { if (clock !== null && !date) { const choice = initialChoice(clock); setDate(choice.date); setTime(choice.time); } }, [clock, date]); const [duration, setDuration] = useState(120); const [guests, setGuests] = useState(4);
  const [availability, setAvailability] = useState<Availability | null>(null); const [quotes, setQuotes] = useState<Record<string, Quote | 'unavailable'>>({});
  const quoteValue = quotes[roomId]; const quote = quoteValue && quoteValue !== 'unavailable' ? quoteValue : null;
  const setQuote = (value: Quote | null) => setQuotes(current => { if (value) return { ...current, [value.roomId]: value }; const next = { ...current }; delete next[roomId]; return next; });
  const [terms, setTerms] = useState<Terms | null>(null); const [acceptedTerms, setAcceptedTerms] = useState<Terms | null>(null);
  const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [holding, setHolding] = useState(false); const [holdError, setHoldError] = useState('');
  const [pending, setPending] = useState<PublicHoldAttempt | null>(null); const [receipt, setReceipt] = useState<PublicHoldReceipt | null>(null); const [retryAt, setRetryAt] = useState(0); const [copied, setCopied] = useState(false);
  const [lookupPhone, setLookupPhone] = useState(''); const [lookupCode, setLookupCode] = useState(''); const [lookup, setLookup] = useState<Lookup | null>(null); const [lookupError, setLookupError] = useState(''); const [lookingUp, setLookingUp] = useState(false); const [lookupRetryAt, setLookupRetryAt] = useState(0);
  const [loading, setLoading] = useState(true); const [searching, setSearching] = useState(false); const [error, setError] = useState('');

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
    setAvailability(null); setQuotes({}); setAcceptedTerms(null);
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
    setQuotes({}); setAvailability(null);
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
  function newBooking() { const storage = session(); if (storage) clear(storage, PUBLIC_HOLD_RECEIPT_KEY); setReceipt(null); setQuotes({}); setAvailability(null); setAcceptedTerms(null); setHoldError(''); }
  async function copyCode(code: string) { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } }

  async function lookupBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLookup(null); setLookupError('');
    const cleanedPhone = cleanPhone(lookupPhone); const code = cleanBookingCode(lookupCode);
    if (!cleanedPhone || !code) { setLookupError('Nhập số điện thoại đã dùng khi đặt và mã đặt phòng gồm 6 ký tự (chữ và số).'); return; }
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

  function resetSearch() { setAvailability(null); setQuotes({}); setAcceptedTerms(null); }

  async function findAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setQuotes({}); setAcceptedTerms(null);
    if (!branchId || !date || !time) { setError('Vui lòng chọn địa điểm, ngày và giờ bắt đầu.'); return; }
    setSearching(true);
    try {
      const query = new URLSearchParams({ startAt: startAt(), durationMinutes: String(duration) });
      const value = await request<Availability>(`/public/branches/${encodeURIComponent(branchId)}/availability?${query}`);
      const eligible = value.rooms.filter(room => room.capacity >= guests);
      setAvailability({ ...value, rooms: eligible }); setRoomId('');
      // Price every listed room up front (bounded) so guests compare totals before choosing.
      const priced = await Promise.all(eligible.slice(0, 12).map(room => request<Quote>(`/public/rooms/${encodeURIComponent(room.id)}/quote`, { method: 'POST', body: JSON.stringify({ startAt: value.startAt, durationMinutes: value.durationMinutes }) }).then(q => [room.id, q] as const).catch(() => [room.id, 'unavailable'] as const)));
      setQuotes(Object.fromEntries(priced));
    } catch (err) { setAvailability(null); setRoomId(''); setError((err as Error).message); }
    finally { setSearching(false); }
  }

  const branch = branches.find(item => item.id === branchId); const rooms = availability?.rooms ?? []; const selectedRoom = rooms.find(item => item.id === roomId);
  const roomImage = (id: string) => fixedRoomImages[Math.max(0, catalogRooms.findIndex(item => item.id === id)) % fixedRoomImages.length];
  const today = dates[0]?.value ?? '';
  const lookupStatus = lookup ? (lookup.bookingStatus ?? lookup.status) : null;
  const pillTone = (value: string | null) => value === 'CANCELLED' || value === 'NO_SHOW' || value === 'EXPIRED' ? 'rose' : value === 'COMPLETED' ? 'gray' : value === 'HELD' ? 'amber' : 'green';
  return <div className="app">
    <header className="app-header"><a className="app-brand" href="/"><span className="logo-mark"><Mic2 size={18} aria-hidden /></span><span><strong>KaraokeNow</strong><small>Đặt phòng karaoke</small></span></a><nav><a href="#booking">Đặt phòng</a><a href="#lookup">Đơn của tôi</a><a href="/merchant">Dành cho chủ quán</a></nav></header>
    <main className="app-body customer">
      <section className="app-banner"><div><h1>Đặt phòng karaoke</h1><p>Nhanh – Tiện – Giá rõ ràng. Giữ chỗ online, nhân viên gọi xác nhận.</p></div><span className="banner-icon" aria-hidden><Mic2 size={40} /></span></section>
      {error && <div className="error" role="alert">{error}</div>}
      {receipt ? <section className="app-card success-card" role="status" aria-live="polite">
        <span className="success-icon"><Check size={36} aria-hidden /></span><h2>Giữ chỗ thành công!</h2>
        <p>{statusLabel[receipt.status] ?? receipt.status}</p>
        <label className="app-label">Mã đặt phòng — hãy lưu lại để tra cứu<code className="booking-code" aria-label={`Mã đặt phòng ${receipt.bookingCode.split('').join(' ')}`}>{formatBookingCode(receipt.bookingCode)}</code></label>
        <div className="summary"><div><span>Thời gian</span><strong>{when(receipt.startAt, branch?.timezone)}</strong></div><div><span>Thời lượng</span><strong>{durationLabel(receipt.durationMinutes)}</strong></div><div><span>Giữ chỗ đến</span><strong>{when(receipt.expiresAt, branch?.timezone)}</strong></div><div><span>Điều khoản</span><strong>Phiên bản {receipt.termsVersion}</strong></div><div className="total"><span>Tổng tiền</span><strong>{money(receipt.totalAmountVnd)}</strong></div></div>
        <BranchContact branch={branches.find(item => item.id === receipt.branchId)} />
        {receipt.depositRequiredVnd && receipt.depositRequiredVnd !== '0' ? <p className="deposit-callout">Cần đặt cọc <strong>{money(receipt.depositRequiredVnd)}</strong> bằng tiền mặt tại quầy trước khi nhân viên xác nhận. Không có thanh toán online.</p> : receipt.depositRequiredVnd === '0' ? <p>Không yêu cầu đặt cọc.</p> : null}
        <p>Nhân viên sẽ gọi số {receipt.phone} để xác minh; giữ chỗ chưa phải đặt phòng đã xác nhận.</p>
        <div className="success-actions"><button type="button" className="primary" onClick={() => void copyCode(receipt.bookingCode)}><Copy size={15} aria-hidden /> {copied ? 'Đã sao chép' : 'Sao chép mã'}</button><a className="secondary" href="#lookup" style={{ textAlign: 'center', textDecoration: 'none' }}>Xem đơn của tôi</a><button type="button" className="secondary" onClick={newBooking}>Đặt phòng khác</button></div>
        <small>Mã chỉ hiển thị một lần và được lưu tạm trong tab này. Đóng tab sẽ mất; dùng số điện thoại và mã để tra cứu.</small>
      </section> : <>
      <section className="app-card" id="booking" aria-labelledby="customer-booking-title">
        <h2 id="customer-booking-title"><span className="step-no">1</span>Chọn quán</h2>
        {loading && branches.length === 0 ? <p role="status">Đang tải danh mục…</p> : branches.length === 0 ? <div className="empty">Chưa có địa điểm được công khai.</div>
          : <div className="branch-list" role="group" aria-label="Địa điểm">{branches.map((item, index) => <button type="button" key={item.id} className="branch-option" aria-pressed={item.id === branchId} onClick={() => setBranchId(item.id)}><img src={item.merchantLogoUrl ?? fixedRoomImages[index % fixedRoomImages.length]} alt={item.merchantLogoUrl ? `Logo ${item.merchantName}` : ''} className={item.merchantLogoUrl ? 'merchant-logo' : undefined} onError={event => { const image = event.currentTarget; const fallback = fixedRoomImages[index % fixedRoomImages.length]; if (!image.src.endsWith(fallback)) { image.src = fallback; image.className = ''; image.alt = ''; } }} /><span><strong>{item.merchantName}</strong><small><MapPin size={12} aria-hidden /> {item.name}</small>{item.address && <small className="branch-option-address">{item.address}</small>}</span></button>)}</div>}
        {branch && <BranchContact branch={branch} />}
      </section>
      <form className="app-card" onSubmit={findAvailability} aria-labelledby="customer-time-title">
        <h2 id="customer-time-title"><span className="step-no">2</span>Chọn ngày &amp; giờ</h2>
        <span className="app-label">Chọn ngày</span>
        <div className="chip-row" role="group" aria-label="Chọn ngày">{dates.map(item => <button type="button" key={item.value} className="date-chip" aria-pressed={date === item.value} onClick={() => { setDate(item.value); setTime(current => firstSlot(item.value, current, Date.now()) ?? current); resetSearch(); }}>{item.weekday}<strong>{item.label}</strong></button>)}<label className="date-other"><span className="visually-hidden">Ngày</span><input aria-label="Ngày" type="date" min={today || undefined} value={date} onChange={event => { const value = event.target.value; setDate(value); setTime(current => firstSlot(value, current, Date.now()) ?? current); resetSearch(); }} required /></label></div>
        <span className="app-label">Chọn khung giờ</span>
        <div className="slot-grid" role="group" aria-label="Giờ bắt đầu">{SLOTS.map(slot => <button type="button" key={slot} className="slot" aria-pressed={time === slot} disabled={clock === null || !slotOpen(date, slot, clock)} onClick={() => { setTime(slot); resetSearch(); }}>{slot}</button>)}</div>
        <div className="stepper-row">
          <div><span className="app-label">Thời lượng</span><div className="stepper"><button type="button" aria-label="Giảm thời lượng" disabled={duration <= 60} onClick={() => { setDuration(value => value - 30); resetSearch(); }}><Minus size={16} /></button><output aria-live="polite" aria-label="Thời lượng">{durationLabel(duration)}</output><button type="button" aria-label="Tăng thời lượng" disabled={duration >= 480} onClick={() => { setDuration(value => value + 30); resetSearch(); }}><Plus size={16} /></button></div></div>
          <div><span className="app-label">Số khách</span><div className="stepper"><button type="button" aria-label="Giảm số khách" disabled={guests <= 1} onClick={() => { setGuests(value => value - 1); resetSearch(); }}><Minus size={16} /></button><output aria-live="polite" aria-label="Số khách">{guests} người</output><button type="button" aria-label="Tăng số khách" disabled={guests >= 100} onClick={() => { setGuests(value => value + 1); resetSearch(); }}><Plus size={16} /></button></div></div>
        </div>
        <button className="primary app-cta" disabled={loading || searching || !branchId || !date}><Search size={16} aria-hidden /> {searching ? 'Đang tìm…' : 'Tìm phòng trống'}</button>
      </form>
      {availability && <section className="app-card" aria-labelledby="customer-rooms-title">
        <h2 id="customer-rooms-title"><span className="step-no">3</span>Phòng còn trống</h2>
        <p><CalendarDays size={13} aria-hidden /> {when(availability.startAt, branch?.timezone)} · {durationLabel(availability.durationMinutes)} · {guests} khách{availability.appliedBufferMinutes ? ` · dọn phòng ${availability.appliedBufferMinutes} phút` : ''}</p>
        {rooms.length === 0 ? <div className="empty">Không có phòng phù hợp còn trống trong thời gian đã chọn.</div> : <div className="room-list">{rooms.map(room => { const value = quotes[room.id]; const priced = value && value !== 'unavailable' ? value : null; return <button type="button" key={room.id} className="room-option" aria-pressed={roomId === room.id} disabled={value === 'unavailable'} onClick={() => { setRoomId(room.id); setAcceptedTerms(null); setHoldError(''); }}>
          <img src={roomImage(room.id)} alt={`Ảnh minh họa cố định cho ${room.name}`} />
          <span><strong>{room.name}</strong><small>Tối đa {room.capacity} người</small><span className="room-price">{priced ? `${money(priced.totalAmountVnd)} / ${durationLabel(priced.durationMinutes)}` : value === 'unavailable' ? 'Chưa có giá cho khung giờ này' : searching ? 'Đang tính giá…' : ''}</span></span>
          <span className="room-pick">{roomId === room.id ? 'Đã chọn' : 'Chọn'}</span></button>; })}</div>}
      </section>}
      {availability && selectedRoom && quote && <section className="app-card" aria-labelledby="customer-confirm-title">
        <h2 id="customer-confirm-title"><span className="step-no">4</span>Xác nhận đặt phòng</h2>
        <div className="summary customer-quote" role="status"><div><span>Quán</span><strong>{branch?.merchantName} · {branch?.name}</strong></div>{branch?.address && <div><span>Địa chỉ</span><strong>{branch.address}</strong></div>}<div><span>Phòng</span><strong>{selectedRoom.name}</strong></div><div><span>Thời gian</span><strong>{when(availability.startAt, branch?.timezone)}</strong></div><div><span>Thời lượng</span><strong>{durationLabel(quote.durationMinutes)}</strong></div><div className="total"><span>Tạm tính</span><strong>{money(quote.totalAmountVnd)}</strong></div></div>
        {terms?.configured && terms.terms && terms.version ? <div className="customer-terms"><details><summary>Đọc điều khoản đặt phòng</summary><p>{terms.terms}</p><small>Phiên bản {terms.version}{terms.updatedAt ? ` · cập nhật ${new Date(terms.updatedAt).toLocaleString('vi-VN')}` : ''}</small></details><label className="check-row"><input type="checkbox" checked={acceptedTerms?.version === terms.version} onChange={event => setAcceptedTerms(event.target.checked ? { ...terms } : null)} /> Tôi đã đọc và đồng ý điều khoản phiên bản {terms.version}.</label></div> : <div className="notice">Merchant chưa cấu hình điều khoản đặt phòng công khai nên chưa thể giữ chỗ online.</div>}
        {holdError && <div className="error" role="alert">{holdError}</div>}
        {pending && <div className="notice" role="status">Có một yêu cầu giữ phòng chưa xác định kết quả ({when(pending.body.startAt, branch?.timezone)} · {pending.body.durationMinutes} phút · {money(pending.body.expectedTotalAmountVnd)}). <div className="hold-actions"><button type="button" className="primary" disabled={holding || retryAt > Date.now()} onClick={() => void send(pending)}>{holding ? 'Đang gửi…' : 'Gửi lại yêu cầu'}</button><button type="button" className="secondary" disabled={holding} onClick={discardPending}>Bỏ yêu cầu này</button></div></div>}
        {!pending && <form className="customer-contact" onSubmit={submitHold}><span className="app-label">Thông tin liên hệ</span><p>Nhân viên sẽ gọi số này để xác minh trước khi xác nhận. Không cần thanh toán online.</p><div className="fields contact-fields"><label>Số điện thoại<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="0912 345 678" required maxLength={24} /></label><label>Email (không bắt buộc)<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></label></div><button className="primary app-cta" disabled={holding || retryAt > Date.now() || !acceptedTerms || acceptedTerms.version !== terms?.version}>{holding ? 'Đang giữ phòng…' : `Giữ phòng · ${money(quote.totalAmountVnd)}`}</button></form>}
      </section>}
      {pending && !(availability && selectedRoom && quote) && <div className="notice" role="status">Có một yêu cầu giữ phòng chưa xác định kết quả ({when(pending.body.startAt, branch?.timezone)} · {pending.body.durationMinutes} phút · {money(pending.body.expectedTotalAmountVnd)}). <div className="hold-actions"><button type="button" className="primary" disabled={holding || retryAt > Date.now()} onClick={() => void send(pending)}>{holding ? 'Đang gửi…' : 'Gửi lại yêu cầu'}</button><button type="button" className="secondary" disabled={holding} onClick={discardPending}>Bỏ yêu cầu này</button></div></div>}
      {holdError && !(availability && selectedRoom && quote) && <div className="error" role="alert">{holdError}</div>}
      </>}
      <section className="app-card customer-lookup" id="lookup" aria-labelledby="customer-lookup-title"><h2 id="customer-lookup-title"><ClipboardList size={18} aria-hidden /> Đơn của tôi</h2><p>Tra cứu bằng số điện thoại đã dùng và mã đặt phòng 6 ký tự (ví dụ K7M 4XQ).</p>
        <form className="fields contact-fields" onSubmit={lookupBooking}><label>Số điện thoại<input type="tel" inputMode="tel" autoComplete="tel" value={lookupPhone} onChange={event => setLookupPhone(event.target.value)} required maxLength={24} /></label><label>Mã đặt phòng<input value={lookupCode} onChange={event => setLookupCode(event.target.value)} required maxLength={40} autoCapitalize="characters" placeholder="K7M 4XQ" autoComplete="off" spellCheck={false} /></label><button className="primary" disabled={lookingUp || lookupRetryAt > Date.now()}>{lookingUp ? 'Đang tra cứu…' : 'Tra cứu'}</button></form>
        {lookupError && <div className="error" role="alert">{lookupError}</div>}
        {lookup && <div className="order-card customer-receipt" role="status"><div className="order-head"><strong>{branches.find(item => item.id === lookup.branchId)?.merchantName ?? 'Đặt phòng'}</strong><span className={`pill ${pillTone(lookupStatus)}`}>{lookup.bookingStatus ? 'Booking' : 'Giữ chỗ'}</span></div><h3>{lookup.bookingStatus ? bookingStatusLabel[lookup.bookingStatus] ?? lookup.bookingStatus : statusLabel[lookup.status] ?? lookup.status}</h3><p>{branches.find(item => item.id === lookup.branchId)?.name ?? 'Địa điểm'} · {catalogRooms.find(item => item.id === lookup.roomId)?.name ?? 'Phòng đã chọn'}</p><p><CalendarDays size={13} aria-hidden /> {when(lookup.startAt, branches.find(item => item.id === lookup.branchId)?.timezone)} · {durationLabel(lookup.durationMinutes)} · <strong>{money(lookup.totalAmountVnd)}</strong></p>{lookup.depositRequiredVnd && lookup.depositRequiredVnd !== '0' && <p>Cọc yêu cầu: {money(lookup.depositRequiredVnd)} · đã ghi nhận: {money(lookup.depositRecordedVnd ?? '0')}{lookup.status === 'HELD' && BigInt(lookup.depositRecordedVnd ?? '0') < BigInt(lookup.depositRequiredVnd) ? ' · vui lòng đặt cọc tiền mặt tại quầy' : ''}</p>}<small>Điều khoản phiên bản {lookup.termsVersion}{lookup.bookingId ? ` · Mã booking: ${lookup.bookingId}` : ''}</small><BranchContact branch={branches.find(item => item.id === lookup.branchId)} /></div>}
      </section>
    </main>
    <nav className="app-tabbar" aria-label="Điều hướng"><a href="#booking" className="active"><Home size={20} aria-hidden />Đặt phòng</a><a href="#lookup"><ClipboardList size={20} aria-hidden />Đơn của tôi</a><a href="/merchant"><CheckCircle2 size={20} aria-hidden />Chủ quán</a></nav>
  </div>;
}
