'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';
import { clearHoldAttempt, holdStorageKey, readHoldAttempt, writeHoldAttempt, type HoldAttempt } from '@/lib/hold-attempt';

type Room = { id: string; name: string; code: string; capacity: number };
type Availability = { rooms: Room[]; startAt: string; requestedEndAt: string; reservedEndAt: string; appliedBufferMinutes: number };
type Quote = { priceSnapshot: { totalAmountVnd: string; currency: string; timezone: string; calculation: { priceRuleCode: string; amountUnit: string } } };
type Hold = { id: string; roomId: string; channel: string; startAt: string; durationMinutes: number; reservedEndAt: string; expiresAt: string; bufferMinutes: number; status: 'HELD' | 'EXPIRED' };
type Props = { token: string; tenant: string; branchId: string; timezone: string };

export default function AvailabilityQuote({ token, tenant, branchId, timezone }: Props) {
  const [start, setStart] = useState('');
  const [offset, setOffset] = useState('+07:00');
  const [minutes, setMinutes] = useState('120');
  const [result, setResult] = useState<Availability | null>(null);
  const [query, setQuery] = useState<{ startAt: string; durationMinutes: number } | null>(null);
  const [quote, setQuote] = useState<{ roomName: string; data: Quote } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<HoldAttempt | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [holdError, setHoldError] = useState('');
  const [holdBusy, setHoldBusy] = useState(false);
  const holdBusyRef = useRef(false);
  const storageKeyRef = useRef<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    try {
      const key = holdStorageKey(token, tenant, branchId);
      const saved = readHoldAttempt(window.sessionStorage, key);
      storageKeyRef.current = key;
      if (saved) { setAttempt(saved); setRecovered(true); }
      setRecoveryReady(true);
    } catch (err) { setHoldError((err as Error).message || 'Không thể truy cập bộ nhớ phiên để khôi phục hold.'); }
  }, [token, tenant, branchId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset) || (offset.slice(1, 3) === '14' && offset.slice(4) !== '00')) {
      setError('Múi giờ lệch phải có dạng +07:00, từ -14:00 đến +14:00.'); return;
    }
    const input = { startAt: `${start}:00${offset}`, durationMinutes: Number(minutes) };
    if (!Number.isFinite(Date.parse(input.startAt))) { setError('Thời gian không hợp lệ.'); return; }
    setBusy(true); setError(''); setResult(null); setQuote(null); setQuery(null);
    try {
      const params = new URLSearchParams({ startAt: input.startAt, durationMinutes: String(input.durationMinutes) });
      const data = await request<Availability>(`/merchant/branches/${encodeURIComponent(branchId)}/availability?${params}`, {}, token, tenant);
      setResult(data); setQuery(input);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function getQuote(room: Room) {
    if (!query) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      const data = await request<Quote>(`/merchant/rooms/${encodeURIComponent(room.id)}/quote`, { method: 'POST', body: JSON.stringify(query) }, token, tenant);
      setQuote({ roomName: room.name, data });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function sendHold(current: HoldAttempt) {
    if (holdBusyRef.current) return;
    holdBusyRef.current = true; setHoldBusy(true); setHoldError('');
    try {
      const response = await request<Hold>('/merchant/booking/holds', { method: 'POST', headers: { 'Idempotency-Key': current.key }, body: JSON.stringify(current.input) }, token, tenant);
      setHold(response);
    } catch (err) { setHoldError((err as Error).message); }
    finally { holdBusyRef.current = false; setHoldBusy(false); }
  }

  function startHold(room: Room) {
    if (!query || holdBusyRef.current || attempt || !recoveryReady || !storageKeyRef.current) return;
    if (!globalThis.crypto?.randomUUID) { setHoldError('Trình duyệt cần HTTPS hoặc localhost để tạo mã yêu cầu an toàn.'); return; }
    const current = { key: globalThis.crypto.randomUUID(), room, input: { roomId: room.id, startAt: query.startAt, durationMinutes: query.durationMinutes, channel: 'WALK_IN' } };
    try { writeHoldAttempt(window.sessionStorage, storageKeyRef.current, current); }
    catch { setHoldError('Không thể lưu mã thử lại trong phiên trình duyệt; chưa gửi yêu cầu giữ phòng.'); return; }
    setAttempt(current); setRecovered(false); void sendHold(current);
  }

  function clearAttempt() {
    if (!storageKeyRef.current) return;
    try { clearHoldAttempt(window.sessionStorage, storageKeyRef.current); }
    catch { setHoldError('Không thể xóa dữ liệu khôi phục; yêu cầu vẫn được giữ để tránh mất dấu.'); return; }
    setAttempt(null); setHold(null); setHoldError(''); setRecovered(false); setResult(null); setQuery(null);
  }

  async function refreshHold() {
    if (!hold || holdBusyRef.current) return;
    holdBusyRef.current = true; setHoldBusy(true); setHoldError('');
    try { setHold(await request<Hold>(`/merchant/booking/holds/${encodeURIComponent(hold.id)}`, {}, token, tenant)); }
    catch (err) { setHoldError((err as Error).message); }
    finally { holdBusyRef.current = false; setHoldBusy(false); }
  }

  return <section className="card availability" aria-labelledby="availability-title">
    <h2 id="availability-title">Tìm phòng trống &amp; báo giá</h2>
    <p>Chi nhánh dùng múi giờ {timezone}. Chọn độ lệch múi giờ tương ứng với thời gian nhập; kết quả tìm kiếm không giữ phòng.</p>
    <form className="availability-form" onSubmit={search}>
      <label>Thời gian bắt đầu<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} required /></label>
      <label>Độ lệch UTC<input value={offset} onChange={e => setOffset(e.target.value)} placeholder="+07:00" required pattern="[+-][0-9]{2}:[0-9]{2}" /></label>
      <label>Thời lượng (phút)<input type="number" min={1} max={1440} step={1} value={minutes} onChange={e => setMinutes(e.target.value)} required /></label>
      <button className="primary" disabled={busy || holdBusy || !!attempt}>{busy ? 'Đang xử lý…' : 'Tìm phòng'}</button>
    </form>
    {error && <div className="error" role="alert">{error}</div>}
    {result && <div aria-live="polite"><p>Thời gian đã tra: {new Date(result.startAt).toLocaleString('vi-VN', { timeZone: timezone })} – {new Date(result.requestedEndAt).toLocaleString('vi-VN', { timeZone: timezone })} ({timezone}). Buffer sau lượt: {result.appliedBufferMinutes} phút.</p>
      {result.rooms.length === 0 ? <p>Không có phòng phù hợp trong khoảng thời gian này.</p> : <ul className="availability-list">{result.rooms.map(room => <li key={room.id}><span><strong>{room.name}</strong> · {room.code} · tối đa {room.capacity} khách</span><div className="amenity-buttons"><button type="button" disabled={busy || holdBusy} onClick={() => void getQuote(room)}>Xem báo giá</button><button type="button" disabled={busy || holdBusy || !!attempt || !recoveryReady} onClick={() => startHold(room)}>Giữ phòng walk-in</button></div></li>)}</ul>}
    </div>}
    {quote && <div className="notice" role="status"><strong>{quote.roomName}: {new Intl.NumberFormat('vi-VN').format(BigInt(quote.data.priceSnapshot.totalAmountVnd))} ₫</strong><br />Quy tắc {quote.data.priceSnapshot.calculation.priceRuleCode} · {quote.data.priceSnapshot.calculation.amountUnit === 'PER_HOUR' ? 'theo giờ' : 'theo lượt'}. Báo giá chỉ mang tính tra cứu, chưa tạo booking.</div>}
    {!attempt && holdError && <div className="error" role="alert">{holdError}</div>}
    {attempt && <div className="hold-result" aria-live="polite"><h3>Giữ phòng walk-in · {attempt.room.name}</h3><p>Bắt đầu: {attempt.input.startAt} · {attempt.input.durationMinutes} phút. Giữ phòng tạm thời chưa phải xác nhận booking; chưa lưu khách hàng hoặc báo giá.</p>{recovered && <p>Đã khôi phục yêu cầu từ phiên trình duyệt này. Nhấn thử lại để lấy trạng thái từ hệ thống; không tự động gửi.</p>}{holdError && <div className="error" role="alert">{holdError}</div>}{hold ? <><p><strong>Trạng thái: {hold.status === 'HELD' ? 'Đang giữ' : 'Đã hết hạn'}</strong><br />Mã giữ: {hold.id}<br />Hạn giữ: {new Date(hold.expiresAt).toLocaleString('vi-VN', { timeZone: timezone })} ({timezone})<br />Giữ chỗ đến: {new Date(hold.reservedEndAt).toLocaleString('vi-VN', { timeZone: timezone })} ({timezone}), gồm {hold.bufferMinutes} phút dọn phòng.</p><div className="amenity-buttons"><button type="button" className="primary" disabled={holdBusy} onClick={() => void refreshHold()}>Kiểm tra trạng thái</button><button type="button" disabled={holdBusy} onClick={clearAttempt}>Tra cứu lượt khác</button></div></> : <><p>Yêu cầu chưa có kết quả xác định. Thử lại sẽ dùng cùng mã yêu cầu để tránh tạo trùng.</p><button type="button" className="primary" disabled={holdBusy} onClick={() => void sendHold(attempt)}>{holdBusy ? 'Đang gửi…' : 'Thử lại cùng yêu cầu'}</button><button type="button" disabled={holdBusy} onClick={() => { if (window.confirm('Yêu cầu có thể đã được xử lý. Bỏ theo dõi sẽ xóa mã thử lại; hãy kiểm tra danh sách hold trước khi tạo yêu cầu mới. Tiếp tục?')) clearAttempt(); }}>Bỏ theo dõi yêu cầu</button></>}</div>}
  </section>;
}
