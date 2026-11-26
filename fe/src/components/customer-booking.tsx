'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { request } from '@/lib/api';

type Branch = { id: string; merchantId: string; merchantName: string; name: string; timezone: string };
type Room = { id: string; branchId?: string; name: string; capacity: number };
type Page<T> = { items: T[]; hasMore: boolean };
type Availability = { branchId: string; startAt: string; requestedEndAt: string; durationMinutes: number; bufferEnabled: boolean; bufferMinutes: number; appliedBufferMinutes: number; reservedEndAt: string; rooms: Room[] };
type Quote = { branchId: string; roomId: string; timezone: string; startAt: string; endAt: string; durationMinutes: number; currency: 'VND'; totalAmountVnd: string; bookingDurationPolicy: { durationStepMinutes: number; minDurationMinutes: number; maxDurationMinutes: number } };
type Terms = { configured: boolean; terms: string | null; version: string | null; updatedAt?: string | null };
const fixedRoomImages = ['/rooms/room-violet.svg', '/rooms/room-rose.svg', '/rooms/room-blue.svg'];

export default function CustomerBooking() {
  const [branches, setBranches] = useState<Branch[]>([]); const [branchId, setBranchId] = useState('');
  const [catalogRooms, setCatalogRooms] = useState<Room[]>([]); const [roomId, setRoomId] = useState('');
  const [date, setDate] = useState(''); const [time, setTime] = useState('20:00'); const [duration, setDuration] = useState('120'); const [guests, setGuests] = useState(8);
  const [availability, setAvailability] = useState<Availability | null>(null); const [quote, setQuote] = useState<Quote | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null); const [acceptedTerms, setAcceptedTerms] = useState<Terms | null>(null);
  const [loading, setLoading] = useState(true); const [searching, setSearching] = useState(false); const [quoting, setQuoting] = useState(false); const [error, setError] = useState('');

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
      request<Terms>(`/public/branches/${encodeURIComponent(branchId)}/booking-terms`, { signal: controller.signal }),
    ]).then(([roomPage, termsValue]) => {
      setCatalogRooms(roomPage.items); setRoomId(current => roomPage.items.some(item => item.id === current) ? current : roomPage.items[0]?.id ?? ''); setTerms(termsValue);
    }).catch(err => { if (!controller.signal.aborted) { setCatalogRooms([]); setRoomId(''); setTerms(null); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId]);

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
  const money = (value: string) => `${BigInt(value).toLocaleString('vi-VN')} ₫`;
  return <main className="customer">
    <div className="demo">DỮ LIỆU THẬT · Đã nối catalog, phòng trống, báo giá và điều khoản. Public guest hold/booking chưa có nên chưa gửi đặt phòng.</div>
    <div className="customer-hero"><div className="eyebrow">KARAOKENOW · HÀ NỘI</div><h1>Buổi hát hay bắt đầu từ một căn phòng phù hợp.</h1><p>Chọn địa điểm, thời gian và xem giá chính xác trước khi quyết định.</p></div>
    <section className="booking card" aria-labelledby="customer-booking-title"><div className="booking-head"><div><h2 id="customer-booking-title">Tìm phòng trống</h2><p>Thời gian trống và giá được tính trực tiếp từ hệ thống Merchant.</p></div><span aria-hidden="true">✦</span></div>
      {error && <div className="error" role="alert">{error}</div>}
      <form className="fields customer-search" onSubmit={findAvailability}><label>Địa điểm<select value={branchId} onChange={event => setBranchId(event.target.value)} disabled={loading || branches.length === 0}>{branches.map(item => <option key={item.id} value={item.id}>{item.merchantName} · {item.name}</option>)}</select></label><label>Ngày<input type="date" value={date} onChange={event => { setDate(event.target.value); setAvailability(null); setQuote(null); }} required /></label><label>Giờ bắt đầu<input type="time" value={time} onChange={event => { setTime(event.target.value); setAvailability(null); setQuote(null); }} step={1800} required /></label><label>Thời lượng<select value={duration} onChange={event => { setDuration(event.target.value); setAvailability(null); setQuote(null); }}><option value="60">1 giờ</option><option value="90">1,5 giờ</option><option value="120">2 giờ</option><option value="180">3 giờ</option></select></label><label>Số khách<input type="number" value={guests} onChange={event => { setGuests(Number(event.target.value)); setAvailability(null); setQuote(null); }} min={1} max={100} /></label><button className="primary" disabled={loading || searching || !branchId}>{searching ? 'Đang tìm…' : 'Tìm phòng trống'}</button></form>
      <div className="section-title"><div><h2>{availability ? 'Phòng còn trống' : `Phòng tại ${branch?.name ?? 'địa điểm đã chọn'}`}</h2><p>{availability ? `${new Date(availability.startAt).toLocaleString('vi-VN', { timeZone: branch?.timezone })} · ${availability.durationMinutes} phút · buffer ${availability.appliedBufferMinutes} phút` : branch ? `${branch.merchantName} · ${branch.timezone}` : 'Chưa có địa điểm công khai'}</p></div></div>
      {loading ? <p role="status">Đang tải danh mục…</p> : branches.length === 0 ? <div className="empty">Chưa có địa điểm được công khai.</div> : rooms.length === 0 ? <div className="empty">{availability ? 'Không có phòng phù hợp còn trống trong thời gian đã chọn.' : 'Địa điểm này chưa có phòng công khai.'}</div> : <div className="room-grid">{rooms.map((room, index) => <button type="button" className={`choice-card ${roomId === room.id ? 'selected' : ''}`} key={room.id} onClick={() => { setRoomId(room.id); setQuote(null); }} aria-pressed={roomId === room.id}><div className="choice-art"><img src={fixedRoomImages[index % fixedRoomImages.length]} alt={`Ảnh minh họa cố định cho ${room.name}`} /><span>{room.name}</span></div><div className="choice-content"><strong>{room.name}</strong><p>Tối đa {room.capacity} khách</p><small>Ảnh minh họa cố định</small></div></button>)}</div>}
      {availability && selectedRoom && <div className="quote-actions"><div><strong>{selectedRoom.name}</strong><p>{date} · {time} · {Number(duration) / 60} giờ · {guests} khách</p></div><button type="button" className="primary" disabled={quoting} onClick={() => void getQuote()}>{quoting ? 'Đang tính giá…' : 'Xem giá phòng này'}</button></div>}
      {quote && <div className="customer-quote" role="status"><span>Tổng giá phòng</span><strong>{money(quote.totalAmountVnd)}</strong><small>{quote.durationMinutes} phút · {quote.currency} · chính sách bước {quote.bookingDurationPolicy.durationStepMinutes} phút</small></div>}
      {terms?.configured && terms.terms && terms.version ? <div className="customer-terms"><details><summary>Đọc điều khoản đặt phòng</summary><p>{terms.terms}</p><small>Phiên bản {terms.version}{terms.updatedAt ? ` · cập nhật ${new Date(terms.updatedAt).toLocaleString('vi-VN')}` : ''}</small></details><label className="check-row"><input type="checkbox" checked={acceptedTerms?.version === terms.version} onChange={event => setAcceptedTerms(event.target.checked ? { ...terms } : null)} /> Tôi đã đọc và đồng ý điều khoản phiên bản {terms.version}.</label></div> : <div className="notice">Merchant chưa cấu hình điều khoản đặt phòng công khai.</div>}
      {quote && acceptedTerms && <div className="notice" role="status">Đã giữ snapshot điều khoản phiên bản {acceptedTerms.version} cùng báo giá {money(quote.totalAmountVnd)}. Nút gửi booking sẽ mở khi public guest hold API được cấp.</div>}
    </section>
  </main>;
}
